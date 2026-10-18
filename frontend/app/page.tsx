"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import AppLink from "./components/AppLink";
import { apiRequest } from "./lib/api";
import { usePoll } from "./lib/hooks";
import { toOpportunityView, type OpportunityView } from "./lib/opportunity";
import { useWatchlist } from "./lib/watchlist";
import { fmtDateTime } from "./lib/format";
import { rememberScan, useLivePrices } from "./lib/livePrices";
import type { ManualUnifiedScanResponse, UnifiedScanResponse, UnifiedScanRun } from "./lib/types";
import { Badge, Card, SectionHeader, Tabs } from "./components/ui";
import PortfolioStrip from "./components/PortfolioStrip";
import WatchStrip from "./components/WatchStrip";
import OpportunityCard from "./components/OpportunityCard";
import ActiveTradesTable from "./components/ActiveTradesTable";
import PaperTrades from "./components/PaperTrades";
import OrderPanel from "./components/OrderPanel";
import LiveNotificationToast from "./components/LiveNotificationToast";
const MarketChart = dynamic(() => import("./components/MarketChart"), {
  ssr: false,
  loading: () => <div className="h-[360px] animate-pulse rounded-xl bg-canvas" />,
});

type HorizonFilter = "all" | "favorites" | "5" | "15";
type LayoutMode = "cards" | "terminal";

function isRibbonCandidate(raw: Record<string, unknown>): boolean {
  const codes = [
    ...(Array.isArray(raw.signal_sources) ? raw.signal_sources : []),
    ...(Array.isArray(raw.unified_sources) ? raw.unified_sources : []),
    ...(Array.isArray(raw.sources) ? raw.sources : []),
    raw.strategy,
  ].map((code) => String(code || ""));
  return codes.includes("ema_ribbon")
    || Number(raw.ribbon_bar_ms || 0) > 0
    || (Array.isArray(raw.ribbon_events) && raw.ribbon_events.length > 0);
}

function isRibbonView(item: OpportunityView): boolean {
  return item.strategy === "ema_ribbon" || item.sourceCodes.includes("ema_ribbon");
}

/** İmleç bir metin alanındayken kısayollar devre dışı kalır. */
function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

export default function Home() {
  const [horizon, setHorizon] = useState<HorizonFilter>("all");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("cards");
  const [selected, setSelected] = useState<string | null>(null);
  const [quickAmount, setQuickAmount] = useState<number | null>(null);
  const [manualRun, setManualRun] = useState<UnifiedScanRun | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  const { favorites, isFavorite, toggleFavorite } = useWatchlist();
  const scan = usePoll<UnifiedScanResponse>("/api/unified-scan/latest", 20_000, 8_000);
  const prefs = usePoll<{ preferences?: { min_score?: number } }>("/api/user/preferences", 60_000);
  const minScore = Math.max(0, Number(prefs.data?.preferences?.min_score ?? 0)) || 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNowSec(Date.now() / 1000), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("odak_home_view_mode");
      if (stored === "terminal" || stored === "cards") setLayoutMode(stored);
    } catch {}
    const params = new URLSearchParams(window.location.search);
    if (params.get("filter") === "favorites") {
      setHorizon("favorites");
    }
    const sym = params.get("symbol");
    if (sym) {
      const clean = sym.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (clean) setSelected(clean);
    }
    if (params.get("scan") === "1") {
      void handleManualScan();
    }

    const onSelect = (e: CustomEvent<string>) => {
      if (e.detail) {
        const clean = String(e.detail).toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (clean) setSelected(clean);
      }
    };
    const onTrigger = () => {
      void handleManualScan();
    };

    window.addEventListener("odak:select-symbol", onSelect as EventListener);
    window.addEventListener("odak:trigger-scan", onTrigger);
    return () => {
      window.removeEventListener("odak:select-symbol", onSelect as EventListener);
      window.removeEventListener("odak:trigger-scan", onTrigger);
    };
  }, []);

  const changeLayoutMode = (mode: LayoutMode) => {
    setLayoutMode(mode);
    try {
      localStorage.setItem("odak_home_view_mode", mode);
    } catch {}
  };

  const latestRun = scan.data?.run ?? null;
  const latestRunAt = Number(latestRun?.completed_at ?? latestRun?.generated_at ?? 0);
  const run = manualRun && Number(manualRun.completed_at || 0) >= latestRunAt ? manualRun : latestRun;
  const views = useMemo(() => {
    // Son taramanın kendi listesi tabandır (Fırsatlar ile aynı tespitler).
    // 15 dk'lık özet bu listenin yerine geçmez; yalnızca EMA kesişimini
    // son taramada düşmüş olsa bile kartta tutar. Sembol başına en güçlü ufuk kalır.
    const unique = new Map<string, OpportunityView>();
    const latest = run?.candidates ?? [];
    const recent = Array.isArray(run?.recent_candidates) ? run.recent_candidates : [];
    const latestSymbols = new Set<string>();
    const put = (view: OpportunityView) => {
      const existing = unique.get(view.symbol);
      if (!existing || (view.strength ?? 0) >= (existing.strength ?? 0)) unique.set(view.symbol, view);
    };
    for (const candidate of latest) {
      const view = toOpportunityView(candidate);
      if (!view.symbol) continue;
      latestSymbols.add(view.symbol);
      put(view);
    }
    for (const candidate of recent) {
      const view = toOpportunityView(candidate);
      if (!view.symbol) continue;
      const ribbon = isRibbonCandidate(candidate as Record<string, unknown>) || isRibbonView(view);
      if (latestSymbols.has(view.symbol)) {
        if (!ribbon) continue;
        const current = unique.get(view.symbol);
        if (current && !current.sourceCodes.includes("ema_ribbon")) {
          unique.set(view.symbol, {
            ...current,
            sourceCodes: [...current.sourceCodes, "ema_ribbon"],
            sources: current.sources.includes("EMA Kurdele") ? current.sources : [...current.sources, "EMA Kurdele"],
          });
        }
        continue;
      }
      if (ribbon) put(view);
    }
    return Array.from(unique.values()).sort((left, right) => {
      const favoriteOrder = Number(isFavorite(right.symbol)) - Number(isFavorite(left.symbol));
      if (favoriteOrder) return favoriteOrder;
      return (right.strength ?? 0) - (left.strength ?? 0);
    });
  }, [run, isFavorite]);

  const filtered = useMemo(() => {
    const scored = minScore > 0
      ? views.filter((item) => isRibbonView(item) || (item.strength ?? 0) >= minScore)
      : views;
    if (horizon === "favorites") return scored.filter((item) => isFavorite(item.symbol));
    if (horizon === "all") return scored;
    return scored.filter((item) => item.horizonMinutes === Number(horizon));
  }, [views, horizon, isFavorite, minScore]);
  const livePrices = useLivePrices(filtered.map((item) => item.symbol));

  const activeSymbol = selected || (filtered.length > 0 ? filtered[0].symbol : "BTCUSDT");

  const selectedView = useMemo(
    () => filtered.find((item) => item.symbol === activeSymbol) ?? null,
    [filtered, activeSymbol],
  );

  const generatedAt = Number(run?.completed_at ?? run?.generated_at ?? 0);
  const SCAN_EVERY_SEC = 90;
  const nextScanSec = generatedAt > 0 ? Math.max(0, Math.ceil(SCAN_EVERY_SEC - (nowSec - generatedAt))) : null;
  const scanKey = String(run?.scan_id || generatedAt || "");
  useMemo(() => {
    if (!scanKey) return;
    rememberScan(scanKey, views.map((item) => ({ symbol: item.symbol, price: item.price })));
  }, [scanKey, views]);
  const stale = generatedAt > 0 && Date.now() / 1000 - generatedAt > 120;
  const loadingFirst = scan.loading && !run;

  // KLAVYE KISAYOLLARI (TradingView tarzı): j/k aday gezinme, Enter panele aktarım,
  // f favori, m manuel tarama, ? yardım. Metin alanlarında devre dışıdır.
  const selectedKey = selectedView ? selectedView.symbol : null;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key;
      if (key === "?") { event.preventDefault(); setShowShortcuts((open) => !open); return; }
      if (key === "Escape") { setShowShortcuts(false); return; }
      if (key === "m" && !scanBusy) { event.preventDefault(); handleManualScan(); return; }
      if (!filtered.length) return;
      const index = selectedKey ? filtered.findIndex((item) => item.symbol === selectedKey) : -1;
      const moveTo = (next: number) => {
        const target = filtered[Math.max(0, Math.min(filtered.length - 1, next))];
        if (target) { setSelected(target.symbol); setQuickAmount(null); }
      };
      if (key === "j" || key === "ArrowDown") { event.preventDefault(); moveTo(index + 1); }
      else if (key === "k" || key === "ArrowUp") { event.preventDefault(); moveTo(index - 1); }
      else if (key === "Enter" && selectedView) {
        event.preventDefault();
        setQuickAmount(1000);
        document.getElementById("islem-paneli")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      else if (key === "f" && selectedView) { event.preventDefault(); toggleFavorite(selectedView.symbol); }
      else if (key === "p" || key === "P") {
        event.preventDefault();
        changeLayoutMode(layoutMode === "terminal" ? "cards" : "terminal");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, selectedKey, selectedView, scanBusy, layoutMode]);

  async function handleManualScan() {
    if (scanBusy) return;
    setScanBusy(true);
    setScanMessage("Salt-veri taraması çalışıyor…");
    try {
      const response = await apiRequest("/api/unified-scan/manual", { method: "POST" });
      const body = await response.json().catch(() => ({})) as ManualUnifiedScanResponse & { detail?: string };
      if (!response.ok) throw new Error(body?.detail || "Tarama tamamlanamadı");
      if (!body.ok || body.side_effects.notifications_sent || body.side_effects.paper_positions_opened || body.side_effects.real_orders_submitted) throw new Error("Tarama güvenlik doğrulaması başarısız oldu");
      setManualRun({
        scan_id: body.scan_id,
        started_at: body.started_at,
        completed_at: body.completed_at,
        algorithm_version: body.algorithm_version,
        source: "manual",
        count: body.count,
        candidates: body.candidates,
      });
      setScanMessage(`Tarama tamamlandı · ${body.count} aday · emir/bildirim oluşturulmadı`);
      scan.reload();
      window.setTimeout(() => setScanMessage(null), 6000);
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : "Tarama sırasında hata oluştu");
      window.setTimeout(() => setScanMessage(null), 6000);
    } finally {
      setScanBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <LiveNotificationToast
        onSelectSymbol={(symbol) => {
          setSelected(symbol);
          setQuickAmount(1000);
        }}
      />

      <PortfolioStrip />

      <WatchStrip />

      {scan.error && !run && (
        <div className="odak-card border-loss/30 bg-loss-soft/50 p-3 text-sm text-loss" role="alert">
          Birleşik tarama verisi alınamadı: {scan.error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white/70 px-4 py-2.5 text-xs text-ink-600 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink-900">Birleşik Piyasa Taraması</span>
          <Badge tone={stale ? "warn" : "gain"}>{stale ? "ESKİ VERİ" : "Salt-veri"}</Badge>
          <span>{run ? `${views.length} aday` : "Henüz tarama yok"}</span>
          <span className="text-ink-400">
            {generatedAt ? `Son tarama ${fmtDateTime(generatedAt)}` : "Fiyat verisi public piyasa akışından"}
          </span>
          <span className="rounded-md border border-line bg-canvas px-2 py-1 font-mono font-semibold text-ink-800" role="timer" aria-live="off">
            {scanBusy ? "taranıyor" : nextScanSec == null ? "ilk tarama bekleniyor" : nextScanSec === 0 ? "sonraki tarama şimdi" : `sonraki tarama ${Math.floor(nextScanSec / 60)}:${String(nextScanSec % 60).padStart(2, "0")}`}
          </span>
          {scan.error && run && <span className="text-amber-700">Bağlantı koptu · son görüntü gösteriliyor</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* Görünüm Değiştirici */}
          <div className="flex rounded-lg border border-line bg-canvas/70 p-0.5">
            <button
              type="button"
              onClick={() => changeLayoutMode("cards")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                layoutMode === "cards" ? "bg-white text-ink-900 shadow-xs" : "text-ink-500 hover:text-ink-800"
              }`}
              title="Klasik kart görünümü"
            >
              ⊞ Kartlar
            </button>
            <button
              type="button"
              onClick={() => changeLayoutMode("terminal")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                layoutMode === "terminal" ? "bg-accent text-white shadow-xs" : "text-ink-500 hover:text-ink-800"
              }`}
              title="Profesyonel grafik & işlem terminali"
            >
              ⚡ Pro Terminal
            </button>
          </div>

          {scanMessage && <span className="font-medium text-accent" role="status">{scanMessage}</span>}
          <button type="button" onClick={() => setShowShortcuts((open) => !open)} title="Klavye kısayolları (?)" aria-label="Klavye kısayolları" className="hidden rounded-lg border border-line px-2 py-1.5 text-xs text-ink-500 hover:border-accent hover:text-accent sm:block">⌘ ?</button>
          <button
            type="button"
            onClick={handleManualScan}
            disabled={scanBusy}
            className="flex min-h-[2.25rem] items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-60"
            title="Yalnız piyasa verisi taranır; emir veya bildirim gönderilmez"
          >
            <span className={scanBusy ? "animate-spin" : ""}>⟳</span>
            <span>{scanBusy ? "Taranıyor…" : "Piyasayı Tara"}</span>
          </button>
        </div>
      </div>

      {layoutMode === "terminal" ? (
        <div className="space-y-5">
          {/* Pro Terminal: Canlı Grafik + İşlem Paneli yan yana */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <MarketChart
                panelId="terminal-main"
                initialSymbol={activeSymbol}
                onSymbolChange={(sym) => setSelected(sym)}
              />
            </div>
            <div id="islem-paneli" className="scroll-mt-24 lg:sticky lg:top-20 lg:self-start">
              <OrderPanel
                initialSymbol={activeSymbol}
                initialAmount={quickAmount}
                initialCandidate={selectedView}
                onTraded={() => scan.reload()}
              />
              <p className="mt-2 text-center text-[10px] text-ink-500">Kısayollar: j/k gezin · Enter panele aktar · f favori · m tara · p görünüm · ? yardım</p>
            </div>
          </div>

          {/* Adaylar Şeridi */}
          <Card className="p-4 sm:p-5">
            <SectionHeader
              eyebrow="Taranan Adaylar · Seçilen Sembol Grafiğe ve Panele Yansır"
              title={
                <span className="inline-flex items-center gap-2">
                  Yükseliş Adayları <Badge tone="gain">{filtered.length} ADAY</Badge>
                </span>
              }
              actions={
                <Tabs
                  items={[
                    { id: "all", label: "Tümü" },
                    { id: "favorites", label: `★ Favoriler (${favorites.length})` },
                    { id: "5", label: "5 dk" },
                    { id: "15", label: "15 dk" },
                  ]}
                  active={horizon}
                  onChange={(id) => setHorizon(id as HorizonFilter)}
                />
              }
            />

            {loadingFirst ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((item) => <div key={item} className="h-44 animate-pulse rounded-xl bg-canvas" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-line py-8 text-center text-sm text-ink-400">
                {horizon === "favorites" ? "Favori sembollerinizde henüz aday yok." : minScore > 0 && views.length > 0 ? `Ayarlardaki minimum skor (${minScore}) bu adayların hepsini eliyor.` : "Henüz aday bulunmuyor. Piyasa Tara ile salt-veri taraması başlatabilirsiniz."}
              </div>
            ) : (
              <div className="mt-4 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                {filtered.slice(0, 12).map((item, index) => (
                  <OpportunityCard
                    key={item.symbol}
                    rank={index + 1}
                    item={item}
                    selected={activeSymbol === item.symbol}
                    onSelect={() => {
                      setSelected(item.symbol);
                      setQuickAmount(null);
                    }}
                    livePrice={livePrices[item.symbol] ?? null}
                    onQuickBuy={(symbol, amount) => {
                      setSelected(symbol);
                      setQuickAmount(amount ?? 1000);
                      document.getElementById("islem-paneli")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  />
                ))}
              </div>
            )}
            {run && <p className="mt-3 text-[10px] text-ink-400">Son taramanın tespitleri ve EMA kurdele kesişimleri · her sembol bir kez.{minScore > 0 ? ` Skor filtresi ${minScore}+ uygulanıyor.` : ""}</p>}
          </Card>
        </div>
      ) : (
        /* Klasik Kart Görünümü */
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="p-4 sm:p-5">
            <SectionHeader
              eyebrow="Adaylar · Kaynak uzlaşısı · Sembol bazında tekil kayıtlar"
              title={
                <span className="inline-flex items-center gap-2">
                  Yükseliş Adayları <Badge tone="gain">{filtered.length} ADAY</Badge>
                </span>
              }
              actions={
                <Tabs
                  items={[
                    { id: "all", label: "Tümü" },
                    { id: "favorites", label: `★ Favoriler (${favorites.length})` },
                    { id: "5", label: "5 dk" },
                    { id: "15", label: "15 dk" },
                  ]}
                  active={horizon}
                  onChange={(id) => setHorizon(id as HorizonFilter)}
                />
              }
            />

            {loadingFirst ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="h-56 animate-pulse rounded-xl bg-canvas" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-line py-12 text-center text-sm text-ink-400">
                {horizon === "favorites" ? "Favori sembollerinizde henüz aday yok." : minScore > 0 && views.length > 0 ? `Ayarlardaki minimum skor (${minScore}) bu adayların hepsini eliyor.` : "Henüz aday bulunmuyor. Piyasa Tara ile salt-veri taraması başlatabilirsiniz."}
              </div>
            ) : (
              <div className="mt-4 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.slice(0, 12).map((item, index) => (
                  <OpportunityCard
                    key={item.symbol}
                    rank={index + 1}
                    item={item}
                    selected={activeSymbol === item.symbol}
                    onSelect={() => {
                      setSelected(item.symbol);
                      setQuickAmount(null);
                    }}
                    livePrice={livePrices[item.symbol] ?? null}
                    onQuickBuy={(symbol, amount) => {
                      setSelected(symbol);
                      setQuickAmount(amount ?? 1000);
                      document.getElementById("islem-paneli")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  />
                ))}
              </div>
            )}
            {run && <p className="mt-3 text-[10px] text-ink-400">Son taramanın tespitleri ve EMA kurdele kesişimleri · her sembol bir kez.{minScore > 0 ? ` Skor filtresi ${minScore}+ uygulanıyor.` : ""}</p>}
          </Card>

          <div id="islem-paneli" className="scroll-mt-24 lg:sticky lg:top-20 lg:self-start">
            <OrderPanel
              initialSymbol={activeSymbol}
              initialAmount={quickAmount}
              initialCandidate={selectedView}
              onTraded={() => scan.reload()}
            />
            <p className="mt-2 text-center text-[10px] text-ink-500">Alım Yap emri hemen göndermez; tutarı onaylaman için işlem paneline taşır. Kısayollar: j/k gezin · Enter alım · f favori · m tara · p görünüm · ? yardım</p>
          </div>
        </div>
      )}

      <Card className="p-5">
        <div id="aktif-islemler" className="scroll-mt-24">
          <SectionHeader
            eyebrow="Portföy & Pozisyonlar"
            title="Aktif Binance TR Varlıkları"
            description="Cüzdandaki açık coin bakiyeleri, anlık kâr/zarar ve maliyet durumu. 50 TL altındaki tutarlar listelenmez."
            actions={<AppLink href="/gecmis-islemler" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-soft">İşlem Geçmişi →</AppLink>}
          />
          <div className="mt-4">
            <ActiveTradesTable
              limit={10}
              onSelectSymbol={(symbol) => {
                setSelected(symbol);
                setQuickAmount(1000);
                document.getElementById("islem-paneli")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />
          </div>
        </div>
      </Card>

      <PaperTrades />

      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowShortcuts(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="w-full max-w-sm rounded-2xl border border-line bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="shortcuts-title" className="text-lg font-bold text-ink-900">Klavye Kısayolları</h2>
              <button type="button" onClick={() => setShowShortcuts(false)} className="rounded-md px-2 py-1 text-ink-500 hover:bg-slate-100" aria-label="Yardım penceresini kapat">✕</button>
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              {[
                ["Ctrl+K / ⌘K", "Komut ve Sembol Arama Paleti"],
                ["p", "Pro Terminal / Kart görünümü değiştir"],
                ["j / ↓", "Sonraki aday"],
                ["k / ↑", "Önceki aday"],
                ["Enter", "Seçili adayı işlem paneline aktar (1.000 ₺)"],
                ["f", "Seçili sembolü favoriye ekle/çıkar"],
                ["m", "Salt-veri piyasa taraması başlat"],
                ["?", "Bu pencereyi aç/kapat"],
                ["Esc", "Pencereleri kapat"],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <dt><kbd className="rounded-md border border-line bg-canvas px-2 py-0.5 font-mono text-xs font-semibold text-ink-800">{key}</kbd></dt>
                  <dd className="text-right text-ink-600">{label}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] text-ink-400">Kısayollar metin kutularında yazarken devre dışıdır.</p>
          </section>
        </div>
      )}
    </div>
  );
}
