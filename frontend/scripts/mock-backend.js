// Geçici test backend'i — yalnızca lokal grafik teşhisi için.
const http = require("http");

function makeCandles(limit) {
  const out = [];
  const now = Math.floor(Date.now() / 60000) * 60000; // 5m hizalı
  let price = 2500000;
  for (let i = limit - 1; i >= 0; i--) {
    const time = Math.floor((now - i * 5 * 60 * 1000) / 1000);
    const drift = (Math.random() - 0.5) * 4000;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + Math.random() * 1500;
    const low = Math.min(open, close) - Math.random() * 1500;
    const volume = 10 + Math.random() * 100;
    out.push({ time, open, high, low, close, volume });
    price = close;
  }
  return out;
}

const KLINES = makeCandles(300);

const server = http.createServer((req, res) => {
  const url = req.url || "";
  let body;
  if (url.startsWith("/api/auth/status")) {
    body = { authenticated: true, username: "testadmin", role: "admin", configured: true };
  } else if (url.startsWith("/api/system/health")) {
    body = { status: "ok", safety: { paper_only: true }, market: { fresh_symbols: 26 } };
  } else if (url.startsWith("/api/market-klines/")) {
    body = { candles: KLINES };
  } else {
    body = { ok: true, data: [], items: [], symbols: ["BTCTRY", "ETHTRY", "SOLTRY"] };
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
});
server.listen(8004, "127.0.0.1", () => console.log("mock backend on 8004"));
