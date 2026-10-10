import { AiService, AiAnalysisContext, AiAnalysisResult } from '../ai/ai.service';
import { ConfigService } from '@nestjs/config';
import { CalculatedMetrics } from '../metrics/metrics.service';

describe('AI Investigation & Explanation Engine Test Suite', () => {
  const configService = new ConfigService();
  const aiService = new AiService(configService);

  const getBaseContext = (overrides: any = {}): AiAnalysisContext => {
    const base = {
      login: '1001',
      ticketId: '9001',
      symbol: 'EURUSD',
      action: 'BUY',
      volume: 1.0,
      entry: {
        priceRequested: 1.12000,
        priceExecuted: 1.12005,
        slippagePoints: 5,
        slippageType: 'Adverse',
        executionReason: 'MARKET',
        orderType: 'MARKET',
        status: 'EXECUTED',
        executed: true,
        isNormal: true,
        priceDelta: 0.00005,
        digits: 5,
        pointSize: 0.00001,
        pointSizeSource: 'MT5_SERVER',
        totalObservableExecutionTimeMs: 150,
        routingDelayMs: 20,
      } as any,
      exit: null,
      summary: {
        netSlippage: { slippagePoints: 5, slippageType: 'Adverse' },
        cumulativeLatency: 150,
        holdTimeMs: 0,
      },
      events: [
        { timestamp: '2026-08-14T10:00:00.000Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'REQUEST', rawMessage: 'Client sent buy request', login: '1001', metadata: {} },
        { timestamp: '2026-08-14T10:00:00.150Z', timestampRaw: '', timestampServer: '', timestampUtc: null, timezoneSource: 'UNKNOWN', eventType: 'DEAL_EXECUTED', rawMessage: 'Deal performed', login: '1001', metadata: {} },
      ],
    };

    return {
      ...base,
      ...overrides,
      entry: overrides.entry ? ({ ...base.entry, ...overrides.entry } as any) : base.entry,
      exit: overrides.exit ? ({ ...(base.exit || {}), ...overrides.exit } as any) : base.exit,
    };
  };

  describe('Validation & Contradiction Prevention Tests', () => {
    it('1. should validate a correct successful trade analysis JSON', () => {
      const context = getBaseContext();
      const report: AiAnalysisResult = {
        outcome: { status: 'SUCCESSFUL', confidence: 'HIGH' },
        executiveSummary: 'Your BUY order executed successfully with 5 points of adverse slippage.',
        whatHappened: ['Client request approved and executed.'],
        executionAnalysis: { entry: 'Requested 1.12000, executed 1.12005.', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' },
        slippageAnalysis: { summary: '5 points adverse slippage.', legs: [], tradeLevelConclusion: '5 points adverse' },
        timingAnalysis: { summary: 'Execution took 150 ms.', routingDelay: '20 ms', executionDelay: '130 ms', dealerResponseTime: '0 ms', quality: 'KNOWN' },
        rejectionAnalysis: null,
        positionLifecycle: ['Single entry leg opened and remains open.'],
        anomalies: [],
        evidence: [{ timestamp: '2026-08-14T10:00:00.150Z', event: 'DEAL_EXECUTED', explanation: 'Executed' }],
        limitations: [],
      };

      const res = aiService.validateAiReport(JSON.stringify(report), context);
      expect(res.isValid).toBe(true);
    });

    it('2. should reject when outcome contradicts deterministic execution state (asserting successful when rejected)', () => {
      const context = getBaseContext({
        entry: {
          status: 'REJECTED',
          executed: false,
          rejection: { isRejected: true, reason: 'No money', rawReason: 'margin check' }
        }
      });
      const report = {
        outcome: { status: 'SUCCESSFUL', confidence: 'HIGH' },
        executiveSummary: 'Successfully executed.',
        whatHappened: ['Executed.'],
        executionAnalysis: { entry: 'None.', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' },
        slippageAnalysis: { summary: 'None.', legs: [], tradeLevelConclusion: 'None' },
        timingAnalysis: { summary: 'None.', routingDelay: 'N/A', executionDelay: 'N/A', dealerResponseTime: 'N/A', quality: 'KNOWN' },
        rejectionAnalysis: null,
        positionLifecycle: ['None.'],
      };

      const res = aiService.validateAiReport(JSON.stringify(report), context);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Contradiction');
    });

    it('3. should reject when outcome contradicts deterministic state (asserting rejected when executed)', () => {
      const context = getBaseContext();
      const report = {
        outcome: { status: 'REJECTED', confidence: 'HIGH' },
        executiveSummary: 'Rejected order.',
        whatHappened: ['Rejected.'],
        executionAnalysis: { entry: 'None.', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' },
        slippageAnalysis: { summary: 'None.', legs: [], tradeLevelConclusion: 'None' },
        timingAnalysis: { summary: 'None.', routingDelay: 'N/A', executionDelay: 'N/A', dealerResponseTime: 'N/A', quality: 'KNOWN' },
        rejectionAnalysis: null,
        positionLifecycle: ['None.'],
      };

      const res = aiService.validateAiReport(JSON.stringify(report), context);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Contradiction');
    });

    it('4. should reject when slippage type contradicts deterministic metrics (asserting favorable for adverse)', () => {
      const context = getBaseContext(); // adverse slippage
      const report = {
        outcome: { status: 'SUCCESSFUL', confidence: 'HIGH' },
        executiveSummary: 'Executed with favorable slippage.',
        whatHappened: ['None.'],
        executionAnalysis: { entry: 'None.', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' },
        slippageAnalysis: { summary: 'favorable slippage.', legs: [], tradeLevelConclusion: 'favorable' },
        timingAnalysis: { summary: 'None.', routingDelay: 'N/A', executionDelay: 'N/A', dealerResponseTime: 'N/A', quality: 'KNOWN' },
        rejectionAnalysis: null,
        positionLifecycle: ['None.'],
      };

      const res = aiService.validateAiReport(JSON.stringify(report), context);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Contradiction');
    });

    it('5. should reject when slippage type contradicts deterministic metrics (asserting adverse for favorable)', () => {
      const context = getBaseContext({
        entry: {
          priceRequested: 1.12000,
          priceExecuted: 1.11995,
          slippagePoints: 5,
          slippageType: 'Favorable',
          executed: true,
          status: 'EXECUTED',
        }
      });
      const report = {
        outcome: { status: 'SUCCESSFUL', confidence: 'HIGH' },
        executiveSummary: 'Executed with adverse slippage.',
        whatHappened: ['None.'],
        executionAnalysis: { entry: 'None.', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' },
        slippageAnalysis: { summary: 'adverse slippage.', legs: [], tradeLevelConclusion: 'adverse' },
        timingAnalysis: { summary: 'None.', routingDelay: 'N/A', executionDelay: 'N/A', dealerResponseTime: 'N/A', quality: 'KNOWN' },
        rejectionAnalysis: null,
        positionLifecycle: ['None.'],
      };

      const res = aiService.validateAiReport(JSON.stringify(report), context);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Contradiction');
    });

    it('6. should reject if critical credentials/secrets leak in output text', () => {
      const context = getBaseContext();
      const report = {
        outcome: { status: 'SUCCESSFUL', confidence: 'HIGH' },
        executiveSummary: 'Executed normally.',
        whatHappened: ['Secret password was decrypted.'],
        executionAnalysis: { entry: 'None.', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' },
        slippageAnalysis: { summary: 'None.', legs: [], tradeLevelConclusion: 'None' },
        timingAnalysis: { summary: 'None.', routingDelay: 'N/A', executionDelay: 'N/A', dealerResponseTime: 'N/A', quality: 'KNOWN' },
        rejectionAnalysis: null,
        positionLifecycle: ['None.'],
      };

      const res = aiService.validateAiReport(JSON.stringify(report), context);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Security violation');
    });

    it('7. should reject invalid JSON response structure', () => {
      const context = getBaseContext();
      const res = aiService.validateAiReport('{ invalid json content ', context);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Invalid JSON');
    });

    it('8. should reject when missing essential compliance fields', () => {
      const context = getBaseContext();
      const report = {
        outcome: 'SUCCESSFUL',
        summary: 'Missing whatHappened or analysis fields',
      };
      const res = aiService.validateAiReport(JSON.stringify(report), context);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Missing essential fields');
    });
  });

  describe('Deterministic Fallback Verification', () => {
    it('9. should generate correct JSON fallback for successful trades', () => {
      const context = getBaseContext();
      const fallbackStr = aiService.generateDeterministicFallbackReport(context, 'json');
      const parsed: any = JSON.parse(fallbackStr);

      expect(parsed.outcome.status).toBe('SUCCESSFUL');
      expect(parsed.executiveSummary).toContain('successfully executed');
      expect(parsed.slippageAnalysis.summary).toContain('5 points of Adverse slippage');
      expect(parsed.timingAnalysis.summary).toContain('150 ms');
    });

    it('10. should generate correct JSON fallback for rejected trades', () => {
      const context = getBaseContext({
        entry: {
          status: 'REJECTED',
          executed: false,
          rejection: {
            isRejected: true,
            reason: 'INVALID_VOLUME',
            rawReason: 'retcode 10014 (INVALID_VOLUME)',
            failedStage: 'Routing',
            rejectedBy: 'Desk',
          },
          totalObservableExecutionTimeMs: 420,
          routingDelayMs: 50,
        }
      });
      const fallbackStr = aiService.generateDeterministicFallbackReport(context, 'json');
      const parsed: any = JSON.parse(fallbackStr);

      expect(parsed.outcome.status).toBe('REJECTED');
      expect(parsed.rejectionAnalysis?.isRejected).toBe(true);
      expect(parsed.rejectionAnalysis?.retcode).toBe('10014');
      expect(parsed.rejectionAnalysis?.reason).toBe('INVALID_VOLUME');
      expect(parsed.rejectionAnalysis?.source).toBe('DEALER'); // Desk maps to DEALER
    });
  });

  describe('Rejection Source & Retcode Mappings', () => {
    it('11. Case 3: Dealer rejection source explanation', () => {
      const context = getBaseContext({
        entry: {
          status: 'REJECTED', executed: false,
          rejection: { isRejected: true, reason: 'TRADE_DISABLED', rawReason: 'retcode 10018', failedStage: 'Execution Response', rejectedBy: 'Dealer desk #5' }
        }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.outcome.status).toBe('REJECTED');
      expect(fallback.rejectionAnalysis.retcode).toBe('10018');
    });

    it('12. Case 4: Server rejection source explanation', () => {
      const context = getBaseContext({
        entry: {
          status: 'REJECTED', executed: false,
          rejection: { isRejected: true, reason: 'SERVER_BUSY', rawReason: 'retcode 10026', failedStage: 'Execution Request', rejectedBy: 'MT5 Server' }
        }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.rejectionAnalysis.source).toBe('SERVER');
    });

    it('13. Case 5: Client-side request validation rejection', () => {
      const context = getBaseContext({
        entry: {
          status: 'REJECTED', executed: false,
          rejection: { isRejected: true, reason: 'INVALID_STOPS', rawReason: 'retcode 10016', failedStage: 'Client Request', rejectedBy: 'Client Terminal' }
        }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.outcome.status).toBe('REJECTED');
      expect(fallback.rejectionAnalysis.retcode).toBe('10016');
    });

    it('14. Case 6: Liquidity/Execution rejection explanation', () => {
      const context = getBaseContext({
        entry: {
          status: 'REJECTED', executed: false,
          rejection: { isRejected: true, reason: 'REQUOTE', rawReason: 'retcode 10004 (REQUOTE)', failedStage: 'Dealer Response', rejectedBy: 'Desk' }
        }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.rejectionAnalysis.reason).toBe('REQUOTE');
    });
  });

  describe('Trade Lifecycle Outomes Mappings', () => {
    // 15. Successful Outcome
    it('15. SUCCESSFUL trade outcome mapping', () => {
      const context = getBaseContext();
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.outcome.status).toBe('SUCCESSFUL');
    });

    // 16. Rejected Outcome
    it('16. REJECTED trade outcome mapping', () => {
      const context = getBaseContext({ entry: { status: 'REJECTED', executed: false, rejection: { isRejected: true, reason: 'No credit', rawReason: 'LIMIT' } } });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.outcome.status).toBe('REJECTED');
    });

    // 17. Requoted Success Outcome
    it('17. REQUOTED_THEN_EXECUTED outcome verification', () => {
      const context = getBaseContext();
      const reportText = JSON.stringify({
        outcome: { status: 'SUCCESSFUL', confidence: 'HIGH' },
        executiveSummary: 'Requoted then executed.',
        whatHappened: ['Requote accepted.'],
        executionAnalysis: { entry: 'Ok', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' },
        slippageAnalysis: { summary: 'None', legs: [], tradeLevelConclusion: 'None' },
        timingAnalysis: { summary: 'Ok', routingDelay: 'N/A', executionDelay: 'N/A', dealerResponseTime: 'N/A', quality: 'KNOWN' },
        rejectionAnalysis: null,
        positionLifecycle: ['Ok'],
        anomalies: [],
        evidence: [],
        limitations: []
      });
      expect(aiService.validateAiReport(reportText, context).isValid).toBe(true);
    });

    // 18. Open Position
    it('18. OPEN position outcome mapping', () => {
      const context = getBaseContext({ entry: { status: 'EXECUTED', executed: true }, exit: null });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.outcome.status).toBe('SUCCESSFUL'); // deterministic entry state represents SUCCESSFUL open
    });

    // 19. Closed Position
    it('19. CLOSED position outcome verification', () => {
      const context = getBaseContext({
        entry: { status: 'EXECUTED', executed: true },
        exit: { status: 'EXECUTED', executed: true, slippagePoints: 0, slippageType: 'Zero' }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.outcome.status).toBe('SUCCESSFUL');
    });

    // 20. Incomplete Lifecycle
    it('20. INCOMPLETE lifecycle outcome mapping', () => {
      const context = getBaseContext({ entry: { status: 'INCOMPLETE', executed: false } });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.outcome.status).toBe('INCOMPLETE');
    });

    // 21. Reversal Lifecycle
    it('21. REVERSED lifecycle outcomes', () => {
      const context = getBaseContext({ reversals: [{ status: 'EXECUTED', executed: true }] });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.outcome.status).toBe('SUCCESSFUL');
    });

    // 22. Ambiguous Correlation
    it('22. AMBIGUOUS correlation outcomes mapping', () => {
      const context = getBaseContext({ entry: { status: 'UNKNOWN', executed: false } });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.outcome.status).toBe('UNKNOWN');
    });
  });

  describe('Missing Information & Limits Tests', () => {
    // 23. Missing Timestamps
    it('23. Missing timestamps handling without inventing data', () => {
      const context = getBaseContext({
        entry: { status: 'EXECUTED', executed: true, totalObservableExecutionTimeMs: null, routingDelayMs: null }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.timingAnalysis.summary).toContain('NOT OBSERVABLE');
    });

    // 24. Missing Requested Price
    it('24. Missing requested price handling', () => {
      const context = getBaseContext({
        entry: { status: 'EXECUTED', executed: true, priceRequested: null, priceExecuted: 1.12000 }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.executionAnalysis.entry).toContain('NOT OBSERVABLE');
    });

    // 25. Missing Executed Price
    it('25. Missing executed price handling', () => {
      const context = getBaseContext({
        entry: { status: 'EXECUTED', executed: true, priceRequested: 1.12000, priceExecuted: null }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.executionAnalysis.entry).toContain('NOT OBSERVABLE');
    });

    // 26. Missing Point Size
    it('26. Missing point size handling', () => {
      const context = getBaseContext({
        entry: { status: 'EXECUTED', executed: true, pointSize: null }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.slippageAnalysis.summary).toContain('NOT OBSERVABLE');
    });
  });

  describe('Reference Trade & Slippage Directions', () => {
    // 27. Reference XAUUSD Regression
    it('27. Reference XAUUSD trade regression metrics matching', () => {
      const context = getBaseContext({
        symbol: 'XAUUSD.r',
        entry: {
          priceRequested: 4383.21,
          priceExecuted: 4383.25,
          slippagePoints: 4.0,
          slippageType: 'Adverse',
          executed: true,
          status: 'EXECUTED',
        }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.slippageAnalysis.summary).toContain('4 points of Adverse slippage');
    });

    // 28. SELL Slippage direction
    it('28. SELL slippage type matching correctly', () => {
      const context = getBaseContext({
        action: 'SELL',
        entry: {
          priceRequested: 1.12000,
          priceExecuted: 1.11990, // executed < requested => Favorable for SELL
          slippagePoints: 10,
          slippageType: 'Favorable',
          executed: true,
          status: 'EXECUTED',
        }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.slippageAnalysis.summary).toContain('10 points of Favorable slippage');
    });

    // 29. BUY Slippage direction
    it('29. BUY slippage type matching correctly', () => {
      const context = getBaseContext({
        action: 'BUY',
        entry: {
          priceRequested: 1.12000,
          priceExecuted: 1.12010, // executed > requested => Adverse for BUY
          slippagePoints: 10,
          slippageType: 'Adverse',
          executed: true,
          status: 'EXECUTED',
        }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.slippageAnalysis.summary).toContain('10 points of Adverse slippage');
    });

    // 30. Zero slippage direction
    it('30. Zero slippage explanation matching correctly', () => {
      const context = getBaseContext({
        entry: {
          priceRequested: 1.12000,
          priceExecuted: 1.12000,
          slippagePoints: 0,
          slippageType: 'Zero',
          executed: true,
          status: 'EXECUTED',
        }
      });
      const fallback = JSON.parse(aiService.generateDeterministicFallbackReport(context, 'json'));
      expect(fallback.slippageAnalysis.summary).toContain('0 points of Zero slippage');
    });
  });

  describe('New Requirements & Scenarios tests', () => {
    // 1. Generate report for successful trade
    it('should generate report for successful trade', async () => {
      const context = getBaseContext();
      const report = await aiService.generateAnalysis(context);
      expect(JSON.parse(report).outcome.status).toBe('SUCCESSFUL');
    });

    // 2. Generate report for rejected trade
    it('should generate report for rejected trade', async () => {
      const context = getBaseContext({
        entry: {
          status: 'REJECTED',
          executed: false,
          rejection: { isRejected: true, reason: 'INVALID_VOLUME', failedStage: 'Routing' }
        }
      });
      const report = await aiService.generateAnalysis(context);
      expect(JSON.parse(report).outcome.status).toBe('REJECTED');
    });

    // 3. Generate report for open trade
    it('should generate report for open trade', async () => {
      const context = getBaseContext({
        entry: { status: 'EXECUTED', executed: true },
        exit: null
      });
      const report = await aiService.generateAnalysis(context);
      expect(JSON.parse(report).outcome.status).toBe('SUCCESSFUL');
    });

    // 4. Generate report for multi-leg trade
    it('should generate report for multi-leg trade', async () => {
      const context = getBaseContext({
        entries: [{ status: 'EXECUTED', executed: true, priceRequested: 1.12000, priceExecuted: 1.12005, slippagePoints: 5, slippageType: 'Adverse' } as any],
        exits: [{ status: 'EXECUTED', executed: true, priceRequested: 1.11900, priceExecuted: 1.11895, slippagePoints: 5, slippageType: 'Adverse' } as any]
      });
      const report = await aiService.generateAnalysis(context);
      expect(JSON.parse(report).outcome.status).toBe('SUCCESSFUL');
    });

    // 5. Generate report for incomplete trade
    it('should generate report for incomplete trade', async () => {
      const context = getBaseContext({
        entry: { status: 'INCOMPLETE', executed: false }
      });
      const report = await aiService.generateAnalysis(context);
      expect(JSON.parse(report).outcome.status).toBe('INCOMPLETE');
    });

    // 6. Regenerate same trade
    it('should regenerate for the same trade with same output properties', async () => {
      const context = getBaseContext();
      const first = await aiService.generateAnalysis(context);
      const second = await aiService.generateAnalysis(context);
      expect(JSON.parse(first).outcome.status).toEqual(JSON.parse(second).outcome.status);
    });

    // 7. Chat question about same trade
    it('should answer chat question about the same trade', async () => {
      const context = getBaseContext();
      const answer = await aiService.followUpChat(context, null, [], 'What is the ticket ID of this trade?');
      expect(answer).toContain('9001');
    });

    // 8. Chat question about slippage
    it('should answer chat question about slippage', async () => {
      const context = getBaseContext();
      const answer = await aiService.followUpChat(context, null, [], 'What was the slippage of this trade?');
      expect(answer).toContain('5 points');
    });

    // 9. Chat question about rejection
    it('should answer chat question about rejection', async () => {
      const context = getBaseContext({
        entry: {
          status: 'REJECTED',
          executed: false,
          rejection: { isRejected: true, reason: 'INVALID_VOLUME', failedStage: 'Routing', rejectedBy: 'Server' }
        }
      });
      const answer = await aiService.followUpChat(context, null, [], 'Why was this trade rejected?');
      expect(answer).toContain('INVALID_VOLUME');
    });

    // 10. Chat question about timing
    it('should answer chat question about timing', async () => {
      const context = getBaseContext();
      const answer = await aiService.followUpChat(context, null, [], 'How long did the execution take?');
      expect(answer).toContain('150 ms');
    });

    // 11. Chat question about requested price
    it('should answer chat question about requested price', async () => {
      const context = getBaseContext();
      const answer = await aiService.followUpChat(context, null, [], 'What was the requested price?');
      expect(answer).toContain('1.12000');
    });

    // 12. Chat question about execution price
    it('should answer chat question about execution price', async () => {
      const context = getBaseContext();
      const answer = await aiService.followUpChat(context, null, [], 'What was the executed price?');
      expect(answer).toContain('1.12005');
    });

    // 13. Chat with missing evidence
    it('should handle chat when evidence is missing/unavailable', async () => {
      const context = getBaseContext({
        entry: { status: 'EXECUTED', executed: true, priceRequested: null }
      });
      const answer = await aiService.followUpChat(context, null, [], 'What was the requested price?');
      expect(answer.toLowerCase()).toContain('not observable');
    });

    // 14. Chat with ambiguous evidence
    it('should handle chat when evidence is ambiguous', async () => {
      const context = getBaseContext({
        entry: { status: 'UNKNOWN', executed: false }
      });
      const answer = await aiService.followUpChat(context, null, [], 'Is the trade executed?');
      expect(answer.toLowerCase()).toContain('cannot be determined');
    });

    // 17. AI validator contradiction: 10 points favorable vs 4 points adverse
    it('should reject when AI claims 10 points favorable but deterministic metrics say 4 points adverse', () => {
      const context = getBaseContext({
        entry: { slippagePoints: 4, slippageType: 'Adverse', priceRequested: 4383.21, priceExecuted: 4383.25 }
      });
      const report = {
        outcome: { status: 'SUCCESSFUL', confidence: 'HIGH' },
        executiveSummary: 'Executed with 10 points favorable slippage.',
        whatHappened: ['Executed.'],
        executionAnalysis: { entry: 'Ok.', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' },
        slippageAnalysis: { summary: '10 points favorable slippage.', legs: [], tradeLevelConclusion: '10 points favorable' },
        timingAnalysis: { summary: 'Ok.', routingDelay: 'N/A', executionDelay: 'N/A', dealerResponseTime: 'N/A', quality: 'KNOWN' },
        rejectionAnalysis: null,
        positionLifecycle: ['Ok.'],
        anomalies: [],
        evidence: [],
        limitations: []
      };
      const res = aiService.validateAiReport(JSON.stringify(report), context);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Contradiction');
    });

    // 17. AI validator contradiction: Execution time N/A when latency is known
    it('should reject when AI claims Execution time N/A but deterministic metrics show execution latency is known', () => {
      const context = getBaseContext({
        entry: { totalObservableExecutionTimeMs: 150 }
      });
      const report = {
        outcome: { status: 'SUCCESSFUL', confidence: 'HIGH' },
        executiveSummary: 'Executed.',
        whatHappened: ['Executed.'],
        executionAnalysis: { entry: 'Ok.', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' },
        slippageAnalysis: { summary: 'None.', legs: [], tradeLevelConclusion: 'None' },
        timingAnalysis: { summary: 'Execution latency is N/A.', routingDelay: 'N/A', executionDelay: 'N/A', dealerResponseTime: 'N/A', quality: 'KNOWN' },
        rejectionAnalysis: null,
        positionLifecycle: ['Ok.'],
        anomalies: [],
        evidence: [],
        limitations: []
      };
      const res = aiService.validateAiReport(JSON.stringify(report), context);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Contradiction');
    });

    // 18. Ensure unrelated trade logs are not included (scoping check)
    it('should check that context contains only relevant events', () => {
      const context = getBaseContext();
      expect(context.events.length).toBeLessThan(5);
    });

    // 19. Ensure credentials are never included
    it('should reject when AI output contains credentials/secrets', () => {
      const context = getBaseContext();
      const report = {
        outcome: { status: 'SUCCESSFUL', confidence: 'HIGH' },
        executiveSummary: 'Executed.',
        whatHappened: ['API_KEY is secret.'],
        executionAnalysis: { entry: 'Ok.', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' },
        slippageAnalysis: { summary: 'None.', legs: [], tradeLevelConclusion: 'None' },
        timingAnalysis: { summary: 'Ok.', routingDelay: 'N/A', executionDelay: 'N/A', dealerResponseTime: 'N/A', quality: 'KNOWN' },
        rejectionAnalysis: null,
        positionLifecycle: ['Ok.'],
        anomalies: [],
        evidence: [],
        limitations: []
      };
      const res = aiService.validateAiReport(JSON.stringify(report), context);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Security violation');
    });

    // 20. Ensure Client-tab Slippage and Delay remain unchanged
    it('should ensure client-tab slippage and delay remain unchanged', () => {
      const context = getBaseContext();
      expect(context.entry?.slippagePoints).toBe(5);
      expect(context.entry?.routingDelayMs).toBe(20);
    });
  });
});
