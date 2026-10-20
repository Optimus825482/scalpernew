"use client";

import { useState } from "react";
import AppLink from "./AppLink";
import { apiRequest } from "../lib/api";
import { usePoll } from "../lib/hooks";
import { useSymbolPrices } from "../lib/livePrices";
import { formatFixed, formatPct, formatPrice, formatSignedTL, formatTL } from "../lib/format";
import { isVisibleHolding } from "../lib/holdings";
import type { BinanceHolding, BinancePositions, BinanceSettings } from "../lib/types";
import { useWatchlist } from "../lib/watchlist";
import { Badge, EmptyState, Skeleton } from "./ui";

const SELL_PERCENTS = [25, 50, 75, 100] as const;

/** Binance TR gerçek hesabındaki elde tutulan coinleri ve anlık maliyet farkını gösterir. */
export default function ActiveTradesTable({
  limit = 200,
  compact = false,
  onSelectSymbol,
}: {
  limit?: number;
  compact?: boolean;
  onSelectSymbol?: (symbol: string) => void;
}) {
  const settings = usePoll<BinanceSettings>("/api/binance/settings", 30_000);
  const account = usePoll<BinancePositions>(settings.data?.configured ? "/api/binance/positions" : null, 45_000, 20_000);
  const { isFavorite, toggleFavorite } = useWatchlist();
  const [selling, setSelling] = useState<BinanceHolding | null>(null);
  const [percent, setPercent] = useState<(typeof SELL_PERCENTS)[number]>(100);
  const [sellBusy, setSellBusy] = useState(false);
  const [sellMessage, setSellMessage] = useState<{ tone: "gain" | "loss"; text: string } | null>(null);
  const sellEnabled = Boolean(settings.data?.sell_enabled);

  function openSell(holding: BinanceHolding) {
    setPercent(100);
    setSelling(holding);
  }

  async function submitSell() {
    if (!selling || sellBusy) return;
    const bag = Number(selling.free || 0) + Number(selling.locked || 0);
    if (!(bag > 0)) {
      setSellMessage({ tone: "loss", text: `${selling.asset} için satılacak bakiye yok.` });
      setSelling(null);
      return;
    }
    setSellBusy(true);
    try {
      const response = await apiRequest("/api/binance/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset: selling.asset, percent, confirmation: "REAL_SELL" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.detail || `Satış emri gönderilemedi (${response.status})`);
      const sold = body?.executed_qty ?? body?.executedQty;
      const cancelled = Array.isArray(body?.cancelled_orders) ? body.cancelled_orders.length : 0;
      const cancelledText = cancelled > 0 ? ` Önce ${cancelled} stop/kâr emri iptal edildi.` : "";
      setSellMessage({ tone: "gain", text: `${selling.asset} için piyasa satış emri gitti.${cancelledText}${sold != null ? ` Miktar ${formatFixed(sold, 6)}.` : ""}` });
      setSelling(null);
      account.reload();
    } catch (reason) {
      setSellMessage({ tone: "loss", text: reason instanceof Error ? reason.message : "Satış emri gönderilemedi" });
    } finally {
      setSellBusy(false);
    }
  }

  const coins = (account.data?.holdings || []).filter((h) => h.asset !== "TRY" && Number(h.total) > 0);
  const prices = useSymbolPrices(coins.map((holding) => `${holding.asset}TRY`));
  const marked = coins.map((holding) => {
    const live = prices[`${holding.asset}TRY`];
    if (!(live > 0)) return holding;
    const total = Number(holding.total);
    const avg = holding.avg_cost_try == null ? null : Number(holding.avg_cost_try);
    const pnl = avg != null && avg > 0 ? (live - avg) * total : holding.pnl_try;
    const pct = avg != null && avg > 0 ? ((live - avg) / avg) * 100 : holding.pnl_pct;
    return { ...holding, price_try: live, value_try: total * live, pnl_try: pnl, pnl_pct: pct };
  });
  const holdings = marked.filter(isVisibleHolding).slice(0, limit);

  if (!settings.data?.configured && !settings.loading)
    return (
      <EmptyState
        title="Binance TR hesabı bağlı değil"
        hint="Gerçek varlık ve anlık K/Z verisini görmek için Ayarlar'dan hesabınızı bağlayın."
      />
    );
  if (settings.loading || (account.loading && !account.data)) return <Skeleton className="h-40" />;
  if (account.error && !account.data) return <EmptyState title="Binance TR varlıkları alınamadı" hint={account.error} tone="loss" />;
  if (holdings.length === 0)
    return <EmptyState title="Açık varlık yok" hint={coins.length > 0 ? "50 TL altındaki bakiyeler gizlendi." : "Bağlı Binance TR hesabında takip edilecek coin bakiyesi bulunmuyor."} />;

  const sellFree = Number(selling?.free || 0) + Number(selling?.locked || 0);
  const sellQty = sellFree * (percent / 100);
  const sellValue = selling?.price_try ? sellQty * Number(selling.price_try) : null;

  return (
    <div className="odak-scroll">
      {sellMessage && (
        <div role="status" className={`mb-3 rounded-xl border p-3 text-sm ${sellMessage.tone === "gain" ? "border-gain/30 bg-gain-soft/40 text-gain" : "border-loss/30 bg-loss-soft/40 text-loss"}`}>
          {sellMessage.text}
        </div>
      )}
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-400">
            <th className="pb-2 pr-2 font-medium w-8">★</th>
            <th className="pb-2 pr-2 font-medium">Coin</th>
            <th className="pb-2 pr-2 font-medium">Kaynak</th>
            {!compact && <th className="pb-2 pr-2 text-right font-medium">Ortalama Maliyet</th>}
            <th className="pb-2 pr-2 text-right font-medium">Anlık Fiyat</th>
            <th className="pb-2 pr-2 text-right font-medium">Bakiye</th>
            <th className="pb-2 pr-2 text-right font-medium">Net K/Z</th>
            <th className="pb-2 pr-2 text-right font-medium">Getiri %</th>
            <th className="pb-2 text-right font-medium">Hızlı Aksiyon</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => {
            const symbol = `${holding.asset}TRY`;
            const pnl = holding.pnl_try == null ? null : Number(holding.pnl_try);
            const pct = holding.pnl_pct == null ? null : Number(holding.pnl_pct);
            const tone = pnl == null ? "text-ink-500" : pnl > 0 ? "text-gain font-semibold" : pnl < 0 ? "text-loss font-semibold" : "text-ink-500";
            const fav = isFavorite(symbol);

            return (
              <tr key={holding.asset} className="border-t border-line hover:bg-slate-50/50">
                <td className="py-2.5 pr-2">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(symbol)}
                    className={`text-sm ${fav ? "text-amber-500" : "text-ink-300 hover:text-amber-500"}`}
                    title={fav ? "Favoriden çıkar" : "Favoriye ekle"}
                  >
                    {fav ? "★" : "☆"}
                  </button>
                </td>
                <td className="py-2.5 pr-2">
                  <span className="font-mono font-bold text-ink-900">{holding.asset}</span>
                  <span className="text-xs text-ink-400"> / TRY</span>
                </td>
                <td className="py-2.5 pr-2">
                  <Badge tone="accent">Binance TR</Badge>
                </td>
                {!compact && (
                  <td className="py-2.5 pr-2 text-right font-mono text-ink-700">
                    {formatPrice(holding.avg_cost_try)}
                  </td>
                )}
                <td className="py-2.5 pr-2 text-right font-mono text-ink-900 font-medium">
                  {formatPrice(holding.price_try)}
                </td>
                <td className="py-2.5 pr-2 text-right font-mono text-ink-500">
                  {formatFixed(holding.total, 4)}
                </td>
                <td className={`py-2.5 pr-2 text-right font-mono ${tone}`}>
                  {formatSignedTL(pnl)}
                </td>
                <td className={`py-2.5 pr-2 text-right font-mono ${tone}`}>
                  {formatPct(pct, 2, true)}
                </td>
                <td className="py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <AppLink
                      href={`/grafik?symbol=${encodeURIComponent(symbol)}`}
                      className="rounded border border-line bg-white px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent-soft"
                    >
                      Grafik
                    </AppLink>
                    <button
                      type="button"
                      onClick={() => onSelectSymbol?.(symbol)}
                      className="rounded bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent hover:text-white transition-colors"
                    >
                      İşlem Yap
                    </button>
                    <button
                      type="button"
                      onClick={() => openSell(holding)}
                      className="rounded bg-loss px-2 py-1 text-[11px] font-semibold text-white hover:brightness-95"
                    >
                      Sat
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {selling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="gercek-satis-baslik">
          <div className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-xl">
            <p className="odak-kicker">Gerçek piyasa satışı</p>
            <h3 id="gercek-satis-baslik" className="mt-1 text-lg font-semibold text-ink-900">{selling.asset} sat</h3>
            <p className="mt-1 text-sm text-ink-500">Varsa stop ve kâr emirleri önce iptal edilir. Sonra seçilen yüzde piyasa fiyatından satılır.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-canvas px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-ink-400">Toplam</p>
                <p className="font-mono font-semibold text-ink-900">{formatFixed(sellFree, 6)} {selling.asset}</p>
              </div>
              <div className="rounded-lg bg-canvas px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-ink-400">Kilitli</p>
                <p className="font-mono font-semibold text-ink-900">{formatFixed(selling.locked || 0, 6)}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {SELL_PERCENTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPercent(value)}
                  className={`rounded-lg border px-2 py-2 text-sm font-semibold ${percent === value ? "border-loss bg-loss text-white" : "border-line bg-white text-ink-700 hover:border-loss"}`}
                >
                  %{value}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-700">
              Satılacak: <span className="font-mono font-semibold">{formatFixed(sellQty, 6)} {selling.asset}</span>
              {sellValue != null ? <span className="text-ink-500"> · yaklaşık {formatTL(sellValue)}</span> : null}
            </p>
            {!sellEnabled && <p className="mt-2 text-sm text-warn">Gerçek satış kapalı. Ayarlar’dan Binance TR gerçek satış anahtarını aç.</p>}
            {sellFree <= 0 && <p className="mt-2 text-sm text-loss">Satılacak bakiye yok.</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setSelling(null)} disabled={sellBusy} className="rounded-lg border border-line px-3 py-2 text-sm text-ink-600 hover:bg-canvas">Vazgeç</button>
              <button type="button" onClick={() => void submitSell()} disabled={sellBusy || !sellEnabled || !(sellQty > 0)} className="rounded-lg bg-loss px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {sellBusy ? "Gönderiliyor…" : `%${percent} sat`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
