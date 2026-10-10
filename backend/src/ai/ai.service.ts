import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalculatedMetrics } from '../metrics/metrics.service';
import { NormalizedEvent } from '../journal/normalization.engine';
import * as crypto from 'crypto';

export interface TradeInvestigationContext {
  contextVersion: string; // "1"
  identity: {
    login: string;
    positionId?: string;
    dealId?: string;
    orderId?: string;
    ticketId?: string;
    requestId?: string;
  };
  symbol: string;
  action: string;
  volume: number;
  deterministicFacts: {
    summary: any | null;
    entry: CalculatedMetrics | null;
    exit: CalculatedMetrics | null;
    entries: CalculatedMetrics[];
    exits: CalculatedMetrics[];
    reversals: CalculatedMetrics[];
  };
  events: NormalizedEvent[];
  canonicalResult: any | null;

  // Backward compatibility fields for legacy tests / code:
  login?: string;
  ticketId?: string;
  entry?: CalculatedMetrics | null;
  exit?: CalculatedMetrics | null;
  summary?: any | null;
  entries?: CalculatedMetrics[];
  exits?: CalculatedMetrics[];
  reversals?: CalculatedMetrics[];
}

export type AiAnalysisContext = TradeInvestigationContext;

export interface AiAnalysisResult {
  outcome: {
    status: 'SUCCESSFUL' | 'REJECTED' | 'FAILED' | 'PARTIALLY_EXECUTED' | 'INCOMPLETE' | 'UNKNOWN';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  };
  executiveSummary: string;
  whatHappened: string[];
  executionAnalysis: {
    entry: string;
    exit: string;
    reversal: string;
  };
  slippageAnalysis: {
    summary: string;
    legs: Array<{
      leg: 'ENTRY' | 'EXIT' | 'REVERSAL';
      requestedPrice: string;
      executedPrice: string;
      slippagePoints: string;
      classification: 'ADVERSE' | 'FAVORABLE' | 'ZERO' | 'NOT_OBSERVABLE';
    }>;
    tradeLevelConclusion: string;
  };
  timingAnalysis: {
    summary: string;
    routingDelay: string;
    executionDelay: string;
    dealerResponseTime: string;
    quality: 'KNOWN' | 'PARTIAL' | 'NOT_OBSERVABLE';
  };
  rejectionAnalysis: {
    isRejected: boolean;
    stage: string;
    reason: string;
    retcode: string;
    source: 'CLIENT_REQUEST' | 'SERVER' | 'DEALER' | 'LIQUIDITY/EXECUTION' | 'UNKNOWN' | 'NOT_OBSERVABLE';
  } | null;
  positionLifecycle: string[];
  anomalies: string[];
  evidence: Array<{
    timestamp: string;
    event: string;
    explanation: string;
  }>;
  limitations: string[];
}

const displayValue = (value: unknown, fallback = 'N/A'): string => {
  if (value === null || value === undefined) return fallback;
  return String(value);
};

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');
  private readonly apiKey: string | null;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || null;
  }

  normalizeContext(context: any): TradeInvestigationContext {
    if (!context) {
      return {
        contextVersion: '1',
        identity: { login: 'N/A', ticketId: 'N/A' },
        symbol: 'N/A',
        action: 'N/A',
        volume: 0,
        deterministicFacts: { summary: null, entry: null, exit: null, entries: [], exits: [], reversals: [] },
        events: [],
        canonicalResult: null,
      };
    }

    if (context.contextVersion === '1') {
      return context as TradeInvestigationContext;
    }

    // Check if it is a legacy CalculatedMetrics object passed directly
    if (context.status !== undefined || context.priceRequested !== undefined || context.slippagePoints !== undefined) {
      if (context.entry === undefined) {
        return {
          contextVersion: '1',
          identity: { login: 'N/A', ticketId: 'N/A' },
          symbol: 'N/A',
          action: 'N/A',
          volume: 0,
          deterministicFacts: {
            summary: null,
            entry: context,
            exit: null,
            entries: [context],
            exits: [],
            reversals: [],
          },
          events: [],
          canonicalResult: null,
        };
      }
    }

    // Convert legacy flat context to versioned structure
    const entry = context.entry || null;
    const exit = context.exit || null;
    return {
      contextVersion: '1',
      identity: {
        login: context.login || 'N/A',
        ticketId: context.ticketId || 'N/A',
        positionId: entry?.positionId || exit?.positionId || undefined,
        dealId: entry?.dealId || exit?.dealId || undefined,
        orderId: entry?.orderId || exit?.orderId || undefined,
        requestId: entry?.requestId || exit?.requestId || undefined,
      },
      symbol: context.symbol || 'EURUSD',
      action: context.action || 'BUY',
      volume: context.volume || 0,
      deterministicFacts: {
        summary: context.summary || null,
        entry,
        exit,
        entries: context.entries || (entry ? [entry] : []),
        exits: context.exits || (exit ? [exit] : []),
        reversals: context.reversals || [],
      },
      events: context.events || [],
      canonicalResult: context.canonicalResult || null,
    };
  }

  // Generates a structured analysis report
  async generateAnalysis(context: AiAnalysisContext): Promise<string> {
    const normalized = this.normalizeContext(context);
    const prompt = this.compileAnalysisPrompt(normalized);

    // If API Key is missing, return a detailed mock AI response reflecting the exact dispute metrics
    if (!this.apiKey || this.apiKey === 'your-gemini-api-key') {
      this.logger.warn('GEMINI_API_KEY is missing or configured as default template. Serving simulated AI report.');
      await new Promise((resolve) => setTimeout(resolve, 500)); // simulated latency
      const mockReport = this.generateMockAiResponse(normalized);
      const validation = this.validateAiReport(mockReport, normalized);
      if (!validation.isValid) {
        this.logger.warn(`Mock AI validation failed: ${validation.reason}. Falling back to deterministic report.`);
        return this.generateDeterministicFallbackReport(normalized, 'json');
      }
      return mockReport;
    }

    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout limit

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: prompt,
                  },
                ],
              },
            ],
            systemInstruction: {
              parts: [
                {
                  text: 'You are MT5 AI Journal Analyzer. You generate detailed, strict compliance reports based ONLY on deterministic facts. You must output minified JSON exactly conforming to the schema.',
                },
              ],
            },
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          }),
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gemini API error: ${errText}`);
        }

        const body = await res.json();
        const rawText = body.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        const validation = this.validateAiReport(rawText, normalized);
        if (validation.isValid) {
          return rawText;
        }

        this.logger.warn(`Gemini API validation failed on attempt ${attempts}/${maxAttempts}: ${validation.reason}`);
      } catch (error: any) {
        this.logger.error(`Attempt ${attempts} failed to complete AI generation: ${error.message}`);
      }
    }

    this.logger.warn('AI Analysis failed to generate a validated report. Serving deterministic fallback.');
    return this.generateDeterministicFallbackReport(normalized, 'json');
  }

  // Conducts follow-up chats in investigation contexts
  async followUpChat(
    contextOrReport: any,
    reportTextOrCanonical: any,
    previousChatHistory: { role: 'user' | 'assistant'; content: string }[],
    userQuestion: string,
  ): Promise<string> {
    let context: TradeInvestigationContext;
    let reportText: string | null = null;

    if (contextOrReport && (contextOrReport.contextVersion === '1' || contextOrReport.login !== undefined || contextOrReport.identity !== undefined)) {
      context = this.normalizeContext(contextOrReport);
      reportText = reportTextOrCanonical || null;
    } else {
      // Legacy signature fallback
      reportText = contextOrReport || null;
      const canonicalResult = reportTextOrCanonical || null;
      context = this.normalizeContext({
        canonicalResult,
        entry: canonicalResult?.execution || null,
        exit: null,
        events: [],
      });
    }

    if (!this.apiKey || this.apiKey === 'your-gemini-api-key') {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const status = context.canonicalResult?.status || 'UNKNOWN';
      const isRejected = context.deterministicFacts.entry?.rejection?.isRejected || false;
      const rejectedBy = context.deterministicFacts.entry?.rejection?.rejectedBy || 'the system';
      const failedStage = context.deterministicFacts.entry?.rejection?.failedStage || 'execution';
      const reason = context.deterministicFacts.entry?.rejection?.reason || 'unknown';
      const latency = context.deterministicFacts.entry?.totalObservableExecutionTimeMs || 'N/A';
      
      const q = userQuestion.toLowerCase();
      if (q.includes('ticket id') || q.includes('ticket_id')) {
        return `The ticket ID of this trade is ${context.identity.ticketId || 'N/A'}.`;
      }
      if (q.includes('slippage')) {
        return `The slippage of this trade was ${context.deterministicFacts.entry?.slippagePoints ?? 'N/A'} points.`;
      }
      if (q.includes('rejection') || q.includes('rejected')) {
        return `The trade was rejected due to ${context.deterministicFacts.entry?.rejection?.reason || 'unknown reason'}.`;
      }
      if (q.includes('timing') || q.includes('how long') || q.includes('duration') || q.includes('latency') || q.includes('execution take')) {
        return `The total execution latency was ${context.deterministicFacts.entry?.totalObservableExecutionTimeMs ?? 'N/A'} ms.`;
      }
      if (q.includes('requested price')) {
        const reqPrice = context.deterministicFacts.entry?.priceRequested;
        return `The requested price was ${reqPrice !== null && reqPrice !== undefined ? (typeof reqPrice === 'number' ? reqPrice.toFixed(5) : reqPrice) : 'NOT OBSERVABLE'}.`;
      }
      if (q.includes('executed price') || q.includes('execution price')) {
        const execPrice = context.deterministicFacts.entry?.priceExecuted;
        return `The executed price was ${execPrice !== null && execPrice !== undefined ? (typeof execPrice === 'number' ? execPrice.toFixed(5) : execPrice) : 'NOT OBSERVABLE'}.`;
      }
      if (q.includes('is the trade executed') || q.includes('executed?')) {
        if (status === 'UNKNOWN') {
          return `Based on the deterministic logs, this details cannot be determined.`;
        }
        return `The execution status is ${status}.`;
      }

      if (isRejected) {
        return `[Mock AI Response] The trade status is deterministically ${status}. It was rejected by ${rejectedBy} at the "${failedStage}" stage due to: "${reason}". Rejection latency was ${latency} ms.`;
      } else {
        return `[Mock AI Response] The trade status is deterministically ${status}. It executed successfully at price ${context.deterministicFacts.entry?.priceExecuted || 'N/A'} with ${context.deterministicFacts.entry?.slippagePoints || 0} points slippage. Execution latency was ${latency} ms.`;
      }
    }

    const systemPrompt = `You are MT5 AI Journal Analyzer, a senior compliance desk assistant.
Answer questions about the trade dispute based ONLY on the provided deterministic context and report text (if available).

Trade Investigation Context:
${JSON.stringify(context, null, 2)}

AI Audit Report (if generated):
${reportText || 'Not generated yet.'}

CRITICAL RULES:
1. Do not invent, assume, or deduce parameters or events outside the provided data.
2. If the user asks about latencies, slippage, execution prices, or rejection reasons, cite the deterministic context fields exactly.
3. If the answer cannot be determined from the provided data, state clearly: "Based on the deterministic logs, this details cannot be determined."
4. This assistant is strictly scoped to the current trade (ID: ${context.identity.ticketId || context.identity.positionId || 'N/A'}). If the user asks about other trades or switches context, inform them: "This assistant is currently analysing Trade #${context.identity.ticketId || context.identity.positionId || 'N/A'}. Open the other trade's Investigation page to analyse that trade."
5. Never behave like a general chatbot, trading advisor, or market analyst. Remain strictly a Trade Investigation Assistant focusing on the evidence of this specific trade.`;

    const contents = [
      ...previousChatHistory.map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
      {
        role: 'user',
        parts: [{ text: userQuestion }],
      },
    ];

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [
              {
                text: systemPrompt,
              },
            ],
          },
          generationConfig: {
            temperature: 0.2,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API chat error: ${errText}`);
      }

      const body = await res.json();
      return body.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI assistant.';
    } catch (error: any) {
      this.logger.error('Failed to contact Gemini API chat', error);
      throw new InternalServerErrorException('AI Chat follow-up failed');
    }
  }

  // Generates hash from prompt to cache results
  generatePromptHash(ticketId: string, entry: CalculatedMetrics | null, exit: CalculatedMetrics | null): string {
    const entryLatency = entry?.totalObservableExecutionTimeMs ?? 'N/A';
    const exitLatency = exit?.totalObservableExecutionTimeMs ?? 'N/A';
    const entrySlippage = entry?.slippagePoints ?? 'N/A';
    const exitSlippage = exit?.slippagePoints ?? 'N/A';
    
    const payload = `v2:${ticketId}:${entryLatency}:${exitLatency}:${entrySlippage}:${exitSlippage}`;
    return crypto.createHash('md5').update(payload).digest('hex');
  }

  private compileAnalysisPrompt(context: AiAnalysisContext): string {
    const normalized = this.normalizeContext(context);
    const { identity, symbol, action, volume, deterministicFacts, events } = normalized;
    const { login, ticketId } = identity;
    const { entry, exit, summary, entries, exits, reversals } = deterministicFacts;

    const eventsFormatted = events
      .map((e, idx) => `[Evidence ID: log_${idx}] [${e.timestamp}] ${e.eventType}: ${e.rawMessage}`)
      .join('\n');

    const entryLegs = entries || [];
    const exitLegs = exits || [];
    const reversalLegs = reversals || [];

    const formatLegs = (legs: CalculatedMetrics[], prefix: string) => {
      return legs.map((leg, idx) => `
${prefix} Leg #${idx + 1}:
- Side: ${leg.action || 'N/A'}
- Price Requested: ${displayValue(leg.priceRequested)}
- Price Executed: ${displayValue(leg.priceExecuted)}
- Slippage: ${leg.slippagePoints != null ? `${leg.slippagePoints} points (${leg.slippageType})` : 'N/A'}
- Latency: ${leg.totalObservableExecutionTimeMs != null ? `${leg.totalObservableExecutionTimeMs} ms` : 'N/A'}
- Status: ${displayValue(leg.status)}
- Rejection: ${leg.rejection?.isRejected ? `Stage: ${leg.rejection.failedStage}, Reason: ${leg.rejection.reason}, Source: ${leg.rejection.rejectedBy}` : 'N/A'}
- IDs: PositionId=${displayValue(leg.positionId)}, OrderId=${displayValue(leg.orderId)}, DealId=${displayValue(leg.dealId)}, RequestId=${displayValue(leg.requestId)}
`).join('\n');
    };

    const entryLegsStr = formatLegs(entryLegs, 'Entry');
    const exitLegsStr = formatLegs(exitLegs, 'Exit');
    const reversalLegsStr = formatLegs(reversalLegs, 'Reversal');

    // JSON SCHEMA:
    const schemaStr = `{
  "outcome": {
    "status": "SUCCESSFUL | REJECTED | FAILED | PARTIALLY_EXECUTED | INCOMPLETE",
    "confidence": "HIGH | MEDIUM | LOW"
  },
  "executiveSummary": "Concise executive summary explaining side, symbol, outcome, slippage, and time.",
  "whatHappened": [
    "Chronological step-by-step description of the execution timeline."
  ],
  "executionAnalysis": {
    "entry": "Analysis of requested vs executed prices for entries.",
    "exit": "Analysis of requested vs executed prices for exits.",
    "reversal": "Analysis of requested vs executed prices for reversals."
  },
  "slippageAnalysis": {
    "summary": "Detailed summary explaining slippage points and classifications.",
    "legs": [
      {
        "leg": "ENTRY | EXIT | REVERSAL",
        "requestedPrice": "requested price or NOT_OBSERVABLE",
        "executedPrice": "executed price or NOT_OBSERVABLE",
        "slippagePoints": "slippage points value or NOT_OBSERVABLE",
        "classification": "ADVERSE | FAVORABLE | ZERO | NOT_OBSERVABLE"
      }
    ],
    "tradeLevelConclusion": "Conclusive summary matching the overall trade slippage."
  },
  "timingAnalysis": {
    "summary": "Breakdown of delays.",
    "routingDelay": "routing delay or NOT_OBSERVABLE",
    "executionDelay": "execution delay or NOT_OBSERVABLE",
    "dealerResponseTime": "dealer/bridge response time or NOT_OBSERVABLE",
    "quality": "KNOWN | PARTIAL | NOT_OBSERVABLE"
  },
  "rejectionAnalysis": {
    "isRejected": true | false,
    "stage": "failed stage name or NOT_OBSERVABLE",
    "reason": "rejection reason name or NOT_OBSERVABLE",
    "retcode": "retcode number or NOT_OBSERVABLE",
    "source": "CLIENT_REQUEST | SERVER | DEALER | LIQUIDITY/EXECUTION | UNKNOWN"
  },
  "positionLifecycle": [
    "State changes during position opening/closing."
  ],
  "anomalies": [
    "Anomalies or empty array"
  ],
  "evidence": [
    {
      "timestamp": "log timestamp",
      "event": "log event type",
      "explanation": "why this is relevant"
    }
  ],
  "limitations": [
    "Limitations observed or empty array"
  ]
}`;

    return `
Analyze the following trade execution incident retrieved from MT5 Server Logs and output a strict JSON compliance report matching the schema.

TRADE METADATA
- Login: ${login}
- Ticket ID: ${ticketId}
- Symbol: ${symbol}
- Action: ${action}
- Volume: ${volume} Lot(s)

ENTRY LEGS
${entryLegsStr}

EXIT LEGS
${exitLegsStr}

REVERSAL LEGS
${reversalLegsStr}

ROUND-TRIP / SUMMARY FACT DETAILS:
- Net Slippage: ${summary?.netSlippage?.slippagePoints != null ? `${summary.netSlippage.slippagePoints} points (${summary.netSlippage.slippageType})` : 'N/A'}
- Cumulative Latency: ${summary?.cumulativeLatency != null ? `${summary.cumulativeLatency} ms` : 'N/A'}
- Hold Time: ${summary?.holdTimeMs != null ? `${summary.holdTimeMs} ms` : 'N/A'}

CORRELATED MT5 LOG EVIDENCE
${eventsFormatted}

OUTPUT INSTRUCTION:
You MUST return ONLY a valid, minified JSON object conforming to the schema below. 
Do NOT wrap the JSON inside markdown code blocks (e.g. \`\`\`json). Do NOT add any extra text or leading/trailing commentary.

JSON SCHEMA:
${schemaStr}

CRITICAL COMPLIANCE RULES:
1. AI is an EXPLANATION LAYER. You MUST NEVER independently calculate or invent timestamps, prices, slippage points, latencies, or outcomes. Cite the exact deterministic facts provided.
2. If evidence does not exist for a parameter (e.g. latency is N/A), state that it is not observable or not applicable.
3. Every claim in the "evidence" array MUST refer to a valid log event from the provided evidence list.
4. Never mention network topology or make assumptions about server load/internet issues unless explicitly present in the logs.
5. Explain retcodes neutrally based on standard MT5 codes.
`;
  }

  validateAiReport(reportText: string, contextOrMetrics: AiAnalysisContext | CalculatedMetrics): { isValid: boolean; reason?: string } {
    const isJson = reportText.trim().startsWith('{');
    
    const normalized = this.normalizeContext(contextOrMetrics);
    const { deterministicFacts } = normalized;
    const entry = deterministicFacts.entry;
    if (!entry) return { isValid: true };

    // 1. Strict Slippage Contradiction Check
    const slippagePoints = entry.slippagePoints;
    if (slippagePoints !== null && slippagePoints !== undefined) {
      const pointRegex = /(\d+(?:\.\d+)?)\s*(?:points?|pips?)/gi;
      let match;
      const allValidPoints = [
        entry.slippagePoints,
        deterministicFacts.exit?.slippagePoints,
        ...(deterministicFacts.entries || []).map(e => e.slippagePoints),
        ...(deterministicFacts.exits || []).map(e => e.slippagePoints),
        ...(deterministicFacts.reversals || []).map(e => e.slippagePoints)
      ].filter((v): v is number => v !== null && v !== undefined);

      while ((match = pointRegex.exec(reportText)) !== null) {
        const val = parseFloat(match[1]);
        if (!allValidPoints.some(vp => Math.abs(val - vp) < 0.01)) {
          return {
            isValid: false,
            reason: `Contradiction: AI claimed ${val} points of slippage, which contradicts deterministic metrics`
          };
        }
      }
    }

    // 2. Strict Latency/Timing Contradiction Check
    const latency = entry.totalObservableExecutionTimeMs;
    if (latency !== null && latency !== undefined) {
      const reportLower = reportText.toLowerCase();
      if (
        /execution\s*(?:latency|time|duration|processing|speed)\s*(?:was|is|to be)?\s*(?:n\/a|not\s*observable|unavailable|unknown)/gi.test(reportLower) ||
        /latency\s*(?:was|is|to be)?\s*(?:n\/a|not\s*observable|unavailable|unknown)/gi.test(reportLower)
      ) {
        return {
          isValid: false,
          reason: `Contradiction: AI claimed execution latency/time was N/A when deterministic metrics show it is known (${latency} ms)`
        };
      }
    }

    if (!isJson) {
      // Legacy markdown validation (identical to original code)
      const reportLower = reportText.toLowerCase();
      const isRejected = entry.rejection?.isRejected || false;

      if (isRejected) {
        if (reportLower.includes('executed successfully') || reportLower.includes('execution was normal')) {
          return { isValid: false, reason: 'AI claimed successful execution for a rejected trade' };
        }
      }

      if (entry.totalObservableExecutionTimeMs === null) {
        const claimsExecutionLatency = /execution latency|total execution|execution duration/i.test(reportText) && !/n\/a|not applicable|no execution/i.test(reportText);
        if (claimsExecutionLatency) {
          return { isValid: false, reason: 'AI asserted execution latency when execution did not occur' };
        }
      }

      if (entry.slippagePoints === null) {
        const claimsSlippage = /slippage of|slippage is/i.test(reportText) && !/n\/a|not applicable|no execution/i.test(reportText);
        if (claimsSlippage) {
          return { isValid: false, reason: 'AI asserted slippage metrics when execution did not occur' };
        }
      }

      if (isRejected && !entry.rejection?.rawReason) {
        const inventsServerLoad = /server load|network delay|network issues/i.test(reportText);
        if (inventsServerLoad) {
          return { isValid: false, reason: 'AI invented root causes when no explicit log reason was present' };
        }
      }

      return { isValid: true };
    }

    // JSON Validation
    try {
      const parsed: any = JSON.parse(reportText);
      
      // Ensure essential fields exist
      if (!parsed.outcome || !parsed.executiveSummary || !parsed.whatHappened || !parsed.executionAnalysis || !parsed.slippageAnalysis || !parsed.timingAnalysis || !parsed.positionLifecycle) {
        return { isValid: false, reason: 'Missing essential fields in JSON schema' };
      }
      
      const isRejected = entry.rejection?.isRejected || false;
      const reportOutcome = parsed.outcome?.status || parsed.outcome;
      
      if (isRejected && reportOutcome === 'SUCCESSFUL') {
        return { isValid: false, reason: 'Contradiction: AI claimed successful execution for a rejected trade' };
      }
      if (!isRejected && entry.status === 'EXECUTED' && reportOutcome === 'REJECTED') {
        return { isValid: false, reason: 'Contradiction: AI claimed rejected outcome for a successful trade' };
      }
      
      if (isRejected && parsed.rejectionAnalysis) {
        if (!parsed.rejectionAnalysis.isRejected) {
          return { isValid: false, reason: 'Contradiction: AI claimed trade was not rejected under rejectionAnalysis' };
        }
      }
      
      const slippagePoints = entry.slippagePoints;
      const slippageType = entry.slippageType;
      
      if (slippagePoints !== null && slippagePoints > 0) {
        const typeLower = slippageType?.toLowerCase();
        const slippageSummary = parsed.slippageAnalysis?.summary || '';
        const executiveSummaryText = parsed.executiveSummary || '';
        const tradeConclusionText = parsed.slippageAnalysis?.tradeLevelConclusion || '';
        const analysisLower = (slippageSummary + ' ' + executiveSummaryText + ' ' + tradeConclusionText).toLowerCase();
        if (typeLower === 'adverse' && analysisLower.includes('favorable') && !analysisLower.includes('adverse')) {
          return { isValid: false, reason: 'Contradiction: AI claimed slippage was favorable when deterministic metrics show adverse' };
        }
        if (typeLower === 'favorable' && analysisLower.includes('adverse') && !analysisLower.includes('favorable')) {
          return { isValid: false, reason: 'Contradiction: AI claimed slippage was adverse when deterministic metrics show favorable' };
        }
      }
      
      const reportLower = reportText.toLowerCase();
      if (reportLower.includes('password') || reportLower.includes('secret') || reportLower.includes('api_key') || reportLower.includes('api-key')) {
        return { isValid: false, reason: 'Security violation: potential credential leakage detected in output' };
      }
 
      return { isValid: true };
    } catch (e: any) {
      return { isValid: false, reason: `Invalid JSON structure: ${e.message}` };
    }
  }

  generateDeterministicFallbackReport(context: any, format: 'markdown' | 'json' = 'markdown'): string {
    const normalized = this.normalizeContext(context);
    const { identity, symbol, action, volume, deterministicFacts, events } = normalized;
    const { login, ticketId } = identity;
    const { entry, exit, summary, entries, exits } = deterministicFacts;

    if (format === 'markdown') {
      const isRejected = entry?.rejection?.isRejected || false;
      let fallbackSummary = '';
      let rootCause = '';
      let evidence = '';
      let recommendation = '';

      if (isRejected) {
        const rej = entry!.rejection!;
        fallbackSummary = `Trade request by Client #${login} for ${volume} Lot ${symbol} was rejected.`;
        rootCause = `Rejection occurred during the "${displayValue(rej.failedStage)}" stage by ${displayValue(rej.rejectedBy)}.`;
        evidence = `- Status: REJECTED\n- Reason: ${displayValue(rej.reason)}\n- Raw Reason: ${displayValue(rej.rawReason)}\n- Rejection Latency: ${entry?.totalObservableExecutionTimeMs != null ? `${entry.totalObservableExecutionTimeMs} ms` : 'N/A'}`;
        recommendation = `Review ${displayValue(rej.failedStage)} parameters and client margin limits.`;
      } else if (entry?.status === 'INCOMPLETE') {
        fallbackSummary = `Trade request by Client #${login} for ${volume} Lot ${symbol} was not completed.`;
        rootCause = `The log sequence terminated abruptly with no execution or rejection event.`;
        evidence = `- Status: INCOMPLETE\n- Execution Latency: N/A\n- Slippage: N/A`;
        recommendation = `Verify server logs to check if the request was routed successfully.`;
      } else {
        fallbackSummary = `Trade request by Client #${login} for ${volume} Lot ${symbol} was successfully executed.`;
        rootCause = `The order was filled normally.`;
        evidence = `- Status: EXECUTED\n- Total Observable Execution Time: ${displayValue(entry?.totalObservableExecutionTimeMs)} ms\n- Slippage: ${entry?.slippagePoints != null ? `${entry.slippagePoints} points` : 'N/A'}\n- Routing Delay: ${entry?.routingDelayMs != null ? `${entry.routingDelayMs} ms` : 'N/A'}`;
        recommendation = `Close investigation case file. No further action is required.`;
      }

      return `### Summary
${fallbackSummary}

### Root Cause
${rootCause}

### Evidence
${evidence}

### Recommendation
${recommendation}

### Confidence
High. Generated deterministically from raw journal logs.`;
    }

    // JSON Fallback
    const isRejected = entry?.rejection?.isRejected || false;
    
    let statusVal: any = 'INCOMPLETE';
    if (isRejected) statusVal = 'REJECTED';
    else if (entry?.status === 'INCOMPLETE') statusVal = 'INCOMPLETE';
    else if (entry?.status === 'EXECUTED') statusVal = 'SUCCESSFUL';
    else if (entry?.status) statusVal = entry.status;
    
    let confidenceVal: AiAnalysisResult['outcome']['confidence'] = 'UNKNOWN';
    if (entry?.totalObservableExecutionTimeMs !== null && entry?.totalObservableExecutionTimeMs !== undefined) {
      confidenceVal = 'HIGH';
    } else if (events.length > 1) {
      confidenceVal = 'MEDIUM';
    } else {
      confidenceVal = 'LOW';
    }
    
    const entryLegs = entries || [];
    const exitLegs = exits || [];
    
    const formatPrice = (val: any) => (val !== null && val !== undefined ? val.toFixed(5) : 'NOT OBSERVABLE');
    const formatMs = (val: any) => (val !== null && val !== undefined ? `${val.toFixed(0)} ms` : 'NOT OBSERVABLE');

    let summaryText = '';
    let whatHappened: string[] = [];
    let executionAnalysis = { entry: 'NOT_OBSERVABLE', exit: 'NOT_OBSERVABLE', reversal: 'NOT_OBSERVABLE' };
    let slippageAnalysis = { summary: 'NOT_OBSERVABLE', legs: [] as any[], tradeLevelConclusion: 'NOT_OBSERVABLE' };
    let timingAnalysis = { summary: 'NOT_OBSERVABLE', routingDelay: 'NOT_OBSERVABLE', executionDelay: 'NOT_OBSERVABLE', dealerResponseTime: 'NOT_OBSERVABLE', quality: 'NOT_OBSERVABLE' as any };
    let rejectionAnalysis: AiAnalysisResult['rejectionAnalysis'] = null;
    let positionLifecycle: string[] = [];
    const anomalies: string[] = [];
    const limitations: string[] = [];
    const evidenceList: AiAnalysisResult['evidence'] = [];

    // Populate evidence list
    events.forEach((ev) => {
      evidenceList.push({
        timestamp: ev.timestamp,
        event: ev.eventType,
        explanation: ev.rawMessage || `Log state change: ${ev.eventType}`,
      });
    });

    if (isRejected) {
      const rej = entry!.rejection!;
      summaryText = `The ${action} order for ${volume} Lot ${symbol} was rejected before execution.`;
      whatHappened = [
        `Client submitted a ${action} request for ${volume} Lot ${symbol}.`,
        `The request was routed but rejected at stage "${rej.failedStage || 'Unknown'}" by ${rej.rejectedBy || 'MT5 Server'} due to: "${rej.reason || 'REJECTED'}".`
      ];
      executionAnalysis = {
        entry: `Requested Price: ${formatPrice(entry?.priceRequested)}. Executed Price: NOT OBSERVABLE (Rejected).`,
        exit: 'NOT_OBSERVABLE',
        reversal: 'NOT_OBSERVABLE'
      };
      slippageAnalysis = {
        summary: `Slippage points and classification are NOT OBSERVABLE because the order was rejected before deal execution.`,
        legs: [],
        tradeLevelConclusion: 'NOT_OBSERVABLE'
      };
      timingAnalysis = {
        summary: `Rejection latency: ${formatMs(entry?.totalObservableExecutionTimeMs)}. Routing delay: ${formatMs(entry?.routingDelayMs)}.`,
        routingDelay: formatMs(entry?.routingDelayMs),
        executionDelay: formatMs(entry?.executionRequestDelayMs),
        dealerResponseTime: formatMs(entry?.dealerBridgeResponseTimeMs),
        quality: entry?.totalObservableExecutionTimeMs !== null ? 'KNOWN' : 'NOT_OBSERVABLE'
      };
      rejectionAnalysis = {
        isRejected: true,
        stage: rej.failedStage || 'Unknown',
        reason: rej.reason || 'REJECTED',
        retcode: rej.rawReason ? (rej.rawReason.match(/retcode\s*[:#\s]*(\d+)/i)?.[1] || '10014') : '10014',
        source: rej.rejectedBy === 'MT5 Server' ? 'SERVER' : (rej.rejectedBy === 'Desk' ? 'DEALER' : 'UNKNOWN')
      };
      positionLifecycle = [`The lifecycle was terminated at entry. No position was opened.`];
    } else {
      summaryText = `Your ${action} order for ${volume} Lot ${symbol} was successfully executed.`;
      whatHappened = [
        `Client submitted a ${action} request for ${volume} Lot ${symbol}.`,
        `The request was routed, approved by dealer/bridge, and filled at price ${formatPrice(entry?.priceExecuted)}.`
      ];
      executionAnalysis = {
        entry: `Requested Price: ${formatPrice(entry?.priceRequested)}. Executed Price: ${formatPrice(entry?.priceExecuted)}.`,
        exit: exitLegs[0] ? `Requested Price: ${formatPrice(exitLegs[0].priceRequested)}. Executed Price: ${formatPrice(exitLegs[0].priceExecuted)}.` : 'NOT_OBSERVABLE',
        reversal: 'NOT_OBSERVABLE'
      };
      slippageAnalysis = {
        summary: entry?.pointSize === null || entry?.slippagePoints === null
          ? 'Slippage points and classification are NOT OBSERVABLE.'
          : `The entry execution resulted in ${entry?.slippagePoints ?? 0} points of ${entry?.slippageType || 'Zero'} slippage.`,
        legs: [
          {
            leg: 'ENTRY',
            requestedPrice: formatPrice(entry?.priceRequested),
            executedPrice: formatPrice(entry?.priceExecuted),
            slippagePoints: entry?.slippagePoints !== null && entry?.slippagePoints !== undefined ? String(entry.slippagePoints) : 'NOT_OBSERVABLE',
            classification: entry?.slippageType ? entry.slippageType.toUpperCase() as any : 'NOT_OBSERVABLE'
          },
          ...(exitLegs[0] ? [{
            leg: 'EXIT',
            requestedPrice: formatPrice(exitLegs[0].priceRequested),
            executedPrice: formatPrice(exitLegs[0].priceExecuted),
            slippagePoints: exitLegs[0].slippagePoints !== null && exitLegs[0].slippagePoints !== undefined ? String(exitLegs[0].slippagePoints) : 'NOT_OBSERVABLE',
            classification: exitLegs[0].slippageType ? exitLegs[0].slippageType.toUpperCase() as any : 'NOT_OBSERVABLE'
          }] : [])
        ],
        tradeLevelConclusion: summary?.netSlippage?.slippagePoints !== null && summary?.netSlippage?.slippagePoints !== undefined
          ? `Overall trade-level slippage is ${summary.netSlippage.slippagePoints} points ${summary.netSlippage.slippageType}.`
          : 'NOT_OBSERVABLE'
      };
      let timingSummary = `Open execution time was ${formatMs(entry?.totalObservableExecutionTimeMs)}`;
      if (exitLegs[0]) {
        timingSummary += `, and Close execution time was ${formatMs(exitLegs[0].totalObservableExecutionTimeMs)}`;
      } else {
        timingSummary += `, and Close execution time was N/A`;
      }
      const formatLegMs = (v1: any, v2?: any) => {
        const s1 = (v1 !== null && v1 !== undefined) ? `${v1.toFixed(0)} ms` : 'NOT OBSERVABLE';
        if (exitLegs[0]) {
          const s2 = (v2 !== null && v2 !== undefined) ? `${v2.toFixed(0)} ms` : 'NOT OBSERVABLE';
          return `${s1} / ${s2}`;
        }
        return s1;
      };
      timingAnalysis = {
        summary: timingSummary,
        routingDelay: formatLegMs(entry?.routingDelayMs, exitLegs[0]?.routingDelayMs),
        executionDelay: formatLegMs(entry?.executionRequestDelayMs, exitLegs[0]?.executionRequestDelayMs),
        dealerResponseTime: formatLegMs(entry?.dealerBridgeResponseTimeMs, exitLegs[0]?.dealerBridgeResponseTimeMs),
        quality: entry?.totalObservableExecutionTimeMs !== null ? 'KNOWN' : 'NOT_OBSERVABLE'
      };
      positionLifecycle = [
        `Position opened through entry leg.`,
        ...(exitLegs.length > 0 ? [`Position closed through exit leg.`] : [])
      ];
      if (exitLegs.length > 0) {
        summaryText += ` The position has been closed.`;
      }
    }

    const reportObj: AiAnalysisResult = {
      outcome: {
        status: statusVal,
        confidence: confidenceVal
      },
      executiveSummary: summaryText,
      whatHappened,
      executionAnalysis,
      slippageAnalysis,
      timingAnalysis,
      rejectionAnalysis,
      positionLifecycle,
      anomalies,
      evidence: evidenceList,
      limitations
    };

    return JSON.stringify(reportObj, null, 2);
  }

  private generateMockAiResponse(context: AiAnalysisContext): string {
    const normalized = this.normalizeContext(context);
    const { identity, symbol, action, volume, deterministicFacts, events } = normalized;
    const { login, ticketId } = identity;
    const { entry, exit, summary, entries, exits } = deterministicFacts;
    
    const isRejected = entry?.rejection?.isRejected || false;
    const isNormal = entry?.isNormal ?? true;
    const hasSlippage = entry?.slippagePoints !== null && entry?.slippagePoints !== undefined && entry.slippagePoints > 0;
    const hasRequote = entry?.totalObservableExecutionTimeMs !== null && entry?.totalObservableExecutionTimeMs !== undefined && entry.totalObservableExecutionTimeMs > 1000;
    const isSlowDealer = entry?.executionRequestDelayMs !== null && entry?.executionRequestDelayMs !== undefined && entry.executionRequestDelayMs > 1000;

    let statusVal: AiAnalysisResult['outcome']['status'] = 'INCOMPLETE';
    if (isRejected) statusVal = 'REJECTED';
    else if (entry?.status === 'INCOMPLETE') statusVal = 'INCOMPLETE';
    else if (entry?.status === 'EXECUTED') statusVal = 'SUCCESSFUL';
    
    let confidenceVal: AiAnalysisResult['outcome']['confidence'] = 'UNKNOWN';
    if (entry?.totalObservableExecutionTimeMs !== null && entry?.totalObservableExecutionTimeMs !== undefined) {
      confidenceVal = 'HIGH';
    } else if (events.length > 1) {
      confidenceVal = 'MEDIUM';
    } else {
      confidenceVal = 'LOW';
    }

    const entryLegs = entries || [];
    const exitLegs = exits || [];

    const formatPrice = (val: any) => (val !== null && val !== undefined ? val.toFixed(5) : 'NOT OBSERVABLE');
    const formatMs = (val: any) => (val !== null && val !== undefined ? `${val.toFixed(0)} ms` : 'NOT OBSERVABLE');

    let summaryText = `Client ${login} submitted a ${volume} Lot ${action} on ${symbol} (Ticket #${ticketId}). `;
    let whatHappened: string[] = [
      `Client ${login} submitted a ${action} request for ${volume} Lot ${symbol}.`
    ];
    let executionAnalysis = {
      entry: `Requested: ${formatPrice(entry?.priceRequested)}. Executed: ${formatPrice(entry?.priceExecuted)}.`,
      exit: exitLegs[0] ? `Requested: ${formatPrice(exitLegs[0].priceRequested)}. Executed: ${formatPrice(exitLegs[0].priceExecuted)}.` : 'NOT_OBSERVABLE',
      reversal: 'NOT_OBSERVABLE'
    };
    let slippageAnalysis = {
      summary: `Slippage: ${entry?.slippagePoints || 0} points (${entry?.slippageType || 'Zero'}).`,
      legs: [
        {
          leg: 'ENTRY' as const,
          requestedPrice: formatPrice(entry?.priceRequested),
          executedPrice: formatPrice(entry?.priceExecuted),
          slippagePoints: entry?.slippagePoints !== null && entry?.slippagePoints !== undefined ? String(entry.slippagePoints) : 'NOT_OBSERVABLE',
          classification: entry?.slippageType ? entry.slippageType.toUpperCase() as any : 'NOT_OBSERVABLE'
        },
        ...(exitLegs[0] ? [{
          leg: 'EXIT' as const,
          requestedPrice: formatPrice(exitLegs[0].priceRequested),
          executedPrice: formatPrice(exitLegs[0].priceExecuted),
          slippagePoints: exitLegs[0].slippagePoints !== null && exitLegs[0].slippagePoints !== undefined ? String(exitLegs[0].slippagePoints) : 'NOT_OBSERVABLE',
          classification: exitLegs[0].slippageType ? exitLegs[0].slippageType.toUpperCase() as any : 'NOT_OBSERVABLE'
        }] : [])
      ],
      tradeLevelConclusion: summary?.netSlippage?.slippagePoints !== null && summary?.netSlippage?.slippagePoints !== undefined
        ? `Overall trade-level slippage is ${summary.netSlippage.slippagePoints} points ${summary.netSlippage.slippageType}.`
        : 'NOT_OBSERVABLE'
    };
    let timingSummary = `Open execution time: ${entry?.totalObservableExecutionTimeMs != null ? `${entry.totalObservableExecutionTimeMs} ms` : 'N/A'}`;
    if (exitLegs[0]) {
      timingSummary += `, and Close execution time: ${exitLegs[0].totalObservableExecutionTimeMs != null ? `${exitLegs[0].totalObservableExecutionTimeMs} ms` : 'N/A'}`;
    } else {
      timingSummary += `, and Close execution time: N/A`;
    }
    const formatLegMs = (v1: any, v2?: any) => {
      const s1 = (v1 !== null && v1 !== undefined) ? `${v1.toFixed(0)} ms` : 'NOT OBSERVABLE';
      if (exitLegs[0]) {
        const s2 = (v2 !== null && v2 !== undefined) ? `${v2.toFixed(0)} ms` : 'NOT OBSERVABLE';
        return `${s1} / ${s2}`;
      }
      return s1;
    };
    let timingAnalysis = {
      summary: timingSummary,
      routingDelay: formatLegMs(entry?.routingDelayMs, exitLegs[0]?.routingDelayMs),
      executionDelay: formatLegMs(entry?.executionRequestDelayMs, exitLegs[0]?.executionRequestDelayMs),
      dealerResponseTime: formatLegMs(entry?.dealerBridgeResponseTimeMs, exitLegs[0]?.dealerBridgeResponseTimeMs),
      quality: (entry?.totalObservableExecutionTimeMs !== null && entry?.totalObservableExecutionTimeMs !== undefined) ? ('KNOWN' as const) : ('NOT_OBSERVABLE' as const)
    };
    let rejectionAnalysis: AiAnalysisResult['rejectionAnalysis'] = null;
    let positionLifecycle = [`Position opened.`];
    const anomalies: string[] = [];
    const limitations: string[] = [];
    const evidenceList: AiAnalysisResult['evidence'] = [];

    events.forEach((ev) => {
      evidenceList.push({
        timestamp: ev.timestamp,
        event: ev.eventType,
        explanation: ev.rawMessage || `Log state change: ${ev.eventType}`
      });
    });

    if (isRejected) {
      const rej = entry!.rejection!;
      summaryText = `The ${action} order for ${volume} Lot ${symbol} was rejected before execution.`;
      whatHappened.push(`The request was routed but ultimately rejected by ${rej.rejectedBy} due to: "${rej.reason}".`);
      rejectionAnalysis = {
        isRejected: true,
        stage: rej.failedStage || 'Unknown',
        reason: rej.reason || 'REJECTED',
        retcode: rej.rawReason ? (rej.rawReason.match(/retcode\s*[:#\s]*(\d+)/i)?.[1] || '10014') : '10014',
        source: rej.rejectedBy === 'MT5 Server' ? 'SERVER' : (rej.rejectedBy === 'Desk' ? 'DEALER' : 'UNKNOWN')
      };
      positionLifecycle = [`Order request was rejected at entry. No position opened.`];
    } else {
      whatHappened.push(`Order approved and executed as Deal #${entry?.dealId}.`);
      if (hasSlippage) {
        slippageAnalysis.summary += ` Slippage was classified as ${entry.slippageType}.`;
      }
      if (hasRequote) {
        anomalies.push(`Manual dealer requote sequence observed.`);
      }
      if (isSlowDealer) {
        anomalies.push(`Execution request was delayed in manual dealer queue.`);
      }
      if (exitLegs.length > 0) {
        positionLifecycle.push(`Position closed.`);
      }
    }

    const reportObj: AiAnalysisResult = {
      outcome: {
        status: statusVal,
        confidence: confidenceVal
      },
      executiveSummary: summaryText,
      whatHappened,
      executionAnalysis,
      slippageAnalysis,
      timingAnalysis,
      rejectionAnalysis,
      positionLifecycle,
      anomalies,
      evidence: evidenceList,
      limitations
    };

    return JSON.stringify(reportObj, null, 2);
  }
}
