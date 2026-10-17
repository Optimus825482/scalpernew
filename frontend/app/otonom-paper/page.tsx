"use client";

import AppLink from "../components/AppLink";
import { apiRequest } from "../lib/api";
import { usePoll } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { fmtDateTime, formatPrice, formatSignedTL, formatTL } from "../lib/format";
import { Badge, Card, EmptyState, SectionHeader, Skeleton } from "../components/ui";

type PaperTrade = {
  id: number;
  symbol: string;
  status: string;
  entry_price?: number;
  current_price?: number | null;
  exit_price?: number | null;
  quantity?: number;
  order_value_try?: number | null;
  entry_time?: number;
  exit_time?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  pnl?: number | null;
  pnl_pct?: number | null;
  exit_reason?: string | null;
};

type PaperList = { trades?: PaperTrade[] };
type PaperStats = {
  cash_try?: number;
  initial_try?: number;
  balance_pct?: number;
  stats?: { total_pnl_try?: number; winning?: number; losing?: number; open?: number; closed?: number };
};

function money(trade: PaperTrade): { try: number | null; pct: number | null } {
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
  const roundTrip = entry * qty * 0.0015 * 2;
  const net = gross - roundTrip;
  return { try: net, pct: (net / (entry * qty)) * 100 };
}

export default function OtonomPaperPage() {
  const { role } = useAuth();
  const isAdmin = String(role || "").toLowerCase() === "admin";
  const book = usePoll<PaperStats>(isAdmin ? "/api/auto-paper/stats" : null, 15_000);
  const open = usePoll<PaperList>(isAdmin ? "/api/auto-paper/trades?status=open&limit=50" : null, 15_000);
  const closed = usePoll<PaperList>(isAdmin ? "/api/auto-paper/trades?status=closed&limit=40" : null, 30_000);

  if (!isAdmin) return <EmptyState title="Yalnız yönetici" hint="Otonom paper defteri admin oturumunda görünür." />;

  async function closeTrade(trade: PaperTrade) {
    const response = await apiRequest(`/api/auto-paper/trades/${trade.id}/close`, { method: "POST" });
    if (!response.ok) return;
    open.reload();
    closed.reload();
    book.reload();
  }

  const openRows = open.data?.trades || [];
  const closedRows = closed.data?.trades || [];
  const cash = book.data?.cash_try;
  const initial = book.data?.initial_try ?? 10000;
  const pct = book.data?.balance_pct ?? 30;
  const openValue = openRows.reduce((sum, trade) => sum + Number(trade.order_value_try || 0), 0);

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Yalnız yönetici"
        title="Otonom paper"
        description="Sistem sinyal ürettiğinde serbest nakdin yüzde otuzu ile sanal alım açar. Giriş ve çıkış komisyonu düşülür. Karttaki Alım Yap gerçek hesap paneline gider; bu deftere yazmaz."
      />

      {book.loading && !book.data ? <Skeleton className="h-24" /> : (
        <div className="grid gap-3 sm:grid-cols-4">
          <Card className="p-4">
            <p className="odak-kicker">Serbest bakiye</p>
            <p className="mt-1 font-mono text-xl font-bold text-ink-900">{cash == null ? "…" : formatTL(cash)}</p>
            <p className="text-[11px] text-ink-400">Başlangıç {formatTL(initial)}</p>
          </Card>
          <Card className="p-4">
            <p className="odak-kicker">Açık tutar</p>
            <p className="mt-1 font-mono text-xl font-bold text-ink-900">{formatTL(openValue)}</p>
            <p className="text-[11px] text-ink-400">{openRows.length} açık işlem</p>
          </Card>
          <Card className="p-4">
            <p className="odak-kicker">Alım payı</p>
            <p className="mt-1 font-mono text-xl font-bold text-ink-900">%{pct}</p>
            <p className="text-[11px] text-ink-400">serbest TL üzerinden</p>
          </Card>
          <Card className="p-4">
            <p className="odak-kicker">Bugünkü kapanan net</p>
            <p className={`mt-1 font-mono text-xl font-bold ${(book.data?.stats?.total_pnl_try ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>{formatSignedTL(book.data?.stats?.total_pnl_try)}</p>
            <p className="text-[11px] text-ink-400">{book.data?.stats?.winning ?? 0} kâr · {book.data?.stats?.losing ?? 0} zarar</p>
          </Card>
        </div>
      )}

      <Card className="p-4">
        <SectionHeader eyebrow="Açık" title="Açık paper işlemler" />
        {open.loading && !open.data ? <Skeleton className="mt-3 h-24" /> : openRows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">Açık işlem yok. Bir sonraki arka plan taramasında eşiği geçen sinyal burada alım açar.</p>
        ) : (
          <TradeTable rows={openRows} onClose={closeTrade} />
        )}
      </Card>

      <Card className="p-4">
        <SectionHeader eyebrow="Kapandı" title="Kapanan paper işlemler" />
        {closed.loading && !closed.data ? <Skeleton className="mt-3 h-24" /> : closedRows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">Henüz kapanan paper işlem yok.</p>
        ) : (
          <TradeTable rows={closedRows} />
        )}
      </Card>
    </div>
  );
}

function TradeTable({ rows, onClose }: { rows: PaperTrade[]; onClose?: (trade: PaperTrade) => void }) {
  return (
    <div className="odak-scroll mt-3">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-400">
            <th className="pb-2 pr-3 font-medium">Sembol</th>
            <th className="pb-2 pr-3 font-medium">Zaman</th>
            <th className="pb-2 pr-3 text-right font-medium">Giriş</th>
            <th className="pb-2 pr-3 text-right font-medium">Şimdi / Çıkış</th>
            <th className="pb-2 pr-3 text-right font-medium">Tutar</th>
            <th className="pb-2 pr-3 text-right font-medium">Net K/Z</th>
            <th className="pb-2 pr-3 font-medium">Durum</th>
            {onClose && <th className="pb-2 font-medium"> </th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((trade) => {
            const pnl = money(trade);
            const tone = pnl.try == null ? "text-ink-500" : pnl.try >= 0 ? "text-gain" : "text-loss";
            const mark = trade.status === "open" ? trade.current_price : trade.exit_price;
            return (
              <tr key={trade.id} className="border-t border-line">
                <td className="py-2 pr-3 font-mono font-semibold text-ink-900">
                  <AppLink href={`/grafik?symbol=${encodeURIComponent(trade.symbol)}&interval=5m`} className="hover:text-accent" title={`${trade.symbol} grafiğini aç`}>{trade.symbol}</AppLink>
                </td>
                <td className="py-2 pr-3 font-mono text-xs text-ink-500">{fmtDateTime(trade.exit_time || trade.entry_time)}</td>
                <td className="py-2 pr-3 text-right font-mono">{formatPrice(trade.entry_price)}</td>
                <td className="py-2 pr-3 text-right font-mono">{formatPrice(mark)}</td>
                <td className="py-2 pr-3 text-right font-mono text-ink-600">{trade.order_value_try == null ? "—" : formatTL(trade.order_value_try)}</td>
                <td className={`py-2 pr-3 text-right font-mono ${tone}`}>{pnl.try == null ? "—" : `${formatSignedTL(pnl.try)} (${pnl.pct?.toFixed(2)}%)`}</td>
                <td className="py-2 pr-3"><Badge tone={trade.status === "open" ? "accent" : "neutral"}>{trade.status === "open" ? "açık" : (trade.exit_reason || "kapandı")}</Badge></td>
                {onClose && (
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => onClose(trade)} className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-ink-600 hover:border-loss hover:text-loss">Kapat</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
