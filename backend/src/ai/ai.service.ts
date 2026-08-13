import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalculatedMetrics } from '../metrics/metrics.service';
import { NormalizedEvent } from '../journal/normalization.engine';
import * as crypto from 'crypto';

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');
  private readonly apiKey: string | null;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || null;
  }

  // Generates a structured analysis report
  async generateAnalysis(
    login: string,
    ticketId: string,
    symbol: string,
    action: string,
    volume: number,
    metrics: CalculatedMetrics,
    events: NormalizedEvent[],
  ): Promise<string> {
    const prompt = this.compileAnalysisPrompt(login, ticketId, symbol, action, volume, metrics, events);

    // If API Key is missing, return a detailed mock AI response reflecting the exact dispute metrics
    if (!this.apiKey || this.apiKey === 'your-gemini-api-key') {
      this.logger.warn('GEMINI_API_KEY is missing or configured as default template. Serving simulated AI report.');
      await new Promise((resolve) => setTimeout(resolve, 1500)); // simulated latency
      const mockReport = this.generateMockAiResponse(login, ticketId, symbol, action, volume, metrics);
      const validation = this.validateAiReport(mockReport, metrics);
      if (!validation.isValid) {
        this.logger.warn(`Mock AI validation failed: ${validation.reason}. Falling back to deterministic report.`);
        return this.generateDeterministicFallbackReport(login, ticketId, symbol, action, volume, metrics);
      }
      return mockReport;
    }

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${this.apiKey}`, {
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
      
      const validation = this.validateAiReport(rawText, metrics);
      if (!validation.isValid) {
        this.logger.warn(`AI validation failed: ${validation.reason}. Falling back to deterministic report.`);
        return this.generateDeterministicFallbackReport(login, ticketId, symbol, action, volume, metrics);
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
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${this.apiKey}`, {
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
  generatePromptHash(ticketId: string, metrics: CalculatedMetrics): string {
    const payload = `${ticketId}:${metrics.totalObservableExecutionTimeMs}:${metrics.slippagePoints}:0`;
    return crypto.createHash('md5').update(payload).digest('hex');
  }

  private compileAnalysisPrompt(
    login: string,
    ticketId: string,
    symbol: string,
    action: string,
    volume: number,
    metrics: CalculatedMetrics,
    events: NormalizedEvent[],
  ): string {
    const eventsFormatted = events
      .map((e) => `[${e.timestamp}] ${e.eventType}: ${e.rawMessage}`)
      .join('\n');

    return `
Analyze the following trade execution incident retrieved from MT5 Server Logs:

Client Login ID: ${login}
Order Ticket ID: ${ticketId}
Symbol: ${symbol}
Action: ${action}
Volume: ${volume} Lot(s)

Deterministic Metrics:
- Trade Status: ${metrics.status}
- Total Observable Execution Time: ${metrics.totalObservableExecutionTimeMs !== null ? `${metrics.totalObservableExecutionTimeMs} ms` : 'N/A'}
- Routing Delay: ${metrics.routingDelayMs !== null ? `${metrics.routingDelayMs} ms` : 'N/A'}
- Execution Request Delay: ${metrics.executionRequestDelayMs !== null ? `${metrics.executionRequestDelayMs} ms` : 'N/A'}
- Execution Processing: ${metrics.executionProcessingMs !== null ? `${metrics.executionProcessingMs} ms` : 'N/A'}
- Execution Slippage: ${metrics.slippagePoints !== null ? `${metrics.slippagePoints} points` : 'N/A'} (Price delta: ${metrics.priceDelta})
- Rejection Reason: ${metrics.rejection?.reason || 'N/A'}
- Rejected By: ${metrics.rejection?.rejectedBy || 'N/A'}
- Failed Stage: ${metrics.rejection?.failedStage || 'N/A'}

Normalized Log Timeline:
${eventsFormatted}

Analyze what occurred during this trade cycle. Identify if this is a Client, Dealer, Server, or Liquidity/Slippage issue.

CRITICAL RULES:
1. The AI explanation must never contradict the deterministic trade status of ${metrics.status}.
2. Do not calculate or assert execution latency or slippage unless they are explicitly present as numbers above. If they are N/A, state that they are undetermined or not applicable.
3. Never label rejection latency as execution latency.
4. Do not invent root causes (like "server load" or "network issues") unless they are directly supported by the logs. If the logs are silent, state that the cause is indeterminate.

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

  validateAiReport(reportText: string, metrics: CalculatedMetrics): { isValid: boolean; reason?: string } {
    const isRejected = metrics.rejection?.isRejected || false;
    const reportLower = reportText.toLowerCase();

    if (isRejected) {
      if (reportLower.includes('executed successfully') || reportLower.includes('execution was normal')) {
        return { isValid: false, reason: 'AI claimed successful execution for a rejected trade' };
      }
    }

    if (metrics.totalObservableExecutionTimeMs === null) {
      const claimsExecutionLatency = /execution latency|total execution|execution duration/i.test(reportText) && !/n\/a|not applicable|no execution/i.test(reportText);
      if (claimsExecutionLatency) {
        return { isValid: false, reason: 'AI asserted execution latency when execution did not occur' };
      }
    }

    if (metrics.slippagePoints === null) {
      const claimsSlippage = /slippage of|slippage is/i.test(reportText) && !/n\/a|not applicable|no execution/i.test(reportText);
      if (claimsSlippage) {
        return { isValid: false, reason: 'AI asserted slippage metrics when execution did not occur' };
      }
    }

    if (isRejected && !metrics.rejection?.rawReason) {
      const inventsServerLoad = /server load|network delay|network issues/i.test(reportText);
      if (inventsServerLoad) {
        return { isValid: false, reason: 'AI invented root causes when no explicit log reason was present' };
      }
    }

    return { isValid: true };
  }

  generateDeterministicFallbackReport(
    login: string,
    ticketId: string,
    symbol: string,
    action: string,
    volume: number,
    metrics: CalculatedMetrics,
  ): string {
    const isRejected = metrics.rejection?.isRejected || false;
    let summary = '';
    let rootCause = '';
    let evidence = '';
    let recommendation = '';

    if (isRejected) {
      const rej = metrics.rejection!;
      summary = `Trade request by Client #${login} for ${volume} Lot ${symbol} was rejected.`;
      rootCause = `Rejection occurred during the "${rej.failedStage}" stage by ${rej.rejectedBy}.`;
      evidence = `- Status: REJECTED\n- Reason: ${rej.reason}\n- Raw Reason: ${rej.rawReason || 'N/A'}\n- Rejection Latency: ${metrics.totalObservableExecutionTimeMs ?? 'N/A'} ms`;
      recommendation = `Review ${rej.failedStage} parameters and client margin limits.`;
    } else if (metrics.status === 'INCOMPLETE') {
      summary = `Trade request by Client #${login} for ${volume} Lot ${symbol} was not completed.`;
      rootCause = `The log sequence terminated abruptly with no execution or rejection event.`;
      evidence = `- Status: INCOMPLETE\n- Execution Latency: N/A\n- Slippage: N/A`;
      recommendation = `Verify server logs to check if the request was routed successfully.`;
    } else {
      summary = `Trade request by Client #${login} for ${volume} Lot ${symbol} was successfully executed.`;
      rootCause = `The order was filled normally.`;
      evidence = `- Status: EXECUTED\n- Total Observable Execution Time: ${metrics.totalObservableExecutionTimeMs} ms\n- Slippage: ${metrics.slippagePoints !== null ? `${metrics.slippagePoints} points` : 'N/A'}\n- Routing Delay: ${metrics.routingDelayMs !== null ? `${metrics.routingDelayMs} ms` : 'N/A'}`;
      recommendation = `Close investigation case file. No further action is required.`;
    }

    return `### Summary
${summary}

### Root Cause
${rootCause}

### Evidence
${evidence}

### Recommendation
${recommendation}

### Confidence
High. Generated deterministically from raw journal logs.`;
  }

  private generateMockAiResponse(
    login: string,
    ticketId: string,
    symbol: string,
    action: string,
    volume: number,
    metrics: CalculatedMetrics,
  ): string {
    const isRejected = metrics.rejection?.isRejected || false;
    const isNormal = metrics.isNormal;
    const hasSlippage = metrics.slippagePoints !== null && metrics.slippagePoints > 0;
    const hasRequote = metrics.totalObservableExecutionTimeMs !== null && metrics.totalObservableExecutionTimeMs > 1000;
    const isSlowDealer = metrics.executionRequestDelayMs !== null && metrics.executionRequestDelayMs > 1000;

    let summary = `Client ${login} submitted a ${volume} Lot ${action} on ${symbol} (Ticket #${ticketId}). `;
    let rootCause = '';
    let evidence = '';
    let recommendation = '';
    let confidence = '### Confidence\nHigh. Simulated metrics show clear chronological milestones.';

    if (isRejected) {
      const rej = metrics.rejection!;
      summary = `Client ${login} placed a ${volume} Lot ${action} on ${symbol} (Ticket #${ticketId}), which was REJECTED. `;
      rootCause = `The trade request failed during the "${rej.failedStage}" stage. It was rejected by ${rej.rejectedBy} due to: "${rej.reason}".`;
      evidence = `- Rejection Stage: ${rej.failedStage}\n- Rejected By: ${rej.rejectedBy}\n- Mapped Reason: ${rej.reason}\n- Raw Log Reason: ${rej.rawReason || 'N/A'}\n- Latency to rejection: ${metrics.totalObservableExecutionTimeMs || 'N/A'} ms`;
      recommendation = `Inform the client that their trade was rejected due to ${(rej.reason || 'unknown reason').toLowerCase()}. No credit or adjustment is required.`;
    } else if (metrics.status === 'INCOMPLETE') {
      summary = `Client ${login} submitted a ${volume} Lot ${action} on ${symbol} (Ticket #${ticketId}), which remains incomplete.`;
      rootCause = `The transaction shows submission but no subsequent server execution or rejection events.`;
      evidence = `- Status: INCOMPLETE\n- Submission Price: ${metrics.priceRequested}\n- Completed Events: REQUEST`;
      recommendation = `Investigate connection stability between bridge gateways and MT5 administrator terminal.`;
    } else if (isNormal) {
      summary += 'Execution was normal, fast, and completed without slippage.';
      rootCause = 'No issue identified. Order was processed within limits.';
      evidence = `- Total Latency: ${metrics.totalObservableExecutionTimeMs} ms (below standard 300ms threshold)\n- Slippage: 0.0 points\n- Requotes: 0`;
      recommendation = 'Close investigation. Inform client execution was normal.';
    } else if (hasRequote) {
      summary += `Order experienced delays due to manual dealer requotes.`;
      rootCause = `Manual dealer rejected the initial request at market, issuing a requote. The trade was delayed until the client accepted the price change.`;
      evidence = `- Requote Count: 1\n- Total Latency: ${metrics.totalObservableExecutionTimeMs} ms\n- Dealer queue delay: ${metrics.executionRequestDelayMs || 0} ms`;
      recommendation = `Inform client that delays were due to requotes issued by dealer desk during price changes.`;
    } else if (isSlowDealer) {
      summary += 'Execution took significant time due to dealer queue delay.';
      rootCause = `The order sat in the manual dealer queue for ${metrics.executionRequestDelayMs} ms before being accepted.`;
      evidence = `- Total execution: ${metrics.totalObservableExecutionTimeMs} ms\n- Dealer latency: ${metrics.executionRequestDelayMs} ms`;
      recommendation = `Apologize to client for queue delays.`;
    } else if (hasSlippage) {
      summary += `Client trade experienced negative slippage of ${metrics.slippagePoints} points.`;
      rootCause = `Market volatility slippage. The order was processed, but the price shifted between submission and execution, resulting in execution at a worse price.`;
      evidence = `- Slippage: +${metrics.slippagePoints} points\n- Execution latency: ${metrics.totalObservableExecutionTimeMs} ms\n- Price delta: ${metrics.priceDelta}`;
      recommendation = `Verify feed logs for quotes at execution timestamp. If quotes match, reject claim as normal market slippage.`;
    } else {
      summary += 'Execution was completed.';
      rootCause = 'Order execution occurred normally.';
      evidence = `- Total Observable Execution Time: ${metrics.totalObservableExecutionTimeMs !== null ? `${metrics.totalObservableExecutionTimeMs} ms` : 'N/A'}`;
      recommendation = 'Close investigation.';
    }

    return `### Summary
${summary}

### Root Cause
${rootCause}

### Evidence
${evidence}

### Recommendation
${recommendation}

${confidence}`;
  }
}
