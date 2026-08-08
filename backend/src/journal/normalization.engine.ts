import { Injectable, Logger } from '@nestjs/common';

function parseTimestamp(ts: string): string {
  let datePart = ts.slice(0, 10);
  const timePart = ts.slice(10);
  datePart = datePart.replace(/\./g, '-');
  let clean = (datePart + timePart).replace(' ', 'T');
  if (!clean.endsWith('Z')) {
    clean += 'Z';
  }
  return clean;
}

export interface NormalizedEvent {
  timestamp: string;
  eventType:
    | 'ORDER_SUBMITTED'
    | 'ORDER_ACCEPTED_SERVER'
    | 'ORDER_ROUTED'
    | 'DEALER_ACCEPTED'
    | 'DEALER_REQUOTED'
    | 'REQUOTE_ACCEPTED'
    | 'ORDER_EXECUTED'
    | 'ORDER_REJECTED'
    | 'DEALER_REJECTED';
  rawMessage: string;
  login: string;
  metadata: {
    ticket?: string;
    symbol?: string;
    action?: 'BUY' | 'SELL';
    volume?: number;
    priceRequested?: number;
    priceExecuted?: number;
    dealerId?: string;
    requotePrice?: number;
    orderId?: string;
    dealId?: string;
    rawReason?: string;
  };
}

@Injectable()
export class NormalizationEngine {
  private readonly logger = new Logger('NormalizationEngine');

  private readonly patterns = [
    // Real order placed: [Trade] '1001': order placed for execution for '910102' [#670 buy 0.01 XAUUSD.s at 4349.26]
    {
      type: 'ORDER_SUBMITTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+.*'(\d+)':\s+order\s+placed\s+for\s+execution\s+for\s+'(\d+)'\s+\[#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[3],
        metadata: {
          orderId: match[4],
          action: match[5].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[6]),
          symbol: match[7],
          priceRequested: parseFloat(match[8]),
        },
      }),
    },
    // Real deal performed: [Trade] Centroid Gateway '910102': deal performed [#712 buy 0.01 XAUUSD.s at 4349.36]
    {
      type: 'ORDER_EXECUTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+(?:.*?\s+)?'(\d+)':\s+deal\s+performed\s+\[#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          dealId: match[3],
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          priceExecuted: parseFloat(match[7]),
        },
      }),
    },
    // Real order performed: [Trade] Centroid Gateway '910102': order performed buy 0.01 at 4349.36 [#670 buy 0.01 XAUUSD.s at 4349.26]
    {
      type: 'ORDER_EXECUTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+(?:.*?\s+)?'(\d+)':\s+order\s+performed\s+(buy|sell)\s+([\d\.]+)\s+at\s+([\d\.]+)\s+\[#(\d+)\s+(?:buy|sell)\s+[\d\.]+\s+[\w\.-]+\s+at\s+([\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          orderId: match[6],
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          priceExecuted: parseFloat(match[5]),
          priceRequested: parseFloat(match[7]),
        },
      }),
    },
    // 1. Submitted: [Trade] 'login': market (buy/sell) volume symbol (requested at price)
    {
      type: 'ORDER_SUBMITTED' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Trade\]\s+'(\d+)':\s+market\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+\(requested\s+at\s+([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: match[2],
        metadata: {
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          symbol: match[5],
          priceRequested: parseFloat(match[6]),
        },
      }),
    },
    // 2. Server accepted: [Trade] 'login': request accepted by server
    {
      type: 'ORDER_ACCEPTED_SERVER' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Trade\]\s+'(\d+)':\s+request\s+accepted\s+by\s+server/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: match[2],
        metadata: {},
      }),
    },
    // 3. Routed: [Trade] 'login': request transferred to dealers
    {
      type: 'ORDER_ROUTED' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Trade\]\s+'(\d+)':\s+request\s+transferred\s+to\s+dealers/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: match[2],
        metadata: {},
      }),
    },
    // 4. Dealer accepted: [Dealer] dealer #ID accepted market (buy/sell) volume symbol at price
    {
      type: 'DEALER_ACCEPTED' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Dealer\]\s+dealer\s+#(\d+)\s+accepted\s+market\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: '', // will be correlated in next step
        metadata: {
          dealerId: match[2],
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          symbol: match[5],
          priceExecuted: parseFloat(match[6]),
        },
      }),
    },
    // 5. Dealer requoted: [Dealer] dealer #ID rejected (buy/sell) volume symbol at price (requote price)
    {
      type: 'DEALER_REQUOTED' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Dealer\]\s+dealer\s+#(\d+)\s+rejected\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\s+\(requote\s+([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: '',
        metadata: {
          dealerId: match[2],
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          symbol: match[5],
          priceRequested: parseFloat(match[6]),
          requotePrice: parseFloat(match[7]),
        },
      }),
    },
    // 6. Client requote accepted: [Trade] 'login': client accepted requote price
    {
      type: 'REQUOTE_ACCEPTED' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Trade\]\s+'(\d+)':\s+client\s+accepted\s+requote\s+([\d\.]+)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: match[2],
        metadata: {
          requotePrice: parseFloat(match[3]),
        },
      }),
    },
    // 7. Order executed: [Trade] 'login': deal performed #ticket (buy/sell) volume symbol at price
    {
      type: 'ORDER_EXECUTED' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Trade\]\s+'(\d+)':\s+deal\s+performed\s+#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: match[2],
        metadata: {
          ticket: match[3],
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          priceExecuted: parseFloat(match[7]),
        },
      }),
    },
    // 8. Order rejected: [Trade] 'login': request rejected: reason
    {
      type: 'ORDER_REJECTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+request\s+rejected:\s+(.+)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          rawReason: match[3].trim(),
        },
      }),
    },
    // 9. Dealer rejected: [Dealer] dealer #ID rejected buy/sell volume symbol at price (rejection)
    {
      type: 'DEALER_REJECTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Dealer\]\s+dealer\s+#(\d+)\s+rejected\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\s+\((.+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: '',
        metadata: {
          dealerId: match[2],
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          symbol: match[5],
          priceRequested: parseFloat(match[6]),
          rawReason: match[7].trim(),
        },
      }),
    },
    // 10. Direct execution rejection: [Trade] 'login': order #ID buy/sell volume symbol at price rejected due execution [reason]
    {
      type: 'ORDER_REJECTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+order\s+#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\s+rejected\s+due\s+execution\s+\[(.+?)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          orderId: match[3],
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          priceRequested: parseFloat(match[7]),
          rawReason: match[8].trim(),
        },
      }),
    },
    // 11. Margin rejection: [Trade] 'login': not enough money [market buy/sell volume symbol]
    {
      type: 'ORDER_REJECTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+not\s+enough\s+money\s+\[market\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          symbol: match[5],
          rawReason: 'Not enough money',
        },
      }),
    },
  ];

  normalize(rawLine: string): NormalizedEvent | null {
    for (const pattern of this.patterns) {
      const match = rawLine.match(pattern.regex);
      if (match) {
        const parsed = pattern.parse(match);
        return {
          timestamp: parsed.timestamp,
          eventType: pattern.type,
          rawMessage: rawLine,
          login: parsed.login,
          metadata: parsed.metadata,
        };
      }
    }
    
    this.logger.debug(`Log line skipped normalization (no pattern match): "${rawLine}"`);
    return null;
  }
}
