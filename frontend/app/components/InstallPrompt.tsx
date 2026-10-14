"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DISMISS_KEY = "scalper-install-dismissed-at";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

function isStandalone(): boolean {
  try {
    if (typeof window === "undefined") return true;
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
    const nav = navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true;
  } catch {
    return true;
  }
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_MS;
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;

    const onPrompt = (e: Event) => {
      // Do not preventDefault; just capture the event for later use.
      deferredRef.current = e as BeforeInstallPromptEvent;
      setDeferred(deferredRef.current);
    };
    const onInstalled = () => {
      deferredRef.current = null;
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    const ev = deferredRef.current;
    if (!ev) return;
    try {
      await ev.prompt();
    } catch {
      // ignore prompt failures
    }
    deferredRef.current = null;
    setDeferred(null);
  }, []);

  const handleDismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // storage unavailable — just hide for this session
    }
    deferredRef.current = null;
    setDeferred(null);
  }, []);

  if (!deferred) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 rounded-xl border border-line bg-ink-900 text-white shadow-lg sm:left-auto sm:right-4 sm:max-w-sm">
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Uygulamayı yükle</p>
          <p className="mt-1 text-xs leading-relaxed text-white/70">
            Scalper Intelligent&apos;ı telefonuna uygulama olarak kur; tam ekran, bildirimler desteklenir.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-4 pb-4">
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-lg px-3 py-1.5 text-xs text-white/60 transition-colors hover:text-white"
        >
          Daha sonra
        </button>
        <button
          type="button"
          onClick={handleInstall}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          Yükle
        </button>
      </div>
    </div>
  );
}
