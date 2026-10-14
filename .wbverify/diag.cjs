/* Canlı site performans + hata teşhis betiği */
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleMsgs = [];
  const requests = [];
  page.on("console", (m) => consoleMsgs.push({ type: m.type(), text: m.text().slice(0, 300) }));
  page.on("pageerror", (e) => consoleMsgs.push({ type: "pageerror", text: String(e).slice(0, 300) }));
  page.on("requestfailed", (r) => consoleMsgs.push({ type: "requestfailed", text: `${r.url()} :: ${r.failure()?.errorText}` }));
  page.on("response", (r) => {
    if (r.url().includes("scalpernew")) requests.push({ url: r.url().replace("https://scalpernew.erkanerdem.online", ""), status: r.status() });
  });

  const t0 = Date.now();
  await page.goto("https://scalpernew.erkanerdem.online/", { waitUntil: "domcontentloaded", timeout: 60000 });
  const domMs = Date.now() - t0;

  // Splash ne zaman kalkıyor?
  let splashGoneMs = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(250);
    const gone = await page.evaluate(() => {
      const fixed = document.querySelector("div[aria-hidden='true']");
      return !fixed || getComputedStyle(fixed).opacity === "0" || fixed.style.pointerEvents === "none";
    });
    if (gone) { splashGoneMs = Date.now() - t0; break; }
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "01-giris.png" });

  // Login ekranı görünür mü
  const loginVisible = await page.evaluate(() => document.body.innerText.includes("Oturum aç") || document.body.innerText.includes("Oturum doğrulanıyor"));

  // Sayfa geçişlerini test et (menü linkleri)
  const navResults = [];
  const navTargets = ["/firsatlar", "/grafik", "/emirler", "/alarmlar", "/ayarlar", "/kullanicilar", "/gecmis-islemler"];
  for (const path of navTargets) {
    const start = Date.now();
    try {
      await page.goto("https://scalpernew.erkanerdem.online" + path, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);
      const text = await page.evaluate(() => document.body.innerText.slice(0, 150).replace(/\n/g, " | "));
      navResults.push({ path, ms: Date.now() - start, head: text });
    } catch (e) {
      navResults.push({ path, ms: Date.now() - start, error: String(e).slice(0, 150) });
    }
  }
  await page.screenshot({ path: "02-ayarlar.png" });

  // Ağ performansı: toplam JS/CSS boyutu ve yavaş istekler
  const slow = requests.filter((r) => r.status >= 400);

  const report = {
    domContentLoadedMs: domMs,
    splashGoneMs,
    loginVisible,
    errors: consoleMsgs,
    failedOrErrorResponses: slow,
    nav: navResults,
  };
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
