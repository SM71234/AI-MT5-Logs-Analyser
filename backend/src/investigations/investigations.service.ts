import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Mt5Service } from '../mt5/mt5.service';
import { JournalEngineService } from '../journal/journal-engine.service';
import { MetricsService, CalculatedMetrics } from '../metrics/metrics.service';
import { NormalizedEvent } from '../journal/normalization.engine';
import { AiService } from '../ai/ai.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { ChatFollowupDto } from './dto/chat-followup.dto';
import { Investigation } from '@prisma/client';

@Injectable()
export class InvestigationsService {
  private readonly logger = new Logger('InvestigationsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mt5Service: Mt5Service,
    private readonly journalEngineService: JournalEngineService,
    private readonly metricsService: MetricsService,
    private readonly aiService: AiService,
  ) {}

  // Creates or retrieves a trade investigation case
  async create(dto: CreateInvestigationDto, operatorId: string, ipAddress?: string): Promise<Investigation> {
    // 1. Fetch raw logs for the client
    const rawLogs = await this.mt5Service.getClientJournal(
      dto.brokerId,
      dto.login,
      operatorId,
      ipAddress,
    );

    // 2. Correlate logs into timelines
    const incidents = this.journalEngineService.processLogs(rawLogs);
    
    // Find the trade details from the broker's history to get the exact Order/Deal IDs
    const trades = await this.mt5Service.getClientTrades(dto.brokerId, dto.login, operatorId, ipAddress);
    const targetTrade = trades.find((t) => t.positionId === dto.ticket || t.ticket === dto.ticket);
    
    let entryIncident;
    let exitIncident = null;
    
    if (targetTrade) {
      const entryOrderId = targetTrade.entry?.orderId;
      const entryDealId = targetTrade.entry?.dealId;
      const exitOrderId = targetTrade.exit?.orderId;
      const exitDealId = targetTrade.exit?.dealId;
      
      entryIncident = incidents.find((incident) => {
        return incident.events.some((e) => {
          const orderId = e.metadata.orderId;
          const dealId = e.metadata.dealId;
          const ticket = e.metadata.ticket;
          
          return (entryOrderId && orderId === entryOrderId) || 
                 (entryDealId && dealId === entryDealId) ||
                 (ticket && ticket === dto.ticket);
        });
      });
      
      exitIncident = incidents.find((incident) => {
        if (!exitOrderId && !exitDealId) return false;
        return incident.events.some((e) => {
          const orderId = e.metadata.orderId;
          const dealId = e.metadata.dealId;
          
          return (exitOrderId && orderId === exitOrderId) || 
                 (exitDealId && dealId === exitDealId);
        });
      }) || null;
    } else {
      // It might be a rejected trade that only exists in the journal log.
      // Search the correlated incidents directly by ticket ID
      entryIncident = incidents.find((incident) => {
        return incident.ticketId === dto.ticket || incident.events.some((e) => {
          return e.metadata.orderId === dto.ticket || 
                 e.metadata.ticket === dto.ticket;
        });
      });
    }

    if (!entryIncident) {
      throw new BadRequestException(
        `Failed to reconstruct opening trade lifecycle. Ensure Ticket #${dto.ticket} exists in the MT5 journal.`,
      );
    }
 
     // 3. Programmatically calculate execution metrics for entry and exit separately
     let digits: number | null = null;
     let point: number | null = null;
     try {
       const symbolInfo = await this.mt5Service.getSymbolSpecs(
         dto.brokerId,
         entryIncident.symbol,
         operatorId,
         ipAddress,
       );
       if (symbolInfo) {
         digits = symbolInfo.digits;
         point = symbolInfo.point;
       }
     } catch (error) {
       this.logger.warn(`Failed to resolve dynamic symbol specs for ${entryIncident.symbol}`, error);
     }
 
     const entryMetrics = this.metricsService.calculate(entryIncident, digits, point);
     const exitMetrics = exitIncident
       ? this.metricsService.calculate(exitIncident, digits, point)
       : null;

      // Combine events from both entry and exit executions for a complete timeline display
      const combinedEvents = [...entryIncident.events];
      if (exitIncident) {
        for (const ev of exitIncident.events) {
          if (!combinedEvents.some((e) => e.timestamp === ev.timestamp && e.eventType === ev.eventType)) {
            combinedEvents.push(ev);
          }
        }
      }
      combinedEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Calculate overall trade summaries using the shared execution analysis engine
      const executionAnalysis = this.metricsService.analyzeExecution(entryMetrics, exitMetrics);

      const structuredMetrics = {
        entry: entryMetrics,
        exit: exitMetrics,
        summary: {
          netAdversePriceImpact: executionAnalysis.netSlippage.slippageType === 'Adverse' 
            ? executionAnalysis.netSlippage.slippagePoints 
            : 0,
          cumulativeLatencyMs: executionAnalysis.cumulativeLatency,
          averageLatencyMs: executionAnalysis.averageLatency,
          ...executionAnalysis,
        },
        canonicalResult: this.buildCanonicalResult(
          dto.login,
          dto.ticket,
          entryIncident,
          entryMetrics,
          exitIncident,
          exitMetrics,
          combinedEvents
        ),
      };
 
     // 4. Save to database
     const title = `Trade Incident — ${entryIncident.symbol} ${entryIncident.action} ${entryIncident.volume} Lot`;

     const existing = await this.prisma.investigation.findFirst({
       where: { ticketId: dto.ticket, brokerId: dto.brokerId },
     });

     let investigation: Investigation;
     if (existing) {
       this.logger.log(`Updating existing investigation case for Ticket #${dto.ticket}`);
       investigation = await this.prisma.investigation.update({
         where: { id: existing.id },
         data: {
           title,
           metrics: JSON.stringify(structuredMetrics),
           events: JSON.stringify(combinedEvents),
         },
       });
     } else {
       this.logger.log(`Creating new investigation case for Ticket #${dto.ticket}`);
       investigation = await this.prisma.investigation.create({
         data: {
           brokerId: dto.brokerId,
           userId: operatorId,
           clientLogin: dto.login,
           ticketId: dto.ticket,
           title,
           status: 'OPEN',
           metrics: JSON.stringify(structuredMetrics),
           events: JSON.stringify(combinedEvents),
         },
       });
     }

    await this.logAction(
      operatorId,
      'CREATE_INVESTIGATION',
      `Saved/Updated investigation case for client ${dto.login}, Ticket #${dto.ticket}`,
      ipAddress,
    );

    return investigation;
  }

  // Lists all saved investigation cases
  async findAll(): Promise<any[]> {
    return this.prisma.investigation.findMany({
      include: {
        broker: {
          select: { name: true },
        },
        user: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Gets detailed case information
  async findOne(id: string): Promise<any> {
    const caseFile = await this.prisma.investigation.findUnique({
      where: { id },
      include: {
        broker: { select: { name: true } },
        user: { select: { name: true } },
        notes: {
          include: {
            user: { select: { name: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        aiReports: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!caseFile) {
      throw new NotFoundException(`Investigation case ID ${id} not found`);
    }

    let parsedMetrics = JSON.parse(caseFile.metrics);
    const parsedEvents = JSON.parse(caseFile.events);

    // Dynamic historical case self-healing & recalculation migration
    const isOldFormat = !parsedMetrics.entry || 
                        parsedMetrics.entry.priceRequested === undefined || 
                        parsedMetrics.entry.priceExecuted === undefined;
                        
    const needsCanonicalResult = !parsedMetrics.canonicalResult;

    if (isOldFormat || needsCanonicalResult) {
      try {
        this.logger.log(`Performing dynamic metrics recalculation for historical case ID ${id}`);
        const rawLines = parsedEvents.map((e: any) => e.rawMessage);
        const correlated = this.journalEngineService.processLogs(rawLines);
        
        // Find matching entry and exit incidents based on trade action names
        const entryInc = correlated.find(c => c.action === (caseFile.title.includes('BUY') ? 'BUY' : 'SELL'));
        const exitInc = correlated.find(c => c.action === (caseFile.title.includes('BUY') ? 'SELL' : 'BUY'));
        
        if (entryInc) {
          const entryM = this.metricsService.calculate(entryInc, parsedMetrics.digits || parsedMetrics.entry?.digits, parsedMetrics.pointSize || parsedMetrics.entry?.pointSize);
          const exitM = exitInc ? this.metricsService.calculate(exitInc, parsedMetrics.digits || parsedMetrics.entry?.digits, parsedMetrics.pointSize || parsedMetrics.entry?.pointSize) : null;
          
          const executionAnalysis = this.metricsService.analyzeExecution(entryM, exitM);
          
          parsedMetrics = {
            entry: entryM,
            exit: exitM,
            summary: {
              netAdversePriceImpact: executionAnalysis.netSlippage.slippageType === 'Adverse'
                ? executionAnalysis.netSlippage.slippagePoints
                : 0,
              cumulativeLatencyMs: executionAnalysis.cumulativeLatency,
              averageLatencyMs: executionAnalysis.averageLatency,
              ...executionAnalysis,
            },
            canonicalResult: this.buildCanonicalResult(
              caseFile.clientLogin,
              caseFile.ticketId,
              entryInc,
              entryM,
              exitInc || null,
              exitM,
              parsedEvents
            )
          };
          
          // Persist the corrected metrics in the database
          await this.prisma.investigation.update({
            where: { id },
            data: { metrics: JSON.stringify(parsedMetrics) }
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to dynamically correct metrics for case ${id}: ${err.message}`);
      }
    }

    return {
      ...caseFile,
      metrics: parsedMetrics,
      events: parsedEvents,
    };
  }

  // Adds a note to a case file
  async addNote(id: string, dto: CreateNoteDto, operatorId: string, ipAddress?: string): Promise<any> {
    const caseFile = await this.prisma.investigation.findUnique({ where: { id } });
    if (!caseFile) {
      throw new NotFoundException(`Investigation case ID ${id} not found`);
    }

    const note = await this.prisma.note.create({
      data: {
        investigationId: id,
        userId: operatorId,
        content: dto.content,
      },
      include: {
        user: { select: { name: true, role: true } },
      },
    });

    await this.logAction(
      operatorId,
      'ADD_NOTE',
      `Added note to case ID ${id}: "${dto.content.substring(0, 30)}..."`,
      ipAddress,
    );

    return note;
  }

  // Triggers AI Analysis for a case (checks cache first)
  async analyze(id: string, operatorId: string, ipAddress?: string): Promise<any> {
    const caseFile = await this.prisma.investigation.findUnique({ where: { id } });
    if (!caseFile) {
      throw new NotFoundException(`Investigation case not found`);
    }

    const metrics = JSON.parse(caseFile.metrics);
    const events = JSON.parse(caseFile.events);

    // 1. Generate prompt hash to verify cache hit
    const promptHash = this.aiService.generatePromptHash(caseFile.ticketId, metrics);

    // Check if an AI report for this prompt state already exists in DB
    const cachedReport = await this.prisma.aiReport.findFirst({
      where: { investigationId: id, promptHash },
    });

    if (cachedReport) {
      this.logger.log(`AI Cache hit for Case ${id}. Returning saved report.`);
      return cachedReport;
    }

    // 2. Perform AI completions
    const reportText = await this.aiService.generateAnalysis(
      caseFile.clientLogin,
      caseFile.ticketId,
      caseFile.title.includes('BUY') ? 'BUY' : 'SELL', // simplified for helper
      caseFile.title.split(' — ')[1]?.split(' ')[0] || 'EURUSD',
      metrics.volume || 1.0,
      metrics,
      events,
    );

    // 3. Cache the generated report
    const report = await this.prisma.aiReport.create({
      data: {
        investigationId: id,
        analysisType: 'TIMELINE_ANALYSIS',
        promptHash,
        response: reportText,
      },
    });

    await this.logAction(
      operatorId,
      'ANALYZE_CASE_AI',
      `Triggered AI Incident Report for case ${id}`,
      ipAddress,
    );

    return report;
  }

  // Handles client dispute chat questions
  async chat(id: string, dto: ChatFollowupDto, operatorId: string, ipAddress?: string): Promise<string> {
    const caseFile = await this.prisma.investigation.findUnique({
      where: { id },
      include: {
        aiReports: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!caseFile) {
      throw new NotFoundException(`Case file not found`);
    }

    const latestReport = caseFile.aiReports[0];
    if (!latestReport) {
      throw new BadRequestException('You must generate the AI Analysis report before starting a follow-up chat');
    }

    const history = (dto.chatHistory || []).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    let canonicalResult = null;
    try {
      const parsedMetrics = JSON.parse(caseFile.metrics);
      canonicalResult = parsedMetrics.canonicalResult || null;
    } catch (e) {}

    const response = await this.aiService.followUpChat(
      latestReport.response,
      canonicalResult,
      history,
      dto.message,
    );

    await this.logAction(
      operatorId,
      'CHAT_CASE_AI',
      `Queried AI helper about case ${id}: "${dto.message.substring(0, 30)}..."`,
      ipAddress,
    );

    return response;
  }

  private buildCanonicalResult(
    clientLogin: string,
    ticketId: string,
    entryIncident: any,
    entryMetrics: CalculatedMetrics,
    exitIncident: any | null,
    exitMetrics: CalculatedMetrics | null,
    combinedEvents: NormalizedEvent[]
  ): any {
    const isRejected = entryMetrics.rejection?.isRejected || false;
    const executed = entryMetrics.executed;
    const status = entryMetrics.status;
    
    const openSubmittedEvent = entryIncident.events.find((e: any) => e.eventType === 'ORDER_SUBMITTED');
    const openExecutedEvent = entryIncident.events.find((e: any) => e.eventType === 'ORDER_EXECUTED');
    const orderId = openSubmittedEvent?.metadata?.orderId || openSubmittedEvent?.metadata?.ticket || null;
    const dealId = openExecutedEvent?.metadata?.dealId || null;
    
    // Construct the timeline with explanations and tech details
    const timeline = combinedEvents.map((ev, index) => {
      let explanation = '';
      let technicalDetails = '';
      const relatedIds: string[] = [];
      const orderId = ev.metadata.orderId || ev.metadata.ticket || '';
      const dealId = ev.metadata.dealId || '';
      if (orderId) relatedIds.push(`Order #${orderId}`);
      if (dealId) relatedIds.push(`Deal #${dealId}`);

      switch (ev.eventType) {
        case 'ORDER_SUBMITTED':
          explanation = `Client submitted a ${ev.metadata.action || 'trade'} request for ${ev.metadata.volume || '0'} Lot ${ev.metadata.symbol || ''} at price ${ev.metadata.priceRequested || 'market'}.`;
          technicalDetails = `Order submission event for Client #${ev.login}.`;
          break;
        case 'ORDER_ROUTED':
          explanation = `The order request was routed to dealer desk.`;
          technicalDetails = `Request transferred to dealers, rule '${ev.metadata.rule || 'Centroid Bridge'}'.`;
          break;
        case 'DEALER_ACCEPTED':
          explanation = `Dealer accepted the order request.`;
          technicalDetails = `Dealer #${ev.metadata.dealerId || 'Desk'} accepted request.`;
          break;
        case 'DEALER_REQUOTED':
          explanation = `Dealer issued a requote to the client.`;
          technicalDetails = `Requote issued: count ${ev.metadata.requoteCount || 1}.`;
          break;
        case 'ORDER_EXECUTED':
          explanation = `The trade request was successfully executed.`;
          technicalDetails = `Deal performed ${ev.metadata.dealId ? `[#${ev.metadata.dealId}]` : ''} at price ${ev.metadata.priceExecuted}.`;
          break;
        case 'ORDER_REJECTED':
          explanation = `The MT5 server rejected the order request.`;
          technicalDetails = `Order #${ev.metadata.orderId || ticketId} rejected: "${ev.metadata.rawReason || 'N/A'}".`;
          break;
        case 'DEALER_REJECTED':
          explanation = `Manual dealer rejected the order request.`;
          technicalDetails = `Dealer #${ev.metadata.dealerId || 'Desk'} rejected: "${ev.metadata.rawReason || 'N/A'}".`;
          break;
        default:
          explanation = ev.rawMessage;
          technicalDetails = `Raw log message.`;
          break;
      }

      return {
        timestamp: ev.timestamp,
        eventType: ev.eventType,
        explanation,
        technicalDetails,
        relatedIds,
        evidenceId: `log_${index}`,
      };
    });

    // Construct evidence tracing support list
    const evidence = combinedEvents.map((ev, index) => {
      let claim = '';
      let type: 'FACT' | 'CALCULATION' | 'INFERENCE' | 'UNKNOWN' = 'FACT';

      switch (ev.eventType) {
        case 'ORDER_SUBMITTED':
          claim = `Client submitted trade request for ${ev.metadata.symbol}`;
          type = 'FACT';
          break;
        case 'ORDER_EXECUTED':
          claim = `Trade request executed at price ${ev.metadata.priceExecuted}`;
          type = 'FACT';
          break;
        case 'ORDER_REJECTED':
        case 'DEALER_REJECTED':
          claim = `Trade request was explicitly rejected by ${entryMetrics.rejection?.rejectedBy || 'system'}`;
          type = 'FACT';
          break;
        default:
          claim = `Log state change: ${ev.eventType}`;
          type = 'FACT';
          break;
      }

      return {
        id: `log_${index}`,
        timestamp: ev.timestamp,
        claim,
        type,
        rawLog: ev.rawMessage,
      };
    });

    // Deterministic confidence calculation
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' = 'UNKNOWN';
    if (executed && entryMetrics.executionLatencyMs !== null) {
      confidence = 'HIGH';
    } else if (isRejected && entryMetrics.rejection?.rawReason) {
      confidence = 'HIGH';
    } else if (combinedEvents.length > 1) {
      confidence = 'MEDIUM';
    } else if (combinedEvents.length === 1) {
      confidence = 'LOW';
    }

    // Determine limitations
    const limitations: string[] = [];
    if (isRejected && !entryMetrics.rejection?.rawReason) {
      limitations.push('The available logs do not specify the underlying server rejection reason.');
    }
    if (status === 'INCOMPLETE') {
      limitations.push('Log sequence ends abruptly with no explicit execution or rejection event.');
    }

    const executionAnalysis = this.metricsService.analyzeExecution(entryMetrics, exitMetrics);

    return {
      trade: {
        clientLogin,
        symbol: entryIncident.symbol,
        side: entryIncident.action,
        volume: entryIncident.volume,
        orderId: orderId,
        dealId: dealId,
        positionId: ticketId,
        requestedPrice: entryMetrics.priceRequested ?? null,
        timestamp: entryIncident.events[0]?.timestamp || new Date().toISOString(),
      },
      status,
      execution: {
        executed,
        executionPrice: entryMetrics.priceExecuted ?? null,
        slippagePips: entryMetrics.slippagePips,
        slippagePoints: entryMetrics.slippagePoints,
        slippageType: entryMetrics.slippageType,
        executionLatencyMs: entryMetrics.executionLatencyMs,
      },
      rejection: {
        isRejected,
        reason: entryMetrics.rejection?.reason ?? null,
        rawReason: entryMetrics.rejection?.rawReason ?? null,
        rejectedBy: entryMetrics.rejection?.rejectedBy ?? null,
        failedStage: entryMetrics.rejection?.failedStage ?? null,
        lastSuccessfulStage: entryMetrics.rejection?.lastSuccessfulStage ?? null,
        rejectionLatencyMs: entryMetrics.rejectionLatencyMs,
      },
      executionAnalysis,
      timeline,
      evidence,
      confidence,
      limitations,
    };
  }

  private async logAction(userId: string, action: string, details: string, ipAddress?: string) {
    this.logger.log(`Audit log: User ${userId} performed ${action} - ${details}`);
    await this.prisma.auditLog.create({
      data: {
        userId,
        action,
        details,
        ipAddress,
      },
    });
  }
}
