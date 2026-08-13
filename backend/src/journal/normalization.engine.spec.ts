import { Test, TestingModule } from '@nestjs/testing';
import { NormalizationEngine } from './normalization.engine';

describe('NormalizationEngine', () => {
  let engine: NormalizationEngine;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NormalizationEngine],
    }).compile();

    engine = module.get<NormalizationEngine>(NormalizationEngine);
  });

  it('should normalize ORDER_SUBMITTED messages', () => {
    const raw = "2026-08-06T09:59:59.980Z [Trade] '1001': market buy 1.00 EURUSD (requested at 1.10200)";
    const result = engine.normalize(raw);

    expect(result).not.toBeNull();
    expect(result!.eventType).toBe('REQUEST');
    expect(result!.login).toBe('1001');
    expect(result!.metadata.symbol).toBe('EURUSD');
    expect(result!.metadata.action).toBe('BUY');
    expect(result!.metadata.volume).toBe(1.00);
    expect(result!.metadata.priceRequested).toBe(1.10200);
  });

  it('should normalize DEALER_ACCEPTED messages', () => {
    const raw = '2026-08-06T14:15:30.010Z [Dealer] dealer #5 accepted market buy 2.00 XAUUSD at 2352.00';
    const result = engine.normalize(raw);

    expect(result).not.toBeNull();
    expect(result!.eventType).toBe('EXECUTION_REQUEST');
    expect(result!.metadata.dealerId).toBe('5');
    expect(result!.metadata.symbol).toBe('XAUUSD');
    expect(result!.metadata.action).toBe('BUY');
    expect(result!.metadata.volume).toBe(2.00);
    expect(result!.metadata.priceExecuted).toBe(2352.00);
  });

  it('should normalize DEALER_REQUOTED messages', () => {
    const raw = '2026-08-06T15:30:13.500Z [Dealer] dealer #8 rejected buy 5.00 GBPUSD at 1.28400 (requote 1.28550)';
    const result = engine.normalize(raw);

    expect(result).not.toBeNull();
    expect(result!.eventType).toBe('EXECUTION_RESPONSE');
    expect(result!.metadata.dealerId).toBe('8');
    expect(result!.metadata.symbol).toBe('GBPUSD');
    expect(result!.metadata.priceRequested).toBe(1.28400);
    expect(result!.metadata.requotePrice).toBe(1.28550);
  });

  it('should normalize ORDER_EXECUTED messages', () => {
    const raw = "2026-08-06T10:00:00.000Z [Trade] '1001': deal performed #5001 buy 1.00 EURUSD at 1.10200";
    const result = engine.normalize(raw);

    expect(result).not.toBeNull();
    expect(result!.eventType).toBe('DEAL_EXECUTED');
    expect(result!.login).toBe('1001');
    expect(result!.metadata.ticket).toBe('5001');
    expect(result!.metadata.symbol).toBe('EURUSD');
    expect(result!.metadata.priceExecuted).toBe(1.10200);
  });
});
