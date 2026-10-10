const PREFIX = "(\\d{4}[-\\.]\\d{2}[-\\.]\\d{2}[T\\s]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z?)\\s+(?:(?:\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}(?::\\d+)?\\s+)?(?:\\[\\w+\\]\\s+)?)?(?:[\\w\\s.-]+?\\s+)?'(\\d+)':\\s+";

const patterns = {
  ORDER_PLACED: new RegExp(PREFIX + "order\\s+placed\\s+\\[#(\\d+)\\s+(buy\\s+limit|sell\\s+limit|buy\\s+stop|sell\\s+stop|buy\\s+stop\\s+limit|sell\\s+stop\\s+limit)\\s+([\\d\\.]+)\\s+([\\w\\.-]+)\\s+at\\s+([\\d\\.]+)\\]", "i"),
  ORDER_TRIGGERED: new RegExp(PREFIX + "order\\s+\\[#(\\d+)\\s+(buy\\s+limit|sell\\s+limit|buy\\s+stop|sell\\s+stop|buy\\s+stop\\s+limit|sell\\s+stop\\s+limit)\\s+([\\d\\.]+)\\s+([\\w\\.-]+)\\s+at\\s+([\\d\\.]+)\\]\\s+triggered(?:,\\s+activation\\s+price\\s+([\\d\\.]+))?(?:\\s+\\[([\\d\\.]+)\\s*\\/\\s*([\\d\\.]+)\\])?", "i"),
  DEAL_EXECUTED: new RegExp(PREFIX + "deal\\s+performed\\s+\\[#(\\d+)\\s+(buy|sell)\\s+([\\d\\.]+)\\s+([\\w\\.-]+)\\s+at\\s+([\\d\\.]+)\\]", "i"),
  ORDER_PERFORMED: new RegExp(PREFIX + "order\\s+performed\\s+(buy|sell)\\s+([\\d\\.]+)\\s+at\\s+([\\d\\.]+)\\s+\\[#(\\d+)\\s+(?:buy|sell)\\s+[\\d\\.]+\\s+[\\w\\.-]+\\s+at\\s+(market|[\\d\\.]+)\\]", "i"),
  MARKET_OPEN: new RegExp(PREFIX + "market\\s+(buy|sell)\\s+([\\d\\.]+)\\s+([\\w\\.-]+)\\s+\\(([\\d\\.]+)\\s*\\/\\s*([\\d\\.]+)\\)", "i"),
  MARKET_CLOSE: new RegExp(PREFIX + "market\\s+(buy|sell)\\s+([\\d\\.]+)\\s+([\\w\\.-]+),\\s+close\\s+#(\\d+)\\s+(?:buy|sell)\\s+[\\d\\.]+\\s+[\\w\\.-]+\\s+[\\d\\.]+\\s+\\(([\\d\\.]+)\\s*\\/\\s*([\\d\\.]+)\\)", "i")
};

const lines = [
  "2026.10.09 08:36:02.327 Centroid Gateway '70038': deal performed [#1290112 buy 0.1 XAUUSD.V at 4202.99]",
  "2026-10-06T12:17:51.515Z [Trade] '905353': market sell 0.01 XAUUSD.p (4154.34 / 4154.69)",
  "2026.10.09 08:36:00.100 Centroid Gateway '70038': order [#1442633 buy stop 0.1 XAUUSD.V at 4202.50] triggered, activation price 4202.80 [4202.50 / 4202.80]",
  "2026.10.09 08:36:02.327 Centroid Gateway '70038': order performed buy 0.1 at 4202.99 [#1442633 buy 0.1 XAUUSD.V at 4202.99], time: 0.05 ms",
  "2026.08.14 10:20:30.123 127.0.0.1:443 [Trade] '1375': order placed [#3381804 buy stop 0.01 XAUUSD.rcnt at 4424.04], time 0.56 ms",
  "2026-10-06T12:42:40.259Z [Trade] '905353': market buy 0.01 XAUUSD.p, close #4432561 sell 0.01 XAUUSD.p 4154.34 (4154.36 / 4154.71)"
];

for (const line of lines) {
  let matched = null;
  for (const [name, regex] of Object.entries(patterns)) {
    const m = line.match(regex);
    if (m) {
      matched = { name, groups: m.slice(1) };
      break;
    }
  }
  console.log(line.substring(0, 50) + " => " + (matched ? matched.name + " (" + matched.groups.join(', ') + ")" : "NO MATCH"));
}
