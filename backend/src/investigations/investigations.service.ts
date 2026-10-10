import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Mt5Service } from '../mt5/mt5.service';
import { JournalEngineService } from '../journal/journal-engine.service';
import { PositionLedgerService } from '../journal/position-ledger.service';
import { MetricsService, CalculatedMetrics } from '../metrics/metrics.service';
import { NormalizedEvent } from '../journal/normalization.engine';
import { AiService, AiAnalysisContext, TradeInvestigationContext } from '../ai/ai.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { ChatFollowupDto } from './dto/chat-followup.dto';
import { Investigation } from '@prisma/client';

@Injectable()
export class InvestigationsService implements OnModuleInit {
  private readonly logger = new Logger('InvestigationsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mt5Service: Mt5Service,
    private readonly journalEngineService: JournalEngineService,
    private readonly positionLedgerService: PositionLedgerService,
    private readonly metricsService: MetricsService,
    private readonly aiService: AiService,
  ) {}

  async onModuleInit() {
    this.logger.log('Running one-time backfill for existing investigations...');
    try {
      const cases = await this.prisma.investigation.findMany({
        where: {
          OR: [
            { symbol: null },
            { action: null },
            { volume: null }
          ]
        }
      });
      this.logger.log(`Found ${cases.length} investigations needing metadata backfill.`);
      for (const c of cases) {
        try {
          let symbol = null;
          let action = null;
          let volume = null;
          // Try parsing metrics.entry
          try {
            const parsed = JSON.parse(c.metrics);
            symbol = parsed.entry?.symbol;
            action = parsed.entry?.action;
            volume = parsed.entry?.volume;
          } catch {}
          
          // Fallback to parsing title (e.g. "Trade Incident — XAUUSD.s BUY 0.01 Lot")
          if (!symbol || !action) {
            const parts = c.title.split(' — ');
            if (parts.length > 1) {
              const tradeDetails = parts[1].split(' ');
              if (tradeDetails.length >= 2) {
                symbol = tradeDetails[0];
                action = tradeDetails[1];
                volume = parseFloat(tradeDetails[2]) || null;
              }
            }
          }
          
          if (symbol && action) {
            await this.prisma.investigation.update({
              where: { id: c.id },
              data: { symbol, action, volume },
            });
            this.logger.log(`Backfilled case ID ${c.id}: symbol=${symbol}, action=${action}, volume=${volume}`);
          }
        } catch (cErr: any) {
          this.logger.warn(`Failed to backfill metadata for case ${c.id}: ${cErr.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Error during investigations backfill init: ${err.message}`);
    }
  }

  // Creates or retrieves a trade investigation case
  async create(dto: CreateInvestigationDto, operatorId: string, ipAddress?: string): Promise<Investigation> {
    // 1. Fetch trades first to locate the execution timestamp
    let trades: any[] = [];
    try {
      trades = await this.mt5Service.getClientTrades(dto.brokerId, dto.login, operatorId, ipAddress);
    } catch (e) {
      this.logger.warn(`Failed to fetch pre-requisite client trades: ${e.message}`);
    }

    const targetTrade = trades.find((t) => t.positionId === dto.ticket || t.ticket === dto.ticket);

    let fromTs: number | undefined;
    let toTs: number | undefined;

    if (targetTrade) {
      const openSecs = targetTrade.timeRequested ? Math.floor(new Date(targetTrade.timeRequested).getTime() / 1000) : null;
      const closeSecs = targetTrade.timeExecuted ? Math.floor(new Date(targetTrade.timeExecuted).getTime() / 1000) : null;

      if (openSecs && closeSecs) {
        // Encompass full lifecycle from opening request to closing deal with safety buffer
        fromTs = Math.min(openSecs, closeSecs) - 300;
        toTs = Math.max(openSecs, closeSecs) + 300;
      } else if (openSecs || closeSecs) {
        const baseSecs = (openSecs ?? closeSecs)!;
        fromTs = baseSecs - 300;
        toTs = baseSecs + 1800;
      }
    } else {
      // Fallback for rejected/missing trades: query logs from the last 3 days
      const nowSecs = Math.floor(Date.now() / 1000);
      fromTs = nowSecs - (3 * 24 * 3600);
      toTs = nowSecs;
    }

    // 2. Fetch raw logs using the highly targeted date range
    const rawLogs = await this.mt5Service.getClientJournal(
      dto.brokerId,
      dto.login,
      operatorId,
      ipAddress,
      fromTs,
      toTs,
    );

    // 3. Correlate logs and reconstruct position using ledger service
    const incidents = this.journalEngineService.processLogs(rawLogs);
    const ledgers = this.positionLedgerService.reconstructPositions(incidents, trades);
    const targetLedger = ledgers.find(l => {
      return l.positionId === dto.ticket || 
             l.entryDeals.some(d => d.ticketId === dto.ticket) ||
             l.exitDeals.some(d => d.ticketId === dto.ticket) ||
             l.reversalDeals.some(d => d.ticketId === dto.ticket);
    });

    let entryIncident = targetLedger?.entryDeals[0] || null;
    let exitIncident = targetLedger?.exitDeals[targetLedger.exitDeals.length - 1] || null;

    if (!entryIncident) {
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
        }) || null;
        
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
        entryIncident = incidents.find((incident) => {
          return incident.ticketId === dto.ticket || incident.events.some((e) => {
            return e.metadata.orderId === dto.ticket || 
                   e.metadata.ticket === dto.ticket;
          });
        }) || null;
      }
    }

    if (!entryIncident) {
      throw new BadRequestException(
        `Failed to reconstruct opening trade lifecycle. Ensure Ticket #${dto.ticket} exists in the MT5 journal.`,
      );
    }
 
     // 3. Programmatically calculate execution metrics for all entry, exit, and reversal deals
     let digits: number | null = null;
     let point: number | null = null;
      let specSource: any = 'HEURISTIC';
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
         specSource = symbolInfo.source || 'MT5_SERVER';
       }
     } catch (error) {
       this.logger.warn(`Failed to resolve dynamic symbol specs for ${entryIncident.symbol}`, error);
     }
 
     const entriesMetrics = targetLedger
        ? targetLedger.entryDeals.map((d) => this.metricsService.calculate(d, digits, point, specSource))
        : [this.metricsService.calculate(entryIncident, digits, point, specSource)];

      const exitsMetrics = targetLedger
        ? targetLedger.exitDeals.map((d) => this.metricsService.calculate(d, digits, point, specSource))
        : (exitIncident ? [this.metricsService.calculate(exitIncident, digits, point, specSource)] : []);

      const reversalsMetrics = targetLedger
        ? targetLedger.reversalDeals.map((d) => this.metricsService.calculate(d, digits, point, specSource))
        : [];

      let entryMetrics = entriesMetrics[0];
      if (!entryMetrics && entryIncident) {
        entryMetrics = this.metricsService.calculate(entryIncident, digits, point, specSource);
      }
      if (!entryMetrics) {
        entryMetrics = {
          priceRequested: 0,
          priceExecuted: 0,
          slippagePoints: 0,
          slippageType: 'Zero',
          executed: false,
          status: 'UNKNOWN',
          rejection: {
            isRejected: false,
            reason: null,
            rawReason: null,
            rejectedBy: null,
            failedStage: null,
            lastSuccessfulStage: null,
          },
        } as any;
      }
      if (entriesMetrics.length === 0) {
        entriesMetrics.push(entryMetrics);
      }

      let exitMetrics = exitsMetrics[exitsMetrics.length - 1] || null;
      if (!exitMetrics && exitIncident) {
        exitMetrics = this.metricsService.calculate(exitIncident, digits, point, specSource);
      }
      if (exitsMetrics.length === 0 && exitMetrics) {
        exitsMetrics.push(exitMetrics);
      }
 
      // Combine events from all entry, exit, and reversal executions for a complete timeline display
      const allIncidents = [
        ...(targetLedger?.entryDeals || [entryIncident].filter(Boolean)),
        ...(targetLedger?.exitDeals || (exitIncident ? [exitIncident] : [])),
        ...(targetLedger?.reversalDeals || [])
      ];
 
      const combinedEvents: NormalizedEvent[] = [];
      for (const incident of allIncidents) {
        for (const ev of incident.events) {
          if (!combinedEvents.some((e) => e.timestamp === ev.timestamp && e.eventType === ev.eventType && e.rawMessage === ev.rawMessage)) {
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
        entries: entriesMetrics,
        exits: exitsMetrics,
        reversals: reversalsMetrics,
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
          combinedEvents,
          entriesMetrics,
          exitsMetrics,
          reversalsMetrics,
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
           symbol: entryIncident.symbol || null,
           action: entryIncident.action || null,
           volume: entryIncident.volume || null,
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
           symbol: entryIncident.symbol || null,
           action: entryIncident.action || null,
           volume: entryIncident.volume || null,
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

  // Shared method to perform dynamic metrics self-healing & recalculation if needed
  private async recalculateIfNeeded(caseFile: any, allowThrow = false): Promise<{ metrics: any; events: any; recalculationFailed?: boolean }> {
    let parsedMetrics: any;
    let parsedEvents: any;
    try {
      parsedMetrics = JSON.parse(caseFile.metrics);
      parsedEvents = JSON.parse(caseFile.events);
    } catch (e) {
      this.logger.error(`Failed to parse cached metrics/events for case ${caseFile.id}`);
      if (allowThrow) {
        throw new InternalServerErrorException('Corrupt case data cached in database.');
      }
      return { metrics: null, events: [], recalculationFailed: true };
    }

    const hasCorruptReport = (caseFile.aiReports || []).some((r: any) => r.response.includes('undefined'));
    const isOldFormat = !parsedMetrics.entry || 
                        parsedMetrics.entry.totalObservableExecutionTimeMs === undefined ||
                        !parsedMetrics.entry.timestamp ||
                        !parsedMetrics.summary ||
                        parsedMetrics.summary.holdTimeMs === undefined;
    const needsCanonicalResult = !parsedMetrics.canonicalResult;

    if (isOldFormat || needsCanonicalResult || hasCorruptReport) {
      try {
        this.logger.log(`Performing dynamic metrics recalculation for historical case ID ${caseFile.id}`);
        
        // Delete legacy cached AI reports to force fresh generation
        await this.prisma.aiReport.deleteMany({
          where: { investigationId: caseFile.id }
        });

        const rawLines = parsedEvents.map((e: any) => e.rawMessage);
        const correlated = this.journalEngineService.processLogs(rawLines);
        
        let targetTrade: any = null;
        let trades: any[] = [];
        try {
          const fetchedTrades = await this.mt5Service.getClientTrades(
            caseFile.brokerId,
            caseFile.clientLogin,
            'SYSTEM',
            undefined,
          );
          if (fetchedTrades && Array.isArray(fetchedTrades)) {
            trades = fetchedTrades;
            targetTrade = trades.find((t: any) => {
              return t.ticketId === caseFile.ticketId || 
                     t.entry?.orderId === caseFile.ticketId || 
                     t.entry?.dealId === caseFile.ticketId ||
                     t.ticket === caseFile.ticketId;
            });
          }
        } catch (fetchErr: any) {
          this.logger.warn(`MT5 Connector fetch failed during recalculation for case ${caseFile.id}: ${fetchErr.message}`);
          if (allowThrow) {
            throw new InternalServerErrorException(`MT5 Connector is unreachable during recalculation: ${fetchErr.message}`);
          }
          return { metrics: parsedMetrics, events: parsedEvents, recalculationFailed: true };
        }

        let entryOrderId = targetTrade?.entry?.orderId;
        let entryDealId = targetTrade?.entry?.dealId;
        let exitOrderId = targetTrade?.exit?.orderId;
        let exitDealId = targetTrade?.exit?.dealId;

        const ledgers = this.positionLedgerService.reconstructPositions(correlated, trades);
        const targetLedger = ledgers.find(l => {
          return l.positionId === caseFile.ticketId || 
                 l.entryDeals.some(d => d.ticketId === caseFile.ticketId) ||
                 l.exitDeals.some(d => d.ticketId === caseFile.ticketId) ||
                 l.reversalDeals.some(d => d.ticketId === caseFile.ticketId);
        });

        let entryInc = targetLedger?.entryDeals[0] || null;
        let exitInc = targetLedger?.exitDeals[targetLedger.exitDeals.length - 1] || null;

        if (!entryInc && Array.isArray(correlated)) {
          entryInc = correlated.find((incident) => {
            return incident.events.some((e) => {
              const orderId = e.metadata.orderId;
              const dealId = e.metadata.dealId;
              const ticket = e.metadata.ticket;
              
              return (entryOrderId && orderId === entryOrderId) || 
                     (entryDealId && dealId === entryDealId) ||
                     (ticket && (ticket === caseFile.ticketId || ticket === entryOrderId || ticket === entryDealId)) ||
                     incident.ticketId === caseFile.ticketId;
            });
          }) || null;
        }
        
        if (entryInc) {
          const calcDigits = parsedMetrics.digits || parsedMetrics.entry?.digits || null;
          const calcPoint = parsedMetrics.pointSize || parsedMetrics.entry?.pointSize || null;
          const calcSource = parsedMetrics.entry?.pointSizeSource || 'HEURISTIC';

          const entriesMetrics = targetLedger
            ? targetLedger.entryDeals.map((d) => this.metricsService.calculate(d, calcDigits, calcPoint, calcSource))
            : [this.metricsService.calculate(entryInc, calcDigits, calcPoint, calcSource)];

          const exitsMetrics = targetLedger
            ? targetLedger.exitDeals.map((d) => this.metricsService.calculate(d, calcDigits, calcPoint, calcSource))
            : (exitInc ? [this.metricsService.calculate(exitInc, calcDigits, calcPoint, calcSource)] : []);

          const reversalsMetrics = targetLedger
            ? targetLedger.reversalDeals.map((d) => this.metricsService.calculate(d, calcDigits, calcPoint, calcSource))
            : [];

          let entryM = entriesMetrics[0];
          if (!entryM && entryInc) {
            entryM = this.metricsService.calculate(entryInc, calcDigits, calcPoint, calcSource);
          }
          if (!entryM) {
            entryM = {
              priceRequested: 0,
              priceExecuted: 0,
              slippagePoints: 0,
              slippageType: 'Zero',
              executed: false,
              status: 'UNKNOWN',
              rejection: {
                isRejected: false,
                reason: null,
                rawReason: null,
                rejectedBy: null,
                failedStage: null,
                lastSuccessfulStage: null,
              },
            } as any;
          }
          if (entriesMetrics.length === 0) {
            entriesMetrics.push(entryM);
          }

          let exitM = exitsMetrics[exitsMetrics.length - 1] || null;
          if (!exitM && exitInc) {
            exitM = this.metricsService.calculate(exitInc, calcDigits, calcPoint, calcSource);
          }
          if (exitsMetrics.length === 0 && exitM) {
            exitsMetrics.push(exitM);
          }
          
          const executionAnalysis = this.metricsService.analyzeExecution(entryM, exitM);
          
          // Combine events from all entry, exit, and reversal executions
          const allIncidents = [
            ...(targetLedger?.entryDeals || [entryInc].filter(Boolean)),
            ...(targetLedger?.exitDeals || (exitInc ? [exitInc] : [])),
            ...(targetLedger?.reversalDeals || [])
          ];

          const combinedRecorrelatedEvents: NormalizedEvent[] = [];
          for (const incident of allIncidents) {
            for (const ev of incident.events) {
              if (!combinedRecorrelatedEvents.some((e) => e.timestamp === ev.timestamp && e.eventType === ev.eventType && e.rawMessage === ev.rawMessage)) {
                combinedRecorrelatedEvents.push(ev);
              }
            }
          }
          combinedRecorrelatedEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

          parsedMetrics = {
            entry: entryM,
            exit: exitM,
            entries: entriesMetrics,
            exits: exitsMetrics,
            reversals: reversalsMetrics,
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
              combinedRecorrelatedEvents,
              entriesMetrics,
              exitsMetrics,
              reversalsMetrics,
            )
          };
          
          // Persist the corrected metrics and events in the database
          await this.prisma.investigation.update({
            where: { id: caseFile.id },
            data: { 
              metrics: JSON.stringify(parsedMetrics),
              events: JSON.stringify(combinedRecorrelatedEvents),
            }
          });

          return { metrics: parsedMetrics, events: combinedRecorrelatedEvents };
        } else {
          return { metrics: parsedMetrics, events: parsedEvents, recalculationFailed: true };
        }
      } catch (err: any) {
        this.logger.error(`CRITICAL METRICS RECALCULATION FAILURE for Case ID ${caseFile.id}: ${err.message}`, err.stack);
        if (allowThrow) {
          throw new InternalServerErrorException(`Unable to process investigation case due to recalculation failure: ${err.message}`);
        }
        return { metrics: parsedMetrics, events: parsedEvents, recalculationFailed: true };
      }
    }

    return { metrics: parsedMetrics, events: parsedEvents };
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

    const { metrics, events, recalculationFailed } = await this.recalculateIfNeeded(caseFile, false);

    const parsedMetricsObj = JSON.parse(caseFile.metrics);
    const isOldFormat = !parsedMetricsObj.entry || 
                        parsedMetricsObj.entry.totalObservableExecutionTimeMs === undefined ||
                        !parsedMetricsObj.entry.timestamp ||
                        !parsedMetricsObj.summary ||
                        parsedMetricsObj.summary.holdTimeMs === undefined;
    const needsCanonicalResult = !parsedMetricsObj.canonicalResult;
    const hasCorruptReport = (caseFile.aiReports || []).some((r: any) => r.response.includes('undefined'));

    return {
      ...caseFile,
      aiReports: isOldFormat || needsCanonicalResult || hasCorruptReport ? [] : caseFile.aiReports,
      metrics,
      events,
      recalculationFailed: !!recalculationFailed,
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
    const caseFile = await this.prisma.investigation.findUnique({
      where: { id },
      include: {
        aiReports: {
          orderBy: { createdAt: 'desc' },
        },
      }
    });
    if (!caseFile) {
      throw new NotFoundException(`Investigation case not found`);
    }

    const { metrics, events } = await this.recalculateIfNeeded(caseFile, true);

    // 1. Generate prompt hash to verify cache hit (v2 hash scheme)
    const promptHash = this.aiService.generatePromptHash(caseFile.ticketId, metrics.entry || null, metrics.exit || null);

    // Check if an AI report for this prompt state already exists in DB
    const cachedReport = await this.prisma.aiReport.findFirst({
      where: { investigationId: id, promptHash },
    });

    if (cachedReport) {
      if (!cachedReport.response.includes('Simulated metrics') && !cachedReport.response.includes('[Mock AI Response]')) {
        this.logger.log(`AI Cache hit for Case ${id}. Returning saved report.`);
        return cachedReport;
      } else {
        this.logger.log(`Deleting legacy cached mock AI report for Case ${id} to refresh with real Gemini API.`);
        await this.prisma.aiReport.delete({ where: { id: cachedReport.id } });
      }
    }

    // 2. Perform AI completions
    const context: TradeInvestigationContext = {
      contextVersion: '1',
      identity: {
        login: caseFile.clientLogin,
        positionId: metrics.canonicalResult?.positionId || undefined,
        dealId: metrics.canonicalResult?.dealId || undefined,
        orderId: metrics.canonicalResult?.orderId || undefined,
        ticketId: caseFile.ticketId,
        requestId: metrics.canonicalResult?.requestId || undefined,
      },
      symbol: caseFile.symbol || caseFile.title.split(' — ')[1]?.split(' ')[0] || 'EURUSD',
      action: caseFile.action || (caseFile.title.includes('BUY') ? 'BUY' : 'SELL'),
      volume: caseFile.volume || metrics.entry?.volume || 0.0,
      deterministicFacts: {
        entry: metrics.entry || null,
        exit: metrics.exit || null,
        summary: metrics.summary || null,
        entries: metrics.entries || [],
        exits: metrics.exits || [],
        reversals: metrics.reversals || [],
      },
      events,
      canonicalResult: metrics.canonicalResult || null,
    };

    const reportText = await this.aiService.generateAnalysis(context);

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

    const { metrics, events } = await this.recalculateIfNeeded(caseFile, true);

    const context: TradeInvestigationContext = {
      contextVersion: '1',
      identity: {
        login: caseFile.clientLogin,
        positionId: metrics.canonicalResult?.positionId || undefined,
        dealId: metrics.canonicalResult?.dealId || undefined,
        orderId: metrics.canonicalResult?.orderId || undefined,
        ticketId: caseFile.ticketId,
        requestId: metrics.canonicalResult?.requestId || undefined,
      },
      symbol: caseFile.symbol || caseFile.title.split(' — ')[1]?.split(' ')[0] || 'EURUSD',
      action: caseFile.action || (caseFile.title.includes('BUY') ? 'BUY' : 'SELL'),
      volume: caseFile.volume || metrics.entry?.volume || 0.0,
      deterministicFacts: {
        entry: metrics.entry || null,
        exit: metrics.exit || null,
        summary: metrics.summary || null,
        entries: metrics.entries || [],
        exits: metrics.exits || [],
        reversals: metrics.reversals || [],
      },
      events,
      canonicalResult: metrics.canonicalResult || null,
    };

    const latestReport = caseFile.aiReports[0];
    const reportText = latestReport ? latestReport.response : null;

    const history = (dto.chatHistory || []).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const response = await this.aiService.followUpChat(
      context,
      reportText,
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
    combinedEvents: NormalizedEvent[],
    entriesMetrics?: CalculatedMetrics[],
    exitsMetrics?: CalculatedMetrics[],
    reversalsMetrics?: CalculatedMetrics[],
  ): any {
    const isRejected = entryMetrics?.rejection?.isRejected || false;
    const executed = entryMetrics?.executed || false;
    const status = entryMetrics?.status || 'UNKNOWN';
    
    const openSubmittedEvent = entryIncident.events.find((e: any) => e.eventType === 'REQUEST' || e.eventType === 'ORDER_PLACED');
    const openExecutedEvent = entryIncident.events.find((e: any) => e.eventType === 'DEAL_EXECUTED' || e.eventType === 'ORDER_FILLED');
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
        case 'REQUEST':
          explanation = `Client submitted a ${ev.metadata.action || 'trade'} request for ${ev.metadata.volume || '0'} Lot ${ev.metadata.symbol || ''} at price ${ev.metadata.priceRequested || 'market'}.`;
          technicalDetails = `Order request event for Client #${ev.login}.`;
          break;
        case 'ROUTED':
          explanation = `The order request was routed.`;
          technicalDetails = `Request transferred to server/dealers.`;
          break;
        case 'EXECUTION_REQUEST':
          explanation = `Execution request was received by dealer/bridge.`;
          technicalDetails = `Dealer/bridge received execution request.`;
          break;
        case 'EXECUTION_RESPONSE':
          explanation = `Broker execution response confirmed.`;
          technicalDetails = `Server/dealer execution confirmation received.`;
          break;
        case 'DEAL_EXECUTED':
          explanation = `The trade request was successfully executed.`;
          technicalDetails = `Deal performed ${ev.metadata.dealId ? `[#${ev.metadata.dealId}]` : ''} at price ${ev.metadata.priceExecuted}.`;
          break;
        case 'ORDER_PLACED':
          explanation = `Pending order placed in system.`;
          technicalDetails = `Pending order #${ev.metadata.orderId || ticketId} placed: price ${ev.metadata.priceRequested}.`;
          break;
        case 'ORDER_TRIGGERED':
          explanation = `Pending order was triggered.`;
          technicalDetails = `Pending order #${ev.metadata.orderId || ticketId} triggered.`;
          break;
        case 'ORDER_FILLED':
          explanation = `Order was filled.`;
          technicalDetails = `Order #${ev.metadata.orderId || ticketId} filled.`;
          break;
        case 'ORDER_REJECTED':
          explanation = `The MT5 server/dealer rejected the request.`;
          technicalDetails = `Request rejected: "${ev.metadata.rawReason || 'N/A'}".`;
          break;
        case 'ORDER_CANCELLED':
          explanation = `The pending order was cancelled.`;
          technicalDetails = `Pending order #${ev.metadata.orderId || ticketId} cancelled.`;
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
        case 'REQUEST':
          claim = `Client submitted trade request for ${ev.metadata.symbol}`;
          type = 'FACT';
          break;
        case 'DEAL_EXECUTED':
          claim = `Trade request executed at price ${ev.metadata.priceExecuted}`;
          type = 'FACT';
          break;
        case 'ORDER_REJECTED':
          claim = `Trade request was explicitly rejected by system/dealer`;
          type = 'FACT';
          break;
        case 'ORDER_CANCELLED':
          claim = `Trade order was cancelled`;
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
    if (executed && entryMetrics?.totalObservableExecutionTimeMs !== null) {
      confidence = 'HIGH';
    } else if (isRejected && entryMetrics?.rejection?.rawReason) {
      confidence = 'HIGH';
    } else if (combinedEvents.length > 1) {
      confidence = 'MEDIUM';
    } else if (combinedEvents.length === 1) {
      confidence = 'LOW';
    }
 
    // Determine limitations
    const limitations: string[] = [];
    if (isRejected && !entryMetrics?.rejection?.rawReason) {
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
        requestedPrice: entryMetrics?.priceRequested ?? null,
        timestamp: entryIncident.events[0]?.timestamp || new Date().toISOString(),
      },
      status,
      execution: {
        executed,
        executionPrice: entryMetrics?.priceExecuted ?? null,
        slippagePips: entryMetrics?.slippagePoints,
        slippagePoints: entryMetrics?.slippagePoints,
        slippageType: entryMetrics?.slippageType,
        executionLatencyMs: entryMetrics?.totalObservableExecutionTimeMs,
      },
      rejection: {
        isRejected,
        reason: entryMetrics?.rejection?.reason ?? null,
        rawReason: entryMetrics?.rejection?.rawReason ?? null,
        rejectedBy: entryMetrics?.rejection?.rejectedBy ?? null,
        failedStage: entryMetrics?.rejection?.failedStage ?? null,
        lastSuccessfulStage: entryMetrics?.rejection?.lastSuccessfulStage ?? null,
        rejectionLatencyMs: entryMetrics?.totalObservableExecutionTimeMs,
      },
      executionAnalysis,
      timeline,
      evidence,
      confidence,
      limitations,
      
      // Multi-leg support
      entries: entriesMetrics || [entryMetrics],
      exits: exitsMetrics || (exitMetrics ? [exitMetrics] : []),
      reversals: reversalsMetrics || [],
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
