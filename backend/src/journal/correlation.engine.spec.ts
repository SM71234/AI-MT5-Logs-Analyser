import { Test, TestingModule } from '@nestjs/testing';
import { CorrelationEngine } from './correlation.engine';
import { NormalizedEvent } from './normalization.engine';

describe('CorrelationEngine', () => {
  let engine: CorrelationEngine;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CorrelationEngine],
    }).compile();

    engine = module.get<CorrelationEngine>(CorrelationEngine);
  });

  it('should correlate client logs using explicit Order IDs (Highest Priority)', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-07T22:50:50.902Z',
        eventType: 'REQUEST',
        rawMessage: 'order placed #670',
        login: '910102',
        metadata: { orderId: '670', symbol: 'XAUUSD.s', action: 'BUY', volume: 0.01, priceRequested: 4349.26 },
      },
      {
        timestamp: '2026-08-07T22:50:51.045Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal performed #712',
        login: '910102',
        metadata: { dealId: '712', symbol: 'XAUUSD.s', action: 'BUY', volume: 0.01, priceExecuted: 4349.36 },
      },
      {
        timestamp: '2026-08-07T22:50:51.045Z',
        eventType: 'EXECUTION_RESPONSE',
        rawMessage: 'order performed buy [#670]',
        login: '910102',
        metadata: { orderId: '670', symbol: 'XAUUSD.s', action: 'BUY', volume: 0.01, priceExecuted: 4349.36 },
      },
    ];

    const result = engine.correlate(events);

    expect(result.length).toBe(1);
    expect(result[0].login).toBe('910102');
    expect(result[0].events.length).toBe(3); // submitted, deal performed, order performed
    expect(result[0].events.find((e) => e.eventType === 'REQUEST')?.metadata.orderId).toBe('670');
  });

  it('should filter out duplicate executions and correlate them cleanly', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-07T22:50:55.365Z',
        eventType: 'REQUEST',
        rawMessage: 'order placed #671',
        login: '910102',
        metadata: { orderId: '671', symbol: 'XAUUSD.s', action: 'SELL', volume: 0.01, priceRequested: 4349.01 },
      },
      {
        timestamp: '2026-08-07T22:50:55.538Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'deal performed #713',
        login: '910102',
        metadata: { dealId: '713', symbol: 'XAUUSD.s', action: 'SELL', volume: 0.01, priceExecuted: 4348.86 },
      },
      {
        timestamp: '2026-08-07T22:50:55.538Z',
        eventType: 'EXECUTION_RESPONSE',
        rawMessage: 'order performed sell [#671]',
        login: '910102',
        metadata: { orderId: '671', symbol: 'XAUUSD.s', action: 'SELL', volume: 0.01, priceExecuted: 4348.86 },
      },
    ];

    const result = engine.correlate(events);

    expect(result.length).toBe(1);
    expect(result[0].events.find((e) => e.rawMessage.includes('deal performed'))).toBeDefined();
    expect(result[0].events.find((e) => e.rawMessage.includes('order performed'))).toBeDefined();
  });

  it('should fallback to side-specific timestamp correlation if explicit IDs are missing', () => {
    const events: NormalizedEvent[] = [
      {
        timestamp: '2026-08-07T22:50:50.902Z',
        eventType: 'REQUEST',
        rawMessage: 'buy request',
        login: '910102',
        metadata: { symbol: 'XAUUSD.s', action: 'BUY', volume: 0.01, priceRequested: 4349.26 },
      },
      {
        timestamp: '2026-08-07T22:50:55.365Z',
        eventType: 'REQUEST',
        rawMessage: 'sell request',
        login: '910102',
        metadata: { symbol: 'XAUUSD.s', action: 'SELL', volume: 0.01, priceRequested: 4349.01 },
      },
      {
        timestamp: '2026-08-07T22:50:55.538Z',
        eventType: 'DEAL_EXECUTED',
        rawMessage: 'sell execution',
        login: '910102',
        metadata: { symbol: 'XAUUSD.s', action: 'SELL', volume: 0.01, priceExecuted: 4348.86 },
      },
    ];

    const result = engine.correlate(events);

    // Should match the sell execution with the sell request, NOT the buy request!
    // Since the buy request is BUY and sell execution is SELL, they must not match.
    const sellIncident = result.find((i) => i.action === 'SELL');
    expect(sellIncident).toBeDefined();
    const submit = sellIncident?.events.find((e) => e.eventType === 'REQUEST');
    expect(submit?.rawMessage).toBe('sell request');
  });
});
