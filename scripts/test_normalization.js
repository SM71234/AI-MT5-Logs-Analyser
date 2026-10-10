const { NormalizationEngine } = require('../backend/dist/journal/normalization.engine');

const engine = new NormalizationEngine();
const lines = [
  "2026-10-06T12:17:51.515Z [Trade] '905353': market sell 0.01 XAUUSD.p (4154.34 / 4154.69)",
  "2026-10-06T12:17:51.515Z [Trade] '905353': request transferred to dealers, rule 'HX Dealer' (market sell 0.01 XAUUSD.p)",
  "2026-10-06T12:17:51.516Z [Trade] '1353': request from '905353' (market sell 0.01 XAUUSD.p)",
  "2026-10-06T12:17:51.757Z [Trade] '1353': confirm sell 0.01 XAUUSD.p at 4154.34 for '905353' (market sell 0.01 XAUUSD.p)(4154.34 / 4154.69) ",
  "2026-10-06T12:17:51.757Z [Trade] '905353': deal performed [#2888946 sell 0.01 XAUUSD.p at 4154.34]",
  "2026-10-06T12:17:51.757Z [Trade] '905353': order performed sell 0.01 at 4154.34 [#4432561 sell 0.01 XAUUSD.p at market], time 241.71 ms",
  "2026-10-06T12:42:40.259Z [Trade] '905353': market buy 0.01 XAUUSD.p, close #4432561 sell 0.01 XAUUSD.p 4154.34 (4154.36 / 4154.71)",
  "2026-10-06T12:42:40.259Z [Trade] '905353': request transferred to dealers, rule 'HX Dealer' (market buy 0.01 XAUUSD.p, close #4432561)",
  "2026-10-06T12:42:40.259Z [Trade] '1353': request from '905353' (market buy 0.01 XAUUSD.p, close #4432561)",
  "2026-10-06T12:42:40.500Z [Trade] '1353': confirm buy 0.01 XAUUSD.p at 4154.71 for '905353' (market buy 0.01 XAUUSD.p, close #4432561)(4154.36 / 4154.71) ",
  "2026-10-06T12:42:40.500Z [Trade] '905353': deal performed [#2889420 buy 0.01 XAUUSD.p at 4154.71]",
  "2026-10-06T12:42:40.500Z [Trade] '905353': order performed buy 0.01 at 4154.71 [#4433089 buy 0.01 XAUUSD.p at market], time 241.58 ms"
];

for (let i = 0; i < lines.length; i++) {
  const norm = engine.normalize(lines[i]);
  console.log(`[Line ${i}]`, norm ? `${norm.eventType} | PriceReq: ${norm.metadata?.priceRequested} | PriceExec: ${norm.metadata?.priceExecuted} | Action: ${norm.metadata?.action}` : 'NULL (NOT MATCHED)');
}
