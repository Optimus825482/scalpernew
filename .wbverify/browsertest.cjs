/* Yerel build tarayıcı doğrulaması: splash süresi, login ekranı, SW kaydı, responsive, konsol */
const { chromium } = require("playwright");

(async () => {
  const results = {};
  const browser = await chromium.launch({ executablePath: "C:/Users/erkan/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });

  // --- Masaüstü: splash süresi + giriş ekranı ---
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

  const t0 = Date.now();
  await page.goto("http://127.0.0.1:3055/", { waitUntil: "domcontentloaded", timeout: 60000 });
  const domMs = Date.now() - t0;

  // Splash görünürlüğünü izle
  let splashVisibleAtStart = await page.evaluate(() => !!document.querySelector("div[aria-hidden='true'].fixed"));
  let splashGoneMs = null;
  let loginTextAtGone = "";
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => {
      const el = document.querySelector("div[aria-hidden='true'].fixed");
      const gone = !el || getComputedStyle(el).opacity === "0";
      return { gone, text: document.body.innerText.slice(0, 80) };
    });
    if (state.gone) { splashGoneMs = Date.now() - t0; loginTextAtGone = state.text; break; }
  }
  results.splashVisibleAtStart = splashVisibleAtStart;
  results.domContentLoadedMs = domMs;
  results.splashGoneMs = splashGoneMs;
  results.textAfterSplash = loginTextAtGone;
  await page.screenshot({ path: "D:/scalpernew/.wbverify/desktop-login.png" });

  // Backend kapalı → AuthGate hata paneli (Türkçe)
  await page.waitForTimeout(2500);
  const hasRetryUI = await page.evaluate(() => document.body.innerText.includes("Yeniden dene") || document.body.innerText.includes("Backend"));
  results.backendDownRetryUI = hasRetryUI;
  await page.screenshot({ path: "D:/scalpernew/.wbverify/desktop-backend-down.png" });

  // SW kaydı + sürüm
  await page.waitForTimeout(1500);
  const sw = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (!regs.length) return { registered: false };
    const script = await (await fetch("/sw.js")).text();
    return { registered: true, version: (script.match(/VERSION = "(.+)"/) || [])[1] || null };
  });
  results.serviceWorker = sw;

  // --- Mobil responsive ---
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.goto("http://127.0.0.1:3055/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await mp.waitForTimeout(3500);
  const mobile = await mp.evaluate(() => {
    const card = document.querySelector(".odak-card");
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    return { cardWidth: card ? Math.round(card.getBoundingClientRect().width) : null, horizontalOverflow: overflow, text: document.body.innerText.slice(0, 60) };
  });
  results.mobile = mobile;
  await mp.screenshot({ path: "D:/scalpernew/.wbverify/mobile-login.png" });

  results.errors = errors;
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
