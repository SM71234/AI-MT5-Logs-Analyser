import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Mt5Service } from '../mt5/mt5.service';
import { JournalEngineService } from '../journal/journal-engine.service';
import { MetricsService } from '../metrics/metrics.service';
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
    
    if (!targetTrade) {
      throw new BadRequestException(`Failed to locate trade details for position #${dto.ticket}`);
    }
    
    const entryOrderId = targetTrade.entry?.orderId;
    const entryDealId = targetTrade.entry?.dealId;
    const exitOrderId = targetTrade.exit?.orderId;
    const exitDealId = targetTrade.exit?.dealId;
    
    const entryIncident = incidents.find((incident) => {
      return incident.events.some((e) => {
        const orderId = e.metadata.orderId;
        const dealId = e.metadata.dealId;
        const ticket = e.metadata.ticket;
        
        return (entryOrderId && orderId === entryOrderId) || 
               (entryDealId && dealId === entryDealId) ||
               (ticket && ticket === dto.ticket); // legacy match
      });
    });
    
    if (!entryIncident) {
      throw new BadRequestException(
        `Failed to reconstruct opening trade lifecycle. Ensure Ticket #${dto.ticket} exists in the MT5 journal.`,
      );
    }
    
    const exitIncident = incidents.find((incident) => {
      if (!exitOrderId && !exitDealId) return false;
      return incident.events.some((e) => {
        const orderId = e.metadata.orderId;
        const dealId = e.metadata.dealId;
        
        return (exitOrderId && orderId === exitOrderId) || 
               (exitDealId && dealId === exitDealId);
      });
    }) || null;
 
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

     // Calculate overall trade summaries
     const entryAdverse = entryMetrics.slippageType === 'Adverse' ? (entryMetrics.slippagePoints ?? 0) : 0;
     const exitAdverse = (exitMetrics && exitMetrics.slippageType === 'Adverse') ? (exitMetrics.slippagePoints ?? 0) : 0;
     const netAdversePriceImpact = entryAdverse + exitAdverse;

     const cumulativeLatencyMs = entryMetrics.executionLatencyMs + (exitMetrics ? exitMetrics.executionLatencyMs : 0);

     const structuredMetrics = {
       entry: entryMetrics,
       exit: exitMetrics,
       summary: {
         netAdversePriceImpact,
         cumulativeLatencyMs,
       },
     };
 
     // 4. Save to database
     const title = `Trade Incident — ${entryIncident.symbol} ${entryIncident.action} ${entryIncident.volume} Lot`;
     
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
                        
    if (isOldFormat) {
      try {
        this.logger.log(`Performing dynamic metrics recalculation for historical case ID ${id}`);
        const rawLines = parsedEvents.map((e: any) => e.rawMessage);
        const correlated = this.journalEngineService.processLogs(rawLines);
        
        // Find matching entry and exit incidents based on trade action names
        const entryInc = correlated.find(c => c.action === (caseFile.title.includes('BUY') ? 'BUY' : 'SELL'));
        const exitInc = correlated.find(c => c.action === (caseFile.title.includes('BUY') ? 'SELL' : 'BUY'));
        
        if (entryInc) {
          const entryM = this.metricsService.calculate(entryInc, parsedMetrics.digits, parsedMetrics.pointSize);
          const exitM = exitInc ? this.metricsService.calculate(exitInc, parsedMetrics.digits, parsedMetrics.pointSize) : null;
          
          const entryAdverse = entryM.slippageType === 'Adverse' ? (entryM.slippagePoints ?? 0) : 0;
          const exitAdverse = (exitM && exitM.slippageType === 'Adverse') ? (exitM.slippagePoints ?? 0) : 0;
          const netAdversePriceImpact = entryAdverse + exitAdverse;
          const cumulativeLatencyMs = entryM.executionLatencyMs + (exitM ? exitM.executionLatencyMs : 0);
          
          parsedMetrics = {
            entry: entryM,
            exit: exitM,
            summary: {
              netAdversePriceImpact,
              cumulativeLatencyMs
            }
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

    const response = await this.aiService.followUpChat(
      latestReport.response,
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
