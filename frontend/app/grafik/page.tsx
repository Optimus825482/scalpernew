"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import AppLink from "../components/AppLink";
import { useSearchParams } from "next/navigation";
import MarketChart from "../components/MarketChart";
import { Card, SectionHeader, Skeleton } from "../components/ui";
import { usePoll } from "../lib/hooks";
import { useWatchlist } from "../lib/watchlist";
import { useAuth } from "../lib/auth";
import type { MarketSymbols } from "../lib/types";

type Panels = 1 | 2 | 4;
type ChartPanel = { symbol: string; interval: string };
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLTRY", "AVAXTRY"];
const INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"];
const defaultPanels = (): ChartPanel[] => DEFAULT_SYMBOLS.map((symbol) => ({ symbol, interval: "5m" }));

function GrafikContent() {
  const { username } = useAuth();
  const searchParams = useSearchParams();
  const [panelCount, setPanelCount] = useState<Panels>(1);
  const [panelConfigs, setPanelConfigs] = useState<ChartPanel[]>(defaultPanels);
  const [syncPanels, setSyncPanels] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const marketSymbols = usePoll<MarketSymbols>("/api/market-symbols", 300_000);
  const { favorites } = useWatchlist();
  const storageKey = `odak_chart_layout:${String(username || "guest").toLowerCase()}`;

  const symbolOptions = useMemo(() => Array.from(new Set([...favorites, ...DEFAULT_SYMBOLS, ...(marketSymbols.data?.symbols || [])])), [favorites, marketSymbols.data?.symbols]);

  // localStorage yüklemesi
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && Array.isArray(saved.panels)) {
        const next = defaultPanels();
        saved.panels.slice(0, 4).forEach((panel: Partial<ChartPanel>, index: number) => {
          const symbol = String(panel.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          const interval = INTERVALS.includes(String(panel.interval)) ? String(panel.interval) : "5m";
          if (symbol) next[index] = { symbol, interval };
        });
        setPanelConfigs(next);
        if ([1, 2, 4].includes(Number(saved.panelCount))) setPanelCount(Number(saved.panelCount) as Panels);
        setSyncPanels(Boolean(saved.syncPanels));
      }
    } catch {
      setPanelConfigs(defaultPanels());
    }
    setLoaded(true);
  }, [storageKey]);

  // Query parametreleri reaktif takibi (Link veya router.push ile sembol değiştiğinde anında tetiklenir)
  const querySymbol = (searchParams.get("symbol") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const queryInterval = searchParams.get("interval") || "";

  useEffect(() => {
    if (querySymbol) {
      updatePanel(0, "symbol", querySymbol);
    }
    if (INTERVALS.includes(queryInterval)) {
      updatePanel(0, "interval", queryInterval);
    }
  }, [querySymbol, queryInterval]);

  // Global sembol seçim olayı (CommandPalette ve FavoriteTickerBand'den tetiklenir)
  useEffect(() => {
    const onSelect = (e: CustomEvent<string>) => {
      if (e.detail) {
        const clean = String(e.detail).toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (clean) updatePanel(0, "symbol", clean);
      }
    };
    window.addEventListener("odak:select-symbol", onSelect as EventListener);
    return () => window.removeEventListener("odak:select-symbol", onSelect as EventListener);
  }, [syncPanels]);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(storageKey, JSON.stringify({ panelCount, panels: panelConfigs, syncPanels }));
  }, [loaded, panelCount, panelConfigs, storageKey, syncPanels]);

  function updatePanel(index: number, field: keyof ChartPanel, value: string) {
    setPanelConfigs((previous) => previous.map((panel, panelIndex) => {
      if (syncPanels || panelIndex === index) return { ...panel, [field]: value };
      return panel;
    }));
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Teknik Analiz"
        title="Canlı Binance TR Grafikleri"
        description="Yakınlaştırılabilir mum grafikleri, kullanıcıya özel gösterge ayarları ve WebSocket güncellemesi."
        actions={<div className="flex flex-wrap items-center gap-2">
          <AppLink href="/" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-accent/90">← Anasayfa & İşlem Paneli</AppLink>
          <div className="flex rounded-lg border border-line bg-white p-1" aria-label="Grafik panel sayısı">
            {([1, 2, 4] as const).map((count) => <button key={count} type="button" aria-pressed={panelCount === count} onClick={() => setPanelCount(count)} className={`min-w-8 rounded-md px-2.5 py-1 text-xs font-semibold ${panelCount === count ? "bg-accent text-white" : "text-ink-500 hover:bg-canvas"}`}>{count} Panel</button>)}
          </div>
        </div>}
      />

      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-500">Favoriler:</span>
          {favorites.length ? favorites.map((symbol) => <button key={symbol} type="button" onClick={() => updatePanel(0, "symbol", symbol)} className="rounded-lg border border-line bg-canvas/70 px-2.5 py-1 font-mono text-xs hover:border-accent">{symbol}</button>) : <span className="text-xs text-ink-400">Henüz favori eklenmedi.</span>}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-600"><input type="checkbox" checked={syncPanels} onChange={(event) => setSyncPanels(event.target.checked)} />Panelleri eşitle</label>
      </Card>

      <div className={`grid gap-4 ${panelCount === 1 ? "grid-cols-1" : "grid-cols-1 2xl:grid-cols-2"}`}>
        {panelConfigs.slice(0, panelCount).map((panel, index) => <Card key={index} className="min-w-0 p-3 sm:p-4">
          <div className="mb-2 text-xs font-semibold text-ink-400">Panel {index + 1} · {panel.symbol} ({panel.interval}) · bağımsız sembol ve zaman aralığı</div>
          <MarketChart
            panelId={`panel-${index + 1}`}
            initialSymbol={panel.symbol}
            initialInterval={panel.interval}
            symbols={symbolOptions}
            onSymbolChange={(symbol) => updatePanel(index, "symbol", symbol)}
            onIntervalChange={(interval) => updatePanel(index, "interval", interval)}
          />
        </Card>)}
      </div>
      <p className="text-[11px] text-ink-400">Varsayılan: fiyatın üzerinde EMA 7, 20 ve 99; alt panele Stochastic RSI 14 (bant 20 / 80). Diğer göstergeler ayardan açılır. Grafik kütüphanesi: TradingView Lightweight Charts™.</p>
    </div>
  );
}

export default function GrafikPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <GrafikContent />
    </Suspense>
  );
}
