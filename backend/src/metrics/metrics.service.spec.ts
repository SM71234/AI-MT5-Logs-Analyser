import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';
import { CorrelatedIncident } from '../journal/correlation.engine';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  it('should calculate correct metrics for a normal EURUSD buy order (Zero Slippage)', () => {
    const incident: CorrelatedIncident = {
      ticketId: '5001',
      login: '1001',
      symbol: 'EURUSD',
      action: 'BUY',
      volume: 1.0,
      events: [
        {
          timestamp: '2026-08-06T09:59:59.980Z',
          eventType: 'REQUEST',
          rawMessage: 'submit',
          login: '1001',
          metadata: { priceRequested: 1.10200 },
        },
        {
          timestamp: '2026-08-06T10:00:00.000Z',
          eventType: 'DEAL_EXECUTED',
          rawMessage: 'exec',
          login: '1001',
          metadata: { priceExecuted: 1.10200 },
        },
      ],
    };

    const metrics = service.calculate(incident, 5, 0.00001);

    expect(metrics.totalObservableExecutionTimeMs).toBe(20);
    expect(metrics.slippagePoints).toBe(0.0);
    expect(metrics.slippageType).toBe('Zero');
    expect(metrics.isNormal).toBe(true);
  });

  it('should calculate BUY adverse slippage correctly (Gold BUY order)', () => {
    const incident: CorrelatedIncident = {
      ticketId: '670',
      login: '910102',
      symbol: 'XAUUSD.s',
      action: 'BUY',
      volume: 0.01,
      events: [
        {
          timestamp: '2026-08-07T22:50:50.902Z',
          eventType: 'REQUEST',
          rawMessage: 'submit',
          login: '910102',
          metadata: { priceRequested: 4349.26 },
        },
        {
          timestamp: '2026-08-07T22:50:51.045Z',
          eventType: 'DEAL_EXECUTED',
          rawMessage: 'exec',
          login: '910102',
          metadata: { priceExecuted: 4349.36 },
        },
      ],
    };

    const metrics = service.calculate(incident, 2, 0.01);

    expect(metrics.totalObservableExecutionTimeMs).toBe(143);
    expect(metrics.priceDelta).toBeCloseTo(0.10, 5);
    expect(metrics.slippagePoints).toBe(10.0);
    expect(metrics.slippageType).toBe('Adverse');
    expect(metrics.priceRequested).toBe(4349.26);
    expect(metrics.priceExecuted).toBe(4349.36);
  });

  it('should calculate BUY favorable slippage correctly', () => {
    const incident: CorrelatedIncident = {
      ticketId: '7001',
      login: '1001',
      symbol: 'EURUSD',
      action: 'BUY',
      volume: 1.0,
      events: [
        {
          timestamp: '2026-08-06T10:00:00.000Z',
          eventType: 'REQUEST',
          rawMessage: 'submit',
          login: '1001',
          metadata: { priceRequested: 1.10200 },
        },
        {
          timestamp: '2026-08-06T10:00:00.150Z',
          eventType: 'DEAL_EXECUTED',
          rawMessage: 'exec',
          login: '1001',
          metadata: { priceExecuted: 1.10180 },
        },
      ],
    };

    const metrics = service.calculate(incident, 5, 0.00001);

    expect(metrics.totalObservableExecutionTimeMs).toBe(150);
    expect(metrics.priceDelta).toBeCloseTo(-0.00020, 5);
    expect(metrics.slippagePoints).toBe(20.0);
    expect(metrics.slippageType).toBe('Favorable');
  });

  it('should calculate SELL adverse slippage correctly (Gold SELL order)', () => {
    const incident: CorrelatedIncident = {
      ticketId: '671',
      login: '910102',
      symbol: 'XAUUSD.s',
      action: 'SELL',
      volume: 0.01,
      events: [
        {
          timestamp: '2026-08-07T22:50:55.365Z',
          eventType: 'REQUEST',
          rawMessage: 'submit',
          login: '910102',
          metadata: { priceRequested: 4349.01 },
        },
        {
          timestamp: '2026-08-07T22:50:55.538Z',
          eventType: 'DEAL_EXECUTED',
          rawMessage: 'exec',
          login: '910102',
          metadata: { priceExecuted: 4348.86 },
        },
      ],
    };

    const metrics = service.calculate(incident, 2, 0.01);

    expect(metrics.totalObservableExecutionTimeMs).toBe(173);
    expect(metrics.priceDelta).toBeCloseTo(-0.15, 5);
    expect(metrics.slippagePoints).toBe(15.0);
    expect(metrics.slippageType).toBe('Adverse');
    expect(metrics.priceRequested).toBe(4349.01);
    expect(metrics.priceExecuted).toBe(4348.86);
  });

  it('should calculate SELL favorable slippage correctly', () => {
    const incident: CorrelatedIncident = {
      ticketId: '8001',
      login: '1001',
      symbol: 'EURUSD',
      action: 'SELL',
      volume: 1.0,
      events: [
        {
          timestamp: '2026-08-06T10:00:00.000Z',
          eventType: 'REQUEST',
          rawMessage: 'submit',
          login: '1001',
          metadata: { priceRequested: 1.10200 },
        },
        {
          timestamp: '2026-08-06T10:00:00.200Z',
          eventType: 'DEAL_EXECUTED',
          rawMessage: 'exec',
          login: '1001',
          metadata: { priceExecuted: 1.10220 },
        },
      ],
    };

    const metrics = service.calculate(incident, 5, 0.00001);

    expect(metrics.totalObservableExecutionTimeMs).toBe(200);
    expect(metrics.priceDelta).toBeCloseTo(0.00020, 5);
    expect(metrics.slippagePoints).toBe(20.0);
    expect(metrics.slippageType).toBe('Favorable');
  });

  it('should return N/A for slippage points if symbol digits specification is unavailable', () => {
    const incident: CorrelatedIncident = {
      ticketId: '9001',
      login: '1001',
      symbol: 'UNKNOWN',
      action: 'BUY',
      volume: 1.0,
      events: [
        {
          timestamp: '2026-08-06T10:00:00.000Z',
          eventType: 'REQUEST',
          rawMessage: 'submit',
          login: '1001',
          metadata: { priceRequested: 100.0 },
        },
        {
          timestamp: '2026-08-06T10:00:00.100Z',
          eventType: 'DEAL_EXECUTED',
          rawMessage: 'exec',
          login: '1001',
          metadata: { priceExecuted: 100.5 },
        },
      ],
    };

    const metrics = service.calculate(incident, null, null);

    expect(metrics.slippagePoints).toBeNull();
    expect(metrics.priceDelta).toBe(0.5);
  });

  it('should handle rejected trade: totalObservableExecutionTimeMs is null, status is REJECTED', () => {
    const incident: CorrelatedIncident = {
      ticketId: '659',
      login: '910102',
      symbol: 'BTCUSD.s',
      action: 'BUY',
      volume: 0.1,
      events: [
        {
          timestamp: '2026-08-07T10:00:00.000Z',
          eventType: 'REQUEST',
          rawMessage: 'submit',
          login: '910102',
          metadata: { priceRequested: 60000 },
        },
        {
          timestamp: '2026-08-07T10:00:00.250Z',
          eventType: 'ORDER_REJECTED',
          rawMessage: 'order rejected due to not enough money',
          login: '910102',
          metadata: { rawReason: 'not enough money' },
        },
      ],
    };

    const metrics = service.calculate(incident, 2, 0.01);

    expect(metrics.totalObservableExecutionTimeMs).toBeNull();
    expect(metrics.status).toBe('REJECTED');
    expect(metrics.executed).toBe(false);
    expect(metrics.rejection?.isRejected).toBe(true);
    expect(metrics.rejection?.reason).toBe('not enough money');
    expect(metrics.rejection?.rejectedBy).toBe('MT5 Server');
    expect(metrics.rejection?.failedStage).toBe('Execution Request');
  });

  it('should handle incomplete trade: totalObservableExecutionTimeMs is null, status is INCOMPLETE', () => {
    const incident: CorrelatedIncident = {
      ticketId: '660',
      login: '910102',
      symbol: 'BTCUSD.s',
      action: 'BUY',
      volume: 0.1,
      events: [
        {
          timestamp: '2026-08-07T10:00:00.000Z',
          eventType: 'REQUEST',
          rawMessage: 'submit',
          login: '910102',
          metadata: { priceRequested: 60000 },
        },
      ],
    };

    const metrics = service.calculate(incident, 2, 0.01);

    expect(metrics.totalObservableExecutionTimeMs).toBeNull();
    expect(metrics.status).toBe('INCOMPLETE');
    expect(metrics.executed).toBe(false);
  });
});
