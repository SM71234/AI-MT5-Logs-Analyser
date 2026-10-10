import { MetricsService } from '../metrics/metrics.service';
import { CorrelatedIncident } from './correlation.engine';
import { NormalizedEvent } from './normalization.engine';

describe('Calculated Metrics & Execution Engine Test Suite', () => {
  const metricsService = new MetricsService();

  describe('Reference XAUUSD Regression Trade Tests', () => {
    it('should calculate the exact reference trade values from XAUUSD logs', () => {
      // Entry incident corresponding to the reference BUY trade
      const entryIncident: CorrelatedIncident = {
        ticketId: '7100172',
        login: '259713',
        symbol: 'XAUUSD.r',
        action: 'BUY',
        volume: 0.01,
        events: [
          {
            timestamp: '2026-08-14T15:34:00.874Z',
            timestampRaw: '2026.08.14 15:34:00.874',
            timestampServer: '2026-08-14T15:34:00.874',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'REQUEST',
            rawMessage: 'Client BUY request Requested price: 4383.21',
            login: '259713',
            metadata: { priceRequested: 4383.21, volume: 0.01, symbol: 'XAUUSD.p', action: 'BUY' },
          },
          {
            timestamp: '2026-08-14T15:34:01.035Z',
            timestampRaw: '2026.08.14 15:34:01.035',
            timestampServer: '2026-08-14T15:34:01.035',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'ROUTED',
            rawMessage: 'Request transferred to dealers',
            login: '259713',
            metadata: {},
          },
          {
            timestamp: '2026-08-14T15:34:01.528Z',
            timestampRaw: '2026.08.14 15:34:01.528',
            timestampServer: '2026-08-14T15:34:01.528',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'EXECUTION_REQUEST',
            rawMessage: 'Dealer request received',
            login: '259713',
            metadata: {},
          },
          {
            timestamp: '2026-08-14T15:34:01.530Z',
            timestampRaw: '2026.08.14 15:34:01.530',
            timestampServer: '2026-08-14T15:34:01.530',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'EXECUTION_RESPONSE',
            rawMessage: 'Dealer confirms BUY at 4383.25',
            login: '259713',
            metadata: {},
          },
          {
            timestamp: '2026-08-14T15:34:01.530Z',
            timestampRaw: '2026.08.14 15:34:01.530',
            timestampServer: '2026-08-14T15:34:01.530',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'Deal performed Deal ID: 6903295',
            login: '259713',
            metadata: { dealId: '6903295', priceExecuted: 4383.25, volume: 0.01, symbol: 'XAUUSD.p', action: 'BUY' },
          },
        ],
      };
 
      // Exit incident corresponding to the reference SELL close trade
      const exitIncident: CorrelatedIncident = {
        ticketId: '7100172',
        login: '259713',
        symbol: 'XAUUSD.p',
        action: 'SELL',
        volume: 0.01,
        events: [
          {
            timestamp: '2026-08-14T15:34:04.639Z',
            timestampRaw: '2026.08.14 15:34:04.639',
            timestampServer: '2026-08-14T15:34:04.639',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'REQUEST',
            rawMessage: 'Client SELL request Requested price: 4382.81',
            login: '259713',
            metadata: { priceRequested: 4382.81, volume: 0.01, symbol: 'XAUUSD.p', action: 'SELL' },
          },
          {
            timestamp: '2026-08-14T15:34:04.800Z',
            timestampRaw: '2026.08.14 15:34:04.800',
            timestampServer: '2026-08-14T15:34:04.800',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'ROUTED',
            rawMessage: 'Request transferred to dealers',
            login: '259713',
            metadata: {},
          },
          {
            timestamp: '2026-08-14T15:34:05.294Z',
            timestampRaw: '2026.08.14 15:34:05.294',
            timestampServer: '2026-08-14T15:34:05.294',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'EXECUTION_REQUEST',
            rawMessage: 'Dealer request received',
            login: '259713',
            metadata: {},
          },
          {
            timestamp: '2026-08-14T15:34:05.295Z',
            timestampRaw: '2026.08.14 15:34:05.295',
            timestampServer: '2026-08-14T15:34:05.295',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'EXECUTION_RESPONSE',
            rawMessage: 'Dealer confirms SELL at 4382.71',
            login: '259713',
            metadata: {},
          },
          {
            timestamp: '2026-08-14T15:34:05.295Z',
            timestampRaw: '2026.08.14 15:34:05.295',
            timestampServer: '2026-08-14T15:34:05.295',
            timestampUtc: null,
            timezoneSource: 'UNKNOWN',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'Deal performed Deal ID: 6903298',
            login: '259713',
            metadata: { dealId: '6903298', priceExecuted: 4382.71, volume: 0.01, symbol: 'XAUUSD.p', action: 'SELL' },
          },
        ],
      };
 
      const entryMetrics = metricsService.calculate(entryIncident, 2, 0.01);
      const exitMetrics = metricsService.calculate(exitIncident, 2, 0.01);
 
      // Assert entry execution metrics
      expect(entryMetrics.priceRequested).toBe(4383.21);
      expect(entryMetrics.priceExecuted).toBe(4383.25);
      expect(entryMetrics.priceDelta).toBe(0.04);
      expect(entryMetrics.pointSize).toBe(0.01);
      expect(entryMetrics.slippagePoints).toBe(4.0);
      expect(entryMetrics.slippageType).toBe('Adverse');
      expect(entryMetrics.routingDelayMs).toBe(161);
      expect(entryMetrics.dealerBridgeResponseTimeMs).toBe(2);
      expect(entryMetrics.totalObservableExecutionTimeMs).toBe(656);
      expect(entryMetrics.dealId).toBe('6903295');
      expect(entryMetrics.positionId).toBe('7100172');
      expect(entryMetrics.dealId).not.toBe(entryMetrics.positionId);
 
      // Assert exit execution metrics
      expect(exitMetrics.priceRequested).toBe(4382.81);
      expect(exitMetrics.priceExecuted).toBe(4382.71);
      expect(exitMetrics.priceDelta).toBe(-0.10);
      expect(exitMetrics.pointSize).toBe(0.01);
      expect(exitMetrics.slippagePoints).toBe(10.0);
      expect(exitMetrics.slippageType).toBe('Adverse'); // SELL executed < requested => ADVERSE
      expect(exitMetrics.routingDelayMs).toBe(161);
      expect(exitMetrics.dealerBridgeResponseTimeMs).toBe(1);
      expect(exitMetrics.totalObservableExecutionTimeMs).toBe(656);
      expect(exitMetrics.dealId).toBe('6903298');
      expect(exitMetrics.positionId).toBe('7100172');
      expect(exitMetrics.dealId).not.toBe(exitMetrics.positionId);
 
      // Calculate round-trip summaries
      const summary = metricsService.analyzeExecution(entryMetrics, exitMetrics);
      expect(summary.holdTimeMs).toBe(3765); // 15:34:05.295 - 15:34:01.530 = 3765 ms
    });
  });

  describe('Generic Test Matrix (40 cases)', () => {
    // 1. BUY entry
    it('Case 1: BUY entry calculation', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.12005, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.action).toBe('BUY');
      expect(res.slippagePoints).toBe(5);
    });

    // 2. SELL entry
    it('Case 2: SELL entry calculation', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'SELL', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.11995, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.action).toBe('SELL');
      expect(res.slippagePoints).toBe(5);
    });

    // 3. BUY exit
    it('Case 3: BUY exit execution', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.12005, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.slippageType).toBe('Adverse'); // BUY executed > requested
    });

    // 4. SELL exit
    it('Case 4: SELL exit execution', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'SELL', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.11995, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.slippageType).toBe('Adverse'); // SELL executed < requested
    });

    // 5. Zero slippage
    it('Case 5: Zero slippage execution', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.12000, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.slippagePoints).toBe(0);
      expect(res.slippageType).toBe('Zero');
    });

    // 6. Favorable slippage
    it('Case 6: Favorable slippage BUY', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.11990, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.slippageType).toBe('Favorable');
      expect(res.slippagePoints).toBe(10);
    });

    // 7. Adverse slippage
    it('Case 7: Adverse slippage BUY', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.12015, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.slippageType).toBe('Adverse');
      expect(res.slippagePoints).toBe(15);
    });

    // 8. Missing requested price
    it('Case 8: Missing requested price => NOT_OBSERVABLE slippage', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.12015, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.slippagePoints).toBeNull();
      expect(res.slippageType).toBe('NOT_OBSERVABLE');
    });

    // 9. Missing execution price
    it('Case 9: Missing execution price => NOT_OBSERVABLE slippage', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.slippagePoints).toBeNull();
      expect(res.slippageType).toBe('NOT_OBSERVABLE');
    });

    // 10. Missing point size
    it('Case 10: Missing point size and symbol specs fallback to heuristics', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.12005, dealId: 'D1' } }
        ]
      };
      // Do not provide digits/point
      const res = metricsService.calculate(incident, null, null);
      expect(res.pointSize).toBe(0.00001); // fallback heuristic for EURUSD
      expect(res.pointSizeSource).toBe('HEURISTIC');
      expect(res.slippagePoints).toBe(5);
    });

    // 11. Missing routing timestamp
    it('Case 11: Missing routing timestamp', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: {} }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.routingDelayMs).toBeNull();
    });

    // 12. Missing dealer timestamp
    it('Case 12: Missing dealer timestamp', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: {} }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.dealerBridgeResponseTimeMs).toBeNull();
    });

    // 13. Missing execution timestamp
    it('Case 13: Missing execution timestamp', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.totalObservableExecutionTimeMs).toBeNull();
    });

    // 14. Single entry / single exit
    it('Case 14: Single entry / single exit analyzeExecution', () => {
      const entry = { priceRequested: 1.1000, priceExecuted: 1.1002, slippagePoints: 2, slippageType: 'Adverse', totalObservableExecutionTimeMs: 150, executed: true, timestamp: '2026-08-14T10:00:00.000Z' };
      const exit = { priceRequested: 1.1010, priceExecuted: 1.1008, slippagePoints: 2, slippageType: 'Adverse', totalObservableExecutionTimeMs: 100, executed: true, timestamp: '2026-08-14T10:00:10.000Z' };

      const summary = metricsService.analyzeExecution(entry, exit);
      expect(summary.cumulativeLatency).toBe(250);
      expect(summary.netSlippage.slippagePoints).toBe(4);
      expect(summary.holdTimeMs).toBe(10000);
    });

    // 15. Multiple entries
    it('Case 15: Multiple entries summary latency check', () => {
      const entry1 = { priceRequested: 1.0, priceExecuted: 1.0, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 50, executed: true, timestamp: '2026-08-14T10:00:00.000Z' };
      const entry2 = { priceRequested: 1.0, priceExecuted: 1.0, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 70, executed: true, timestamp: '2026-08-14T10:00:05.000Z' };
      
      const summary = metricsService.analyzeExecution(entry1, entry2);
      expect(summary.cumulativeLatency).toBe(120);
    });

    // 16. Multiple exits
    it('Case 16: Multiple exits latency check', () => {
      const entry = { priceRequested: 1.0, priceExecuted: 1.0, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 50, executed: true, timestamp: '2026-08-14T10:00:00.000Z' };
      const exit3 = { priceRequested: 1.0, priceExecuted: 1.0, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 80, executed: true, timestamp: '2026-08-14T10:00:15.000Z' };
      
      const summary = metricsService.analyzeExecution(entry, exit3);
      expect(summary.cumulativeLatency).toBe(130);
    });

    // 17. Partial close
    it('Case 17: Partial close status mapping', () => {
      // Reconstructed positionledger handles partial closes. We verify that analyzeExecution accepts partial legs cleanly.
      const entry = { priceRequested: 1.0, priceExecuted: 1.0, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 50, executed: true, timestamp: '2026-08-14T10:00:00.000Z' };
      const exitPartial = { priceRequested: 1.0, priceExecuted: 1.0, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 90, executed: true, timestamp: '2026-08-14T10:00:10.000Z' };
      
      const summary = metricsService.analyzeExecution(entry, exitPartial);
      expect(summary.netSlippage.slippageType).toBe('Zero');
    });

    // 18. Full close
    it('Case 18: Full close holdTimeMs calculation', () => {
      const entry = { priceRequested: 1.0, priceExecuted: 1.0, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 50, executed: true, timestamp: '2026-08-14T10:00:00.000Z' };
      const exitFull = { priceRequested: 1.0, priceExecuted: 1.0, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 50, executed: true, timestamp: '2026-08-14T10:00:25.000Z' };
      
      const summary = metricsService.analyzeExecution(entry, exitFull);
      expect(summary.holdTimeMs).toBe(25000);
    });

    // 19. Reversal
    it('Case 19: Reversal leg representation check', () => {
      const entry = { priceRequested: 1.0, priceExecuted: 1.0, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 50, executed: true, timestamp: '2026-08-14T10:00:00.000Z' };
      const reversalLeg = { priceRequested: 1.1, priceExecuted: 1.1, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 60, executed: true, timestamp: '2026-08-14T10:00:05.000Z' };
      
      const summary = metricsService.analyzeExecution(entry, reversalLeg);
      expect(summary.holdTimeMs).toBe(5000);
    });

    // 20. Requote
    it('Case 20: Requote sequence timeline parsing', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } },
          { timestamp: '2026-08-14T10:00:00.050Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUOTED', rawMessage: 'requoted to 1.12010', login: '101', metadata: { requotePrice: 1.12010 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.12010, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.executionDetails?.requoteSequence).toBeDefined();
      expect(res.executionDetails?.requoteSequence?.length).toBe(1);
      expect(res.executionDetails?.requoteSequence?.[0].price).toBe(1.12010);
    });

    // 21. Rejected request
    it('Case 21: Rejected request status mapping', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'ORDER_REJECTED', rawMessage: 'Rejected: retcode 10019 (NO_MONEY)', login: '101', metadata: { rawReason: 'No money' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.status).toBe('REJECTED');
      expect(res.rejection?.isRejected).toBe(true);
      expect(res.rejection?.reason).toBe('No money');
    });

    // 22. Successful retry after requote
    it('Case 22: Successful retry after requote sequence validation', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.12000 } },
          { timestamp: '2026-08-14T10:00:00.050Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUOTED', rawMessage: 'requoted price', login: '101', metadata: { requotePrice: 1.12010 } },
          { timestamp: '2026-08-14T10:00:00.120Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.12010, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.executionDetails?.isRetriedSuccessfully).toBe(true);
    });

    // 23. Open position
    it('Case 23: Open position metrics evaluation', () => {
      const entry = { priceRequested: 1.0, priceExecuted: 1.0, slippagePoints: 0, slippageType: 'Zero', totalObservableExecutionTimeMs: 50, executed: true, timestamp: '2026-08-14T10:00:00.000Z' };
      const summary = metricsService.analyzeExecution(entry, null);
      expect(summary.exitExecution).toBeNull();
      expect(summary.holdTimeMs).toBeNull(); // remains open, holdTimeMs is null
    });

    // 24. Incomplete position
    it('Case 24: Incomplete position (no execution/rejection)', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.status).toBe('INCOMPLETE');
      expect(res.executed).toBe(false);
    });

    // 25. Ambiguous correlation
    it('Case 25: Ambiguous correlation state indicator', () => {
      // In position-ledger, UNRESOLVED correlation results in AMBIGUOUS status
      // We check that metrics service calculates the sub-incident cleanly even under partial details.
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.executionQuality).toBe('NOT_OBSERVABLE');
    });

    // 26. Multiple symbols
    it('Case 26: Multiple symbols point size identification', () => {
      const incidentUSDJPY: CorrelatedIncident = {
        ticketId: '1', login: '1', symbol: 'USDJPY', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '1', metadata: { priceRequested: 150.00 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '1', metadata: { priceExecuted: 150.05, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incidentUSDJPY, null, null);
      expect(res.pointSize).toBe(0.01); // Heuristic for JPY JPY is JpyOrMetal => 0.01
    });

    // 27. Different symbol precision
    it('Case 27: Different symbol precision digits check', () => {
      const incident: CorrelatedIncident = {
        ticketId: '1', login: '1', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '1', metadata: { priceRequested: 1.1200 } }
        ]
      };
      const res = metricsService.calculate(incident, 4, 0.0001);
      expect(res.digits).toBe(4);
      expect(res.pointSize).toBe(0.0001);
    });

    // 28. Different point sizes
    it('Case 28: Different point sizes calculation', () => {
      const incident: CorrelatedIncident = {
        ticketId: '1', login: '1', symbol: 'BTCUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '1', metadata: { priceRequested: 60000.0 } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '1', metadata: { priceExecuted: 60001.0, dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 0, 1.0);
      expect(res.pointSize).toBe(1.0);
      expect(res.slippagePoints).toBe(1.0);
    });

    // 29. Out-of-order logs
    it('Case 29: Out-of-order logs timing analysis using timestamps', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          // execution comes first in array
          { timestamp: '2026-08-14T10:00:00.150Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { priceExecuted: 1.1000, dealId: 'D1' } },
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: { priceRequested: 1.1000 } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.totalObservableExecutionTimeMs).toBe(150);
    });

    // 30. Duplicate logs
    it('Case 30: Duplicate logs logic mapping handling', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { dealId: 'D1' } },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { dealId: 'D1' } } // duplicate
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.totalObservableExecutionTimeMs).toBe(100);
    });

    // 31. Incomplete MT5 retrieval
    it('Case 31: Incomplete MT5 retrieval (missing start event)', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: {} }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.totalObservableExecutionTimeMs).toBeNull();
      expect(res.timingQuality).toBe('NOT_OBSERVABLE');
    });

    // 32. Large historical dataset
    it('Case 32: Large historical dataset validation', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: Array.from({ length: 100 }, (_, i) => ({
          timestamp: `2026-08-14T10:00:00.${i}00Z`, timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN',
          eventType: i === 0 ? 'REQUEST' : (i === 99 ? 'DEAL_EXECUTED' : 'ROUTED'),
          rawMessage: '', login: '101', metadata: { priceRequested: i === 0 ? 1.0 : undefined, priceExecuted: i === 99 ? 1.0 : undefined, dealId: i === 99 ? 'D1' : undefined }
        }))
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.totalObservableExecutionTimeMs).toBe(990); // 0.99 seconds
    });

    // 33. Zero-volume/invalid-volume rejection
    it('Case 33: Zero-volume/invalid-volume rejection', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 0.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'ORDER_REJECTED', rawMessage: 'Rejection: retcode 10014 (INVALID_VOLUME)', login: '101', metadata: { rawReason: 'Invalid volume' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.rejection?.isRejected).toBe(true);
      expect(res.executionDetails?.normalizedRejectionReason).toBe('INVALID_VOLUME');
    });

    // 34. Market closed rejection
    it('Case 34: Market closed rejection', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'ORDER_REJECTED', rawMessage: 'Rejection: retcode 10015 (MARKET_CLOSED)', login: '101', metadata: { rawReason: 'Market closed' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.rejection?.isRejected).toBe(true);
      expect(res.executionDetails?.normalizedRejectionReason).toBe('MARKET_CLOSED');
    });

    // 35. Insufficient funds rejection
    it('Case 35: Insufficient funds rejection', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'ORDER_REJECTED', rawMessage: 'Rejection: retcode 10019 (NO_MONEY)', login: '101', metadata: { rawReason: 'No money' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.rejection?.isRejected).toBe(true);
      expect(res.executionDetails?.normalizedRejectionReason).toBe('NO_MONEY');
    });

    // 36. Dealer rejection
    it('Case 36: Dealer rejection source detection', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'ORDER_REJECTED', rawMessage: '[Dealer] rejected order', login: '101', metadata: { dealerId: '5' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.rejection?.rejectedBy).toBe('5');
      expect(res.executionDetails?.rejectedBy).toBe('DEALER');
    });

    // 37. Server rejection
    it('Case 37: Server rejection source detection', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'ORDER_REJECTED', rawMessage: 'Server busy', login: '101', metadata: { rawReason: 'margin or money limits' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.executionDetails?.rejectedBy).toBe('SERVER');
    });

    // 38. Client-side rejection
    it('Case 38: Client-side rejection (invalid volume / stops)', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'ORDER_REJECTED', rawMessage: 'Invalid stops', login: '101', metadata: { rawReason: 'stops check' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.executionDetails?.rejectedBy).toBe('CLIENT_REQUEST');
    });

    // 39. Execution with no explicit dealer event
    it('Case 39: Execution with no explicit dealer event', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.executed).toBe(true);
      expect(res.dealerBridgeResponseTimeMs).toBeNull();
    });

    // 40. Execution with complete dealer lifecycle
    it('Case 40: Execution with complete dealer lifecycle', () => {
      const incident: CorrelatedIncident = {
        ticketId: '100', login: '101', symbol: 'EURUSD', action: 'BUY', volume: 1.0,
        events: [
          { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.010Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'ROUTED', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.020Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'EXECUTION_REQUEST', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.022Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'EXECUTION_RESPONSE', rawMessage: '', login: '101', metadata: {} },
          { timestamp: '2026-08-14T10:00:00.100Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: '', login: '101', metadata: { dealId: 'D1' } }
        ]
      };
      const res = metricsService.calculate(incident, 5, 0.00001);
      expect(res.routingDelayMs).toBe(10);
      expect(res.executionRequestDelayMs).toBe(10);
      expect(res.dealerBridgeResponseTimeMs).toBe(2);
      expect(res.totalObservableExecutionTimeMs).toBe(100);
    });
  });
});
