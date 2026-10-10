import { Test, TestingModule } from '@nestjs/testing';
import { CorrelationEngine } from './correlation.engine';
import { NormalizedEvent } from './normalization.engine';

describe('CorrelationEngine - Deterministic MT5 Event Correlation', () => {
  let engine: CorrelationEngine;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CorrelationEngine],
    }).compile();

    engine = module.get<CorrelationEngine>(CorrelationEngine);
  });

  // TEST 1: Exact PositionID match
  it('TEST 1: should correlate events via exact positionId match', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'close position request',
        login: '259713',
        metadata: { positionId: '789', symbol: 'XAUUSD', action: 'SELL' },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal executed',
        login: '259713',
        metadata: { dealId: '999', positionId: '789', symbol: 'XAUUSD', action: 'SELL' },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(1);
    expect(result[0].correlationMethod).toBe('EXACT_POSITION_ID');
    expect(result[0].events.length).toBe(2);
  });

  // TEST 2: Exact OrderID match
  it('TEST 2: should correlate events via exact orderId match', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'order request',
        login: '259713',
        metadata: { orderId: '123', symbol: 'XAUUSD', action: 'BUY' },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'ORDER_FILLED',
        rawMessage: 'order filled',
        login: '259713',
        metadata: { orderId: '123', symbol: 'XAUUSD', action: 'BUY' },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(1);
    expect(result[0].correlationMethod).toBe('EXACT_ORDER_ID');
  });

  // TEST 3: Exact DealID match
  it('TEST 3: should correlate events via exact dealId match', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'EXECUTION_RESPONSE',
        rawMessage: 'exec response',
        login: '259713',
        metadata: { dealId: '456', symbol: 'XAUUSD', action: 'BUY' },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal perf',
        login: '259713',
        metadata: { dealId: '456', symbol: 'XAUUSD', action: 'BUY' },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(1);
    expect(result[0].correlationMethod).toBe('EXACT_DEAL_ID');
  });

  // TEST 4: RequestID match
  it('TEST 4: should correlate events via requestId match', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'modify position',
        login: '259713',
        metadata: { requestId: '888', symbol: 'XAUUSD', action: 'BUY' },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'ORDER_FILLED',
        rawMessage: 'confirm modify',
        login: '259713',
        metadata: { requestId: '888', symbol: 'XAUUSD', action: 'BUY' },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(1);
    expect(result[0].correlationMethod).toBe('REQUEST_ID');
  });

  // TEST 5: Multiple identifiers on one event
  it('TEST 5: should preserve multiple identifiers on a single event and support transitive matches', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'req',
        login: '259713',
        metadata: { orderId: '100' },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'EXECUTION_RESPONSE',
        rawMessage: 'resp',
        login: '259713',
        metadata: { orderId: '100', dealId: '200' },
      },
      {
        timestamp: '2026-08-14T10:00:02.000Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal',
        login: '259713',
        metadata: { dealId: '200' },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(1);
    expect(result[0].events.length).toBe(3);
    expect(result[0].correlationMethod).toBe('EXPLICIT_REFERENCE');
  });

  // TEST 6: Same login + same symbol + same side + close timestamps
  it('TEST 6: should match exact IDs instead of closest timestamps when competing', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'req A',
        login: '259713',
        metadata: { orderId: 'AAA', symbol: 'XAUUSD', action: 'BUY' },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'REQUEST',
        rawMessage: 'req B',
        login: '259713',
        metadata: { orderId: 'BBB', symbol: 'XAUUSD', action: 'BUY' },
      },
      {
        timestamp: '2026-08-14T10:00:01.100Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal A',
        login: '259713',
        metadata: { orderId: 'AAA', symbol: 'XAUUSD', action: 'BUY' },
      }
    ];

    const result = engine.correlate(events);
    const incidentA = result.find(i => i.events.some(e => e.metadata.orderId === 'AAA'));
    expect(incidentA?.events.some(e => e.rawMessage === 'req A')).toBe(true);
    expect(incidentA?.events.some(e => e.rawMessage === 'req B')).toBe(false);
  });

  // TEST 7: Two simultaneous BUY orders for the same symbol
  it('TEST 7: should keep two simultaneous BUY orders separate if IDs are available', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'req 1',
        login: '259713',
        metadata: { orderId: 'ID1', symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:00.010Z',
        eventType: 'REQUEST',
        rawMessage: 'req 2',
        login: '259713',
        metadata: { orderId: 'ID2', symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'fill 1',
        login: '259713',
        metadata: { orderId: 'ID1', symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:01.010Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'fill 2',
        login: '259713',
        metadata: { orderId: 'ID2', symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(2);
    expect(result[0].events.length).toBe(2);
    expect(result[1].events.length).toBe(2);
  });

  // TEST 8: BUY and SELL orders occurring almost simultaneously
  it('TEST 8: should keep simultaneous BUY and SELL orders separate even without IDs', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'buy req',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:00.010Z',
        eventType: 'REQUEST',
        rawMessage: 'sell req',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'SELL', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:00.500Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'buy fill',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:00.510Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'sell fill',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'SELL', volume: 0.1 },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(2);
    const buyIncident = result.find(i => i.action === 'BUY');
    const sellIncident = result.find(i => i.action === 'SELL');
    expect(buyIncident?.events.some(e => e.rawMessage === 'buy req')).toBe(true);
    expect(sellIncident?.events.some(e => e.rawMessage === 'sell req')).toBe(true);
  });

  // TEST 9: Missing identifiers
  it('TEST 9: should successfully fall back to semantic matching when identifiers are completely missing', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'request',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'BUY', volume: 0.05 },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal performed',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'BUY', volume: 0.05 },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(1);
    expect(result[0].correlationMethod).toBe('SEMANTIC_MATCH');
  });

  // TEST 10: Ambiguous events
  it('TEST 10: should mark correlation as UNRESOLVED when ambiguous matches are detected', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'ambiguous request',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal A',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:01.010Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal B',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(2);
    expect(result[0].correlationMethod).toBe('UNRESOLVED');
    expect(result[1].correlationMethod).toBe('UNRESOLVED');
  });

  // TEST 11: Duplicate journal events
  it('TEST 11: should handle duplicate outcome events by grouping them instead of creating duplicate incidents', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'request',
        login: '259713',
        metadata: { orderId: '123', symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'ORDER_FILLED',
        rawMessage: 'filled A',
        login: '259713',
        metadata: { orderId: '123', symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:01.010Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal B (duplicate outcome)',
        login: '259713',
        metadata: { orderId: '123', symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(1);
    expect(result[0].events.length).toBe(3);
  });

  // TEST 12: Out-of-order journal events
  it('TEST 12: should sort out-of-order events chronologically in the output incident timeline', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:02.000Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal',
        login: '259713',
        metadata: { orderId: '123' },
      },
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'request',
        login: '259713',
        metadata: { orderId: '123' },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'ROUTED',
        rawMessage: 'routed',
        login: '259713',
        metadata: { orderId: '123' },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(1);
    expect(result[0].events[0].eventType).toBe('REQUEST');
    expect(result[0].events[1].eventType).toBe('ROUTED');
    expect(result[0].events[2].eventType).toBe('DEAL_EXECUTED');
  });

  // TEST 13: An event matches one trade by OrderID but is closer in time to another trade
  it('TEST 13: should prioritize OrderID match over proximity match', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'request to match',
        login: '259713',
        metadata: { orderId: 'MATCH_ME', symbol: 'XAUUSD', action: 'BUY' },
      },
      {
        timestamp: '2026-08-14T10:00:04.900Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal close by time but different ID',
        login: '259713',
        metadata: { orderId: 'OTHER_ID', symbol: 'XAUUSD', action: 'BUY' },
      },
      {
        timestamp: '2026-08-14T10:00:05.000Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal far by time but matching ID',
        login: '259713',
        metadata: { orderId: 'MATCH_ME', symbol: 'XAUUSD', action: 'BUY' },
      }
    ];

    const result = engine.correlate(events);
    const correctIncident = result.find(i => i.events.some(e => e.metadata.orderId === 'MATCH_ME'));
    expect(correctIncident?.events.some(e => e.rawMessage === 'request to match')).toBe(true);
    
    const timeIncident = result.find(i => i.events.some(e => e.metadata.orderId === 'OTHER_ID'));
    expect(timeIncident?.events.some(e => e.rawMessage === 'request to match')).toBe(false);
  });

  // TEST 14: An event has DealID and PositionID
  it('TEST 14: should preserve both dealId and positionId on events and match them appropriately', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'request',
        login: '259713',
        metadata: { positionId: 'POS1', symbol: 'XAUUSD', action: 'BUY' },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal',
        login: '259713',
        metadata: { dealId: 'DEAL1', positionId: 'POS1', symbol: 'XAUUSD', action: 'BUY' },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(1);
    expect(result[0].events[1].metadata.positionId).toBe('POS1');
    expect(result[0].events[1].metadata.dealId).toBe('DEAL1');
  });

  // TEST 15: An event is evaluated as a candidate for multiple trades without global early consumption bugs
  it('TEST 15: should evaluate candidate against all outcomes without early consumption bias', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:00:00.000Z',
        eventType: 'REQUEST',
        rawMessage: 'request',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:01.000Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal A',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      },
      {
        timestamp: '2026-08-14T10:00:01.100Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal B',
        login: '259713',
        metadata: { symbol: 'XAUUSD', action: 'BUY', volume: 0.1 },
      }
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(2);
    expect(result[0].correlationMethod).toBe('UNRESOLVED');
    expect(result[1].correlationMethod).toBe('UNRESOLVED');
  });

  // TEST 16: Correlate exit close request/confirm to execution deal without ticket conflict
  it('TEST 16: should correlate exit close request/confirm to execution deal without ticket conflict', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-14T10:20:33.888Z',
        eventType: 'REQUEST',
        rawMessage: "Client 259713 sends SELL 0.01 XAUUSD.r at 4382.81, close #7100172",
        login: '259713',
        metadata: { positionId: '7100172', ticketId: '7100172', ticket: '7100172', volume: 0.01, symbol: 'XAUUSD.r', action: 'SELL' },
      },
      {
        timestamp: '2026-08-14T10:20:34.051Z',
        eventType: 'EXECUTION_RESPONSE',
        rawMessage: "Dealer confirms SELL 0.01 XAUUSD.r at 4382.71 for '259713' (for '259713' sell 0.01 XAUUSD.r at 4382.81, close #7100172)",
        login: '259713',
        metadata: { positionId: '7100172', ticketId: '7100172', ticket: '7100172', volume: 0.01, symbol: 'XAUUSD.r', action: 'SELL' },
      },
      {
        timestamp: '2026-08-14T10:20:34.544Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: "Deal performed #6903298 at 4382.71",
        login: '259713',
        metadata: { dealId: '6903298', ticketId: '6903298', ticket: '6903298', volume: 0.01, symbol: 'XAUUSD.r', action: 'SELL' },
      },
    ];

    const result = engine.correlate(events);
    expect(result.length).toBe(1);
    expect(result[0].events.length).toBe(3);
    expect(result[0].ticketId).toBe('7100172');
  });
});

