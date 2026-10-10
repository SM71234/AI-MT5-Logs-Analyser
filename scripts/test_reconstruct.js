const { NormalizationEngine } = require('../backend/dist/journal/normalization.engine');
const { CorrelationEngine } = require('../backend/dist/journal/correlation.engine');
const { PositionLedgerService } = require('../backend/dist/journal/position-ledger.service');

const normEngine = new NormalizationEngine();
const corrEngine = new CorrelationEngine();
const ledgerService = new PositionLedgerService();

const rawLogs = [
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

const normalized = rawLogs.map(l => normEngine.normalize(l)).filter(Boolean);
console.log('Normalized events:', normalized.length);

const incidents = corrEngine.correlate(normalized);
console.log('Correlated incidents:', incidents.length);
incidents.forEach((inc, i) => {
  console.log(`Incident ${i}: ticketId=${inc.ticketId}, action=${inc.action}, volume=${inc.volume}, events=${inc.events.map(e => e.eventType).join(', ')}`);
});

const ledgers = ledgerService.reconstructPositions(incidents);
console.log('Ledgers:', ledgers.length);
ledgers.forEach((l, i) => {
  console.log(`Ledger ${i}: posId=${l.positionId}, side=${l.side}, status=${l.lifecycleStatus}, entries=${l.entryDeals.length}, exits=${l.exitDeals.length}`);
});
