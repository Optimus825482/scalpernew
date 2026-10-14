"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveMessages } from "../lib/liveSocket";
import { sound } from "../lib/sound";
import { formatPct, formatPrice } from "../lib/format";
import { baseAsset } from "../lib/opportunity";
import { getJSON } from "../lib/api";

export type SignalToast = {
  id: string;
  symbol: string;
  source: string;
  price?: number | null;
  targetPct?: number | null;
  score?: number | null;
  timestamp: number;
};

const DIALOG_TTL_MS = 12_000;

export default function LiveNotificationToast({ onSelectSymbol }: { onSelectSymbol?: (symbol: string) => void }) {
  const [toasts, setToasts] = useState<SignalToast[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Kullanıcının minimum bildirim skoru (0 = tüm bildirimler).
  const minScoreRef = useRef(0);

  // Kullanıcının minimum bildirim skorunu periyodik olarak çek (Ayarlar'dan
  // değişikliği de almak için; ucuz istek, saniyede değil dakikada bir).
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await getJSON<{ preferences: { min_score?: number } }>("/api/user/preferences");
        if (active) minScoreRef.current = Math.max(0, Number(r.preferences?.min_score ?? 0)) || 0;
      } catch {
        // Tercih alınamazsa filtreleme yapma (varsayılan davranış).
      }
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  // Ses ayarını localStorage veya tercihlerden al
  useEffect(() => {
    try {
      const saved = localStorage.getItem("odak_sound_enabled");
      if (saved !== null) {
        setSoundEnabled(saved === "true");
      }
    } catch {
      // pass
    }
  }, []);

  useLiveMessages((msg) => {
    let newSignals: SignalToast[] = [];
    const now = Date.now();

    if (msg.type === "monitoring_alert" || msg.type === "rising_alert" || msg.type === "signal") {
      const rawItems = Array.isArray(msg.data) ? msg.data : [msg.data];

      for (const item of rawItems) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const symbol = String(row.symbol || row.pair || "").toUpperCase();
        if (!symbol) continue;

        const targetPct = Number(row.target_pct ?? row.potential_pct ?? row.ceiling_pct ?? 0);
        const score = Number(row.score ?? row.quality_score ?? row.unified_score ?? row.velocity_score ?? 0);
        const price = Number(row.price ?? row.current_price ?? row.entry_price ?? 0) || null;
        const source = String(row.source ?? row.strategy ?? (msg.type === "rising_alert" ? "Yükseliş" : "Radar Sinyali"));

        // Kullanıcının minimum bildirim skoru: skorlu sinyal eşiğin altındaysa gösterme.
        const userMin = minScoreRef.current;
        if (userMin > 0 && score > 0 && score < userMin) continue;

        newSignals.push({
          id: `${symbol}-${now}-${Math.random()}`,
          symbol,
          source,
          price,
          targetPct: targetPct > 0 ? targetPct : null,
          score: score > 0 ? Math.round(score) : null,
          timestamp: now,
        });
      }
    }

    if (newSignals.length > 0) {
      if (soundEnabled) {
        sound.playSignalChime();
      }

      setToasts((prev) => [...newSignals.slice(0, 3), ...prev].slice(0, 4));

      // Süresi dolan diyalogları temizle
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => Date.now() - t.timestamp < DIALOG_TTL_MS));
      }, DIALOG_TTL_MS + 200);
    }
  });

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  const dialog = toasts[0];
  const queuedCount = toasts.length - 1;
  const goChart = () => {
    removeToast(dialog.id);
    // Next 16 router'ı bu uygulamada no-op; tam sayfa navigasyonu kullan.
    window.location.assign(`/grafik?symbol=${encodeURIComponent(dialog.symbol)}`);
  };
  const openTrade = () => {
    onSelectSymbol?.(dialog.symbol);
    removeToast(dialog.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={() => removeToast(dialog.id)}
    >
      <div
        className="pointer-events-auto w-full max-w-sm rounded-2xl border border-accent/30 bg-white p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-xl text-accent">
              ⚡
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{dialog.source}</p>
              <p className="font-mono text-lg font-bold leading-tight text-ink-900">
                {baseAsset(dialog.symbol)}
                <span className="text-xs font-normal text-ink-400"> / TRY</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => removeToast(dialog.id)}
            aria-label="Kapat"
            className="grid h-7 w-7 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-canvas hover:text-ink-700"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-baseline gap-3 rounded-xl bg-canvas px-3.5 py-2.5 text-sm">
          {dialog.price && <span className="font-mono font-semibold text-ink-900">{formatPrice(dialog.price)}</span>}
          {dialog.targetPct != null && (
            <span className="font-mono text-base font-bold text-gain">↗ {formatPct(dialog.targetPct, 1, true)}</span>
          )}
          {dialog.score != null && <span className="ml-auto text-xs text-ink-400">Skor: {dialog.score}</span>}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={goChart}
            className="flex-1 rounded-xl border border-line px-3 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-canvas"
          >
            📈 Grafiğe Git
          </button>
          <button
            type="button"
            onClick={openTrade}
            className="flex-1 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover"
          >
            ⚡ İşlem Aç
          </button>
        </div>

        <button
          type="button"
          onClick={() => removeToast(dialog.id)}
          className="mt-2 w-full rounded-xl px-3 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-canvas hover:text-ink-700"
        >
          Tamam
        </button>

        {queuedCount > 0 && (
          <p className="mt-3 text-center text-[11px] text-ink-400">
            {queuedCount} yeni sinyal daha bekliyor
          </p>
        )}
      </div>
    </div>
  );
}
