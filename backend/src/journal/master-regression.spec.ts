import { Test, TestingModule } from '@nestjs/testing';
import { NormalizationEngine } from './normalization.engine';
import { CorrelationEngine } from './correlation.engine';
import { PositionLedgerService } from './position-ledger.service';
import { MetricsService } from '../metrics/metrics.service';
import * as fs from 'fs';
import * as path from 'path';

describe('Master Regression Test Suite — AI MT5 Logs Analyser', () => {
  let normalizationEngine: NormalizationEngine;
  let correlationEngine: CorrelationEngine;
  let positionLedgerService: PositionLedgerService;
  let metricsService: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NormalizationEngine,
        CorrelationEngine,
        PositionLedgerService,
        MetricsService,
      ],
    }).compile();

    normalizationEngine = module.get<NormalizationEngine>(NormalizationEngine);
    correlationEngine = module.get<CorrelationEngine>(CorrelationEngine);
    positionLedgerService = module.get<PositionLedgerService>(PositionLedgerService);
    metricsService = module.get<MetricsService>(MetricsService);
  });

  describe('1. Gateway-prefixed MT5 Journal Normalization & Parsing', () => {
    it('should parse real Centroid Gateway deal performed with dot timestamp and preserve deal price', () => {
      const logLine = "2026.10.09 08:36:02.327 Centroid Gateway '70038': deal performed [#1290112 buy 0.1 XAUUSD.V at 4202.99]";
      const event = normalizationEngine.normalize(logLine);

      expect(event).not.toBeNull();
      expect(event?.eventType).toBe('DEAL_EXECUTED');
      expect(event?.login).toBe('70038');
      expect(event?.metadata.dealId).toBe('1290112');
      expect(event?.metadata.action).toBe('BUY');
      expect(event?.metadata.volume).toBe(0.1);
      expect(event?.metadata.symbol).toBe('XAUUSD.V');
      expect(event?.metadata.priceExecuted).toBe(4202.99);
      expect(event?.timestampServer).toBe('2026-10-09T08:36:02.327');
    });

    it('should parse Centroid Gateway order performed summary and link to order ID', () => {
      const logLine = "2026.10.09 08:36:02.327 Centroid Gateway '70038': order performed buy 0.1 at 4202.99 [#1442633 buy 0.1 XAUUSD.V at 4202.99], time: 0.05 ms";
      const event = normalizationEngine.normalize(logLine);

      expect(event).not.toBeNull();
      expect(event?.eventType).toBe('EXECUTION_RESPONSE');
      expect(event?.login).toBe('70038');
      expect(event?.metadata.orderId).toBe('1442633');
      expect(event?.metadata.action).toBe('BUY');
      expect(event?.metadata.volume).toBe(0.1);
      expect(event?.metadata.priceExecuted).toBe(4202.99);
    });

    it('should parse Centroid Gateway logs containing optional IP addresses and whitespace variations', () => {
      const logWithIp = "2026.10.09 08:36:02.327 192.168.1.100:54321 Centroid Gateway '70038': deal performed [#1290112 buy 0.1 XAUUSD.V at 4202.99]";
      const event = normalizationEngine.normalize(logWithIp);

      expect(event).not.toBeNull();
      expect(event?.eventType).toBe('DEAL_EXECUTED');
      expect(event?.login).toBe('70038');
      expect(event?.metadata.dealId).toBe('1290112');
      expect(event?.metadata.priceExecuted).toBe(4202.99);
    });

    it('should parse pending order trigger with activation quote benchmarks [Bid / Ask]', () => {
      const logLine = "2026.10.09 08:36:00.100 Centroid Gateway '70038': order [#1442633 buy stop 0.1 XAUUSD.V at 4202.50] triggered, activation price 4202.80 [4202.50 / 4202.80]";
      const event = normalizationEngine.normalize(logLine);

      expect(event).not.toBeNull();
      expect(event?.eventType).toBe('ORDER_TRIGGERED');
      expect(event?.metadata.orderId).toBe('1442633');
      expect(event?.metadata.priceRequested).toBe(4202.50); // specified limit/stop price
      expect(event?.metadata.activationPrice).toBe(4202.80);
      expect(event?.metadata.activationBid).toBe(4202.50);
      expect(event?.metadata.activationAsk).toBe(4202.80);
      expect(event?.metadata.priceActivation).toBe(4202.80); // for BUY, benchmark is Ask
    });

    it('should NOT treat position modifications as new trade executions', () => {
      const logLine = "2026.10.09 09:00:00.000 [Trade] '70038': position modified [#1442633 buy 0.1 XAUUSD.V sl: 4190.00 tp: 4250.00]";
      const event = normalizationEngine.normalize(logLine);

      expect(event).not.toBeNull();
      expect(event?.eventType).not.toBe('DEAL_EXECUTED');
      expect(event?.eventType).toBe('EXECUTION_RESPONSE');
    });
  });

  describe('2. Correlation Engine: Repeated Trigger Attempts (Order #1442633)', () => {
    it('should associate the actual fill with the correct execution attempt and keep failed attempts separate', () => {
      // Order #1442633:
      // Attempt 1: Triggered at 08:30:00, rejected at 08:30:00.050 (Off quotes)
      // Attempt 2: Triggered at 08:36:00, deal performed at 08:36:02.327
      const rawLogs = [
        "2026.10.09 08:30:00.000 Centroid Gateway '70038': order [#1442633 buy stop 0.1 XAUUSD.V at 4202.50] triggered, activation price 4201.00 [4200.70 / 4201.00]",
        "2026.10.09 08:30:00.050 Centroid Gateway '70038': order [#1442633] rejected due to off quotes",
        "2026.10.09 08:36:00.100 Centroid Gateway '70038': order [#1442633 buy stop 0.1 XAUUSD.V at 4202.50] triggered, activation price 4202.80 [4202.50 / 4202.80]",
        "2026.10.09 08:36:02.327 Centroid Gateway '70038': deal performed [#1290112 buy 0.1 XAUUSD.V at 4202.99]",
        "2026.10.09 08:36:02.327 Centroid Gateway '70038': order performed buy 0.1 at 4202.99 [#1442633 buy 0.1 XAUUSD.V at 4202.99], time: 0.05 ms",
      ];

      const events = rawLogs.map((l) => normalizationEngine.normalize(l)).filter(Boolean) as any[];
      const incidents = correlationEngine.correlate(events);

      // Should produce 2 distinct incidents: one REJECTED attempt and one EXECUTED fill
      expect(incidents.length).toBe(2);

      const rejectedIncident = incidents.find((inc) => inc.events.some((e) => e.eventType === 'ORDER_REJECTED'));
      const executedIncident = incidents.find((inc) => inc.events.some((e) => e.eventType === 'DEAL_EXECUTED'));

      expect(rejectedIncident).toBeDefined();
      expect(executedIncident).toBeDefined();

      // The executed incident must contain the second trigger (08:36:00), NOT the first trigger
      const execTrigger = executedIncident?.events.find((e) => e.eventType === 'ORDER_TRIGGERED');
      expect(execTrigger?.timestampServer).toBe('2026-10-09T08:36:00.100');

      // The rejected incident contains the first trigger (08:30:00)
      const rejTrigger = rejectedIncident?.events.find((e) => e.eventType === 'ORDER_TRIGGERED');
      expect(rejTrigger?.timestampServer).toBe('2026-10-09T08:30:00.000');

      // Calculate metrics on the executed incident
      const metrics = metricsService.calculate(executedIncident!, 2, 0.01, 'MT5_SERVER');
      expect(metrics.status).toBe('EXECUTED');
      expect(metrics.dealId).toBe('1290112');
      expect(metrics.orderId).toBe('1442633');
      expect(metrics.priceExecuted).toBe(4202.99);
      // Latency is 08:36:02.327 - 08:36:00.100 = 2227 ms
      expect(metrics.totalObservableExecutionTimeMs).toBe(2227);
    });
  });

  describe('3. Position Lifecycles: Separate Stop-Loss Closes (#1444368 & #1444369) & Manual Close (#1469935)', () => {
    it('should keep separate stop-loss closing orders distinct without merging unrelated executions', () => {
      // Position A (Position 1444360) closed by SL order 1444368
      // Position B (Position 1444361) closed by SL order 1444369
      const rawLogs = [
        // Pos A Open
        "2026.10.09 09:00:00.000 Centroid Gateway '70038': deal performed [#2000001 buy 0.1 XAUUSD.V at 4200.00]",
        "2026.10.09 09:00:00.000 Centroid Gateway '70038': order performed buy 0.1 at 4200.00 [#1444360 buy 0.1 XAUUSD.V at 4200.00]",
        // Pos B Open
        "2026.10.09 09:00:05.000 Centroid Gateway '70038': deal performed [#2000002 buy 0.1 XAUUSD.V at 4201.00]",
        "2026.10.09 09:00:05.000 Centroid Gateway '70038': order performed buy 0.1 at 4201.00 [#1444361 buy 0.1 XAUUSD.V at 4201.00]",
        // Pos A Close via SL
        "2026.10.09 09:15:00.000 Centroid Gateway '70038': deal performed [#2000003 sell 0.1 XAUUSD.V at 4190.00]",
        "2026.10.09 09:15:00.000 Centroid Gateway '70038': order performed sell 0.1 at 4190.00 [#1444368 sell 0.1 XAUUSD.V at 4190.00]",
        // Pos B Close via SL
        "2026.10.09 09:15:05.000 Centroid Gateway '70038': deal performed [#2000004 sell 0.1 XAUUSD.V at 4191.00]",
        "2026.10.09 09:15:05.000 Centroid Gateway '70038': order performed sell 0.1 at 4191.00 [#1444369 sell 0.1 XAUUSD.V at 4191.00]",
      ];

      const events = rawLogs.map((l) => normalizationEngine.normalize(l)).filter(Boolean) as any[];
      const incidents = correlationEngine.correlate(events);

      expect(incidents.length).toBe(4);

      // Reconstruct positions using trade mappings
      const trades = [
        {
          positionId: '1444360',
          ticket: '1444360',
          entry: { orderId: '1444360', dealId: '2000001' },
          exit: { orderId: '1444368', dealId: '2000003' },
        },
        {
          positionId: '1444361',
          ticket: '1444361',
          entry: { orderId: '1444361', dealId: '2000002' },
          exit: { orderId: '1444369', dealId: '2000004' },
        },
      ];

      const positions = positionLedgerService.reconstructPositions(incidents, trades);
      expect(positions.length).toBe(2);

      const posA = positions.find((p) => p.positionId === '1444360');
      const posB = positions.find((p) => p.positionId === '1444361');

      expect(posA).toBeDefined();
      expect(posB).toBeDefined();

      expect(posA?.entryDeals.length).toBe(1);
      expect(posA?.exitDeals.length).toBe(1);
      expect(posA?.exitDeals[0].events.some((e) => e.metadata.orderId === '1444368')).toBe(true);

      expect(posB?.entryDeals.length).toBe(1);
      expect(posB?.exitDeals.length).toBe(1);
      expect(posB?.exitDeals[0].events.some((e) => e.metadata.orderId === '1444369')).toBe(true);
    });

    it('should correctly correlate manual close #1469935 to target position', () => {
      const logLine = "2026.10.09 10:00:00.000 [Trade] '70038': market sell 0.1 XAUUSD.V, close #1469935 buy 0.1 XAUUSD.V 4200.00 (4205.10 / 4205.40)";
      const event = normalizationEngine.normalize(logLine);

      expect(event).not.toBeNull();
      expect(event?.metadata.positionId).toBe('1469935');
      expect(event?.metadata.action).toBe('SELL');
      expect(event?.metadata.volume).toBe(0.1);
    });
  });

  describe('4. Accurate Slippage & Price Improvement Calculations', () => {
    it('should distinguish pending limit price from activation quote and calculate price improvement vs slippage', () => {
      // Pending Buy Stop:
      // Limit/Stop Price = 4202.50
      // Market quote at activation = Ask 4202.80
      // Executed Fill Price = 4202.99
      const incident = {
        ticketId: '1442633',
        login: '70038',
        symbol: 'XAUUSD.V',
        action: 'BUY' as const,
        volume: 0.1,
        events: [
          {
            timestamp: '2026-10-09T08:36:00.100Z',
            eventType: 'ORDER_TRIGGERED' as const,
            rawMessage: 'triggered',
            login: '70038',
            metadata: {
              orderId: '1442633',
              action: 'BUY' as const,
              priceRequested: 4202.50, // pending limit price
              priceActivation: 4202.80, // activation market quote benchmark
              activationAsk: 4202.80,
              activationBid: 4202.50,
            },
          },
          {
            timestamp: '2026-10-09T08:36:02.327Z',
            eventType: 'DEAL_EXECUTED' as const,
            rawMessage: 'deal performed',
            login: '70038',
            metadata: {
              dealId: '1290112',
              action: 'BUY' as const,
              priceExecuted: 4202.99,
            },
          },
        ],
      };

      const metrics = metricsService.calculate(incident, 2, 0.01, 'MT5_SERVER');

      // Price improvement against pending limit price:
      // BUY filled higher than stop price: 4202.50 - 4202.99 = -0.49 (-49.0 points adverse vs stop)
      expect(metrics.pendingLimitPrice).toBe(4202.50);
      expect(metrics.quoteBenchmark).toBe(4202.80);
      expect(metrics.priceExecuted).toBe(4202.99);
      expect(metrics.priceImprovementPoints).toBe(-49.0);

      // Quote-to-fill slippage against market quote benchmark at activation:
      // Fill (4202.99) - Activation Ask (4202.80) = +0.19 => 19.0 points Adverse
      expect(metrics.slippagePoints).toBe(19.0);
      expect(metrics.slippageType).toBe('Adverse');
    });

    it('should return NOT_OBSERVABLE and null points for market orders without observable requested prices', () => {
      // Market order executed without observable requested price
      const incident = {
        ticketId: '99001',
        login: '70038',
        symbol: 'XAUUSD.V',
        action: 'BUY' as const,
        volume: 0.1,
        events: [
          {
            timestamp: '2026-10-09T08:36:00.000Z',
            eventType: 'EXECUTION_REQUEST' as const,
            rawMessage: 'order placed for execution [#99001 buy 0.1 XAUUSD.V at market]',
            login: '70038',
            metadata: {
              orderId: '99001',
              action: 'BUY' as const,
              volume: 0.1,
              // priceRequested is undefined for market orders
            },
          },
          {
            timestamp: '2026-10-09T08:36:00.120Z',
            eventType: 'DEAL_EXECUTED' as const,
            rawMessage: 'deal performed [#99002 buy 0.1 XAUUSD.V at 4202.99]',
            login: '70038',
            metadata: {
              dealId: '99002',
              action: 'BUY' as const,
              priceExecuted: 4202.99,
            },
          },
        ],
      };

      const metrics = metricsService.calculate(incident, 2, 0.01, 'MT5_SERVER');

      expect(metrics.slippagePoints).toBeNull();
      expect(metrics.slippageType).toBe('NOT_OBSERVABLE');
      expect(metrics.slippageWarning).toContain('Market order');
    });

    it('should return N/A for analyzeExecution net slippage when requested baseline is unobservable on both legs', () => {
      const entry = {
        priceRequested: null,
        priceExecuted: 4200.00,
        slippagePoints: null,
        slippageType: 'NOT_OBSERVABLE',
        totalObservableExecutionTimeMs: 120,
      };

      const exit = {
        priceRequested: null,
        priceExecuted: 4210.00,
        slippagePoints: null,
        slippageType: 'NOT_OBSERVABLE',
        totalObservableExecutionTimeMs: 80,
      };

      const analysis = metricsService.analyzeExecution(entry, exit);

      expect(analysis.netSlippage.slippagePoints).toBeNull();
      expect(analysis.netSlippage.slippageType).toBe('N/A');
      expect(analysis.cumulativeLatency).toBe(200);
      expect(analysis.averageLatency).toBe(100);
    });

    it('should accurately calculate SELL adverse slippage when execution price is lower than requested price', () => {
      const incident = {
        ticketId: '99005',
        login: '70038',
        symbol: 'EURUSD',
        action: 'SELL' as const,
        volume: 1.0,
        events: [
          {
            timestamp: '2026-10-09T10:00:00.000Z',
            eventType: 'REQUEST' as const,
            rawMessage: 'request',
            login: '70038',
            metadata: { priceRequested: 1.10500 },
          },
          {
            timestamp: '2026-10-09T10:00:00.050Z',
            eventType: 'DEAL_EXECUTED' as const,
            rawMessage: 'deal',
            login: '70038',
            metadata: { priceExecuted: 1.10480 }, // sold 20 points lower than requested
          },
        ],
      };

      const metrics = metricsService.calculate(incident, 5, 0.00001, 'MT5_SERVER');
      expect(metrics.slippagePoints).toBe(20.0);
      expect(metrics.slippageType).toBe('Adverse');
    });

    it('should accurately calculate SELL favorable slippage when execution price is higher than requested price', () => {
      const incident = {
        ticketId: '99006',
        login: '70038',
        symbol: 'EURUSD',
        action: 'SELL' as const,
        volume: 1.0,
        events: [
          {
            timestamp: '2026-10-09T10:00:00.000Z',
            eventType: 'REQUEST' as const,
            rawMessage: 'request',
            login: '70038',
            metadata: { priceRequested: 1.10500 },
          },
          {
            timestamp: '2026-10-09T10:00:00.050Z',
            eventType: 'DEAL_EXECUTED' as const,
            rawMessage: 'deal',
            login: '70038',
            metadata: { priceExecuted: 1.10520 }, // sold 20 points higher than requested
          },
        ],
      };

      const metrics = metricsService.calculate(incident, 5, 0.00001, 'MT5_SERVER');
      expect(metrics.slippagePoints).toBe(20.0);
      expect(metrics.slippageType).toBe('Favorable');
    });
  });

  describe('5. Execution Latency: Real Timings and No Synthetic Offsets', () => {
    it('should compute duration_ms strictly from genuine timestamps without hardcoded offsets', () => {
      const incident = {
        ticketId: '99010',
        login: '70038',
        symbol: 'XAUUSD.V',
        action: 'BUY' as const,
        volume: 0.1,
        events: [
          {
            timestamp: '2026-10-09T08:36:00.100Z',
            eventType: 'REQUEST' as const,
            rawMessage: 'request',
            login: '70038',
            metadata: { priceRequested: 4200.00 },
          },
          {
            timestamp: '2026-10-09T08:36:00.125Z',
            eventType: 'ROUTED' as const,
            rawMessage: 'routed',
            login: '70038',
            metadata: {},
          },
          {
            timestamp: '2026-10-09T08:36:00.200Z',
            eventType: 'EXECUTION_REQUEST' as const,
            rawMessage: 'placed for execution',
            login: '70038',
            metadata: {},
          },
          {
            timestamp: '2026-10-09T08:36:00.275Z',
            eventType: 'DEAL_EXECUTED' as const,
            rawMessage: 'deal performed',
            login: '70038',
            metadata: { priceExecuted: 4200.00 },
          },
        ],
      };

      const metrics = metricsService.calculate(incident, 2, 0.01, 'MT5_SERVER');

      expect(metrics.routingDelayMs).toBe(25);
      expect(metrics.executionRequestDelayMs).toBe(75);
      expect(metrics.executionProcessingMs).toBe(75);
      expect(metrics.totalObservableExecutionTimeMs).toBe(175);
    });
  });

  describe('6. Permanent MT5 Read-Only Security Rule Verification', () => {
    it('should verify that mt5-connector contains zero trading mutation endpoints or methods', () => {
      const connectorPath = path.resolve(__dirname, '../../../mt5-connector/main.py');
      const connectorCode = fs.readFileSync(connectorPath, 'utf8');

      // The connector must strictly NEVER call MT5 trading mutation functions
      expect(connectorCode).not.toContain('OrderSend(');
      expect(connectorCode).not.toContain('OrderModify(');
      expect(connectorCode).not.toContain('OrderClose(');
      expect(connectorCode).not.toContain('PositionClose(');
      expect(connectorCode).not.toContain('TradeRequest(');
      expect(connectorCode).not.toContain('OrderDelete(');
    });
  });
});
