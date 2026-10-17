"use client";

import { apiRequest } from "../lib/api";
import { usePoll } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { fmtDateTime, formatPrice, formatSignedTL } from "../lib/format";
import { Badge, Card, EmptyState, SectionHeader, Skeleton } from "./ui";

type PaperTrade = {
  id: number;
  symbol: string;
  status: string;
  entry_price?: number;
  current_price?: number | null;
  exit_price?: number | null;
  quantity?: number;
  entry_time?: number;
  exit_time?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  pnl?: number | null;
  pnl_pct?: number | null;
  notification_score?: number | null;
  exit_reason?: string | null;
};

type PaperList = { trades?: PaperTrade[]; paper_only?: boolean };

function pnlOf(trade: PaperTrade): { try: number | null; pct: number | null } {
  if (trade.status !== "open") {
    return {
      try: trade.pnl == null ? null : Number(trade.pnl),
      pct: trade.pnl_pct == null ? null : Number(trade.pnl_pct),
    };
  }
  const entry = Number(trade.entry_price || 0);
  const qty = Number(trade.quantity || 0);
  const current = Number(trade.current_price || 0);
  if (!(entry > 0) || !(qty > 0) || !(current > 0)) return { try: null, pct: null };
  const gross = (current - entry) * qty;
  return { try: gross, pct: (gross / (entry * qty)) * 100 };
}

export default function PaperTrades() {
  const { role } = useAuth();
  const isAdmin = String(role || "").toLowerCase() === "admin";
  const open = usePoll<PaperList>(isAdmin ? "/api/auto-paper/trades?status=open&limit=50" : null, 15_000);
  const closed = usePoll<PaperList>(isAdmin ? "/api/auto-paper/trades?status=closed&limit=8" : null, 30_000);

  if (!isAdmin) return null;

  async function closeTrade(trade: PaperTrade) {
    const response = await apiRequest(`/api/auto-paper/trades/${trade.id}/close`, { method: "POST" });
    if (!response.ok) return;
    open.reload();
    closed.reload();
  }

  const openRows = open.data?.trades || [];
  const closedRows = closed.data?.trades || [];

  return (
    <Card className="p-5">
      <SectionHeader
        eyebrow="Yalnız yönetici"
        title="Sinyal paper işlemleri"
        description="Canlı radar bildirimi gelince sistem bu deftere sanal işlem açar. Elle tarama emir açmaz. Gerçek Binance bakiyesi yukarıdaki tablodadır."
      />
      {open.loading && !open.data ? <Skeleton className="mt-4 h-24" /> : open.error && !open.data ? (
        <EmptyState title="Paper listesi alınamadı" hint={open.error} tone="loss" />
      ) : openRows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-500">Açık paper işlem yok. Sistem bir sinyal bildirdiğinde burada görünür.</p>
      ) : (
        <div className="odak-scroll mt-4">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-400">
                <th className="pb-2 pr-3 font-medium">Sembol</th>
                <th className="pb-2 pr-3 font-medium">Giriş</th>
                <th className="pb-2 pr-3 text-right font-medium">Fiyat</th>
                <th className="pb-2 pr-3 text-right font-medium">Anlık</th>
                <th className="pb-2 pr-3 text-right font-medium">K/Z</th>
                <th className="pb-2 pr-3 text-right font-medium">Hedef</th>
                <th className="pb-2 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {openRows.map((trade) => {
                const pnl = pnlOf(trade);
                const tone = pnl.try == null ? "text-ink-500" : pnl.try >= 0 ? "text-gain" : "text-loss";
                return (
                  <tr key={trade.id} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono font-semibold text-ink-900">{trade.symbol}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-500">{fmtDateTime(trade.entry_time)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{formatPrice(trade.entry_price)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{formatPrice(trade.current_price)}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${tone}`}>
                      {pnl.try == null ? "—" : `${formatSignedTL(pnl.try)} (${pnl.pct?.toFixed(2)}%)`}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-ink-600">{formatPrice(trade.take_profit)}</td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => closeTrade(trade)} className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-ink-600 hover:border-loss hover:text-loss">Kapat</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {closedRows.length > 0 && (
        <div className="mt-4">
          <p className="odak-kicker">Son kapananlar</p>
          <ul className="mt-2 space-y-1 text-xs text-ink-600">
            {closedRows.map((trade) => {
              const pnl = pnlOf(trade);
              const tone = pnl.try == null ? "text-ink-500" : pnl.try >= 0 ? "text-gain" : "text-loss";
              return (
                <li key={trade.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-1.5">
                  <span className="font-mono font-semibold text-ink-800">{trade.symbol}</span>
                  <Badge tone="neutral">{trade.exit_reason || "kapandı"}</Badge>
                  <span className={`font-mono ${tone}`}>{pnl.try == null ? "—" : formatSignedTL(pnl.try)}</span>
                  <span className="font-mono text-ink-400">{fmtDateTime(trade.exit_time || trade.entry_time)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
