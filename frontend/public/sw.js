/* Scalper Intelligent — Service Worker (klasik, bağımsız)
 * Stratejiler:
 *  - Navigasyon (HTML): network-first, zaman aşımında önbellek; çevrimdışı fallback.
 *  - /_next/static/, /icons/, /icon.svg: cache-first (değişmez varlıklar).
 *  - /api/ ve /ws ASLA yakalanmaz (bypass).
 */
"use strict";

var VERSION = "v3";
var SHELL_CACHE = "scalper-shell-" + VERSION;
var ASSET_CACHE = "scalper-assets-" + VERSION;
var RUNTIME_CACHE = "scalper-runtime-" + VERSION;
var NAV_TIMEOUT_MS = 4000;

var ASSET_PATTERNS = [
  /^\/_next\/static\//,
  /^\/icons\//,
  /^\/icon\.svg$/,
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // Minimal çevrimdışı sayfayı önceden koy.
      return cache.put("/__offline__", new Response(OFFLINE_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }));
    }).then(function () {
      return self.skipWaiting();
    }).catch(function () { /* yut */ })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== SHELL_CACHE && key !== ASSET_CACHE && key !== RUNTIME_CACHE) {
          return caches.delete(key);
        }
      }));
    }).then(function () {
      return self.clients.claim();
    }).catch(function () { /* yut */ })
  );
});

/* ----- Web Push ----- */

// Push mesajı alındığında bildirim göster. Veri savunmacı şekilde parse edilir;
// parse edilemezse genel bir bildirim gösterilir (push API görünür bildirim ister).
self.addEventListener("push", function (event) {
  var title = "Scalper";
  var options = {
    body: "Yeni bildirim var.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "scalper-push",
    data: {},
    requireInteraction: false,
  };

  if (event.data) {
    try {
      var payload = event.data.json();
      if (payload && typeof payload === "object") {
        if (typeof payload.title === "string" && payload.title) title = payload.title;
        if (typeof payload.body === "string" && payload.body) options.body = payload.body;
        if (typeof payload.tag === "string" && payload.tag) options.tag = payload.tag;
        if (payload.data && typeof payload.data === "object") options.data = payload.data;
      }
    } catch (e) {
      // JSON değilse düz metin olarak dene.
      try {
        var text = event.data.text();
        if (text) options.body = text.slice(0, 200);
      } catch (e2) { /* yut — genel bildirim gösterilir */ }
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options).catch(function () { /* yut */ })
  );
});

// Bildirime tıklanınca: mevcut sekmeyi odakla ya da hedef URL'i aç.
// basePath'e saygı: kayıt scope'u (örn. /yeni-arayuz/) göreli yolun önüne eklenir.
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var data = event.notification.data || {};
  var target = (typeof data.url === "string" && data.url) ? data.url : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      var scopeUrl;
      try { scopeUrl = new URL(self.registration.scope); } catch (e) { scopeUrl = null; }

      // Göreli hedefi scope tabanlı tam URL'e çevir.
      var targetUrl = null;
      try {
        targetUrl = new URL(target, scopeUrl ? scopeUrl.href : self.location.origin);
      } catch (e) { targetUrl = null; }

      // Aynı hedefe açık sekme varsa odakla (ve varsa #hash güncelle).
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        try {
          if (targetUrl && new URL(client.url).origin === targetUrl.origin &&
              new URL(client.url).pathname === targetUrl.pathname) {
            if ("focus" in client) return client.focus();
          }
        } catch (e) { /* yut */ }
      }

      // Uygun sekme yoksa yeni pencere aç.
      if (self.clients.openWindow && targetUrl) {
        return self.clients.openWindow(targetUrl.href);
      }
      return undefined;
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // API ve WebSocket trafiğine dokunma.
  if (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0) return;
  if (url.pathname === "/ws" || url.pathname.indexOf("/ws/") === 0 || url.pathname.indexOf("/ws") === 0) return;

  // Next.js App Router istemci navigasyonu: RSC payload / prefetch isteklerini
  // ASLA yakalama — router kendi yönetir; SW önbelleği eski build payload'ını
  // döndürüp menü geçişlerini kırar (2026-10-14 teşhisi).
  if (req.headers.get("RSC") || req.headers.get("Next-Router-Prefetch") ||
      req.headers.get("Next-Router-State-Tree")) return;

  // Değişmez varlıklar: cache-first.
  for (var i = 0; i < ASSET_PATTERNS.length; i++) {
    if (ASSET_PATTERNS[i].test(url.pathname)) {
      event.respondWith(cacheFirst(req, ASSET_CACHE));
      return;
    }
  }

  // Navigasyon (HTML): network-first + timeout fallback.
  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // Diğer aynı-origin GET'ler: stale-while-revalidate benzeri, sessiz.
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
        return res;
      }).catch(function () {
        return new Response("", { status: 504, statusText: "Offline" });
      });
    }).catch(function () {
      return fetch(req);
    });
  });
}

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    });
  }).catch(function () { return fetch(req); });
}

function networkFirstNavigation(req) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () {
      if (!done) {
        done = true;
        resolve(offlineFallback(req));
      }
    }, NAV_TIMEOUT_MS);

    fetch(req).then(function (res) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        if (res && res.ok) {
          caches.open(RUNTIME_CACHE).then(function (cache) {
            cache.put(req, res.clone()).catch(function () {});
          }).catch(function () {});
        }
        resolve(res);
      }
    }).catch(function () {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(offlineFallback(req));
      }
    });
  });
}

function offlineFallback(req) {
  // Yalnızca AYNI URL'in önbellekteki karşılığı döner; başka sayfanın
  // cache'ini yanlışlıkla render etmek kabul edilemez (yanlış sayfa tuzağı).
  return caches.open(RUNTIME_CACHE).then(function (runtime) {
    return runtime.match(req).then(function (last) {
      return last || offlinePage();
    });
  }).catch(function () { return offlinePage(); });
}

function offlinePage() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

var OFFLINE_HTML = "<!DOCTYPE html><html lang=\"tr\"><head><meta charset=\"utf-8\">" +
  "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
  "<title>Scalper — Çevrimdışı</title><style>body{font-family:system-ui,sans-serif;" +
  "background:#eef2f7;color:#0f172a;display:flex;align-items:center;justify-content:center;" +
  "min-height:100vh;margin:0}.box{background:#fff;border:1px solid #e2e8f0;border-radius:1rem;" +
  "padding:2rem;max-width:420px;text-align:center;box-shadow:0 8px 24px rgba(15,23,42,.08)}" +
  "h1{font-size:1.1rem;margin:0 0 .5rem;color:#0066ff}p{margin:0;color:#64748b;font-size:.9rem}" +
  "</style></head><body><div class=\"box\"><h1>Bağlantı yok</h1>" +
  "<p>Bağlantı yok — son yüklenen sayfa gösteriliyor. Bağlantı geri geldiğinde sayfayı yenileyin.</p>" +
  "</div></body></html>";
