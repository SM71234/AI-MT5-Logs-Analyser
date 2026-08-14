import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalculatedMetrics } from '../metrics/metrics.service';
import { NormalizedEvent } from '../journal/normalization.engine';
import * as crypto from 'crypto';

export interface AiAnalysisContext {
  login: string;
  ticketId: string;
  symbol: string;
  action: string;
  volume: number;
  entry: CalculatedMetrics | null;
  exit: CalculatedMetrics | null;
  summary: any | null;
  events: NormalizedEvent[];
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

  // Generates a structured analysis report
  async generateAnalysis(context: AiAnalysisContext): Promise<string> {
    const prompt = this.compileAnalysisPrompt(context);

    // If API Key is missing, return a detailed mock AI response reflecting the exact dispute metrics
    if (!this.apiKey || this.apiKey === 'your-gemini-api-key') {
      this.logger.warn('GEMINI_API_KEY is missing or configured as default template. Serving simulated AI report.');
      await new Promise((resolve) => setTimeout(resolve, 1500)); // simulated latency
      const mockReport = this.generateMockAiResponse(context);
      const validation = this.validateAiReport(mockReport, context.entry);
      if (!validation.isValid) {
        this.logger.warn(`Mock AI validation failed: ${validation.reason}. Falling back to deterministic report.`);
        return this.generateDeterministicFallbackReport(context);
      }
      return mockReport;
    }

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
                text: 'You are MT5 AI Journal Analyzer, a senior broker operations compliance investigator. Provide detailed analysis strictly backed by metrics. Never invent facts.',
              },
            ],
          },
          generationConfig: {
            temperature: 0.1,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error: ${errText}`);
      }

      const body = await res.json();
      const rawText = body.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      const validation = this.validateAiReport(rawText, context.entry);
      if (!validation.isValid) {
        this.logger.warn(`AI validation failed: ${validation.reason}. Falling back to deterministic report.`);
        return this.generateDeterministicFallbackReport(context);
      }
      return rawText;
    } catch (error: any) {
      this.logger.error('Failed to contact Gemini API completions', error);
      throw new InternalServerErrorException(`AI Analysis service failed: ${error.message}`);
    }
  }

  // Conducts follow-up chats in investigation contexts
  async followUpChat(
    reportText: string,
    canonicalResult: any,
    previousChatHistory: { role: 'user' | 'assistant'; content: string }[],
    userQuestion: string,
  ): Promise<string> {
    if (!this.apiKey || this.apiKey === 'your-gemini-api-key') {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const status = canonicalResult?.status || 'UNKNOWN';
      const isRejected = canonicalResult?.rejection?.isRejected || false;
      if (isRejected) {
        return `[Mock AI Response] The trade status is deterministically ${status}. It was rejected by ${canonicalResult.rejection.rejectedBy} at the "${canonicalResult.rejection.failedStage}" stage due to: "${canonicalResult.rejection.reason}". Rejection latency was ${canonicalResult.rejection.rejectionLatencyMs} ms.`;
      } else {
        return `[Mock AI Response] The trade status is deterministically ${status}. It executed successfully at price ${canonicalResult.execution?.executionPrice} with ${canonicalResult.execution?.slippagePips} pips slippage. Execution latency was ${canonicalResult.execution?.executionLatencyMs} ms.`;
      }
    }

    const systemPrompt = `You are MT5 AI Journal Analyzer, a senior compliance desk assistant. 
Answer questions about the trade dispute based ONLY on the following deterministic Canonical Result and report text.

Deterministic Canonical Result:
${JSON.stringify(canonicalResult, null, 2)}

Report Text:
${reportText}

CRITICAL RULES:
1. Do not invent, assume, or deduce parameters or events outside the provided data.
2. If the user asks about latencies, slippage, execution prices, or rejection reasons, cite the Canonical Result fields exactly.
3. If the answer cannot be determined from the provided data, state clearly: "Based on the deterministic logs, this details cannot be determined."`;

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

  // Generates hash from prompt to cache results (v2 prefix invalidates old cache formats)
  generatePromptHash(ticketId: string, entry: CalculatedMetrics | null, exit: CalculatedMetrics | null): string {
    const entryLatency = entry?.totalObservableExecutionTimeMs ?? 'N/A';
    const exitLatency = exit?.totalObservableExecutionTimeMs ?? 'N/A';
    const entrySlippage = entry?.slippagePoints ?? 'N/A';
    const exitSlippage = exit?.slippagePoints ?? 'N/A';
    
    const payload = `v2:${ticketId}:${entryLatency}:${exitLatency}:${entrySlippage}:${exitSlippage}`;
    return crypto.createHash('md5').update(payload).digest('hex');
  }

  private compileAnalysisPrompt(context: AiAnalysisContext): string {
    const { login, ticketId, symbol, action, volume, entry, exit, summary, events } = context;

    const eventsFormatted = events
      .map((e) => `[${e.timestamp}] ${e.eventType}: ${e.rawMessage}`)
      .join('\n');

    const entryPriceReq = displayValue(entry?.priceRequested);
    const entryPriceExec = displayValue(entry?.priceExecuted);
    const entrySlippage = entry?.slippagePoints != null ? `${entry.slippagePoints} points (${entry.slippageType})` : 'N/A';
    const entryLatency = entry?.totalObservableExecutionTimeMs != null ? `${entry.totalObservableExecutionTimeMs} ms` : 'N/A';
    const entryStatus = displayValue(entry?.status);
    const entryRejection = entry?.rejection?.isRejected 
      ? `Rejected by ${displayValue(entry.rejection.rejectedBy)} at stage "${displayValue(entry.rejection.failedStage)}" due to: "${displayValue(entry.rejection.reason)}"`
      : 'N/A';

    const exitPriceReq = displayValue(exit?.priceRequested);
    const exitPriceExec = displayValue(exit?.priceExecuted);
    const exitSlippage = exit?.slippagePoints != null ? `${exit.slippagePoints} points (${exit.slippageType})` : 'N/A';
    const exitLatency = exit?.totalObservableExecutionTimeMs != null ? `${exit.totalObservableExecutionTimeMs} ms` : 'N/A';
    const exitStatus = displayValue(exit?.status);

    const totalSlippage = summary?.netSlippage?.slippagePoints != null ? `${summary.netSlippage.slippagePoints} points` : 'N/A';
    const netSlippageType = displayValue(summary?.netSlippage?.slippageType);
    const totalObsTime = entry?.totalObservableExecutionTimeMs != null ? `${entry.totalObservableExecutionTimeMs} ms` : 'N/A';
    const cumulativeLatency = summary?.cumulativeLatency != null ? `${summary.cumulativeLatency} ms` : 'N/A';
    const averageLatency = summary?.averageLatency != null ? `${summary.averageLatency} ms` : 'N/A';
    const holdTime = summary?.holdTimeMs != null ? `${summary.holdTimeMs} ms` : 'N/A';

    return `
Analyze the following trade execution incident retrieved from MT5 Server Logs:

TRADE METADATA
- Login: ${login}
- Ticket ID: ${ticketId}
- Symbol: ${symbol}
- Action: ${action}
- Volume: ${volume} Lot(s)

ENTRY EXECUTION
- Entry Price Requested: ${entryPriceReq}
- Entry Price Executed: ${entryPriceExec}
- Entry Slippage: ${entrySlippage}
- Entry Latency: ${entryLatency}
- Entry Status: ${entryStatus}
- Entry Rejection Details: ${entryRejection}

EXIT EXECUTION
- Exit Price Requested: ${exitPriceReq}
- Exit Price Executed: ${exitPriceExec}
- Exit Slippage: ${exitSlippage}
- Exit Latency: ${exitLatency}
- Exit Status: ${exitStatus}

ROUND-TRIP / EXECUTION SUMMARY
- Total Slippage: ${totalSlippage}
- Net Slippage Type: ${netSlippageType}
- Total Observable Execution Time: ${totalObsTime}
- Cumulative Latency: ${cumulativeLatency}
- Average Latency: ${averageLatency}
- Hold Time: ${holdTime}

CORRELATED MT5 EVENTS:
${eventsFormatted}

Analyze what occurred during this trade cycle. Identify if this is a Client, Dealer, Server, or Liquidity/Slippage issue.

CRITICAL RULES:
1. The AI explanation must never contradict the deterministic trade status of ${entryStatus}.
2. Do not calculate or assert execution latency or slippage unless they are explicitly present as numbers above. If they are N/A, state that they are undetermined or not applicable.
3. Never label rejection latency as execution latency.
4. Do not invent root causes (like "server load" or "network issues") unless they are directly supported by the logs. If the logs are silent, state that the cause is indeterminate.
5. Address both entry-leg behavior, exit-leg behavior (where closed), and overall round-trip performance.

You MUST write your report using Markdown, strictly formatted with the following headers:
### Summary
(High-level operational overview of the transaction)

### Root Cause
(Detailed cause matching the deterministic facts)

### Evidence
(List key log lines and deterministic metrics as evidence)

### Recommendation
(Action items for compliance desk or operations desk)

### Confidence
High. Simulated metrics show clear chronological milestones.
`;
  }

  validateAiReport(reportText: string, entry: CalculatedMetrics | null): { isValid: boolean; reason?: string } {
    if (!entry) return { isValid: true };
    const isRejected = entry.rejection?.isRejected || false;
    const reportLower = reportText.toLowerCase();

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

  generateDeterministicFallbackReport(context: AiAnalysisContext): string {
    const { login, ticketId, symbol, action, volume, entry, exit, summary } = context;
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

  private generateMockAiResponse(context: AiAnalysisContext): string {
    const { login, ticketId, symbol, action, volume, entry, exit, summary } = context;
    const isRejected = entry?.rejection?.isRejected || false;
    const isNormal = entry?.isNormal ?? true;
    const hasSlippage = entry?.slippagePoints !== null && entry?.slippagePoints !== undefined && entry.slippagePoints > 0;
    const hasRequote = entry?.totalObservableExecutionTimeMs !== null && entry?.totalObservableExecutionTimeMs !== undefined && entry.totalObservableExecutionTimeMs > 1000;
    const isSlowDealer = entry?.executionRequestDelayMs !== null && entry?.executionRequestDelayMs !== undefined && entry.executionRequestDelayMs > 1000;

    let fallbackSummary = `Client ${login} submitted a ${volume} Lot ${action} on ${symbol} (Ticket #${ticketId}). `;
    let rootCause = '';
    let evidence = '';
    let recommendation = '';
    const confidence = '### Confidence\nHigh. Simulated metrics show clear chronological milestones.';

    if (isRejected) {
      const rej = entry!.rejection!;
      fallbackSummary = `Client ${login} placed a ${volume} Lot ${action} on ${symbol} (Ticket #${ticketId}), which was REJECTED. `;
      rootCause = `The trade request failed during the "${displayValue(rej.failedStage)}" stage. It was rejected by ${displayValue(rej.rejectedBy)} due to: "${displayValue(rej.reason)}".`;
      evidence = `- Rejection Stage: ${displayValue(rej.failedStage)}\n- Rejected By: ${displayValue(rej.rejectedBy)}\n- Mapped Reason: ${displayValue(rej.reason)}\n- Raw Log Reason: ${displayValue(rej.rawReason)}\n- Latency to rejection: ${entry?.totalObservableExecutionTimeMs != null ? `${entry.totalObservableExecutionTimeMs} ms` : 'N/A'}`;
      recommendation = `Inform the client that their trade was rejected due to ${displayValue(rej.reason).toLowerCase()}. No credit or adjustment is required.`;
    } else if (entry?.status === 'INCOMPLETE') {
      fallbackSummary = `Client ${login} submitted a ${volume} Lot ${action} on ${symbol} (Ticket #${ticketId}), which remains incomplete.`;
      rootCause = `The transaction shows submission but no subsequent server execution or rejection events.`;
      evidence = `- Status: INCOMPLETE\n- Submission Price: ${displayValue(entry.priceRequested)}\n- Completed Events: REQUEST`;
      recommendation = `Investigate connection stability between bridge gateways and MT5 administrator terminal.`;
    } else if (isNormal) {
      fallbackSummary += 'Execution was normal, fast, and completed without slippage.';
      rootCause = 'No issue identified. Order was processed within limits.';
      evidence = `- Total Latency: ${displayValue(entry?.totalObservableExecutionTimeMs)} ms (below standard 300ms threshold)\n- Slippage: 0.0 points\n- Requotes: 0`;
      recommendation = 'Close investigation. Inform client execution was normal.';
    } else if (hasRequote) {
      fallbackSummary += `Order experienced delays due to manual dealer requotes.`;
      rootCause = `Manual dealer rejected the initial request at market, issuing a requote. The trade was delayed until the client accepted the price change.`;
      evidence = `- Requote Count: 1\n- Total Latency: ${displayValue(entry?.totalObservableExecutionTimeMs)} ms\n- Dealer queue delay: ${displayValue(entry?.executionRequestDelayMs)} ms`;
      recommendation = `Inform client that delays were due to requotes issued by dealer desk during price changes.`;
    } else if (isSlowDealer) {
      fallbackSummary += 'Execution took significant time due to dealer queue delay.';
      rootCause = `The order sat in the manual dealer queue for ${displayValue(entry?.executionRequestDelayMs)} ms before being accepted.`;
      evidence = `- Total execution: ${displayValue(entry?.totalObservableExecutionTimeMs)} ms\n- Dealer latency: ${displayValue(entry?.executionRequestDelayMs)} ms`;
      recommendation = `Apologize to client for queue delays.`;
    } else if (hasSlippage) {
      fallbackSummary += `Client trade experienced negative slippage of ${displayValue(entry?.slippagePoints)} points.`;
      rootCause = `Market volatility slippage. The order was processed, but the price shifted between submission and execution, resulting in execution at a worse price.`;
      evidence = `- Slippage: +${displayValue(entry?.slippagePoints)} points\n- Execution latency: ${displayValue(entry?.totalObservableExecutionTimeMs)} ms\n- Price delta: ${displayValue(entry?.priceDelta)}`;
      recommendation = `Verify feed logs for quotes at execution timestamp. If quotes match, reject claim as normal market slippage.`;
    } else {
      fallbackSummary += 'Execution was completed.';
      rootCause = 'Order execution occurred normally.';
      evidence = `- Total Observable Execution Time: ${entry?.totalObservableExecutionTimeMs != null ? `${entry.totalObservableExecutionTimeMs} ms` : 'N/A'}`;
      recommendation = 'Close investigation.';
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
High. Simulated metrics show clear chronological milestones.`;
  }
}
