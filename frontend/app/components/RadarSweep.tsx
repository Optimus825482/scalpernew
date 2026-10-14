"use client";

import { useEffect, useState } from "react";

/**
 * RadarSweep — manuel tarama sırasında gösterilen radar görselleştirmesi.
 * Konsantrik halkalar + artı çizgileri + dönen conic-gradient süpürme huzmesi,
 * farklı gecikmelerle nabız atan hedef noktaları ve dönen durum metinleri.
 * prefers-reduced-motion: dönen huzme/noktalar yerine statik halkalar.
 */
const STATUS_LINES = [
  "Sinyaller toplanıyor",
  "Adaylar puanlanıyor",
  "Filtreler uygulanıyor",
];

export default function RadarSweep({ active }: { active: boolean }) {
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setStatusIndex(0);
      return;
    }
    const timer = window.setInterval(
      () => setStatusIndex((i) => (i + 1) % STATUS_LINES.length),
      1500
    );
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm"
    >
      <div className="flex w-72 flex-col items-center gap-4 rounded-2xl border border-line bg-white p-6 shadow-pop">
        {/* Radar gövdesi */}
        <div className="relative h-44 w-44 rounded-full border border-line bg-canvas">
          {/* Konsantrik halkalar */}
          <span className="absolute inset-4 rounded-full border border-line" />
          <span className="absolute inset-9 rounded-full border border-line" />
          <span className="absolute inset-14 rounded-full border border-line" />
          {/* Artı (crosshair) çizgileri */}
          <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-line" />
          <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-line" />

          {/* Dönen süpürme huzmesi (reduced-motion'da statik) */}
          <span
            className="absolute inset-0 rounded-full motion-safe:animate-spin"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(0,102,255,0.5), rgba(0,102,255,0.12) 55deg, transparent 90deg)",
              animationDuration: "1.6s",
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
            }}
          />

          {/* Nabız atan hedef noktaları (blip) */}
          <span
            className="absolute left-[30%] top-[38%] h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-ping"
            style={{ animationDuration: "1.4s" }}
          />
          <span
            className="absolute left-[62%] top-[58%] h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-ping"
            style={{ animationDuration: "1.4s", animationDelay: "0.5s" }}
          />
          <span
            className="absolute left-[52%] top-[26%] h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-ping"
            style={{ animationDuration: "1.4s", animationDelay: "1s" }}
          />

          {/* Merkez nokta */}
          <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
        </div>

        {/* Durum metinleri */}
        <div className="text-center">
          <p className="odak-kicker">RADAR</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">Piyasa taranıyor…</p>
          <p className="mt-0.5 text-xs text-ink-500">{STATUS_LINES[statusIndex]}</p>
          <p className="mt-2 text-[11px] text-ink-400">Arka planda sürüyor</p>
        </div>
      </div>
    </div>
  );
}
