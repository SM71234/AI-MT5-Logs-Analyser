import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { ConfigService } from '@nestjs/config';
import { CalculatedMetrics } from '../metrics/metrics.service';

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue('mock-api-key'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateAiReport', () => {
    it('should pass validation if report is consistent with metrics', () => {
      const metrics: CalculatedMetrics = {
        totalObservableExecutionTimeMs: 150,
        routingDelayMs: 10,
        executionRequestDelayMs: 130,
        executionProcessingMs: 10,
        dealerBridgeResponseTimeMs: null,
        pendingWaitingTimeMs: null,
        holdTimeMs: null,
        slippagePoints: 20,
        slippageType: 'Adverse',
        executionReason: 'MARKET',
        orderType: 'MARKET',
        status: 'EXECUTED',
        executed: true,
        isNormal: true,
        priceDelta: 0.0002,
        digits: 5,
        pointSize: 0.00001,
      };

      const reportText = `### Summary\nTrade executed successfully.`;
      const validation = service.validateAiReport(reportText, metrics);

      expect(validation.isValid).toBe(true);
    });

    it('should fail validation if AI claims successful execution for a rejected trade', () => {
      const metrics: CalculatedMetrics = {
        totalObservableExecutionTimeMs: null,
        routingDelayMs: null,
        executionRequestDelayMs: null,
        executionProcessingMs: null,
        dealerBridgeResponseTimeMs: null,
        pendingWaitingTimeMs: null,
        holdTimeMs: null,
        slippagePoints: null,
        slippageType: 'N/A',
        executionReason: 'MARKET',
        orderType: 'MARKET',
        status: 'REJECTED',
        executed: false,
        isNormal: false,
        priceDelta: 0,
        digits: 5,
        pointSize: 0.00001,
        rejection: {
          isRejected: true,
          reason: 'Insufficient margin',
          rawReason: 'not enough money',
          rejectedBy: 'MT5 Server',
          failedStage: 'Server Validation',
          lastSuccessfulStage: 'Client Request',
        },
      };

      const reportText = `### Summary\nThe trade request was executed successfully with 0 pips slippage.`;
      const validation = service.validateAiReport(reportText, metrics);

      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('AI claimed successful execution for a rejected trade');
    });

    it('should fail validation if AI asserts execution latency when no execution occurred', () => {
      const metrics: CalculatedMetrics = {
        totalObservableExecutionTimeMs: null,
        routingDelayMs: null,
        executionRequestDelayMs: null,
        executionProcessingMs: null,
        dealerBridgeResponseTimeMs: null,
        pendingWaitingTimeMs: null,
        holdTimeMs: null,
        slippagePoints: null,
        slippageType: 'N/A',
        executionReason: 'MARKET',
        orderType: 'MARKET',
        status: 'REJECTED',
        executed: false,
        isNormal: false,
        priceDelta: 0,
        digits: 5,
        pointSize: 0.00001,
        rejection: {
          isRejected: true,
          reason: 'Insufficient margin',
          rawReason: 'not enough money',
          rejectedBy: 'MT5 Server',
          failedStage: 'Server Validation',
          lastSuccessfulStage: 'Client Request',
        },
      };

      const reportText = `### Summary\nRejection details report.\n### Evidence\nTotal execution latency was 250 ms.`;
      const validation = service.validateAiReport(reportText, metrics);

      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('AI asserted execution latency when execution did not occur');
    });
  });

  describe('generateDeterministicFallbackReport', () => {
    it('should generate a correct deterministic markdown report for rejected trade', () => {
      const metrics: CalculatedMetrics = {
        totalObservableExecutionTimeMs: null,
        routingDelayMs: null,
        executionRequestDelayMs: null,
        executionProcessingMs: null,
        dealerBridgeResponseTimeMs: null,
        pendingWaitingTimeMs: null,
        holdTimeMs: null,
        slippagePoints: null,
        slippageType: 'N/A',
        executionReason: 'MARKET',
        orderType: 'MARKET',
        status: 'REJECTED',
        executed: false,
        isNormal: false,
        priceDelta: 0,
        digits: 5,
        pointSize: 0.00001,
        rejection: {
          isRejected: true,
          reason: 'Insufficient margin',
          rawReason: 'not enough money',
          rejectedBy: 'MT5 Server (Margin Validation)',
          failedStage: 'Server Validation',
          lastSuccessfulStage: 'Client Request',
        },
      };

      const report = service.generateDeterministicFallbackReport('1001', '659', 'BTCUSD.s', 'BUY', 0.1, metrics);

      expect(report).toContain('### Summary');
      expect(report).toContain('Trade request by Client #1001 for 0.1 Lot BTCUSD.s was rejected.');
      expect(report).toContain('### Root Cause');
      expect(report).toContain('Rejection occurred during the "Server Validation" stage by MT5 Server (Margin Validation).');
      expect(report).toContain('### Evidence');
      expect(report).toContain('- Status: REJECTED');
      expect(report).toContain('- Reason: Insufficient margin');
    });
  });
});
