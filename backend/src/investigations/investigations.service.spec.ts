import { Test, TestingModule } from '@nestjs/testing';
import { InvestigationsService } from './investigations.service';
import { PrismaService } from '../prisma/prisma.service';
import { Mt5Service } from '../mt5/mt5.service';
import { JournalEngineService } from '../journal/journal-engine.service';
import { MetricsService, CalculatedMetrics } from '../metrics/metrics.service';
import { AiService } from '../ai/ai.service';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';

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
        deleteMany: jest.fn(),
        delete: jest.fn(),
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
      processLogs: jest.fn().mockReturnValue([]),
    };

    const mockMetricsService = {
      calculate: jest.fn(),
      analyzeExecution: jest.fn().mockImplementation((entry, exit) => ({
        netSlippage: { slippagePoints: entry?.slippagePoints || 0, slippageType: entry?.slippageType || 'Zero' },
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

  describe('findOne with unreachable connector', () => {
    it('should degrade gracefully and return recalculationFailed: true rather than throwing', async () => {
      const mockCase = {
        id: 'case-id',
        brokerId: 'broker-id',
        clientLogin: '910102',
        ticketId: '670',
        title: 'Trade Incident — XAUUSD.s BUY 0.01 Lot',
        metrics: JSON.stringify({
          entry: { totalObservableExecutionTimeMs: undefined }, // triggers recalculate
        }),
        events: JSON.stringify([]),
        aiReports: [],
        createdAt: new Date(),
      };

      prisma.investigation.findUnique.mockResolvedValue(mockCase);
      // Simulate unreachable MT5 connector
      mt5Service.getClientTrades.mockRejectedValue(new Error('Connector is down'));

      const result = await service.findOne('case-id');

      expect(result.recalculationFailed).toBe(true);
      expect(result.id).toBe('case-id');
    });
  });

  describe('analyze with unreachable connector', () => {
    it('should throw InternalServerErrorException for hard-abort during report generation', async () => {
      const mockCase = {
        id: 'case-id',
        brokerId: 'broker-id',
        clientLogin: '910102',
        ticketId: '670',
        title: 'Trade Incident — XAUUSD.s BUY 0.01 Lot',
        metrics: JSON.stringify({
          entry: { totalObservableExecutionTimeMs: undefined }, // triggers recalculate
        }),
        events: JSON.stringify([]),
        aiReports: [],
        createdAt: new Date(),
      };

      prisma.investigation.findUnique.mockResolvedValue(mockCase);
      // Simulate unreachable MT5 connector
      mt5Service.getClientTrades.mockRejectedValue(new Error('Connector is down'));

      await expect(
        service.analyze('case-id', 'operator-id'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('onModuleInit metadata backfill', () => {
    it('should query unbackfilled cases and parse symbol, action, volume details', async () => {
      const mockLegacyCase = {
        id: 'legacy-id',
        title: 'Trade Incident — EURUSD BUY 1.5 Lot',
        metrics: JSON.stringify({
          entry: { symbol: 'EURUSD', action: 'BUY', volume: 1.5, totalObservableExecutionTimeMs: 150 },
        }),
      };

      prisma.investigation.findMany.mockResolvedValue([mockLegacyCase]);
      prisma.investigation.update.mockResolvedValue({} as any);

      await service.onModuleInit();

      expect(prisma.investigation.update).toHaveBeenCalledWith({
        where: { id: 'legacy-id' },
        data: { symbol: 'EURUSD', action: 'BUY', volume: 1.5 },
      });
    });
  });
});
