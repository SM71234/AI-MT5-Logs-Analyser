import { Test, TestingModule } from '@nestjs/testing';
import { InvestigationsService } from './investigations.service';
import { PrismaService } from '../prisma/prisma.service';
import { Mt5Service } from '../mt5/mt5.service';
import { JournalEngineService } from '../journal/journal-engine.service';
import { MetricsService, CalculatedMetrics } from '../metrics/metrics.service';
import { AiService } from '../ai/ai.service';
import { NotFoundException } from '@nestjs/common';

describe('InvestigationsService', () => {
  let service: InvestigationsService;
  let prisma: any;
  let mt5Service: any;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    const mockPrismaService = {
      investigation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      note: {
        create: jest.fn(),
      },
      aiReport: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };

    const mockMt5Service = {
      getClientJournal: jest.fn(),
      getClientTrades: jest.fn(),
      getSymbolSpecs: jest.fn(),
    };

    const mockJournalEngineService = {
      processLogs: jest.fn(),
    };

    const mockMetricsService = {
      calculate: jest.fn(),
      analyzeExecution: jest.fn().mockImplementation((entry, exit) => ({
        entryExecution: entry,
        exitExecution: exit,
        netSlippage: { slippagePoints: entry?.slippagePoints || 0, slippageType: entry?.slippageType || 'Zero' },
        grossAdverseSlippage: entry?.slippageType === 'Adverse' ? entry?.slippagePoints || 0 : 0,
        grossFavorableSlippage: entry?.slippageType === 'Favorable' ? entry?.slippagePoints || 0 : 0,
        entryLatency: entry?.totalObservableExecutionTimeMs || null,
        exitLatency: exit?.totalObservableExecutionTimeMs || null,
        cumulativeLatency: (entry?.totalObservableExecutionTimeMs || 0) + (exit?.totalObservableExecutionTimeMs || 0),
        averageLatency: entry?.totalObservableExecutionTimeMs || null,
      })),
    };

    const mockAiService = {
      generatePromptHash: jest.fn().mockReturnValue('hash-val'),
      generateAnalysis: jest.fn(),
      followUpChat: jest.fn(),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        InvestigationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: Mt5Service, useValue: mockMt5Service },
        { provide: JournalEngineService, useValue: mockJournalEngineService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();

    service = moduleRef.get<InvestigationsService>(InvestigationsService);
    prisma = moduleRef.get(PrismaService);
    mt5Service = moduleRef.get(Mt5Service);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should update existing investigation if already saved', async () => {
      const mockSaved = { id: 'saved-id', ticketId: '5001' };
      prisma.investigation.findFirst.mockResolvedValue(mockSaved);
      prisma.investigation.update.mockResolvedValue(mockSaved);

      mt5Service.getClientJournal.mockResolvedValue(['log1', 'log2']);
      mt5Service.getClientTrades.mockResolvedValue([
        {
          ticket: '5001',
          positionId: '5001',
          entry: { orderId: '100', dealId: '200' },
          exit: { orderId: '101', dealId: '201' },
        },
      ]);
      mt5Service.getSymbolSpecs.mockResolvedValue({ digits: 5, point: 0.00001 });

      const mockIncident = {
        ticketId: '5001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-06T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal',
            login: '1001',
            metadata: { dealId: '200' },
          },
        ],
      };

      const journalEngine = moduleRef.get(JournalEngineService);
      (journalEngine.processLogs as jest.Mock).mockReturnValue([mockIncident]);

      const metricsService = moduleRef.get(MetricsService);
      (metricsService.calculate as jest.Mock).mockReturnValue({
        totalObservableExecutionTimeMs: 100,
        slippagePoints: 5,
        slippageType: 'Adverse',
      });

      const result = await service.create(
        { brokerId: 'broker-1', login: '1001', ticket: '5001' },
        'operator-id',
      );

      expect(prisma.investigation.findFirst).toHaveBeenCalled();
      expect(prisma.investigation.update).toHaveBeenCalled();
      expect(result).toEqual(mockSaved);
    });
  });

  describe('addNote', () => {
    it('should throw NotFoundException if case is missing', async () => {
      prisma.investigation.findUnique.mockResolvedValue(null);

      await expect(
        service.addNote('missing-id', { content: 'test note' }, 'operator-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
