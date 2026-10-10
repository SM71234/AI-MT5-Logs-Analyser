import { parseFullTimestamp } from './normalization.engine';
import { MetricsService } from '../metrics/metrics.service';
import { CorrelatedIncident } from './correlation.engine';
import { NormalizedEvent } from './normalization.engine';

describe('Chunk 3 - Timestamp, Rejection Analysis & Symbol Spec Integrity', () => {
  const metricsService = new MetricsService();

  describe('Timestamp parsing & conversions', () => {
    // TEST 1: Millisecond precision preservation
    it('TEST 1: should preserve millisecond precision', () => {
      const parsed = parseFullTimestamp('2026.08.14 10:20:30.123');
      expect(parsed.timestampServer).toBe('2026-08-14T10:20:30.123');
      expect(parsed.timestampRaw).toBe('2026.08.14 10:20:30.123');
    });

    // TEST 2: Server timestamp with explicit offset
    it('TEST 2: should convert explicit offset server timestamp to correct UTC', () => {
      const parsed = parseFullTimestamp('2026.08.14 10:20:30.123+03:00');
      expect(parsed.timezoneSource).toBe('EXPLICIT_OFFSET');
      expect(parsed.timestampUtc).toBe('2026-08-14T07:20:30.123Z');
      expect(parsed.timestampServer).toBe('2026-08-14T10:20:30.123');
    });

    // TEST 3: Server timestamp without explicit offset (should not assume UTC)
    it('TEST 3: should not assume UTC for timestamps without offset', () => {
      const parsed = parseFullTimestamp('2026.08.14 10:20:30.123');
      expect(parsed.timezoneSource).toBe('UNKNOWN');
      expect(parsed.timestampUtc).toBeNull();
      expect(parsed.timestampServer).toBe('2026-08-14T10:20:30.123');
    });

    // TEST 4: Cross-timezone comparison
    it('TEST 4: should accurately compare two events across timezones using UTC', () => {
      const parsedA = parseFullTimestamp('2026.08.14 10:20:30.000+03:00'); // UTC: 07:20:30
      const parsedB = parseFullTimestamp('2026.08.14 08:20:31.000+01:00'); // UTC: 07:20:31
      
      const timeA = parsedA.timestampUtc ? new Date(parsedA.timestampUtc).getTime() : 0;
      const timeB = parsedB.timestampUtc ? new Date(parsedB.timestampUtc).getTime() : 0;
      
      expect(timeB).toBeGreaterThan(timeA);
      expect(timeB - timeA).toBe(1000); // 1 second difference
    });

    // TEST 5: Timing analysis doesn't assume raw ordering (uses normalized timestamps)
    it('TEST 5: should perform timing analysis using sorted normalized timestamps even if raw events are out of order', () => {
      const events: NormalizedEvent[] = [
        {
          timestamp: '2026-08-14T10:20:35.000Z',
          timestampRaw: '2026.08.14 10:20:35.000',
          timestampServer: '2026-08-14T10:20:35.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'DEAL_EXECUTED',
          rawMessage: 'deal performed ...',
          login: '1001',
          metadata: { dealId: 'D1', priceExecuted: 1.1000 },
        },
        {
          timestamp: '2026-08-14T10:20:30.000Z',
          timestampRaw: '2026.08.14 10:20:30.000',
          timestampServer: '2026-08-14T10:20:30.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'REQUEST',
          rawMessage: 'order request ...',
          login: '1001',
          metadata: { priceRequested: 1.1000 },
        }
      ];

      // Note: events[0] has later timestamp (10:20:35) but is first in raw list
      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events: events,
      };

      const metrics = metricsService.calculate(incident, 5, 0.00001);
      // latency = 35 - 30 = 5000 ms
      expect(metrics.totalObservableExecutionTimeMs).toBe(5000);
    });

    // TEST 6: DST Boundary Transitions
    it('TEST 6: should parse DST boundary offsets correctly', () => {
      const parsedDST = parseFullTimestamp('2026.06.01 12:00:00.000+01:00'); // BST/DST
      const parsedStandard = parseFullTimestamp('2026-12-01 12:00:00.000+00:00'); // GMT
      
      expect(parsedDST.timestampUtc).toBe('2026-06-01T11:00:00.000Z');
      expect(parsedStandard.timestampUtc).toBe('2026-12-01T12:00:00.000Z');
    });

    // TEST 7: Invalid timestamps resolved as UNKNOWN/NOT_OBSERVABLE
    it('TEST 7: should map invalid timestamps to UNKNOWN or NOT_OBSERVABLE', () => {
      const parsed = parseFullTimestamp('invalid-date-string');
      expect(parsed.timezoneSource).toBe('UNKNOWN');
      expect(parsed.timestampUtc).toBeNull();
      
      const events: NormalizedEvent[] = [
        {
          timestamp: 'invalid-time',
          timestampRaw: 'invalid-time',
          timestampServer: 'invalid-time',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'REQUEST',
          rawMessage: 'order request ...',
          login: '1001',
          metadata: {},
        }
      ];

      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events: events,
      };

      const metrics = metricsService.calculate(incident);
      expect(metrics.timingQuality).toBe('NOT_OBSERVABLE');
      expect(metrics.totalObservableExecutionTimeMs).toBeNull();
    });
  });

  describe('Rejection & Requote Life Cycle', () => {
    // TEST 1: Valid request -> executed deal
    it('TEST 1: should correctly categorize EXECUTED status', () => {
      const events: NormalizedEvent[] = [
        {
          timestamp: '2026-08-14T10:20:30.000Z',
          timestampRaw: '2026.08.14 10:20:30.000',
          timestampServer: '2026-08-14T10:20:30.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'REQUEST',
          rawMessage: 'order request ...',
          login: '1001',
          metadata: { priceRequested: 1.1000 },
        },
        {
          timestamp: '2026-08-14T10:20:31.000Z',
          timestampRaw: '2026.08.14 10:20:31.000',
          timestampServer: '2026-08-14T10:20:31.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'DEAL_EXECUTED',
          rawMessage: 'deal performed ...',
          login: '1001',
          metadata: { dealId: 'D1', priceExecuted: 1.1000 },
        }
      ];

      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events,
      };

      const metrics = metricsService.calculate(incident);
      expect(metrics.status).toBe('EXECUTED');
      expect(metrics.executionDetails?.isDealCreated).toBe(true);
      expect(metrics.executionDetails?.dealId).toBe('D1');
    });

    // TEST 2: Request -> server rejection
    it('TEST 2: should identify and attribute SERVER rejections', () => {
      const events: NormalizedEvent[] = [
        {
          timestamp: '2026-08-14T10:20:30.000Z',
          timestampRaw: '2026.08.14 10:20:30.000',
          timestampServer: '2026-08-14T10:20:30.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'REQUEST',
          rawMessage: 'order request ...',
          login: '1001',
          metadata: {},
        },
        {
          timestamp: '2026-08-14T10:20:31.000Z',
          timestampRaw: '2026.08.14 10:20:31.000',
          timestampServer: '2026-08-14T10:20:31.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'ORDER_REJECTED',
          rawMessage: '[Trade] request rejected: not enough money',
          login: '1001',
          metadata: { rawReason: 'not enough money' },
        }
      ];

      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events,
      };

      const metrics = metricsService.calculate(incident);
      expect(metrics.status).toBe('REJECTED');
      expect(metrics.executionDetails?.rejectedBy).toBe('SERVER');
      expect(metrics.executionDetails?.normalizedRejectionReason).toBe('NO_MONEY');
    });

    // TEST 3: Request -> dealer rejection
    it('TEST 3: should identify and attribute DEALER rejections only with evidence', () => {
      const events: NormalizedEvent[] = [
        {
          timestamp: '2026-08-14T10:20:30.000Z',
          timestampRaw: '2026.08.14 10:20:30.000',
          timestampServer: '2026-08-14T10:20:30.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'REQUEST',
          rawMessage: 'order request ...',
          login: '1001',
          metadata: {},
        },
        {
          timestamp: '2026-08-14T10:20:31.000Z',
          timestampRaw: '2026.08.14 10:20:31.000',
          timestampServer: '2026-08-14T10:20:31.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'ORDER_REJECTED',
          rawMessage: '[Dealer] dealer #5 rejected buy 1.00 EURUSD at 1.1000 (Off quotes)',
          login: '1001',
          metadata: { dealerId: '5', rawReason: 'Off quotes' },
        }
      ];

      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events,
      };

      const metrics = metricsService.calculate(incident);
      expect(metrics.status).toBe('REJECTED');
      expect(metrics.executionDetails?.rejectedBy).toBe('DEALER');
      expect(metrics.executionDetails?.dealerResponse).toBe('Dealer #5 rejected');
      expect(metrics.executionDetails?.normalizedRejectionReason).toBe('REQUOTE');
    });

    // TEST 4: Request -> requote -> successful execution
    it('TEST 4: should preserve complete requote sequence leading to successful execution', () => {
      const events: NormalizedEvent[] = [
        {
          timestamp: '2026-08-14T10:20:30.000Z',
          timestampRaw: '2026.08.14 10:20:30.000',
          timestampServer: '2026-08-14T10:20:30.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'REQUEST',
          rawMessage: 'order request ...',
          login: '1001',
          metadata: { priceRequested: 1.1000 },
        },
        {
          timestamp: '2026-08-14T10:20:31.000Z',
          timestampRaw: '2026.08.14 10:20:31.000',
          timestampServer: '2026-08-14T10:20:31.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'REQUOTED',
          rawMessage: '[Dealer] dealer #5 rejected buy 1.00 EURUSD at 1.1000 (requote 1.1010)',
          login: '1001',
          metadata: { dealerId: '5', requotePrice: 1.1010, volume: 1.0 },
        },
        {
          timestamp: '2026-08-14T10:20:32.000Z',
          timestampRaw: '2026.08.14 10:20:32.000',
          timestampServer: '2026-08-14T10:20:32.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'DEAL_EXECUTED',
          rawMessage: 'deal performed ...',
          login: '1001',
          metadata: { dealId: 'D1', priceExecuted: 1.1010 },
        }
      ];

      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events,
      };

      const metrics = metricsService.calculate(incident);
      expect(metrics.status).toBe('EXECUTED');
      expect(metrics.executionDetails?.requoteSequence?.length).toBe(1);
      expect(metrics.executionDetails?.requoteSequence?.[0].price).toBe(1.1010);
    });

    // TEST 5: Request -> requote -> rejection
    it('TEST 5: should map requote sequence followed by rejection correctly', () => {
      const events: NormalizedEvent[] = [
        {
          timestamp: '2026-08-14T10:20:30.000Z',
          timestampRaw: '2026.08.14 10:20:30.000',
          timestampServer: '2026-08-14T10:20:30.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'REQUEST',
          rawMessage: 'order request ...',
          login: '1001',
          metadata: { priceRequested: 1.1000 },
        },
        {
          timestamp: '2026-08-14T10:20:31.000Z',
          timestampRaw: '2026.08.14 10:20:31.000',
          timestampServer: '2026-08-14T10:20:31.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'REQUOTED',
          rawMessage: '[Dealer] dealer #5 rejected buy 1.00 EURUSD at 1.1000 (requote 1.1010)',
          login: '1001',
          metadata: { dealerId: '5', requotePrice: 1.1010, volume: 1.0 },
        },
        {
          timestamp: '2026-08-14T10:20:32.000Z',
          timestampRaw: '2026.08.14 10:20:32.000',
          timestampServer: '2026-08-14T10:20:32.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'ORDER_REJECTED',
          rawMessage: '[Trade] request rejected: market closed',
          login: '1001',
          metadata: { rawReason: 'market closed' },
        }
      ];

      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events,
      };

      const metrics = metricsService.calculate(incident);
      expect(metrics.status).toBe('REJECTED');
      expect(metrics.executionDetails?.requoteSequence?.length).toBe(1);
      expect(metrics.executionDetails?.normalizedRejectionReason).toBe('MARKET_CLOSED');
    });

    // TEST 6: Request exists but no deal -> INCOMPLETE or NOT_OBSERVABLE
    it('TEST 6: should mark as INCOMPLETE status if request exists but no outcome event occurred', () => {
      const events: NormalizedEvent[] = [
        {
          timestamp: '2026-08-14T10:20:30.000Z',
          timestampRaw: '2026.08.14 10:20:30.000',
          timestampServer: '2026-08-14T10:20:30.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'REQUEST',
          rawMessage: 'order request ...',
          login: '1001',
          metadata: {},
        }
      ];

      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events,
      };

      const metrics = metricsService.calculate(incident);
      expect(metrics.status).toBe('INCOMPLETE');
      expect(metrics.executed).toBe(false);
      expect(metrics.executionDetails?.isDealCreated).toBe(false);
      expect(metrics.executionQuality).toBe('NOT_OBSERVABLE');
    });

    // TEST 7: Explicit MT5 Rejection Code preservation
    it('TEST 7: should parse and map explicit MT5 retcode and normalize reason', () => {
      const events: NormalizedEvent[] = [
        {
          timestamp: '2026-08-14T10:20:30.000Z',
          timestampRaw: '2026.08.14 10:20:30.000',
          timestampServer: '2026-08-14T10:20:30.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'ORDER_REJECTED',
          rawMessage: 'order failed with retcode 10014 (invalid volume)',
          login: '1001',
          metadata: { rawReason: 'invalid volume' },
        }
      ];

      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events,
      };

      const metrics = metricsService.calculate(incident);
      expect(metrics.executionDetails?.rejectionCode).toBe('10014');
      expect(metrics.executionDetails?.normalizedRejectionReason).toBe('INVALID_VOLUME');
    });

    // TEST 8: Unknown rejection reason fallback
    it('TEST 8: should map unknown reason to UNKNOWN/rawReason rather than fabricating details', () => {
      const events: NormalizedEvent[] = [
        {
          timestamp: '2026-08-14T10:20:30.000Z',
          timestampRaw: '2026.08.14 10:20:30.000',
          timestampServer: '2026-08-14T10:20:30.000',
          timestampUtc: null,
          timezoneSource: 'UNKNOWN',
          eventType: 'ORDER_REJECTED',
          rawMessage: 'order failed: some weird broker error',
          login: '1001',
          metadata: { rawReason: 'some weird broker error' },
        }
      ];

      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'EURUSD',
        action: 'BUY',
        volume: 1.0,
        events,
      };

      const metrics = metricsService.calculate(incident);
      expect(metrics.executionDetails?.rejectedBy).toBe('UNKNOWN');
      expect(metrics.executionDetails?.rawRejectionReason).toBe('some weird broker error');
      expect(metrics.executionDetails?.normalizedRejectionReason).toBeUndefined();
    });
  });

  describe('Symbol Data Specs & Heuristics', () => {
    it('should correctly configure default parameters based on JPY/Metal patterns and not apply FX point universally', () => {
      // Mock metrics calculate point and digits checks:
      const incident: CorrelatedIncident = {
        ticketId: '1001',
        login: '1001',
        symbol: 'USDJPY',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:20:30.000Z',
            timestampRaw: '2026.08.14 10:20:30.000',
            timestampServer: '2026-08-14T10:20:30.000',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'REQUEST',
            rawMessage: 'order request ...',
            login: '1001',
            metadata: { priceRequested: 145.50 },
          },
          {
            timestamp: '2026-08-14T10:20:31.000Z',
            timestampRaw: '2026.08.14 10:20:31.000',
            timestampServer: '2026-08-14T10:20:31.000',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ...',
            login: '1001',
            metadata: { dealId: 'D1', priceExecuted: 145.52 },
          }
        ]
      };

      // USDJPY has 3 digits normally or 2 in legacy checks. Let's pass 3 digits, point = 0.001
      const metricsJPY = metricsService.calculate(incident, 3, 0.001);
      // slippage: (145.52 - 145.50) = 0.02.   0.02 / 0.001 = 20.0 points
      expect(metricsJPY.slippagePoints).toBe(20.0);
      expect(metricsJPY.pointSize).toBe(0.001);

      // Gold check (e.g. XAUUSD), normally 2 digits, point = 0.01
      incident.symbol = 'XAUUSD';
      incident.events[0].metadata.priceRequested = 2000.00;
      incident.events[1].metadata.priceExecuted = 2000.15;
      const metricsGold = metricsService.calculate(incident, 2, 0.01);
      // slippage: 0.15 / 0.01 = 15.0 points
      expect(metricsGold.slippagePoints).toBe(15.0);
    });
  });

  describe('Regression - Preserving existing Client-tab Slippage & Delay', () => {
    it('should calculate the exact same Slippage and Delay values matching existing EURUSD fixtures', () => {
      const EURUSD_BUY_NORMAL: CorrelatedIncident = {
        ticketId: '670',
        login: '259713',
        symbol: 'EURUSD.r',
        action: 'BUY',
        volume: 0.01,
        events: [
          {
            timestamp: '2026-08-07T19:43:16.000Z',
            timestampRaw: '2026.08.07 19:43:16.000',
            timestampServer: '2026-08-07T19:43:16.000',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'REQUEST',
            rawMessage: 'request #1 buy 0.01 EURUSD.r',
            login: '259713',
            metadata: { priceRequested: 1.10000 },
          },
          {
            timestamp: '2026-08-07T19:43:16.120Z',
            timestampRaw: '2026.08.07 19:43:16.120',
            timestampServer: '2026-08-07T19:43:16.120',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed #1 buy 0.01 EURUSD.r at 1.10000',
            login: '259713',
            metadata: { dealId: 'D1', priceExecuted: 1.10000 },
          }
        ]
      };

      const metrics = metricsService.calculate(EURUSD_BUY_NORMAL, 5, 0.00001);
      
      // Delay check: 120ms
      expect(metrics.totalObservableExecutionTimeMs).toBe(120);
      
      // Slippage check: 0.0 points
      expect(metrics.slippagePoints).toBe(0.0);
      expect(metrics.slippageType).toBe('Zero');
    });

    it('should calculate the exact same adverse Slippage for Gold BUY order fixtures', () => {
      const GOLD_BUY_ADVERSE: CorrelatedIncident = {
        ticketId: '789',
        login: '259713',
        symbol: 'XAUUSD.r',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-07T19:43:16.000Z',
            timestampRaw: '2026.08.07 19:43:16.000',
            timestampServer: '2026-08-07T19:43:16.000',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'REQUEST',
            rawMessage: 'request #2 buy 1.00 XAUUSD.r',
            login: '259713',
            metadata: { priceRequested: 2000.00 },
          },
          {
            timestamp: '2026-08-07T19:43:16.150Z',
            timestampRaw: '2026.08.07 19:43:16.150',
            timestampServer: '2026-08-07T19:43:16.150',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed #2 buy 1.00 XAUUSD.r at 2000.05',
            login: '259713',
            metadata: { dealId: 'D2', priceExecuted: 2000.05 },
          }
        ]
      };

      const metrics = metricsService.calculate(GOLD_BUY_ADVERSE, 2, 0.01);
      
      // Delay check: 150ms
      expect(metrics.totalObservableExecutionTimeMs).toBe(150);
      
      // Slippage check: (2000.05 - 2000.00) = 0.05.   0.05 / 0.01 = 5.0 points
      expect(metrics.slippagePoints).toBe(5.0);
      expect(metrics.slippageType).toBe('Adverse');
    });
  });
});
