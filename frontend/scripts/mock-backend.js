// Geçici test backend'i — yalnızca lokal navigasyon teşhisi için.
const http = require("http");
const server = http.createServer((req, res) => {
  const url = req.url || "";
  let body;
  if (url.startsWith("/api/auth/status")) {
    body = { authenticated: true, username: "testadmin", role: "admin", configured: true };
  } else if (url.startsWith("/api/system/health")) {
    body = { status: "ok", safety: { paper_only: true }, market: { fresh_symbols: 26 } };
  } else {
    body = { ok: true, data: [], items: [], symbols: ["BTCTRY", "ETHTRY", "SOLTRY"] };
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
});
server.listen(8004, "127.0.0.1", () => console.log("mock backend on 8004"));
