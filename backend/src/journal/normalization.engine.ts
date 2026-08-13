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

export type StandardEventType =
  | 'REQUEST'
  | 'ROUTED'
  | 'EXECUTION_REQUEST'
  | 'EXECUTION_RESPONSE'
  | 'DEAL_EXECUTED'
  | 'ORDER_PLACED'
  | 'ORDER_TRIGGERED'
  | 'ORDER_FILLED'
  | 'ORDER_REJECTED'
  | 'ORDER_CANCELLED';

export interface NormalizedEvent {
  timestamp: string;
  eventType: StandardEventType;
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
    rule?: string;
    requoteCount?: number;
  };
}

@Injectable()
export class NormalizationEngine {
  private readonly logger = new Logger('NormalizationEngine');

  private readonly patterns = [
    // 1. Pending order placed: [Trade] '1375': order placed [#3381804 buy stop 0.01 XAUUSD.rcnt at 4424.04], time 0.56 ms
    {
      type: 'ORDER_PLACED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+order\s+placed\s+\[#(\d+)\s+(buy\s+limit|sell\s+limit|buy\s+stop|sell\s+stop|buy\s+stop\s+limit|sell\s+stop\s+limit)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          orderId: match[3],
          action: match[4].toLowerCase().includes('buy') ? ('BUY' as const) : ('SELL' as const),
          volume: parseFloat(match[5]),
          symbol: match[6],
          priceRequested: parseFloat(match[7]),
        },
      }),
    },
    // 2. Pending order triggered: [Trade] '1375': order [#3381804 buy stop 0.01 XAUUSD.rcnt at 4424.04] triggered, activation price 4424.04 [4423.93 / 4424.04]
    {
      type: 'ORDER_TRIGGERED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+order\s+\[#(\d+)\s+(?:buy\s+limit|sell\s+limit|buy\s+stop|sell\s+stop|buy\s+stop\s+limit|sell\s+stop\s+limit)\s+[\d\.]+\s+[\w\.-]+\s+at\s+[\d\.]+\]\s+triggered/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          orderId: match[3],
        },
      }),
    },
    // 3. Direct execution request: [Trade] '259713': order placed for execution [#6943681 sell 0.01 XAGUSD.i at market], time 1.10 ms
    {
      type: 'EXECUTION_REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+order\s+placed\s+for\s+execution\s+\[#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+(market|[\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          orderId: match[3],
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          priceRequested: match[7].toLowerCase() === 'market' ? null : parseFloat(match[7]),
        },
      }),
    },
    // 4. Direct order performed response: [Trade] '259713': order performed buy 0.01 at 64.018 [#6943674 buy 0.01 XAGUSD.i at market]
    {
      type: 'EXECUTION_RESPONSE' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+order\s+performed\s+(buy|sell)\s+([\d\.]+)\s+at\s+([\d\.]+)\s+\[#(\d+)\s+(?:buy|sell)\s+[\d\.]+\s+[\w\.-]+\s+at\s+(market|[\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          orderId: match[6],
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          priceExecuted: parseFloat(match[5]),
          priceRequested: match[7].toLowerCase() === 'market' ? null : parseFloat(match[7]),
        },
      }),
    },
    // 5. Direct order filled: [Trade] '259713': order #6943674 buy 0.01 / 0.01 XAGUSD.i at market filled due execution [filled order #6943674, buy 0.01 XAGUSD.i at 64 [based on deal '2524210']]
    {
      type: 'DEAL_EXECUTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+order\s+#(\d+)\s+(buy|sell)\s+[\d\.]+\s+\/\s+[\d\.]+\s+[\w\.-]+\s+at\s+\w+\s+filled\s+due\s+execution\s+\[filled\s+order\s+#\d+,\s+(?:buy|sell)\s+[\d\.]+\s+[\w\.-]+\s+at\s+([\d\.]+)\s+\[based\s+on\s+deal\s+'(\d+)'\]\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          orderId: match[3],
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          priceExecuted: parseFloat(match[5]),
          dealId: match[6],
        },
      }),
    },
    // 6. Real deal performed (with login context): [Trade] '1001': deal performed for '259713' [#6716101 sell 0.01 XAUUSD.r at 4261.44]
    {
      type: 'DEAL_EXECUTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+.*'(\d+)':\s+deal\s+performed\s+for\s+'(\d+)'\s+\[#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[3],
        metadata: {
          dealId: match[4],
          action: match[5].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[6]),
          symbol: match[7],
          priceExecuted: parseFloat(match[8]),
        },
      }),
    },
    // 7. Close order request submitted: [Trade] '259713': market sell 0.01 XAGUSD.i, close #6943674 buy 0.01 XAGUSD.i 64.018 (63.972 / 63.997)
    {
      type: 'REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+market\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+),\s+close\s+#(\d+)\s+(?:buy|sell)\s+[\d\.]+\s+[\w\.-]+\s+[\d\.]+\s+\(([\d\.]+)\s*\/\s*([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          symbol: match[5],
          ticket: match[6],
          priceRequested: match[3].toUpperCase() === 'BUY' ? parseFloat(match[8]) : parseFloat(match[7]),
        },
      }),
    },
    // 8. Direct submission (from broker desk perspective): [Trade] '1001': for '259713' buy 0.01 XAUUSD.r at 4257.04 (4256.97 / 4257.06)
    {
      type: 'REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+.*'(\d+)':\s+for\s+'(\d+)'\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\s+\(([\d\.]+)\s*\/\s*([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[3],
        metadata: {
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          priceRequested: parseFloat(match[7]),
        },
      }),
    },
    // 9. Close order submitted (from broker desk perspective): [Trade] '1001': for '259713' sell 0.01 XAUUSD.r at 4257.11, close #6913312 buy 0.01 XAUUSD.r 4257.06 (4257.11 / 4257.20)
    {
      type: 'REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+.*'(\d+)':\s+for\s+'(\d+)'\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+),\s+close\s+#(\d+)\s+(?:buy|sell)\s+[\d\.]+\s+[\w\.-]+\s+[\d\.]+\s+\(([\d\.]+)\s*\/\s*([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[3],
        metadata: {
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          priceRequested: parseFloat(match[7]),
          ticket: match[8],
        },
      }),
    },
    // 10. Dealer confirm response: [Trade] '1085': confirm sell 0.01 XAUUSD.r at 4261.44 for '259713' (for '259713' sell 0.01 XAUUSD.r at 4261.52, close #6913228)(4261.52 / 4261.61)
    {
      type: 'EXECUTION_RESPONSE' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+.*'(\d+)':\s+confirm\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\s+for\s+'(\d+)'\s+\(for\s+'\d+'\s+(?:buy|sell)\s+[\d\.]+\s+[\w\.-]+\s+at\s+([\d\.]+)(?:,\s+close\s+#(\d+))?\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[7],
        metadata: {
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          symbol: match[5],
          priceExecuted: parseFloat(match[6]),
          priceRequested: parseFloat(match[8]),
          ticket: match[9] || undefined,
        },
      }),
    },
    // 11. Real execution request: [Trade] '1001': order placed for execution for '910102' [#670 buy 0.01 XAUUSD.s at 4349.26]
    {
      type: 'EXECUTION_REQUEST' as const,
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
    // 12. Real deal performed (Centroid/generic): [Trade] Centroid Gateway '910102': deal performed [#712 buy 0.01 XAUUSD.s at 4349.36]
    {
      type: 'DEAL_EXECUTED' as const,
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
    // 13. Real order performed: [Trade] Centroid Gateway '910102': order performed buy 0.01 at 4349.36 [#670 buy 0.01 XAUUSD.s at 4349.26]
    {
      type: 'EXECUTION_RESPONSE' as const,
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
    // 14. Client request submit format: [Trade] 'login': market buy 0.01 XAUUSD.r (requested at 4349.26)
    {
      type: 'REQUEST' as const,
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
    // 15. Server accepted: [Trade] 'login': request accepted by server
    {
      type: 'EXECUTION_RESPONSE' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Trade\]\s+'(\d+)':\s+request\s+accepted\s+by\s+server/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: match[2],
        metadata: {},
      }),
    },
    // 16. Routed: [Trade] 'login': request transferred to dealers
    {
      type: 'ROUTED' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Trade\]\s+'(\d+)':\s+request\s+transferred\s+to\s+dealers/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: match[2],
        metadata: {},
      }),
    },
    // 17. Dealer accepted request: [Dealer] dealer #ID accepted market buy/sell volume symbol at price
    {
      type: 'EXECUTION_REQUEST' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Dealer\]\s+dealer\s+#(\d+)\s+accepted\s+market\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: '',
        metadata: {
          dealerId: match[2],
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          symbol: match[5],
          priceExecuted: parseFloat(match[6]),
        },
      }),
    },
    // 18. Dealer requote: [Dealer] dealer #ID rejected buy/sell volume symbol at price (requote price)
    {
      type: 'EXECUTION_RESPONSE' as const,
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
    // 19. Client accepted requote: [Trade] 'login': client accepted requote price
    {
      type: 'REQUEST' as const,
      regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\s+\[Trade\]\s+'(\d+)':\s+client\s+accepted\s+requote\s+([\d\.]+)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: match[1],
        login: match[2],
        metadata: {
          requotePrice: parseFloat(match[3]),
        },
      }),
    },
    // 20. Executed deal (generic): [Trade] 'login': deal performed #ticket buy/sell volume symbol at price
    {
      type: 'DEAL_EXECUTED' as const,
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
    // 21. Standard order rejection: [Trade] 'login': request rejected: reason
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
    // 22. Dealer rejected request: [Dealer] dealer #ID rejected buy/sell volume symbol at price (rejection)
    {
      type: 'ORDER_REJECTED' as const,
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
    // 23. Order rejected due execution: [Trade] 'login': order #ID buy/sell volume symbol at price rejected due execution [reason]
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
    // 24. Margin rejection: [Trade] 'login': not enough money [market buy/sell volume symbol]
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
    // 25. Dealer/Server reject error: [Trade] '1': reject (Request error) for 'login' (for 'login' buy/sell volume symbol at priceRequested)
    {
      type: 'ORDER_REJECTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+reject\s+\((.+?)\)\s+for\s+'(\d+)'\s+\(for\s+'\d+'\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[4],
        metadata: {
          action: match[5].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[6]),
          symbol: match[7],
          priceRequested: parseFloat(match[8]),
          rejectedBy: `Dealer/Server #${match[2]}`,
          rawReason: match[3].trim(),
        },
      }),
    },
    // 26. Alternative Margin rejection: [Trade] '1001': not enough money on 'login' [for 'login' buy/sell volume symbol at price]
    {
      type: 'ORDER_REJECTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+not\s+enough\s+money\s+on\s+'(\d+)'\s+\[for\s+'\d+'\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[3],
        metadata: {
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          priceRequested: parseFloat(match[7]),
          rejectedBy: 'Risk Management System',
          rawReason: 'Not enough money',
        },
      }),
    },
    // 27. Order modify confirm: [Trade] '1375': modify #3381804 buy 0.01 XAUUSD.rcnt sl: 0.00, tp: 4424.54 -> sl: 0.00, tp: 4425.86 (4423.98 / 4424.09)
    {
      type: 'REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+modify\s+#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+sl:\s+([\d\.]+),\s+tp:\s+([\d\.]+)\s+->\s+sl:\s+([\d\.]+),\s+tp:\s+([\d\.]+)\s+\(([\d\.]+)\s*\/\s*([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          ticket: match[3],
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          rawReason: `Modified TP/SL parameters: SL ${match[7]} -> ${match[9]} | TP ${match[8]} -> ${match[10]}`,
        },
      }),
    },
    // 28. Order modify request: [Trade] '1': request from '1375' (modify #3381804 buy 0.01 XAUUSD.rcnt -> sl: 0.00, tp: 4425.86)
    {
      type: 'EXECUTION_REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+request\s+from\s+'(\d+)'\s+\(modify\s+#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+->\s+sl:\s+([\d\.]+),\s+tp:\s+([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[3],
        metadata: {
          ticket: match[4],
          action: match[5].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[6]),
          symbol: match[7],
          rawReason: `Requested modification: SL ${match[8]}, TP ${match[9]}`,
        },
      }),
    },
    // 29. Order modify confirm status: [Trade] '1': confirm for '1375' (modify #3381804 buy 0.01 XAUUSD.rcnt -> sl: 0.00, tp: 4425.86)(4423.98 / 4424.09)
    {
      type: 'EXECUTION_RESPONSE' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+confirm\s+for\s+'(\d+)'\s+\(modify\s+#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+->\s+sl:\s+([\d\.]+),\s+tp:\s+([\d\.]+)\)\(([\d\.]+)\s*\/\s*([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[3],
        metadata: {
          ticket: match[4],
          action: match[5].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[6]),
          symbol: match[7],
          rawReason: `Server confirmed modification: SL ${match[8]}, TP ${match[9]}`,
        },
      }),
    },
    // 30. Position modified: [Trade] '1375': position modified [#3381804 buy 0.01 XAUUSD.rcnt 4425.36 tp: 4425.86], time 0.49 ms
    {
      type: 'DEAL_EXECUTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+position\s+modified\s+\[#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+([\d\.]+)(?:\s+sl:\s+([\d\.]+))?(?:\s+tp:\s+([\d\.]+))?\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          ticket: match[3],
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          rawReason: `Position modified at ${match[7]}${match[8] ? `, SL ${match[8]}` : ''}${match[9] ? `, TP ${match[9]}` : ''}`,
        },
      }),
    },
    // 31. Rule modification confirm: [Trade] '1375': request confirmed, rule 'Auto Execution' (modify #3379113 sell 0.02 XAUUSD.rcnt -> sl: 0.00, tp: 4417.10)
    {
      type: 'EXECUTION_RESPONSE' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+request\s+confirmed,\s+rule\s+'(.+?)'\s+\(modify\s+#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+->\s+sl:\s+([\d\.]+),\s+tp:\s+([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          ticket: match[4],
          action: match[5].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[6]),
          symbol: match[7],
          rule: match[3],
          rawReason: `Modification confirmed via rule '${match[3]}': SL ${match[8]}, TP ${match[9]}`,
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
