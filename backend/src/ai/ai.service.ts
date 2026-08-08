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
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY') || null;
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
    if (!this.apiKey || this.apiKey === 'your-openai-api-key') {
      this.logger.warn('OPENAI_API_KEY is missing or configured as default template. Serving simulated AI report.');
      await new Promise((resolve) => setTimeout(resolve, 1500)); // simulated latency
      return this.generateMockAiResponse(login, ticketId, symbol, action, volume, metrics);
    }

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // cost-efficient, fast, and highly capable model
          messages: [
            {
              role: 'system',
              content: 'You are MT5 AI Journal Analyzer, a senior broker operations compliance investigator. Provide detailed analysis strictly backed by metrics. Never invent facts.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1, // very low temperature to ensure strict adherence to evidence
        }),
      });

      if (!res.ok) {
        const errBody = await res.json();
        throw new Error(errBody.error?.message || 'OpenAI completion error');
      }

      const body = await res.json();
      return body.choices[0].message.content;
    } catch (error: any) {
      this.logger.error('Failed to contact OpenAI API completions', error);
      throw new InternalServerErrorException(`AI Analysis service failed: ${error.message}`);
    }
  }

  // Conducts follow-up chats in investigation contexts
  async followUpChat(
    reportText: string,
    previousChatHistory: { role: 'user' | 'assistant'; content: string }[],
    userQuestion: string,
  ): Promise<string> {
    if (!this.apiKey || this.apiKey === 'your-openai-api-key') {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return `[Mock AI Response] This is a follow-up answer explaining details about the trade incident logs. (Install a valid OpenAI Key in your environments to enable live follow-up queries)`;
    }

    const messages = [
      {
        role: 'system' as const,
        content: 'You are MT5 AI Journal Analyzer. Answer questions about the trade dispute based ONLY on the analysis report details. If the answer cannot be inferred, state that logs do not contain that details.',
      },
      {
        role: 'user' as const,
        content: `Here is the investigation report of the trade dispute:\n\n${reportText}`,
      },
      ...previousChatHistory,
      {
        role: 'user' as const,
        content: userQuestion,
      },
    ];

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          temperature: 0.2,
        }),
      });

      if (!res.ok) {
        throw new Error('OpenAI communication failed');
      }

      const body = await res.json();
      return body.choices[0].message.content;
    } catch (error: any) {
      throw new InternalServerErrorException('AI Chat follow-up failed');
    }
  }

  // Generates hash from prompt to cache results
  generatePromptHash(ticketId: string, metrics: CalculatedMetrics): string {
    const payload = `${ticketId}:${metrics.executionLatencyMs}:${metrics.slippagePips}:${metrics.requoteCount}`;
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
- Total Execution Duration: ${metrics.executionLatencyMs} ms
- Dealer Queuing Delay: ${metrics.dealerLatencyMs} ms
- Execution Slippage: ${metrics.slippagePips} pips (Price delta: ${metrics.priceDelta})
- Requotes Count: ${metrics.requoteCount}
- Retries Count: ${metrics.retryCount}
- Manual Dealer ID: ${metrics.dealerId || 'N/A'}

Normalized Log Timeline:
${eventsFormatted}

Analyze what occurred during this trade cycle. Identify if this is a Client, Dealer, Server, or Liquidity/Slippage issue.

You MUST write your report using Markdown, strictly formatted with the following headers:
### Summary
(High-level operational overview of the transaction)

### Root Cause
(Detailed cause: e.g. dealer latency, market volatility slippage, manual dealer requotes)

### Evidence
(Bulleted list referencing timestamps, raw log outputs, and calculated metrics)

### Recommendation
(Actions for support/risk desk: e.g., credit client's balance, reject claim because slippage matches quotes, check dealer performance)

### Confidence
[Low/Medium/High] with a one-sentence rationale.
`;
  }

  private generateMockAiResponse(
    login: string,
    ticketId: string,
    symbol: string,
    action: string,
    volume: number,
    metrics: CalculatedMetrics,
  ): string {
    const isNormal = metrics.isNormal;
    const hasSlippage = metrics.slippagePips > 0;
    const hasRequote = metrics.hasRequote;
    const isSlowDealer = metrics.dealerLatencyMs > 1000;

    let summary = `Client ${login} executed a ${volume} Lot ${action} on ${symbol} (Ticket #${ticketId}). `;
    let rootCause = '';
    let evidence = '';
    let recommendation = '';
    let confidence = '### Confidence\nHigh. Simulated metrics show clear chronological milestones.';

    if (isNormal) {
      summary += 'Execution was normal, fast, and completed without slippage.';
      rootCause = 'No issue identified. Order was processed within limits.';
      evidence = `- Total Latency: ${metrics.executionLatencyMs} ms (below standard 300ms threshold)\n- Slippage: 0.0 pips\n- Requotes: 0`;
      recommendation = 'Close investigation. Inform client execution was normal.';
    } else if (hasRequote) {
      summary += `Order experienced delays due to manual dealer requotes.`;
      rootCause = `Manual dealer #${metrics.dealerId} rejected the initial request at market, issuing a requote. The trade was delayed until the client accepted the price change.`;
      evidence = `- Requote Count: ${metrics.requoteCount}\n- Total Latency: ${metrics.executionLatencyMs} ms\n- Dealer queue delay: ${metrics.dealerLatencyMs} ms`;
      recommendation = `Inform client that delays were due to requotes issued by dealer desk during price changes. Re-evaluate manual dealer #${metrics.dealerId} execution speeds.`;
    } else if (isSlowDealer) {
      summary += 'Execution took significant time due to dealer queue delay.';
      rootCause = `The order sat in the manual dealer queue for ${metrics.dealerLatencyMs} ms before dealer #${metrics.dealerId} accepted it.`;
      evidence = `- Total execution: ${metrics.executionLatencyMs} ms\n- Dealer latency: ${metrics.dealerLatencyMs} ms\n- Executed by: Dealer #${metrics.dealerId}`;
      recommendation = `Apologize to client for queue delays. Review dealer #${metrics.dealerId} performance parameters.`;
    } else if (hasSlippage) {
      summary += `Client trade experienced negative slippage of ${metrics.slippagePips} pips.`;
      rootCause = `Market volatility slippage. The order was processed, but the price shifted between submission and dealer execution, resulting in execution at a worse price.`;
      evidence = `- Slippage: +${metrics.slippagePips} pips\n- Execution latency: ${metrics.executionLatencyMs} ms\n- Price delta: ${metrics.priceDelta}`;
      recommendation = `Verify feed logs for quotes at execution timestamp. If quotes match, reject claim as normal market slippage.`;
    } else {
      summary += 'Execution latency was high.';
      rootCause = 'Server load or network delay between MT5 server and connector service.';
      evidence = `- Total execution delay: ${metrics.executionLatencyMs} ms`;
      recommendation = 'Investigate server connection latency statistics.';
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
