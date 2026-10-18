"use client";

import { useEffect, useState } from "react";
import AppLink from "../components/AppLink";
import { apiRequest } from "../lib/api";
import { usePoll } from "../lib/hooks";
import { useLiveMessages, useLiveStatus } from "../lib/liveSocket";
import { fmtDateTime, formatFixed, formatPrice } from "../lib/format";
import { baseAsset } from "../lib/opportunity";
import type { BinanceSettings } from "../lib/types";
import { Badge, Card, EmptyState, SectionHeader, Skeleton } from "../components/ui";

export type OpenOrder = {
  orderId: number;
  symbol: string;
  side: string;
  type: string;
  price: string;
  stopPrice?: string;
  origQty: string;
  executedQty?: string;
  status?: string;
  time: number;
  orderListId?: number;
  clientOrderId?: string;
};

function sideLabel(side: string) {
  const raw = String(side).toUpperCase();
  return raw === "BUY" || raw === "1" ? "ALIŞ" : "SATIŞ";
}

const OPEN_ORDER_STATUSES = new Set(["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL", "SYSTEM_PROCESSING"]);

function orderStatusCode(status: unknown): string {
  const raw = status == null ? "" : String(status).toUpperCase();
  const numeric: Record<string, string> = {
    "-2": "SYSTEM_PROCESSING",
    "0": "NEW",
    "1": "PARTIALLY_FILLED",
    "2": "FILLED",
    "3": "CANCELED",
    "4": "PENDING_CANCEL",
    "5": "REJECTED",
    "6": "EXPIRED",
  };
  return numeric[raw] || raw;
}

function applyExecution(list: OpenOrder[], fields: Record<string, unknown>): OpenOrder[] {
  const orderId = Number(fields.order_id ?? 0);
  const symbol = String(fields.symbol ?? "").toUpperCase();
  if (!orderId || !symbol) return list;
  const status = orderStatusCode(fields.status);
  const rest = list.filter((order) => !(order.orderId === orderId && String(order.symbol).toUpperCase() === symbol));
  if (!OPEN_ORDER_STATUSES.has(status)) return rest;
  const created = Number(fields.order_time_ms ?? fields.transaction_time_ms ?? Date.now());
  const row: OpenOrder = {
    orderId,
    symbol,
    side: String(fields.side ?? ""),
    type: String(fields.order_type ?? ""),
    price: String(fields.order_price ?? "0"),
    stopPrice: String(fields.stop_price ?? "0"),
    origQty: String(fields.order_quantity ?? "0"),
    executedQty: String(fields.cumulative_filled_quantity ?? "0"),
    status,
    time: Number.isFinite(created) && created > 0 ? created : Date.now(),
    orderListId: Number(fields.order_list_id ?? -1),
    clientOrderId: String(fields.client_order_id ?? ""),
  };
  return [row, ...rest].sort((left, right) => Number(right.time || 0) - Number(left.time || 0));
}

/** Binance TR açık (bekleyen) emirler: listeleme, durum ve tek tıkla iptal. */
export default function EmirlerPage() {
  const settings = usePoll<BinanceSettings>("/api/binance/settings", 30_000);
  const live = useLiveStatus();
  const orders = usePoll<{ orders: OpenOrder[]; count: number; ok?: boolean; user_stream?: { connected?: boolean; state?: string } }>(
    settings.data?.configured ? "/api/binance/open-orders" : null, live === "open" ? 60_000 : 15_000);
  const [liveOrders, setLiveOrders] = useState<OpenOrder[] | null>(null);
  useEffect(() => {
    if (orders.data?.orders) setLiveOrders(orders.data.orders);
  }, [orders.data]);
  useLiveMessages((message) => {
    if (message.type !== "binance_user_event") return;
    const event = message.data as { event_type?: string; fields?: Record<string, unknown> } | undefined;
    if (event?.event_type !== "executionReport" || !event.fields) return;
    setLiveOrders((current) => applyExecution(current ?? [], event.fields || {}));
  });
  const [cancelBusy, setCancelBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "gain" | "loss"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);

  async function cancelOrder(order: OpenOrder) {
    setCancelBusy(order.orderId);
    setMessage(null);
    try {
      const response = await apiRequest("/api/binance/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.orderId, symbol: order.symbol }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.detail || `Emir iptal edilemedi (${response.status})`);
      setMessage({ tone: "gain", text: `${order.symbol} emri #${order.orderId} iptal edildi.` });
      orders.reload();
    } catch (reason) {
      setMessage({ tone: "loss", text: reason instanceof Error ? reason.message : "Emir iptal edilemedi" });
    } finally {
      setCancelBusy(null);
      setConfirming(null);
    }
  }

  async function cancelAllOrders(list: OpenOrder[]) {
    if (!list.length) return;
    setCancelBusy(-1);
    setMessage(null);
    const results = await Promise.allSettled(
      list.map((order) =>
        apiRequest("/api/binance/cancel-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: order.orderId, symbol: order.symbol }),
        }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res;
        })
      )
    );
    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = list.length - successCount;
    if (successCount === 0) {
      setMessage({ tone: "loss", text: `Emirler iptal edilemedi (${failCount} hata).` });
    } else if (failCount > 0) {
      setMessage({ tone: "gain", text: `${successCount} açık emir iptal edildi, ${failCount} emir iptal edilemedi.` });
    } else {
      setMessage({ tone: "gain", text: `Tüm açık emirler (${successCount}) başarıyla iptal edildi.` });
    }
    setCancelBusy(null);
    setConfirmingAll(false);
    orders.reload();
  }

  if (settings.loading) return <Skeleton className="h-64" />;
  if (!settings.data?.configured) return <EmptyState title="Binance TR hesabı bağlı değil" hint="Açık emirleri görüntülemek için Ayarlar'dan hesabınızı bağlayın." />;

  const list = liveOrders ?? orders.data?.orders ?? [];
  const exchangeConnected = Boolean(orders.data?.user_stream?.connected);
  const streamNote = live !== "open"
    ? "Uygulama soketi kapalı · liste REST ile yenilenir"
    : exchangeConnected
      ? "Özel emir akışı bağlı · dolum ve iptal anında düşer"
      : "Emir akışı bağlanıyor · ilk liste REST ile geldi";

  return <div className="space-y-5">
    <SectionHeader
      eyebrow="Açık Emirler"
      title="Bekleyen Binance TR emirleri"
      description="Borsada gerçekleşmeyi bekleyen limit/stop/OCO emirleri. İptal kararı anında uygulanır."
      actions={<div className="flex items-center gap-2">
        {list.length > 1 && (
          confirmingAll ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={cancelBusy === -1}
                onClick={() => cancelAllOrders(list)}
                className="rounded-lg bg-loss px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
              >
                {cancelBusy === -1 ? "İptal ediliyor…" : "Tümünü İptal Et"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingAll(false)}
                className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-600 hover:bg-canvas"
              >
                Vazgeç
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingAll(true)}
              className="rounded-lg border border-loss/40 bg-loss-soft/40 px-3 py-1.5 text-xs font-semibold text-loss hover:bg-loss-soft transition-colors"
            >
              Tümünü İptal Et ({list.length})
            </button>
          )
        )}
        <Badge tone={exchangeConnected && live === "open" ? "gain" : "warn"}>{exchangeConnected && live === "open" ? "Canlı" : "Bağlanıyor"}</Badge>
        <button type="button" onClick={() => orders.reload()} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-soft">⟳ Yenile</button>
      </div>}
    />

    {message && <div role="status" className={`rounded-xl border p-3 text-sm ${message.tone === "gain" ? "border-gain/30 bg-gain-soft/40 text-gain" : "border-loss/30 bg-loss-soft/40 text-loss"}`}>{message.text}</div>}
    <p className="text-[10px] text-ink-400" role="status">{streamNote}</p>

    {orders.loading && !orders.data ? <Skeleton className="h-48" /> : orders.error && !orders.data ? (
      <EmptyState title="Açık emirler alınamadı" hint={orders.error} tone="loss" />
    ) : list.length === 0 ? (
      <EmptyState title="Bekleyen emir yok" hint="Borsada açık emriniz bulunmuyor. Yeni emir için ana sayfadaki işlem panelini kullanın." />
    ) : (
      <Card className="p-4">
        <div className="odak-scroll"><table className="w-full min-w-[860px] border-collapse text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink-400">
            <th className="pb-2 pr-3 font-medium">Zaman</th><th className="pb-2 pr-3 font-medium">Coin</th><th className="pb-2 pr-3 font-medium">Yön</th>
            <th className="pb-2 pr-3 font-medium">Tür</th><th className="pb-2 pr-3 text-right font-medium">Fiyat</th>
            <th className="pb-2 pr-3 text-right font-medium">Miktar</th><th className="pb-2 pr-3 text-right font-medium">Gerçekleşen</th>
            <th className="pb-2 pr-3 font-medium">Emir No</th><th className="pb-2 font-medium">İşlem</th>
          </tr></thead>
          <tbody>{list.map((order) => {
            const isOco = order.orderListId != null && order.orderListId >= 0;
            const stop = Number(order.stopPrice || 0);
            return <tr key={`${order.symbol}-${order.orderId}`} className="border-t border-line">
              <td className="py-2 pr-3 font-mono text-xs text-ink-500">{fmtDateTime(order.time)}</td>
              <td className="py-2 pr-3 font-mono font-semibold text-ink-900">
                <AppLink
                  href={`/grafik?symbol=${encodeURIComponent(order.symbol)}`}
                  className="hover:text-accent transition-colors underline decoration-dotted"
                  title={`${order.symbol} grafiğini aç`}
                >
                  {baseAsset(order.symbol)}
                </AppLink>
              </td>
              <td className="py-2 pr-3"><Badge tone={String(order.side).toUpperCase() === "BUY" || String(order.side) === "1" ? "gain" : "loss"}>{sideLabel(order.side)}</Badge></td>
              <td className="py-2 pr-3 text-xs text-ink-600">{isOco ? `OCO${stop > 0 ? " · tetik " + formatPrice(stop) : ""}` : order.type || "—"}</td>
              <td className="py-2 pr-3 text-right font-mono text-ink-700">{Number(order.price) > 0 ? formatPrice(Number(order.price)) : "Piyasa"}</td>
              <td className="py-2 pr-3 text-right font-mono text-ink-700">{formatFixed(order.origQty, 6)}</td>
              <td className="py-2 pr-3 text-right font-mono text-ink-500">{formatFixed(order.executedQty || 0, 6)}</td>
              <td className="py-2 pr-3 font-mono text-xs text-ink-400">#{order.orderId}</td>
              <td className="py-2">
                {confirming === order.orderId ? (
                  <div className="flex items-center gap-1.5">
                    <button type="button" disabled={cancelBusy === order.orderId} onClick={() => cancelOrder(order)} className="rounded-md bg-loss px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50">{cancelBusy === order.orderId ? "İptal…" : "Onayla"}</button>
                    <button type="button" onClick={() => setConfirming(null)} className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-500">Vazgeç</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirming(order.orderId)} className="rounded-md border border-loss/40 px-2.5 py-1 text-[11px] font-semibold text-loss hover:bg-loss-soft">İptal et</button>
                )}
              </td>
            </tr>;
          })}</tbody>
        </table></div>
        <p className="mt-3 text-[10px] text-ink-400">Toplam {list.length} açık emir. OCO emirlerinin her iki bacağı tek liste kimliğiyle gruplanır.</p>
      </Card>
    )}
  </div>;
}
