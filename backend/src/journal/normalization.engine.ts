import { Injectable, Logger } from '@nestjs/common';

export function parseFullTimestamp(ts: string): {
  timestamp: string;
  timestampRaw: string;
  timestampServer: string;
  timestampUtc: string | null;
  timezoneSource: 'BROKER_CONFIG' | 'MT5_SERVER' | 'EXPLICIT_OFFSET' | 'SYSTEM_CONFIGURATION' | 'UNKNOWN';
} {
  const timestampRaw = ts;
  
  let datePart = ts.slice(0, 10);
  const timePart = ts.slice(10);
  datePart = datePart.replace(/\./g, '-');
  const clean = (datePart + timePart).replace(' ', 'T').trim();
  
  let timezoneSource: 'BROKER_CONFIG' | 'MT5_SERVER' | 'EXPLICIT_OFFSET' | 'SYSTEM_CONFIGURATION' | 'UNKNOWN' = 'UNKNOWN';
  let timestampUtc: string | null = null;
  
  const hasZ = clean.toUpperCase().endsWith('Z');
  const hasOffset = /T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2})$/.test(clean);
  
  if (hasZ) {
    timezoneSource = 'EXPLICIT_OFFSET';
    timestampUtc = clean;
  } else if (hasOffset) {
    timezoneSource = 'EXPLICIT_OFFSET';
    const parsedDate = new Date(clean);
    if (!isNaN(parsedDate.getTime())) {
      timestampUtc = parsedDate.toISOString();
    }
  }
  
  let timestampServer = clean;
  if (hasZ) {
    timestampServer = clean.slice(0, -1);
  } else {
    const offsetIndex = clean.lastIndexOf('+') !== -1 ? clean.lastIndexOf('+') : (clean.lastIndexOf('-') > 10 ? clean.lastIndexOf('-') : -1);
    if (offsetIndex > 10) {
      timestampServer = clean.substring(0, offsetIndex);
    }
  }

  const legacyTimestamp = timestampUtc || timestampServer;

  return {
    timestamp: legacyTimestamp,
    timestampRaw,
    timestampServer,
    timestampUtc,
    timezoneSource,
  };
}

function parseTimestamp(ts: string): string {
  return parseFullTimestamp(ts).timestamp;
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
  | 'ORDER_CANCELLED'
  | 'REQUOTED';

export interface NormalizedEvent {
  timestamp: string; // for backward compatibility
  timestampRaw?: string;
  timestampServer?: string;
  timestampUtc?: string | null;
  timezoneSource?: 'BROKER_CONFIG' | 'MT5_SERVER' | 'EXPLICIT_OFFSET' | 'SYSTEM_CONFIGURATION' | 'UNKNOWN';
  eventType: StandardEventType;
  rawMessage: string;
  login: string;
  metadata: {
    ticket?: string; // legacy support
    ticketId?: string;
    positionId?: string;
    orderId?: string;
    dealId?: string;
    requestId?: string;
    symbol?: string;
    action?: 'BUY' | 'SELL';
    volume?: number;
    priceRequested?: number;
    priceExecuted?: number;
    dealerId?: string;
    requotePrice?: number;
    rawReason?: string;
    rule?: string;
    requoteCount?: number;
    rejectedBy?: string;
    commission?: number;
    swap?: number;
    fee?: number;
    profit?: number;
    priceActivation?: number;
    activationPrice?: number;
    activationBid?: number;
    activationAsk?: number;
  };
}

@Injectable()
export class NormalizationEngine {
  private readonly logger = new Logger('NormalizationEngine');

  private readonly patterns = [
    // 1. Pending order placed: [Trade] '1375': order placed [#3381804 buy stop 0.01 XAUUSD.rcnt at 4424.04], time 0.56 ms
    {
      type: 'ORDER_PLACED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+order\s+placed\s+\[#(\d+)\s+(buy\s+limit|sell\s+limit|buy\s+stop|sell\s+stop|buy\s+stop\s+limit|sell\s+stop\s+limit)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          orderId: match[3],
          ticketId: match[3],
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
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+order\s+\[#(\d+)\s+(buy\s+limit|sell\s+limit|buy\s+stop|sell\s+stop|buy\s+stop\s+limit|sell\s+stop\s+limit)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\]\s+triggered(?:,\s+activation\s+price\s+([\d\.]+))?(?:\s+\[([\d\.]+)\s*\/\s*([\d\.]+)\])?/i,
      parse: (match: RegExpMatchArray) => {
        const action = match[4].toLowerCase().includes('buy') ? ('BUY' as const) : ('SELL' as const);
        const orderPrice = parseFloat(match[7]);
        const activationPrice = match[8] ? parseFloat(match[8]) : undefined;
        const bid = match[9] ? parseFloat(match[9]) : undefined;
        const ask = match[10] ? parseFloat(match[10]) : undefined;
        const activationQuote = action === 'BUY' ? (ask ?? activationPrice) : (bid ?? activationPrice);
        return {
          timestamp: parseTimestamp(match[1]),
          login: match[2],
          metadata: {
            orderId: match[3],
            ticketId: match[3],
            action,
            volume: parseFloat(match[5]),
            symbol: match[6],
            priceRequested: orderPrice,
            activationPrice,
            activationBid: bid,
            activationAsk: ask,
            priceActivation: activationQuote,
          },
        };
      },
    },
    // 3. Direct execution request: [Trade] '259713': order placed for execution [#6943681 sell 0.01 XAGUSD.i at market], time 1.10 ms
    {
      type: 'EXECUTION_REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+order\s+placed\s+for\s+execution\s+\[#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+(market|[\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          orderId: match[3],
          ticketId: match[3],
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
          ticketId: match[6],
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
          dealId: match[6],
          ticketId: match[6] || match[3],
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          priceExecuted: parseFloat(match[5]),
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
          ticketId: match[4],
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
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+market\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+),\s+close\s+#(\d+)\s+(?:buy|sell)\s+[\d\.]+\s+[\w\.-]+\s+[\d\.]+\s+\(([\d\.]+)\s*\/\s*([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          symbol: match[5],
          positionId: match[6],
          ticketId: match[6],
          ticket: match[6],
          priceRequested: match[3].toUpperCase() === 'BUY' ? parseFloat(match[8]) : parseFloat(match[7]),
        },
      }),
    },
    // 7b. Opening market order request: [Trade] '905353': market sell 0.01 XAUUSD.p (4154.34 / 4154.69)
    {
      type: 'REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+market\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+\(([\d\.]+)\s*\/\s*([\d\.]+)\)/i,
      parse: (match: RegExpMatchArray) => {
        const action = match[3].toUpperCase() as 'BUY' | 'SELL';
        const bid = parseFloat(match[6]);
        const ask = parseFloat(match[7]);
        const priceRequested = action === 'BUY' ? ask : bid;
        return {
          timestamp: parseTimestamp(match[1]),
          login: match[2],
          metadata: {
            action,
            volume: parseFloat(match[4]),
            symbol: match[5],
            priceRequested,
            rawReason: `Market ${match[3]} requested at ${priceRequested} (${match[6]} / ${match[7]})`,
          },
        };
      },
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
          positionId: match[8],
          ticketId: match[8],
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
          positionId: match[9] || undefined,
          ticketId: match[9] || undefined,
          ticket: match[9] || undefined,
          requestId: match[2],
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
          ticketId: match[4],
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
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+deal\s+performed\s+\[#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          dealId: match[3],
          ticketId: match[3],
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
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+order\s+performed\s+(buy|sell)\s+([\d\.]+)\s+at\s+([\d\.]+)\s+\[#(\d+)\s+(?:buy|sell)\s+[\d\.]+\s+[\w\.-]+\s+at\s+(market|[\d\.]+)\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          orderId: match[6],
          ticketId: match[6],
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          priceExecuted: parseFloat(match[5]),
          priceRequested: match[7].toLowerCase() === 'market' ? null : parseFloat(match[7]),
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
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:\[Trade\]\s+)?(?:'(\d+)':\s+)?request\s+transferred\s+to\s+dealers/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2] || '',
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
    // 17b. Dealer execution request: [Trade] '1353': request from '905353' (market sell 0.01 XAUUSD.p)
    {
      type: 'EXECUTION_REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+request\s+from\s+'(\d+)'\s+\((?:market\s+)?(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)(?:,\s*close\s*#(\d+))?/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[3],
        metadata: {
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          ticketId: match[7] || undefined,
          positionId: match[7] || undefined,
          requestId: match[2],
          dealerId: match[2],
        },
      }),
    },
    // 17c. Dealer confirm: [Trade] '1353': confirm sell 0.01 XAUUSD.p at 4154.34 for '905353'
    {
      type: 'EXECUTION_RESPONSE' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+confirm\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\s+for\s+'(\d+)'/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[7],
        metadata: {
          action: match[3].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[4]),
          symbol: match[5],
          priceExecuted: parseFloat(match[6]),
          requestId: match[2],
          dealerId: match[2],
        },
      }),
    },
    // 18. Dealer requote: [Dealer] dealer #ID rejected buy/sell volume symbol at price (requote price)
    {
      type: 'REQUOTED' as const,
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
          dealId: match[3],
          ticketId: match[3],
          ticket: match[3],
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          priceExecuted: parseFloat(match[7]),
        },
      }),
    },
    // 21. Standard order/request rejection: [Trade] 'login': request rejected: reason or Centroid Gateway 'login': order [#ID] rejected due to reason
    {
      type: 'ORDER_REJECTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+(?:order\s+\[#(\d+)\]\s+rejected(?:\s+due\s+to\s+(.+))?|request\s+rejected:\s+(.+))/i,
      parse: (match: RegExpMatchArray) => {
        const orderId = match[3] || undefined;
        const reason = (match[4] || match[5] || '').trim();
        return {
          timestamp: parseTimestamp(match[1]),
          login: match[2],
          metadata: {
            orderId,
            ticketId: orderId,
            rawReason: reason || 'Request rejected',
          },
        };
      },
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
          ticketId: match[3],
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
          requestId: match[2],
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
          ticketId: match[3],
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
          ticketId: match[4],
          ticket: match[4],
          action: match[5].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[6]),
          symbol: match[7],
          rawReason: `Requested modification: SL ${match[8]}, TP ${match[9]}`,
          requestId: match[2],
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
          ticketId: match[4],
          ticket: match[4],
          action: match[5].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[6]),
          symbol: match[7],
          rawReason: `Server confirmed modification: SL ${match[8]}, TP ${match[9]}`,
          requestId: match[2],
        },
      }),
    },
    // 30. Position modified: [Trade] '1375': position modified [#3381804 buy 0.01 XAUUSD.rcnt 4425.36 tp: 4425.86], time 0.49 ms
    // or Gateway: Centroid Gateway '70038': position modified [#1442633 buy 0.1 XAUUSD.V sl: 4190.00 tp: 4250.00]
    {
      type: 'EXECUTION_RESPONSE' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+(?:(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s+)?(?:\[\w+\]\s+)?)?(?:[\w\s.-]+?\s+)?'(\d+)':\s+position\s+modified\s+\[#(\d+)\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)(?:\s+([\d\.]+))?(?:\s+sl:\s+([\d\.]+))?(?:\s+tp:\s+([\d\.]+))?\]/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[2],
        metadata: {
          positionId: match[3],
          ticketId: match[3],
          ticket: match[3],
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          rawReason: `Position modified${match[7] ? ` at ${match[7]}` : ''}${match[8] ? `, SL ${match[8]}` : ''}${match[9] ? `, TP ${match[9]}` : ''}`,
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
          ticketId: match[4],
          ticket: match[4],
          action: match[5].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[6]),
          symbol: match[7],
          rule: match[3],
          rawReason: `Modification confirmed via rule '${match[3]}': SL ${match[8]}, TP ${match[9]}`,
          requestId: match[2],
        },
      }),
    },
    // 32. Execution request received (from dealer/bridge perspective): [Trade] '1085': request from '259713' (for '259713' sell 0.01 XAUUSD.p at 4382.81, close #7100172)
    {
      type: 'EXECUTION_REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+request\s+from\s+'(\d+)'\s+\(for\s+'\d+'\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)(?:,\s+close\s+#(\d+))?\)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: match[3],
        metadata: {
          action: match[4].toUpperCase() as 'BUY' | 'SELL',
          volume: parseFloat(match[5]),
          symbol: match[6],
          priceRequested: parseFloat(match[7]),
          positionId: match[8] || undefined,
          ticketId: match[8] || undefined,
          ticket: match[8] || undefined,
          requestId: match[2],
        },
      }),
    },
    // 33. Client BUY/SELL Request: Client BUY request Requested price: 4383.21
    {
      type: 'REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+Client\s+(BUY|SELL)\s+request\s+Requested\s+price:\s+([\d\.]+)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: '',
        metadata: {
          action: match[2].toUpperCase() as 'BUY' | 'SELL',
          priceRequested: parseFloat(match[3]),
        },
      }),
    },
    // 34. Dealer request received
    {
      type: 'EXECUTION_REQUEST' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+Dealer\s+request\s+received/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: '',
        metadata: {},
      }),
    },
    // 35. Dealer confirms BUY/SELL: Dealer confirms BUY at 4383.25
    {
      type: 'EXECUTION_RESPONSE' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+Dealer\s+confirms\s+(BUY|SELL)\s+at\s+([\d\.]+)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: '',
        metadata: {
          action: match[2].toUpperCase() as 'BUY' | 'SELL',
          priceExecuted: parseFloat(match[3]),
        },
      }),
    },
    // 36. Deal performed Deal ID: 6903295
    {
      type: 'DEAL_EXECUTED' as const,
      regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+Deal\s+performed\s+Deal\s+ID:\s+(\d+)/i,
      parse: (match: RegExpMatchArray) => ({
        timestamp: parseTimestamp(match[1]),
        login: '',
        metadata: {
          dealId: match[2],
          ticketId: match[2],
          ticket: match[2],
        },
      }),
    },
  ];

  normalize(rawLine: string): NormalizedEvent | null {
    for (const pattern of this.patterns) {
      const match = rawLine.match(pattern.regex);
      if (match) {
        const parsed = pattern.parse(match);
        const metadata: NormalizedEvent['metadata'] = parsed.metadata || {};
        if (metadata.ticket && !metadata.ticketId) {
          metadata.ticketId = metadata.ticket;
        }
        if (metadata.ticketId && !metadata.ticket) {
          metadata.ticket = metadata.ticketId;
        }
        
        const tsObj = parseFullTimestamp(match[1]);

        return {
          timestamp: tsObj.timestamp,
          timestampRaw: tsObj.timestampRaw,
          timestampServer: tsObj.timestampServer,
          timestampUtc: tsObj.timestampUtc,
          timezoneSource: tsObj.timezoneSource,
          eventType: pattern.type,
          rawMessage: rawLine,
          login: parsed.login,
          metadata: metadata,
        };
      }
    }
    
    this.logger.debug(`Log line skipped normalization (no pattern match): "${rawLine}"`);
    return null;
  }
}
