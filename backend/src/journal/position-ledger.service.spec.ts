import { Test, TestingModule } from '@nestjs/testing';
import { PositionLedgerService, PositionLedger } from './position-ledger.service';
import { CorrelatedIncident } from './correlation.engine';
import { NormalizedEvent } from './normalization.engine';

describe('PositionLedgerService - Reconstructing position lifecycles', () => {
  let service: PositionLedgerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PositionLedgerService],
    }).compile();

    service = module.get<PositionLedgerService>(PositionLedgerService);
  });

  // TEST 1: Single ENTRY_IN
  it('TEST 1: should correctly reconstruct a single ENTRY_IN', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        correlationMethod: 'EXACT_DEAL_ID',
        correlationScore: 100,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 0.50, priceExecuted: 2000.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].lifecycleStatus).toBe('OPEN');
    expect(ledgers[0].side).toBe('BUY');
    expect(ledgers[0].originalVolume).toBe(0.50);
    expect(ledgers[0].currentVolume).toBe(0.50);
    expect(ledgers[0].entryDeals.length).toBe(1);
  });

  // TEST 2: Single ENTRY_IN + complete ENTRY_OUT
  it('TEST 2: should reconstruct complete ENTRY_OUT closing the position', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 1.0, priceExecuted: 2000.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'SELL', volume: 1.0, priceExecuted: 2005.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].lifecycleStatus).toBe('CLOSED');
    expect(ledgers[0].currentVolume).toBe(0.0);
    expect(ledgers[0].closedVolume).toBe(1.0);
  });

  // TEST 3: Single ENTRY_IN + partial ENTRY_OUT
  it('TEST 3: should handle partial close correctly', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 1.0, priceExecuted: 2000.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 0.3,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'SELL', volume: 0.3, priceExecuted: 2005.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].lifecycleStatus).toBe('PARTIALLY_CLOSED');
    expect(ledgers[0].currentVolume).toBe(0.7);
    expect(ledgers[0].closedVolume).toBe(0.3);
  });

  // TEST 4: Multiple ENTRY_IN deals
  it('TEST 4: should aggregate multiple ENTRY_IN deals and calculate weighted entry price', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 0.50, priceExecuted: 2000.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.30,
        events: [
          {
            timestamp: '2026-08-14T10:01:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'BUY', volume: 0.30, priceExecuted: 2010.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.20,
        events: [
          {
            timestamp: '2026-08-14T10:02:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D3', positionId: '1001', action: 'BUY', volume: 0.20, priceExecuted: 2020.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].originalVolume).toBe(1.0);
    expect(ledgers[0].currentVolume).toBe(1.0);
    // (0.50*2000 + 0.30*2010 + 0.20*2020) / 1.0 = 2007.0
    expect(ledgers[0].weightedAverageEntryPrice).toBe(2007.0);
    expect(ledgers[0].entryDeals.length).toBe(3);
  });

  // TEST 5: Multiple partial closes
  it('TEST 5: should preserve all exit deals and compute weighted exit price', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 1.0, priceExecuted: 2000.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 0.3,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'SELL', volume: 0.3, priceExecuted: 2005.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 0.2,
        events: [
          {
            timestamp: '2026-08-14T10:06:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D3', positionId: '1001', action: 'SELL', volume: 0.2, priceExecuted: 2010.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 0.5,
        events: [
          {
            timestamp: '2026-08-14T10:07:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D4', positionId: '1001', action: 'SELL', volume: 0.5, priceExecuted: 2015.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].closedVolume).toBe(1.0);
    expect(ledgers[0].currentVolume).toBe(0.0);
    // (0.3*2005 + 0.2*2010 + 0.5*2015) / 1.0 = 2011.0
    expect(ledgers[0].weightedAverageExitPrice).toBe(2011.0);
    expect(ledgers[0].exitDeals.length).toBe(3);
    expect(ledgers[0].lifecycleStatus).toBe('CLOSED');
  });

  // TEST 6: Scale-in
  it('TEST 6: should keep scale-in deals inside one position', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 0.50 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:01:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'BUY', volume: 0.50 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].originalVolume).toBe(1.0);
  });

  // TEST 7: Scale-out
  it('TEST 7: should preserve separate exit deals on scale-out', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 2.00,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 2.00 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'SELL', volume: 0.50 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:06:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D3', positionId: '1001', action: 'SELL', volume: 0.50 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].exitDeals.length).toBe(2);
    expect(ledgers[0].closedVolume).toBe(1.0);
    expect(ledgers[0].currentVolume).toBe(1.0);
  });

  // TEST 8: ENTRY_INOUT
  it('TEST 8: should map explicit ENTRY_INOUT correctly', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 1.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 2.0,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_INOUT reversal',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'SELL', volume: 2.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].reversalDeals.length).toBe(1);
    expect(ledgers[0].lifecycleStatus).toBe('REVERSED');
  });

  // TEST 9: Reversal
  it('TEST 9: should close exposure and open opposite side on reversal', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 1.0, priceExecuted: 2000.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 2.0,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_INOUT reversal',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'SELL', volume: 2.0, priceExecuted: 2010.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].side).toBe('SELL'); // exposure reversed from BUY to SELL
    expect(ledgers[0].closedVolume).toBe(1.0);
    expect(ledgers[0].originalVolume).toBe(1.0); // original open + 1.0 net reversal open
    expect(ledgers[0].currentVolume).toBe(1.0);
    expect(ledgers[0].weightedAverageExitPrice).toBe(2010.0);
    expect(ledgers[0].weightedAverageEntryPrice).toBe(2010.0); // new entry price of reversed exposure
  });

  // TEST 10: Missing opening event
  it('TEST 10: should handle missing opening event correctly', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed close #1001 ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'SELL', volume: 1.0, priceExecuted: 2005.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].lifecycleStatus).toBe('INCOMPLETE');
    expect(ledgers[0].weightedAverageEntryPrice).toBeNull();
    expect(ledgers[0].weightedAverageExitPrice).toBe(2005.0);
  });

  // TEST 11: Missing closing event
  it('TEST 11: should handle missing closing event correctly', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 1.0, priceExecuted: 2000.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].lifecycleStatus).toBe('OPEN');
    expect(ledgers[0].weightedAverageExitPrice).toBeNull();
  });

  // TEST 12: Duplicate deal
  it('TEST 12: should ignore duplicate deal executions', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'deal performed ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 1.0, priceExecuted: 2000.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.100Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'duplicate deal performed ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 1.0, priceExecuted: 2000.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].originalVolume).toBe(1.0); // should not be 2.0
  });

  // TEST 13: Out-of-order events
  it('TEST 13: should reconstruct same position ledger from out-of-order events', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'SELL', volume: 1.0, priceExecuted: 2005.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 1.0, priceExecuted: 2000.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].lifecycleStatus).toBe('CLOSED');
    expect(ledgers[0].currentVolume).toBe(0.0);
    expect(ledgers[0].weightedAverageEntryPrice).toBe(2000.0);
    expect(ledgers[0].weightedAverageExitPrice).toBe(2005.0);
  });

  // TEST 14: Two different positions with different PositionIDs
  it('TEST 14: should not merge different positions', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 0.50 },
          }
        ]
      },
      {
        ticketId: '1002',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:01:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1002', action: 'BUY', volume: 0.50 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(2);
  });

  // TEST 15: Same symbol, same login, simultaneous positions
  it('TEST 15: should keep simultaneous positions on same login/symbol separate using positionId', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 0.50 },
          }
        ]
      },
      {
        ticketId: '1002',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.100Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1002', action: 'BUY', volume: 0.50 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(2);
  });

  // TEST 16: Closing SELL deal for BUY position
  it('TEST 16: should preserve BUY positionSide even when closed by SELL deal', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 0.50 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'SELL', volume: 0.50 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].side).toBe('BUY');
  });

  // TEST 17: Closing BUY deal for SELL position
  it('TEST 17: should preserve SELL positionSide even when closed by BUY deal', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'SELL', volume: 0.50 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'BUY', volume: 0.50 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].side).toBe('SELL');
  });

  // TEST 18: Unresolved correlation event
  it('TEST 18: should flag position as AMBIGUOUS and score 0 if it contains unresolved correlation evidence', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.50,
        correlationMethod: 'UNRESOLVED',
        correlationScore: 0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 0.50 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    expect(ledgers[0].lifecycleStatus).toBe('AMBIGUOUS');
    expect(ledgers[0].correlationScore).toBe(0);
    expect(ledgers[0].correlationMethod).toBe('UNRESOLVED');
  });

  // TEST 19: Multiple entry prices
  it('TEST 19: should verify exact weighted entry price calculation', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.25,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 0.25, priceExecuted: 2000.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 0.75,
        events: [
          {
            timestamp: '2026-08-14T10:01:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'BUY', volume: 0.75, priceExecuted: 2004.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    // (0.25*2000.0 + 0.75*2004.0) / 1.0 = 2003.0
    expect(ledgers[0].weightedAverageEntryPrice).toBe(2003.0);
  });

  // TEST 20: Multiple exit prices
  it('TEST 20: should verify exact weighted exit price calculation', () => {
    const incidents: CorrelatedIncident[] = [
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'BUY',
        volume: 1.0,
        events: [
          {
            timestamp: '2026-08-14T10:00:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_IN',
            login: '259713',
            metadata: { dealId: 'D1', positionId: '1001', action: 'BUY', volume: 1.0, priceExecuted: 2000.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 0.25,
        events: [
          {
            timestamp: '2026-08-14T10:05:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D2', positionId: '1001', action: 'SELL', volume: 0.25, priceExecuted: 2008.0 },
          }
        ]
      },
      {
        ticketId: '1001',
        login: '259713',
        symbol: 'XAUUSD',
        action: 'SELL',
        volume: 0.75,
        events: [
          {
            timestamp: '2026-08-14T10:06:00.000Z',
            eventType: 'DEAL_EXECUTED',
            rawMessage: 'ENTRY_OUT',
            login: '259713',
            metadata: { dealId: 'D3', positionId: '1001', action: 'SELL', volume: 0.75, priceExecuted: 2012.0 },
          }
        ]
      }
    ];

    const ledgers = service.reconstructPositions(incidents);
    expect(ledgers.length).toBe(1);
    // (0.25*2008.0 + 0.75*2012.0) / 1.0 = 2011.0
    expect(ledgers[0].weightedAverageExitPrice).toBe(2011.0);
  });
});
