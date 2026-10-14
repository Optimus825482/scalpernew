"use client";

import { useEffect } from "react";

/**
 * Service Worker kaydı — yalnızca üretimde, https veya localhost'ta.
 * basePath desteği: SW script yolu document.baseURI üzerinden çözülür.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const { protocol, hostname } = window.location;
    const isSecure = protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
    if (!isSecure) return;

    const register = () => {
      try {
        const swUrl = new URL("sw.js", document.baseURI).href;
        navigator.serviceWorker.register(swUrl).catch(() => {
          /* kayıt başarısız — sessizce yoksay */
        });
      } catch {
        /* yoksay */
      }
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
