"use client";

import { useEffect, useMemo, useState } from "react";
import AppLink from "./AppLink";
import { apiRequest } from "../lib/api";
import { formatPrice } from "../lib/format";
import { usePriceWatch, type PriceWatchEntry } from "../lib/priceWatch";
import { Card } from "./ui";

type TickerRow = { symbol: string; available: boolean; last: number | null };

/**
 * "İzlemeye Al" ile kaydedilen sembolleri kartın İZLEME fiyatından itibaren
 * canlı fiyat ve % değişimle üst şeritte gösterir. Fiyatlar
 * /api/market-tickers toplu ucundan 15 saniyede bir tazelenir.
 */
export default function WatchStrip() {
  const { entries, unwatch } = usePriceWatch();
  const [prices, setPrices] = useState<Record<string, number>>({});

  const symbolsParam = useMemo(() => entries.map((entry) => entry.symbol).join(","), [entries]);

  useEffect(() => {
    if (!symbolsParam) return;
    let active = true;
    const load = async () => {
      try {
        const response = await apiRequest(`/api/market-tickers?symbols=${encodeURIComponent(symbolsParam)}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { tickers?: TickerRow[] };
        if (!active) return;
        const next: Record<string, number> = {};
        for (const row of body.tickers ?? []) {
          if (row.available && Number.isFinite(Number(row.last))) next[row.symbol] = Number(row.last);
        }
        setPrices(next);
      } catch {
        // Şerit fiyat alamazsa son bilinen fiyatla devam eder.
      }
    };
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [symbolsParam]);

  if (entries.length === 0) return null;

  return (
    <Card className="p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="odak-kicker">◎ İzlemede · alma anındaki fiyattan itibaren</p>
        <span className="text-[10px] text-ink-400">{entries.length}/{30} kayıt</span>
      </div>
      <div className="odak-ticker-scroll mt-2 flex gap-2 overflow-x-auto pb-1">
        {entries.map((entry) => (
          <WatchChip key={entry.symbol} entry={entry} current={prices[entry.symbol] ?? null} onRemove={() => unwatch(entry.symbol)} />
        ))}
      </div>
    </Card>
  );
}

function WatchChip({ entry, current, onRemove }: { entry: PriceWatchEntry; current: number | null; onRemove: () => void }) {
  const diffPct = current != null && entry.price > 0 ? ((current - entry.price) / entry.price) * 100 : null;
  const tone = diffPct == null ? "text-ink-500" : diffPct >= 0 ? "text-gain" : "text-loss";
  return (
    <div className="flex min-w-[150px] shrink-0 flex-col rounded-xl border border-line bg-white p-2.5">
      <div className="flex items-center justify-between gap-2">
        <AppLink
          href={`/grafik?symbol=${encodeURIComponent(entry.symbol)}&interval=5m`}
          className="font-mono text-xs font-bold text-ink-900 hover:text-accent"
        >
          {entry.base}<span className="text-[10px] font-normal text-ink-400">/TRY</span>
        </AppLink>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${entry.base} izlemeden çıkar`}
          title="İzlemeden çıkar"
          className="grid h-5 w-5 place-items-center rounded text-ink-300 hover:bg-canvas hover:text-loss"
        >
          ×
        </button>
      </div>
      <p className="mt-1 font-mono text-sm font-semibold text-ink-900">
        {current != null ? formatPrice(current) : "—"}
      </p>
      <p className={`mt-0.5 font-mono text-[11px] font-semibold ${tone}`}>
        {diffPct != null ? `${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(2)}%` : "—"}
        <span className="ml-1 font-sans text-[9px] font-normal text-ink-400">
          alma {formatPrice(entry.price)}
        </span>
      </p>
    </div>
  );
}
