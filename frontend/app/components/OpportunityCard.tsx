"use client";

import { memo, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import AppLink from "./AppLink";
import { formatPct, formatPrice } from "../lib/format";
import type { OpportunityView } from "../lib/opportunity";
import { useWatchlist } from "../lib/watchlist";
import { usePriceWatch } from "../lib/priceWatch";
import { elapsedLabel, readSignal, touchPeak, type SignalMark } from "../lib/livePrices";
import { SourceBadges } from "./ui";

const MarketChart = dynamic(() => import("./MarketChart"), {
  ssr: false,
  loading: () => <div className="h-[230px] animate-pulse rounded-lg bg-canvas" />,
});

function chartInterval(minutes: number | null) {
  return minutes != null && minutes >= 60 ? "1h" : "5m";
}

function OpportunityCard({
  rank,
  item,
  selected,
  onSelect,
  onQuickBuy,
  livePrice = null,
}: {
  rank: number;
  item: OpportunityView;
  selected: boolean;
  onSelect: () => void;
  onQuickBuy?: (symbol: string, defaultAmountTry?: number) => void;
  livePrice?: number | null;
}) {
  const { potentialPct, strength, price, horizonMinutes, volumeRatio } = item;
  const [chartOpen, setChartOpen] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  const [mark, setMark] = useState<SignalMark | null>(() => readSignal(item.symbol));
  const { isFavorite, toggleFavorite } = useWatchlist();
  const { entries, watch, unwatch, isWatched } = usePriceWatch();

  const favorited = isFavorite(item.symbol);
  const watched = isWatched(item.symbol);
  const watchEntry = entries.find((entry) => entry.symbol === item.symbol);
  const shownPrice = livePrice != null && livePrice > 0 ? livePrice : price;
  const noticePrice = mark?.noticePrice ?? price;
  const livePct = noticePrice != null && shownPrice != null && noticePrice > 0
    ? ((shownPrice - noticePrice) / noticePrice) * 100
    : null;
  const chainPct = mark && mark.chainBase > 0 && shownPrice != null
    ? ((shownPrice - mark.chainBase) / mark.chainBase) * 100
    : null;
  const watchPct = watchEntry && shownPrice != null && watchEntry.price > 0
    ? ((shownPrice - watchEntry.price) / watchEntry.price) * 100
    : null;
  const targetPct = item.targetPct ?? potentialPct;
  const targetPrice = noticePrice != null && targetPct != null
    ? noticePrice * (1 + targetPct / 100)
    : null;
  const peak = Math.max(mark?.peak ?? 0, shownPrice ?? 0);
  const targetHit = targetPrice != null && peak >= targetPrice;
  const interval = chartInterval(horizonMinutes);
  const chartUrl = `/grafik?symbol=${encodeURIComponent(item.symbol)}&interval=${interval}`;

  // Birleşik skor tonu: 75+ güçlü (yeşil), 55+ orta (amber), altı nötr.
  const score = strength != null ? Math.round(strength) : null;
  const scoreTone = score == null
    ? { ring: "border-line", text: "text-ink-500", bg: "bg-canvas", label: "text-ink-400" }
    : score >= 75
      ? { ring: "border-gain/30", text: "text-gain", bg: "bg-gain-soft", label: "text-gain/80" }
      : score >= 55
        ? { ring: "border-amber-300", text: "text-amber-600", bg: "bg-amber-50", label: "text-amber-700/80" }
        : { ring: "border-line", text: "text-ink-700", bg: "bg-canvas", label: "text-ink-400" };

  useEffect(() => {
    setMark(touchPeak(item.symbol, shownPrice ?? price) ?? readSignal(item.symbol));
  }, [item.symbol, shownPrice, price]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowSec(Date.now() / 1000), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!chartOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChartOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [chartOpen]);

  return (
    <>
      <article
        className={`odak-card relative flex w-full flex-col justify-between p-4 transition-all duration-200 hover:shadow-pop ${
          selected ? "ring-2 ring-accent border-accent" : ""
        }`}
      >
        <div>
          {/* ÜST BİLGİ & FAVORİ BUTONU */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-canvas text-xs font-bold text-ink-500">
                {rank}
              </span>
              {horizonMinutes != null && (
                <span className="rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-500">
                  {horizonMinutes} DK
                </span>
              )}
              {/* FAVORİ YILDIZ BUTONU (büyük ve dokunuş dostu) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(item.symbol);
                }}
                className={`grid h-8 w-8 place-items-center rounded-md text-xl leading-none transition-colors ${
                  favorited
                    ? "bg-amber-50 text-amber-500 hover:bg-amber-100"
                    : "text-ink-400 hover:bg-canvas hover:text-amber-500"
                }`}
                title={favorited ? "Favorilerden çıkar" : "Favoriye ekle"}
                aria-label={favorited ? "Favorilerden çıkar" : "Favoriye ekle"}
              >
                {favorited ? "★" : "☆"}
              </button>
            </div>

            {/* YÜKSELİŞ POTANSİYELİ */}
            {potentialPct != null && (
              <div className="rounded-lg bg-gain-soft px-2.5 py-1 text-right">
                <p className="font-mono text-base font-bold leading-none text-gain">↗ {formatPct(potentialPct, 0)}</p>
                <p className="mt-0.5 text-[9px] leading-tight text-gain/80">Hedef Potansiyel</p>
              </div>
            )}
          </div>

          {/* SEMBOL + FİYAT + BİRLEŞİK SKOR (kahraman öğe) */}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <button type="button" onClick={onSelect} aria-pressed={selected} className="min-w-0 flex-1 text-left">
              <p className="font-mono text-base font-bold text-ink-900">
                {item.base} <span className="text-xs font-normal text-ink-400">/ TRY</span>
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-lg font-semibold text-ink-900">{formatPrice(shownPrice)}</span>
                {livePct != null && (
                  <span className={`font-mono text-xs font-semibold ${livePct >= 0 ? "text-gain" : "text-loss"}`}>
                    {livePct >= 0 ? "+" : ""}
                    {formatPct(livePct, 2)}
                  </span>
                )}
              </div>
            </button>
            {score != null && (
              <div className={`shrink-0 rounded-xl border px-2.5 py-1.5 text-right ${scoreTone.bg} ${scoreTone.ring}`}>
                <p className={`font-mono text-2xl font-bold leading-none ${scoreTone.text}`}>{score}</p>
                <p className={`mt-0.5 text-[8px] font-semibold uppercase tracking-wide leading-tight ${scoreTone.label}`}>
                  Birleşik Skor
                </p>
                <p className="text-[8px] leading-tight text-ink-400">
                  {item.sources.length > 1 ? `${item.sources.length} motor` : "tek motor"}
                </p>
              </div>
            )}
          </div>

          {/* İSTATİSTİK ŞERİDİ */}
          <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-line/80 pt-2.5 text-center">
            <div>
              <p className="text-[9px] uppercase tracking-wide text-ink-400">Hedef</p>
              <p className="font-mono text-xs font-semibold text-ink-700">
                {formatPct(item.targetPct ?? potentialPct, 1, true)}
              </p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-ink-400">Olasılık</p>
              <p className="font-mono text-xs font-semibold text-ink-700">
                {item.targetProbability != null ? `%${Math.round(item.targetProbability)}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-ink-400">Hacim Gücü</p>
              <p className="font-mono text-xs font-semibold text-ink-700">
                {volumeRatio != null ? `${volumeRatio.toFixed(1)}×` : "—"}
              </p>
            </div>
          </div>

          {/* SİNYALİ ÜRETEN MOTORLAR (her motora özgü renkli rozetler) */}
          <SourceBadges codes={item.sourceCodes} max={4} label="Motorlar" className="mt-2" />
          {item.confirmSources.length > 0 && <p className="mt-1 text-[10px] text-gain">Uzlaşı: {item.confirmSources.join(" · ")}</p>}
          {item.opposingSources.length > 0 && <p className="mt-1 text-[10px] text-loss">Çelişki: {item.opposingSources.join(" · ")}</p>}
          {item.sourceEvidence.rsi7 != null && <p className="mt-1 text-[10px] text-ink-500">Snapback kanıtı: RSI7 {String(item.sourceEvidence.rsi7)} · RSI14 {String(item.sourceEvidence.rsi14)}{item.stopLoss != null ? ` · Stop ${formatPrice(item.stopLoss)} (${formatPct(-(item.stopLossPct ?? 0), 1)})` : ""}</p>}
          {item.sourceEvidence.return_1m_pct != null && <p className="mt-1 text-[10px] text-ink-500">Nabız kanıtı: 1 dk {formatPct(Number(item.sourceEvidence.return_1m_pct), 2)} · hacim {Number(item.sourceEvidence.volume_burst ?? 0).toFixed(1)}×</p>}
          {item.scoreComponents.length > 0 && <p className="mt-1 text-[10px] text-ink-400">Skor kanıtı: {item.scoreComponents.map(({ label, value }) => `${label} ${Math.round(value)}`).join(" · ")}</p>}
          <p className="mt-2 text-[11px] leading-snug text-ink-600">
            {mark?.continued ? (
              <>
                İlk bildirimden beri <span className="font-mono font-semibold text-ink-800">{elapsedLabel(nowSec - mark.chainAt)}</span>
                {" · zincir "}
                <span className={`font-mono font-semibold ${chainPct == null ? "text-ink-500" : chainPct >= 0 ? "text-gain" : "text-loss"}`}>
                  {chainPct == null ? "—" : `${chainPct >= 0 ? "+" : ""}${chainPct.toFixed(2)}%`}
                </span>
                {" · bu bildirim "}
              </>
            ) : (
              <>
                Bildirimden beri <span className="font-mono font-semibold text-ink-800">{mark ? elapsedLabel(nowSec - mark.noticeAt) : "şimdi"}</span>
                {" · anlık "}
                <span className={`font-mono font-semibold ${livePct == null ? "text-ink-500" : livePct >= 0 ? "text-gain" : "text-loss"}`}>
                  {livePct == null ? "—" : `${livePct >= 0 ? "+" : ""}${livePct.toFixed(2)}%`}
                </span>
                {" · "}
              </>
            )}
            <span className={targetHit ? "font-semibold text-gain" : "text-ink-500"}>
              {targetPrice == null ? "hedef yok" : targetHit ? "hedefe ulaştı" : `hedefe ulaşmadı (${formatPrice(targetPrice)})`}
            </span>
          </p>
          {watched && watchPct != null && (
            <p className="mt-1 text-[11px] text-emerald-700">
              İzleme {watchPct >= 0 ? "+" : ""}{watchPct.toFixed(2)}% · alma fiyatı {formatPrice(watchEntry?.price)}
            </p>
          )}
        </div>

        {/* AKSİYON BUTONLARI: HIZLI İŞLEM VE GRAFİK (mobil dokunuş dostu) */}
        <div className="mt-3.5 space-y-1.5">
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <button
              type="button"
              onClick={() => {
                onSelect();
                onQuickBuy?.(item.symbol);
              }}
              className="flex min-h-[2.5rem] items-center justify-center gap-1 rounded-lg bg-accent px-2 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-accent/90 sm:text-xs"
            >
              <span>⚡</span>
              <span className="truncate">Alım Yap</span>
            </button>

            <button
              type="button"
              onClick={() => setQuickMenuOpen(!quickMenuOpen)}
              aria-expanded={quickMenuOpen}
              aria-label="Diğer hızlı tutar seçenekleri"
              className="min-h-[2.5rem] rounded-lg border border-line bg-canvas px-2.5 text-xs font-bold text-ink-700 transition-colors hover:bg-slate-200"
            >
              ▾
            </button>
          </div>

          {/* Açılır Hızlı Tutar Seçenekleri */}
          {quickMenuOpen && (
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-slate-50 p-1 text-center animate-in fade-in-50 duration-150">
              {[500, 2500, 5000].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    setQuickMenuOpen(false);
                    onSelect();
                    onQuickBuy?.(item.symbol, amount);
                  }}
                  className="min-h-[2rem] rounded border border-line/60 bg-white py-1 font-mono text-[11px] font-semibold text-ink-800 shadow-xs transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
                >
                  ₺{amount.toLocaleString("tr-TR")}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => toggleFavorite(item.symbol)}
              className={`inline-flex min-h-[2.25rem] items-center justify-center rounded-lg border px-2 text-xs font-semibold transition-colors ${
                favorited
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-line bg-white text-ink-700 hover:border-amber-400 hover:text-amber-700"
              }`}
            >
              {favorited ? "★ Favoride" : "☆ Favorilere Ekle"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (watched) unwatch(item.symbol);
                else if (shownPrice != null) watch(item.symbol, shownPrice);
              }}
              disabled={!watched && shownPrice == null}
              className={`inline-flex min-h-[2.25rem] items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition-colors ${
                watched
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "border-line bg-white text-ink-700 hover:border-emerald-400 hover:text-emerald-700"
              } disabled:opacity-50`}
              title={watched ? "İzlemeden çıkar" : shownPrice != null ? `${formatPrice(shownPrice)} fiyatından izlemeye al` : "Fiyat yok"}
            >
              {watched ? "✓ İzlemede" : "◎ İzlemeye Al"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setChartOpen(true)}
            aria-haspopup="dialog"
            className="inline-flex min-h-[2.25rem] w-full items-center justify-center rounded-lg border border-accent/25 bg-accent-soft px-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/15"
          >
            ▥ Grafik
          </button>
        </div>
      </article>

      {/* GRAFİK MODALİ */}
      {chartOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setChartOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`chart-title-${rank}`}
            className="max-h-[95vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-line bg-white p-4 shadow-2xl sm:p-6"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleFavorite(item.symbol)}
                  className={`text-lg ${favorited ? "text-amber-500" : "text-ink-400 hover:text-amber-500"}`}
                >
                  {favorited ? "★" : "☆"}
                </button>
                <div>
                  <p className="text-xs font-medium text-ink-400">Teknik Grafik & Göstergeler</p>
                  <h2 id={`chart-title-${rank}`} className="text-lg font-bold text-ink-900">
                    {item.base} / TRY
                  </h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <AppLink
                  href={chartUrl}
                  onClick={() => setChartOpen(false)}
                  className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white shadow-sm"
                >
                  Tam Ekranda Aç
                </AppLink>
                <button
                  type="button"
                  aria-label="Grafik penceresini kapat"
                  onClick={() => setChartOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line text-lg text-ink-500 hover:bg-canvas"
                >
                  ×
                </button>
              </div>
            </div>
            <MarketChart initialSymbol={item.symbol} initialInterval={interval} compact />
          </section>
        </div>
      )}
    </>
  );
}

/**
 * Performans: sayfa her yoklamada (20 sn) veya üst durum değiştiğinde (toast,
 * hızlı tutar vb.) 12 kart yeniden render ediliyordu. memo ile yalnızca kendi
 * verisi/seçimi değişen kartlar yeniden çizilir; fonksiyon prop'ları her render
 * yeni closure olsa da veri aynıysa davranışları da aynıdır, bu yüzden
 * karşılaştırmaya dahil edilmez.
 */
export default memo(
  OpportunityCard,
  (previous, next) =>
    previous.rank === next.rank &&
    previous.selected === next.selected &&
    previous.livePrice === next.livePrice &&
    previous.item === next.item,
);
