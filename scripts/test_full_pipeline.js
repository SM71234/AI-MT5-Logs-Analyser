const { NormalizationEngine } = require('../backend/dist/journal/normalization.engine');
const { CorrelationEngine } = require('../backend/dist/journal/correlation.engine');
const { PositionLedgerService } = require('../backend/dist/journal/position-ledger.service');

// Subclass NormalizationEngine to test new patterns before modifying the codebase
class EnhancedNormalizationEngine extends NormalizationEngine {
  constructor() {
    super();
    // Add new patterns at the top of patterns
    this.patterns.unshift(
      // Opening market order with prevailing quotes: [Trade] '905353': market sell 0.01 XAUUSD.p (4154.34 / 4154.69)
      {
        type: 'REQUEST',
        regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+market\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+\(([\d\.]+)\s*\/\s*([\d\.]+)\)/i,
        parse: (match) => {
          const action = match[3].toUpperCase();
          const bid = parseFloat(match[6]);
          const ask = parseFloat(match[7]);
          const priceRequested = action === 'BUY' ? ask : bid;
          return {
            timestamp: match[1].endsWith('Z') ? match[1] : match[1] + 'Z',
            login: match[2],
            metadata: {
              action,
              volume: parseFloat(match[4]),
              symbol: match[5],
              priceRequested,
              rawReason: `Market ${match[3]} requested at ${priceRequested} (${match[6]} / ${match[7]})`
            }
          };
        }
      },
      // Dealer execution request: [Trade] '1353': request from '905353' (market sell 0.01 XAUUSD.p)
      {
        type: 'EXECUTION_REQUEST',
        regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+request\s+from\s+'(\d+)'\s+\((?:market\s+)?(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)(?:,\s*close\s*#(\d+))?/i,
        parse: (match) => {
          const action = match[4].toUpperCase();
          return {
            timestamp: match[1].endsWith('Z') ? match[1] : match[1] + 'Z',
            login: match[3],
            metadata: {
              action,
              volume: parseFloat(match[5]),
              symbol: match[6],
              ticketId: match[7] || undefined,
              positionId: match[7] || undefined,
              requestId: match[2]
            }
          };
        }
      },
      // Dealer confirm: [Trade] '1353': confirm sell 0.01 XAUUSD.p at 4154.34 for '905353' ...
      {
        type: 'EXECUTION_RESPONSE',
        regex: /(\d{4}[-\.]\d{2}[-\.]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[Trade\]\s+'(\d+)':\s+confirm\s+(buy|sell)\s+([\d\.]+)\s+([\w\.-]+)\s+at\s+([\d\.]+)\s+for\s+'(\d+)'/i,
        parse: (match) => {
          const action = match[3].toUpperCase();
          return {
            timestamp: match[1].endsWith('Z') ? match[1] : match[1] + 'Z',
            login: match[7],
            metadata: {
              action,
              volume: parseFloat(match[4]),
              symbol: match[5],
              priceExecuted: parseFloat(match[6]),
              requestId: match[2]
            }
          };
        }
      }
    );

    // Fix Rule 30 (position modified): make it EXECUTION_RESPONSE instead of DEAL_EXECUTED
    const rule30 = this.patterns.find(p => p.regex && p.regex.toString().includes('position\\s+modified'));
    if (rule30) {
      rule30.type = 'EXECUTION_RESPONSE';
    }
  }
}

const normEngine = new EnhancedNormalizationEngine();
const corrEngine = new CorrelationEngine();
const ledgerService = new PositionLedgerService();

const lines = [
  "2026-10-06T12:17:51.515Z [Trade] '905353': market sell 0.01 XAUUSD.p (4154.34 / 4154.69)",
  "2026-10-06T12:17:51.515Z [Trade] '905353': request transferred to dealers, rule 'HX Dealer' (market sell 0.01 XAUUSD.p)",
  "2026-10-06T12:17:51.516Z [Trade] '1353': request from '905353' (market sell 0.01 XAUUSD.p)",
  "2026-10-06T12:17:51.757Z [Trade] '1353': confirm sell 0.01 XAUUSD.p at 4154.34 for '905353' (market sell 0.01 XAUUSD.p)(4154.34 / 4154.69) ",
  "2026-10-06T12:17:51.757Z [Trade] '905353': deal performed [#2888946 sell 0.01 XAUUSD.p at 4154.34]",
  "2026-10-06T12:17:51.757Z [Trade] '905353': order performed sell 0.01 at 4154.34 [#4432561 sell 0.01 XAUUSD.p at market], time 241.71 ms",
  "2026-10-06T12:22:49.557Z [Trade] '905353': modify #4432561 sell 0.01 XAUUSD.p sl: 0.00, tp: 0.00 -> sl: 0.00, tp: 4153.21 (4155.33 / 4155.67)",
  "2026-10-06T12:22:49.557Z [Trade] '905353': request transferred to dealers, rule 'HX Dealer' (modify #4432561 sell 0.01 XAUUSD.p -> sl: 0.00, tp: 4153.21)",
  "2026-10-06T12:22:49.557Z [Trade] '1353': request from '905353' (modify #4432561 sell 0.01 XAUUSD.p -> sl: 0.00, tp: 4153.21)",
  "2026-10-06T12:22:49.809Z [Trade] '1353': confirm for '905353' (modify #4432561 sell 0.01 XAUUSD.p -> sl: 0.00, tp: 4153.21)(4155.34 / 4155.69) ",
  "2026-10-06T12:22:49.809Z [Trade] '905353': position modified [#4432561 sell 0.01 XAUUSD.p 4154.34 tp: 4153.21], time 251.77 ms",
  "2026-10-06T12:42:40.259Z [Trade] '905353': market buy 0.01 XAUUSD.p, close #4432561 sell 0.01 XAUUSD.p 4154.34 (4154.36 / 4154.71)",
  "2026-10-06T12:42:40.259Z [Trade] '905353': request transferred to dealers, rule 'HX Dealer' (market buy 0.01 XAUUSD.p, close #4432561)",
  "2026-10-06T12:42:40.259Z [Trade] '1353': request from '905353' (market buy 0.01 XAUUSD.p, close #4432561)",
  "2026-10-06T12:42:40.500Z [Trade] '1353': confirm buy 0.01 XAUUSD.p at 4154.71 for '905353' (market buy 0.01 XAUUSD.p, close #4432561)(4154.36 / 4154.71) ",
  "2026-10-06T12:42:40.500Z [Trade] '905353': deal performed [#2889420 buy 0.01 XAUUSD.p at 4154.71]",
  "2026-10-06T12:42:40.500Z [Trade] '905353': order performed buy 0.01 at 4154.71 [#4433089 buy 0.01 XAUUSD.p at market], time 241.58 ms"
];

const normalized = [];
for (const line of lines) {
  const ev = normEngine.normalize(line);
  if (ev) normalized.push(ev);
}

console.log("Normalized events count:", normalized.length, "out of", lines.length);
normalized.forEach((ev, i) => console.log(`  ${i}: [${ev.eventType}] ${ev.login} - ${ev.rawMessage.substring(30, 80)}`));

const incidents = corrEngine.correlate(normalized);
console.log("\nCorrelated incidents count:", incidents.length);
for (let i = 0; i < incidents.length; i++) {
  const inc = incidents[i];
  console.log(`\nIncident ${i}: ticketId=${inc.ticketId}, action=${inc.action}, volume=${inc.volume}, eventsCount=${inc.events.length}`);
  console.log("Events:", inc.events.map(e => `${e.eventType} (req=${e.metadata?.priceRequested ?? 'none'}, exec=${e.metadata?.priceExecuted ?? 'none'})`));
}

const mockTrade = {
  ticket: "4432561",
  positionId: "4432561",
  entry: { orderId: "4432561", dealId: "2888946" },
  exit: { orderId: "4433089", dealId: "2889420" }
};

const ledgers = ledgerService.reconstructPositions(incidents, [mockTrade]);
console.log("\nReconstructed ledgers count:", ledgers.length);
for (const l of ledgers) {
  console.log("Ledger posId:", l.positionId, "status:", l.lifecycleStatus, "entryDeals:", l.entryDeals.length, "exitDeals:", l.exitDeals.length);
  l.entryDeals.forEach((d, idx) => console.log(`  Entry ${idx}: ticketId=${d.ticketId}, action=${d.action}, events=${d.events.map(e => e.eventType).join(', ')}`));
  l.exitDeals.forEach((d, idx) => console.log(`  Exit ${idx}: ticketId=${d.ticketId}, action=${d.action}, events=${d.events.map(e => e.eventType).join(', ')}`));
}
