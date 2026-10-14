/* sw.js networkFirstNavigation retry mantığı birim testi */
const fs = require("fs");
const src = fs.readFileSync("D:/scalpernew/frontend/public/sw.js", "utf8");

function makeEnv(fetchImpl) {
  const handlers = {};
  const cacheStore = new Map();
  const caches = {
    open: async (name) => {
      if (!cacheStore.has(name)) cacheStore.set(name, new Map());
      const store = cacheStore.get(name);
      return {
        match: async (req) => store.get(req) || undefined,
        put: async (req, res) => { store.set(req, res); },
      };
    },
    keys: async () => Array.from(cacheStore.keys()),
    delete: async (name) => cacheStore.delete(name),
  };
  const self = { addEventListener: (ev, fn) => { handlers[ev] = fn; }, location: { origin: "http://localhost" }, skipWaiting: () => {}, clients: { claim: () => {} } };
  const resolved = new Function("self", "caches", "fetch", "setTimeout", "clearTimeout", src + "\n;return {networkFirstNavigation, VERSION};");
  const mod = resolved(self, caches, fetchImpl, setTimeout, clearTimeout);
  return { mod, caches, cacheStore };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log("PASS:", name); } else { fail++; console.log("FAIL:", name); } }

(async () => {
  // Senaryo 1: 503, 503, 200 → retry sonrası 200 dönmeli
  let calls = 0;
  const fetchImpl = async () => { calls++; await sleep(10); return calls <= 2 ? { status: 503, ok: false, clone() { return this; } } : { status: 200, ok: true, clone() { return this; } }; };
  const env1 = makeEnv(fetchImpl);
  const req = { url: "http://localhost/firsatlar", mode: "navigate" };
  const res1 = await env1.mod.networkFirstNavigation(req);
  check("2 kez 503 sonrası 200 döner", res1 && res1.status === 200);
  check("toplam 3 fetch denemesi yapıldı", calls === 3);

  // Senaryo 2: sürekli 503 → önbellek boş → offline fallback (200 offline sayfası)
  const fetchImpl2 = async () => ({ status: 503, ok: false, clone() { return this; } });
  const env2 = makeEnv(fetchImpl2);
  const res2 = await env2.mod.networkFirstNavigation({ url: "http://localhost/ ", mode: "navigate" });
  check("sürekli 503 → offline fallback 200", res2 && res2.status === 200);

  // Senaryo 3: ağ hatası (TypeError) → hemen offline fallback
  const env3 = makeEnv(async () => { throw new TypeError("fetch failed"); });
  const res3 = await env3.mod.networkFirstNavigation({ url: "http://localhost/grafik", mode: "navigate" });
  check("ağ hatası → offline fallback", res3 && res3.status === 200);

  // Senaryo 4: önbellekte sayfa var + 503 → cache'den dönmeli
  const env4 = makeEnv(async () => ({ status: 503, ok: false, clone() { return this; } }));
  await env4.caches.open("scalper-runtime-v4").then((c) => c.put("http://localhost/ayarlar", { status: 200, ok: true, clone() { return this; } }));
  const res4 = await env4.mod.networkFirstNavigation({ url: "http://localhost/ayarlar", mode: "navigate" });
  check("503 + cache → önbellekten 200", res4 && res4.status === 200);

  // Senaryo 5: ilk denemede 200 → retry yok, tek fetch
  let calls5 = 0;
  const env5 = makeEnv(async () => { calls5++; return { status: 200, ok: true, clone() { return this; } }; });
  const res5 = await env5.mod.networkFirstNavigation({ url: "http://localhost/emirler", mode: "navigate" });
  check("sağlıklı ağ → tek istek", calls5 === 1 && res5.status === 200);

  console.log(`\nSONUÇ: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
