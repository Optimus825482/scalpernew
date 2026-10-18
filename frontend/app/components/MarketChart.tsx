"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { apiRequest } from "../lib/api";
import { useLiveMessages, useLiveStatus } from "../lib/liveSocket";
import { useAuth } from "../lib/auth";
import { formatPrice } from "../lib/format";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Indicator = "volume" | "sma" | "ema" | "ema3" | "bollinger" | "rsi" | "stochrsi" | "macd" | "vwap" | "atr" | "adx";
type IndicatorConfig = { version: number; enabled: Indicator[]; periods: { sma: number; ema: number; bollinger: number; rsi: number; atr: number; adx: number } };
const INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
const CONFIG_VERSION = 3;
const STOCH_RSI_PERIOD = 14;
const STOCH_RSI_LOW = 20;
const STOCH_RSI_HIGH = 80;
const EMA_TRIPLE = [7, 20, 99] as const;
const SUB_PANE_IDS: Indicator[] = ["rsi", "stochrsi", "macd", "atr", "adx"];
const INDICATORS: Array<{ id: Indicator; label: string }> = [
  { id: "volume", label: "Hacim" }, { id: "ema3", label: "EMA 7/20/99" }, { id: "sma", label: "SMA" }, { id: "ema", label: "EMA" },
  { id: "bollinger", label: "Bollinger" }, { id: "stochrsi", label: "Stoch RSI" }, { id: "rsi", label: "RSI" }, { id: "macd", label: "MACD" },
  { id: "vwap", label: "VWAP" }, { id: "atr", label: "ATR" }, { id: "adx", label: "ADX" },
];
const DEFAULT_CONFIG: IndicatorConfig = {
  version: CONFIG_VERSION,
  enabled: ["ema3", "stochrsi"],
  periods: { sma: 20, ema: 12, bollinger: 20, rsi: 14, atr: 14, adx: 14 },
};
const normalizeSymbol = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const formatReading = (value: number | null) => value == null ? "—" : value.toLocaleString("tr-TR", { maximumSignificantDigits: 6 });

type SignalMark = {
  id?: number;
  detected_at?: number;
  price?: number | null;
  expected_price?: number | null;
  target_pct?: number | null;
  outcome_status?: string | null;
  outcome_at?: number | null;
};
type ChartMarker = { time: UTCTimestamp; position: "aboveBar" | "belowBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string };

function epochSec(value: number | null | undefined): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : n;
}

function barAtOrBefore(candles: Candle[], ts: number): number | null {
  const sec = epochSec(ts);
  if (!sec || candles.length === 0) return null;
  if (sec < candles[0].time) return null;
  let chosen: number | null = null;
  for (const candle of candles) {
    if (candle.time <= sec) chosen = candle.time;
    else break;
  }
  return chosen ?? candles[candles.length - 1].time;
}

function riseBar(candles: Candle[], from: number, target: number): number | null {
  for (const candle of candles) {
    if (candle.time < from) continue;
    if (candle.high >= target) return candle.time;
  }
  return null;
}

function readCandle(raw: unknown): Candle | null {
  if (Array.isArray(raw)) {
    const [rawTime, rawOpen, rawHigh, rawLow, rawClose, rawVolume] = raw;
    const values = [Number(rawTime), Number(rawOpen), Number(rawHigh), Number(rawLow), Number(rawClose), Number(rawVolume)];
    return values.every(Number.isFinite) ? { time: values[0] > 1e12 ? Math.floor(values[0] / 1000) : values[0], open: values[1], high: values[2], low: values[3], close: values[4], volume: values[5] } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const time = Number(row.time), open = Number(row.open), high = Number(row.high), low = Number(row.low), close = Number(row.close), volume = Number(row.volume ?? 0);
  return [time, open, high, low, close, volume].every(Number.isFinite) ? { time: time > 1e12 ? Math.floor(time / 1000) : time, open, high, low, close, volume } : null;
}

function sma(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = Array(values.length).fill(null);
  let total = 0;
  for (let index = 0; index < values.length; index++) {
    total += values[index];
    if (index >= period) total -= values[index - period];
    if (index >= period - 1) output[index] = total / period;
  }
  return output;
}

function ema(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return output;
  const alpha = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = current;
  for (let index = period; index < values.length; index++) {
    current = values[index] * alpha + current * (1 - alpha);
    output[index] = current;
  }
  return output;
}

const PEGGED_BASES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "EUR", "PAXG", "XAUT", "PAX", "USD1", "RLUSD"]);
const RIBBON_FLAT_LOOKBACK = 20;
const RIBBON_MIN_RANGE_PCT = 0.8;
const RIBBON_MIN_SPAN_PCT = 0.4;
const RIBBON_DEAD_STICK_PCT = 0.08;
const RIBBON_DEAD_STICK_RATIO = 0.7;

function ribbonBase(symbol: string) {
  const name = symbol.toUpperCase();
  if (name.endsWith("TRY")) return name.slice(0, -3);
  if (name.endsWith("USDT")) return name.slice(0, -4);
  return name;
}

function ribbonBuyIndexes(symbol: string, candles: Candle[], fast: Array<number | null>, mid: Array<number | null>, slow: Array<number | null>): number[] {
  if (PEGGED_BASES.has(ribbonBase(symbol))) return [];
  const hits: number[] = [];
  const lastClosed = candles.length - 1;
  for (let index = 1; index < lastClosed; index += 1) {
    const prevFast = fast[index - 1];
    const prevMid = mid[index - 1];
    const currFast = fast[index];
    const currMid = mid[index];
    const currSlow = slow[index];
    if (prevFast == null || prevMid == null || currFast == null || currMid == null || currSlow == null) continue;
    if (!(prevFast <= prevMid && currFast > currMid && currFast > currSlow && currMid > currSlow)) continue;
    const price = candles[index]?.close ?? 0;
    if (!(price > 0)) continue;
    const span = (Math.max(currFast, currMid, currSlow) - Math.min(currFast, currMid, currSlow)) / price * 100;
    if (span < RIBBON_MIN_SPAN_PCT) continue;
    const start = Math.max(0, index - RIBBON_FLAT_LOOKBACK + 1);
    let high = candles[start].high;
    let low = candles[start].low;
    for (let cursor = start + 1; cursor <= index; cursor += 1) {
      if (candles[cursor].high > high) high = candles[cursor].high;
      if (candles[cursor].low < low) low = candles[cursor].low;
    }
    if (!(low > 0) || ((high - low) / low) * 100 < RIBBON_MIN_RANGE_PCT) continue;
    let dead = 0;
    let counted = 0;
    for (let cursor = start; cursor <= index; cursor += 1) {
      const candle = candles[cursor];
      const mark = candle.close > 0 ? candle.close : candle.open;
      if (!(mark > 0)) continue;
      counted += 1;
      const stick = Math.max(Math.abs(candle.close - candle.open), candle.high - candle.low);
      if ((stick / mark) * 100 < RIBBON_DEAD_STICK_PCT) dead += 1;
    }
    if (counted < 8 || dead / counted >= RIBBON_DEAD_STICK_RATIO) continue;
    hits.push(index);
  }
  return hits;
}

function wilderRsi(closes: number[], period: number): Array<number | null> {
  const rsi: Array<number | null> = Array(closes.length).fill(null);
  const gains: number[] = [];
  const losses: number[] = [];
  for (let index = 1; index < closes.length; index++) {
    const delta = closes[index] - closes[index - 1];
    gains.push(Math.max(0, delta));
    losses.push(Math.max(0, -delta));
  }
  if (gains.length < period) return rsi;
  let gain = gains.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  let loss = losses.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const value = (averageGain: number, averageLoss: number) => averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  rsi[period] = value(gain, loss);
  for (let index = period + 1; index < closes.length; index++) {
    gain = (gain * (period - 1) + gains[index - 1]) / period;
    loss = (loss * (period - 1) + losses[index - 1]) / period;
    rsi[index] = value(gain, loss);
  }
  return rsi;
}

function smaNullable(values: Array<number | null>, period: number): Array<number | null> {
  const output: Array<number | null> = Array(values.length).fill(null);
  for (let index = period - 1; index < values.length; index++) {
    let total = 0;
    let complete = true;
    for (let cursor = index - period + 1; cursor <= index; cursor++) {
      const point = values[cursor];
      if (point == null) { complete = false; break; }
      total += point;
    }
    if (complete) output[index] = total / period;
  }
  return output;
}

function stochasticRsi(closes: number[], rsiPeriod = STOCH_RSI_PERIOD, stochPeriod = STOCH_RSI_PERIOD, kPeriod = 3, dPeriod = 3) {
  const rsi = wilderRsi(closes, rsiPeriod);
  const raw: Array<number | null> = Array(closes.length).fill(null);
  for (let index = stochPeriod - 1; index < rsi.length; index++) {
    let low = Infinity;
    let high = -Infinity;
    let complete = true;
    for (let cursor = index - stochPeriod + 1; cursor <= index; cursor++) {
      const point = rsi[cursor];
      if (point == null) { complete = false; break; }
      if (point < low) low = point;
      if (point > high) high = point;
    }
    if (!complete || rsi[index] == null) continue;
    raw[index] = high === low ? 50 : ((rsi[index] as number) - low) / (high - low) * 100;
  }
  const k = smaNullable(raw, kPeriod);
  return { k, d: smaNullable(k, dPeriod) };
}

function calculate(candles: Candle[], periods: IndicatorConfig["periods"]) {
  const closes = candles.map((candle) => candle.close);
  const middle = sma(closes, periods.bollinger);
  const upper = middle.map((value, index) => {
    if (value == null) return null;
    const values = closes.slice(index - periods.bollinger + 1, index + 1);
    const sd = Math.sqrt(values.reduce((sum, current) => sum + (current - value) ** 2, 0) / periods.bollinger);
    return value + 2 * sd;
  });
  const lower = upper.map((value, index) => value == null || middle[index] == null ? null : 2 * (middle[index] as number) - value);
  const rsi = wilderRsi(closes, periods.rsi);
  const stoch = stochasticRsi(closes);
  const tr: number[] = [], up: number[] = [], down: number[] = [];
  for (let index = 0; index < candles.length; index++) {
    const current = candles[index], previous = candles[index - 1];
    tr.push(previous ? Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)) : current.high - current.low);
    up.push(previous && current.high - previous.high > previous.low - current.low && current.high > previous.high ? current.high - previous.high : 0);
    down.push(previous && previous.low - current.low > current.high - previous.high && previous.low > current.low ? previous.low - current.low : 0);
  }
  const atr: Array<number | null> = Array(candles.length).fill(null);
  if (candles.length >= periods.atr) {
    let value = tr.slice(0, periods.atr).reduce((sum, current) => sum + current, 0) / periods.atr;
    atr[periods.atr - 1] = value;
    for (let index = periods.atr; index < candles.length; index++) { value = (value * (periods.atr - 1) + tr[index]) / periods.atr; atr[index] = value; }
  }
  const adx: Array<number | null> = Array(candles.length).fill(null);
  if (candles.length >= periods.adx * 2) {
    let smoothTr = tr.slice(1, periods.adx + 1).reduce((sum, value) => sum + value, 0);
    let smoothUp = up.slice(1, periods.adx + 1).reduce((sum, value) => sum + value, 0);
    let smoothDown = down.slice(1, periods.adx + 1).reduce((sum, value) => sum + value, 0);
    const dx: Array<number | null> = Array(candles.length).fill(null);
    for (let index = periods.adx; index < candles.length; index++) {
      if (index > periods.adx) { smoothTr += tr[index] - smoothTr / periods.adx; smoothUp += up[index] - smoothUp / periods.adx; smoothDown += down[index] - smoothDown / periods.adx; }
      const plus = smoothTr ? 100 * smoothUp / smoothTr : 0, minus = smoothTr ? 100 * smoothDown / smoothTr : 0;
      dx[index] = plus + minus ? 100 * Math.abs(plus - minus) / (plus + minus) : 0;
    }
    const first = periods.adx * 2 - 1;
    let value = dx.slice(periods.adx, first + 1).reduce<number>((sum, current) => sum + (current ?? 0), 0) / periods.adx;
    adx[first] = value;
    for (let index = first + 1; index < candles.length; index++) { value = (value * (periods.adx - 1) + (dx[index] ?? 0)) / periods.adx; adx[index] = value; }
  }
  const macdFast = ema(closes, 12), macdSlow = ema(closes, 26);
  const macd = closes.map((_, index) => macdFast[index] != null && macdSlow[index] != null ? (macdFast[index] as number) - (macdSlow[index] as number) : 0);
  const macdStart = macdSlow.findIndex((value) => value != null);
  const signal = macdStart < 0 ? [] : ema(macd.slice(macdStart), 9);
  const histogram: Array<number | null> = Array(candles.length).fill(null);
  if (macdStart >= 0) for (let index = 0; index < signal.length; index++) if (signal[index] != null) histogram[macdStart + index] = macd[macdStart + index] - (signal[index] as number);
  let weighted = 0, volume = 0;
  const vwap = candles.map((candle) => { weighted += ((candle.high + candle.low + candle.close) / 3) * candle.volume; volume += candle.volume; return volume ? weighted / volume : null; });
  return {
    sma: sma(closes, periods.sma),
    ema: ema(closes, periods.ema),
    ema7: ema(closes, EMA_TRIPLE[0]),
    ema20: ema(closes, EMA_TRIPLE[1]),
    ema99: ema(closes, EMA_TRIPLE[2]),
    upper, lower, rsi, stochK: stoch.k, stochD: stoch.d, adx, atr, histogram, vwap,
  };
}

function storedConfig(username: string | null, panelId: string): IndicatorConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(`odak_chart_indicators:${String(username || "guest").toLowerCase()}:${panelId}`);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<IndicatorConfig>;
    if (Number(parsed.version) !== CONFIG_VERSION) return DEFAULT_CONFIG;
    const enabled = Array.isArray(parsed.enabled) ? parsed.enabled.filter((item): item is Indicator => INDICATORS.some((option) => option.id === item)) : DEFAULT_CONFIG.enabled;
    const periods = { ...DEFAULT_CONFIG.periods, ...(parsed.periods || {}) };
    for (const key of Object.keys(periods) as Array<keyof typeof periods>) periods[key] = Math.max(2, Math.min(200, Number(periods[key]) || DEFAULT_CONFIG.periods[key]));
    return { version: CONFIG_VERSION, enabled, periods };
  } catch { return DEFAULT_CONFIG; }
}

export function MarketChart({ initialSymbol = "BTCUSDT", initialInterval = "5m", compact = false, symbols = [], onSymbolChange, onIntervalChange, panelId = "main" }: {
  initialSymbol?: string; initialInterval?: string; compact?: boolean; symbols?: string[]; onSymbolChange?: (symbol: string) => void; onIntervalChange?: (interval: string) => void; panelId?: string;
}) {
  const { username } = useAuth();
  const [symbol, setSymbol] = useState(normalizeSymbol(initialSymbol));
  const [interval, setInterval] = useState<string>(INTERVALS.includes(initialInterval as typeof INTERVALS[number]) ? initialInterval : "5m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState("");
  const [restAt, setRestAt] = useState<number | null>(null);
  const [tickAt, setTickAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<IndicatorConfig>(DEFAULT_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signalMarks, setSignalMarks] = useState<SignalMark[]>([]);
  const [buyMarks, setBuyMarks] = useState<Array<{ time: number; x: number; y: number }>>([]);
  const [loadedConfigKey, setLoadedConfigKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const subContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const subChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markerApiRef = useRef<{ setMarkers: (markers: ChartMarker[]) => void } | null>(null);
  const markerFactoryRef = useRef<((series: ISeriesApi<"Candlestick">, markers: ChartMarker[]) => { setMarkers: (markers: ChartMarker[]) => void }) | null>(null);
  const targetLineRef = useRef<{ applyOptions?: (options: object) => void } | null>(null);
  const seriesRef = useRef<Record<string, ISeriesApi<any>>>({});
  const socketStatus = useLiveStatus();
  const socketStatusRef = useRef(socketStatus);
  const tickAtRef = useRef<number | null>(tickAt);
  // Yanıt-tazeliği: sembol/interval değişince geç kalan ESKI isteğin yanıtını
  // state'e yazmayı engeller (farklı sembolün mumlarının karışması → grafikte
  // iki fiyat seviyesinin birleşmesi hatası).
  const requestKeyRef = useRef("");
  const restAtRef = useRef<number | null>(restAt);
  socketStatusRef.current = socketStatus;
  tickAtRef.current = tickAt;
  restAtRef.current = restAt;

  useEffect(() => { setSymbol(normalizeSymbol(initialSymbol)); }, [initialSymbol]);
  useEffect(() => { setInterval(INTERVALS.includes(initialInterval as typeof INTERVALS[number]) ? initialInterval : "5m"); }, [initialInterval]);
  const configStorageKey = `odak_chart_indicators:${String(username || "guest").toLowerCase()}:${panelId}`;
  useEffect(() => { setConfig(storedConfig(username, panelId)); setLoadedConfigKey(configStorageKey); }, [configStorageKey, panelId, username]);
  useEffect(() => {
    if (loadedConfigKey !== configStorageKey || typeof window === "undefined") return;
    localStorage.setItem(configStorageKey, JSON.stringify(config));
  }, [config, configStorageKey, loadedConfigKey]);

  const load = useCallback(async () => {
    const requestKey = `${symbol}|${interval}`;
    try {
      const response = await apiRequest(`/api/market-klines/${encodeURIComponent(symbol)}?interval=${interval}&limit=500`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Grafik verisi alınamadı (${response.status})`);
      const body = await response.json();
      if (requestKeyRef.current !== requestKey) return; // bu istek eskidi; sonucu düşür
      const rows = Array.isArray(body?.candles) ? body.candles.map(readCandle).filter(Boolean) as Candle[] : [];
      if (rows.length) setCandles((current) => {
        const live = current.filter((candle) => tickAtRef.current != null && candle.time === current[current.length - 1]?.time && Date.now() - tickAtRef.current < 60_000);
        const merged = new Map(rows.map((candle) => [candle.time, candle]));
        live.forEach((candle) => merged.set(candle.time, candle));
        return Array.from(merged.values()).sort((left, right) => left.time - right.time).slice(-500);
      });
      setRestAt(Date.now());
      setError(rows.length ? "" : "Bu sembol ve zaman aralığı için mum verisi yok.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Grafik verisi alınamadı"); }
  }, [interval, symbol]);
  useEffect(() => {
    // Sembol/interval değişiminde eski sembolün mumları MUTLAKA temizlenir;
    // aksi halde WS'ten gelen yeni sembolün mumları eski verinin SONUNA
    // eklenir ve tek grafikte iki sembolün fiyatı birleşir.
    requestKeyRef.current = `${symbol}|${interval}`;
    setTickAt(null);
    setCandles([]);
    void load();
  }, [load]);
  useEffect(() => {
    let active = true;
    setSignalMarks([]);
    const pull = async () => {
      try {
        const response = await apiRequest(`/api/chart/${encodeURIComponent(symbol)}/signal-marks`, { cache: "no-store" });
        if (!response.ok || !active) return;
        const body = await response.json() as { marks?: SignalMark[] };
        if (active) setSignalMarks(Array.isArray(body.marks) ? body.marks : []);
      } catch {
        if (active) setSignalMarks([]);
      }
    };
    void pull();
    const timer = window.setInterval(pull, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [symbol]);
  useLiveMessages((message) => {
    if (message.type !== "kline" || !message.data || typeof message.data !== "object") return;
    const bar = message.data as Record<string, unknown>;
    if (normalizeSymbol(String(bar.symbol || "")) !== symbol || String(bar.timeframe) !== interval) return;
    const candle = readCandle(bar);
    if (!candle) return;
    tickAtRef.current = Date.now();
    setTickAt(tickAtRef.current);
    setError("");
    setCandles((current) => {
      const index = current.findIndex((row) => row.time === candle.time);
      if (index < 0) {
        // Sıra koruması: zamanı son bardan eski/geç gelen mum dizi başına
        // eklenmez (lightweight-charts sıralı veri ister; karışık seri → bozuk grafik).
        const lastTime = current[current.length - 1]?.time ?? 0;
        if (candle.time <= lastTime) return current;
        return [...current.slice(-499), candle];
      }
      const next = current.slice(); next[index] = candle; return next;
    });
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      // Sekme arka plandayken saat/tick durumunu güncelleme ve REST yükü yapma.
      if (typeof document !== "undefined" && document.hidden) return;
      setClock(Date.now());
      const stale = socketStatusRef.current !== "open" || !tickAtRef.current || Date.now() - tickAtRef.current > 30_000;
      // WS tick'leri taze olsa bile en fazla ~60 sn'de bir REST ile geçmişi
      // tazele: ilk yüklemesi başarısız olan panel sonsuza dek bozuk/eski
      // veriyle kalmasın (tick tazeliği yüklemeyi sonsuza dek engelliyordu).
      if (stale || Date.now() - (restAtRef.current ?? 0) > 60_000) void load();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let main: IChartApi | null = null;
    let sub: IChartApi | null = null;
    void import("lightweight-charts").then((charts) => {
      if (cancelled || !containerRef.current || !subContainerRef.current) return;
      // DİKKAT: fixRightEdge KULLANMA — sağ kenarı son bara kilitler ve
      // rightOffset boşluk payını yok sayar; sonuç: son mum tam sağ kenara
      // yapışıp kırpık görünür ("grafiğin sağı görünmüyor"). fixLeftEdge
      // yeterli: veri başının ötesine kayıt engellenir, sağda ise rightOffset
      // payıyla rahat görünüm kalır.
      const common = { layout: { background: { color: "#ffffff" }, textColor: "#64748b", attributionLogo: true }, grid: { vertLines: { color: "#eef2f7" }, horzLines: { color: "#eef2f7" } }, rightPriceScale: { borderColor: "#e2e8f0" }, timeScale: { borderColor: "#e2e8f0", timeVisible: true, secondsVisible: false, fixLeftEdge: true, rightOffset: 6, minBarSpacing: 0.5 }, crosshair: { mode: 1 }, handleScroll: { vertTouchDrag: false } };
      main = charts.createChart(containerRef.current, { ...common, width: containerRef.current.clientWidth, height: compact ? 230 : 360 });
      sub = charts.createChart(subContainerRef.current, { ...common, width: subContainerRef.current.clientWidth, height: compact ? 72 : 115, timeScale: { ...common.timeScale, visible: false } });
      chartRef.current = main; subChartRef.current = sub;
      candleSeriesRef.current = main.addSeries(charts.CandlestickSeries, { upColor: "#08a66a", downColor: "#e24755", borderVisible: false, wickUpColor: "#08a66a", wickDownColor: "#e24755" });
      markerFactoryRef.current = typeof charts.createSeriesMarkers === "function" ? charts.createSeriesMarkers : null;
      markerApiRef.current = null;
      seriesRef.current = {
        volume: main.addSeries(charts.HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }),
        sma: main.addSeries(charts.LineSeries, { color: "#3478e5", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }),
        ema: main.addSeries(charts.LineSeries, { color: "#e3a126", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }),
        ema7: main.addSeries(charts.LineSeries, { color: "#f59e0b", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "EMA 7" }),
        ema20: main.addSeries(charts.LineSeries, { color: "#3478e5", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "EMA 20" }),
        ema99: main.addSeries(charts.LineSeries, { color: "#0f172a", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "EMA 99" }),
        upper: main.addSeries(charts.LineSeries, { color: "#9370db", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
        lower: main.addSeries(charts.LineSeries, { color: "#9370db", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
        vwap: main.addSeries(charts.LineSeries, { color: "#0e9f9a", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }),
        rsi: sub.addSeries(charts.LineSeries, { color: "#7c3aed", lineWidth: 2, priceScaleId: "rsi" }),
        stochK: sub.addSeries(charts.LineSeries, {
          color: "#7c3aed", lineWidth: 2, priceScaleId: "stochrsi", priceLineVisible: false, title: "StochRSI %K",
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        }),
        stochD: sub.addSeries(charts.LineSeries, { color: "#f59e0b", lineWidth: 1, priceScaleId: "stochrsi", priceLineVisible: false, lastValueVisible: false, title: "%D" }),
        stochHigh: sub.addSeries(charts.LineSeries, { color: "#e24755", lineWidth: 1, lineStyle: 2, priceScaleId: "stochrsi", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
        stochLow: sub.addSeries(charts.LineSeries, { color: "#08a66a", lineWidth: 1, lineStyle: 2, priceScaleId: "stochrsi", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
        adx: sub.addSeries(charts.LineSeries, { color: "#f59e0b", lineWidth: 2, priceScaleId: "adx" }),
        atr: sub.addSeries(charts.LineSeries, { color: "#0e9f9a", lineWidth: 2, priceScaleId: "atr" }),
        macd: sub.addSeries(charts.HistogramSeries, { priceScaleId: "macd", priceLineVisible: false, lastValueVisible: false }),
      };
      main.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      ["rsi", "stochrsi", "adx", "atr", "macd"].forEach((scale) => sub?.priceScale(scale).applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } }));
      main.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) sub?.timeScale().setVisibleLogicalRange(range); });
      sub.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) main?.timeScale().setVisibleLogicalRange(range); });

      main.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData || !candleSeriesRef.current) {
          setHoveredCandle(null);
          return;
        }
        const bar = param.seriesData.get(candleSeriesRef.current) as any;
        if (bar && bar.open !== undefined) {
          setHoveredCandle({
            time: Number(param.time),
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: 0,
          });
        } else {
          setHoveredCandle(null);
        }
      });

      observer = new ResizeObserver(() => {
        if (containerRef.current) main?.applyOptions({ width: containerRef.current.clientWidth });
        if (subContainerRef.current) sub?.applyOptions({ width: subContainerRef.current.clientWidth });
      });
      observer.observe(containerRef.current); observer.observe(subContainerRef.current);
      setReady(true);
    }).catch(() => setError("Grafik bileşeni yüklenemedi."));
    return () => { cancelled = true; observer?.disconnect(); main?.remove(); sub?.remove(); chartRef.current = null; subChartRef.current = null; candleSeriesRef.current = null; markerApiRef.current = null; targetLineRef.current = null; seriesRef.current = {}; appliedRef.current = null; setReady(false); };
  }, [compact]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const [fullscreenHeight, setFullscreenHeight] = useState<number>(540);

  useEffect(() => {
    if (!chartRef.current || !containerRef.current || !subChartRef.current || !subContainerRef.current) return;

    if (isFullscreen) {
      const updateFullscreenDimensions = () => {
        const subVisible = config.enabled.some((id) => SUB_PANE_IDS.includes(id));
        const subHeight = subVisible ? 120 : 0;
        const availableHeight = Math.max(320, window.innerHeight - 240 - subHeight);
        setFullscreenHeight(availableHeight);

        if (chartRef.current && containerRef.current) {
          chartRef.current.applyOptions({
            height: availableHeight,
            width: containerRef.current.clientWidth,
          });
        }
        if (subChartRef.current && subContainerRef.current) {
          subChartRef.current.applyOptions({
            width: subContainerRef.current.clientWidth,
          });
        }
      };

      updateFullscreenDimensions();
      window.addEventListener("resize", updateFullscreenDimensions);
      return () => window.removeEventListener("resize", updateFullscreenDimensions);
    } else {
      const standardHeight = compact ? 230 : 360;
      chartRef.current.applyOptions({
        height: standardHeight,
        width: containerRef.current.clientWidth,
      });
      subChartRef.current.applyOptions({
        width: subContainerRef.current.clientWidth,
      });
    }
  }, [isFullscreen, compact, config.enabled]);

  const values = useMemo(() => calculate(candles, config.periods), [candles, config.periods]);
  // Uygulama anahtarı: sembol/interval/gösterge kümesi veya mum dizisinin
  // başlangıcı değişmediyse (yani yalnızca son mum tick'lendiyse) seri başına
  // tam `setData` + `fitContent` yerine ucuz `update(last)` kullanılır.
  const appliedRef = useRef<{ key: string; firstTime: number | null } | null>(null);
  useEffect(() => {
    if (!ready || !candleSeriesRef.current || !chartRef.current || !subChartRef.current) return;
    const toTime = (value: number) => value as UTCTimestamp;
    const lineData = (input: Array<number | null>) => candles.flatMap((candle, index) => input[index] == null ? [] : [{ time: toTime(candle.time), value: input[index] as number }]);
    const enabled = new Set(config.enabled);
    const key = `${symbol}|${interval}|${config.enabled.join(",")}|${Object.values(config.periods).join("-")}`;
    const firstTime = candles[0]?.time ?? null;
    const keyChanged = appliedRef.current?.key !== key;
    const full = keyChanged || appliedRef.current?.firstTime !== firstTime;
    if (full) {
      candleSeriesRef.current.setData(candles.map((candle) => ({ time: toTime(candle.time), open: candle.open, high: candle.high, low: candle.low, close: candle.close })));
      seriesRef.current.volume?.setData(enabled.has("volume") ? candles.map((candle) => ({ time: toTime(candle.time), value: candle.volume, color: candle.close >= candle.open ? "rgba(8,166,106,.45)" : "rgba(226,71,85,.45)" })) : []);
      seriesRef.current.sma?.setData(enabled.has("sma") ? lineData(values.sma) : []);
      seriesRef.current.ema?.setData(enabled.has("ema") ? lineData(values.ema) : []);
      seriesRef.current.ema7?.setData(enabled.has("ema3") ? lineData(values.ema7) : []);
      seriesRef.current.ema20?.setData(enabled.has("ema3") ? lineData(values.ema20) : []);
      seriesRef.current.ema99?.setData(enabled.has("ema3") ? lineData(values.ema99) : []);
      seriesRef.current.upper?.setData(enabled.has("bollinger") ? lineData(values.upper) : []);
      seriesRef.current.lower?.setData(enabled.has("bollinger") ? lineData(values.lower) : []);
      seriesRef.current.vwap?.setData(enabled.has("vwap") ? lineData(values.vwap) : []);
      seriesRef.current.rsi?.setData(enabled.has("rsi") ? lineData(values.rsi) : []);
      seriesRef.current.stochK?.setData(enabled.has("stochrsi") ? lineData(values.stochK) : []);
      seriesRef.current.stochD?.setData(enabled.has("stochrsi") ? lineData(values.stochD) : []);
      const band = (price: number) => enabled.has("stochrsi") ? candles.map((candle) => ({ time: toTime(candle.time), value: price })) : [];
      seriesRef.current.stochHigh?.setData(band(STOCH_RSI_HIGH));
      seriesRef.current.stochLow?.setData(band(STOCH_RSI_LOW));
      seriesRef.current.adx?.setData(enabled.has("adx") ? lineData(values.adx) : []);
      seriesRef.current.atr?.setData(enabled.has("atr") ? lineData(values.atr) : []);
      seriesRef.current.macd?.setData(enabled.has("macd") ? candles.flatMap((candle, index) => values.histogram[index] == null ? [] : [{ time: toTime(candle.time), value: values.histogram[index] as number, color: (values.histogram[index] as number) >= 0 ? "#08a66a" : "#e24755" }]) : []);
      // Yeni görünüm: TÜM mumları sığdırmak yerine son ~120 mumu okunak
      // genişlikte göster + sağda boşluk payı bırak.
      // Neden: fitContent 500 mumu sıkıştırınca barSpacing min'e iner, görünen
      // pencere tüm veriyi kapsar → sürükleme/kaydırma oynamıyor (pay sıfır) ve
      // son bar sağ kenara dayalı yarı kırpık çıkıyordu. ~120 mum ile 380 mumluk
      // kaydırma payı kalır (sol çekince kaydırma/zoom çalışır), sağ kenar
      // rightOffset kadar boşluklu kalır (son bar hiç kırpılmaz).
      if (keyChanged) {
        const bars = Math.max(candles.length, 1);
        const from = Math.max(0, bars - 120);
        // to: bars + rightOffset(6) → son mumun sağında boşluk payı kalır.
        chartRef.current.timeScale().setVisibleLogicalRange({ from, to: bars + 6 });
        subChartRef.current.timeScale().setVisibleLogicalRange({ from, to: bars + 6 });
      }
      appliedRef.current = { key, firstTime };
      return;
    }
    // Artımlı yol: yalnızca son mum güncellendi/eklendi.
    const lastIndex = candles.length - 1;
    const lastCandle = candles[lastIndex];
    if (!lastCandle) return;
    const lastTime = toTime(lastCandle.time);
    const lastValue = (input: Array<number | null>) => input[lastIndex] == null ? null : input[lastIndex] as number;
    candleSeriesRef.current.update({ time: lastTime, open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: lastCandle.close });
    if (enabled.has("volume")) seriesRef.current.volume?.update({ time: lastTime, value: lastCandle.volume, color: lastCandle.close >= lastCandle.open ? "rgba(8,166,106,.45)" : "rgba(226,71,85,.45)" });
    if (enabled.has("sma") && lastValue(values.sma) != null) seriesRef.current.sma?.update({ time: lastTime, value: lastValue(values.sma) as number });
    if (enabled.has("ema") && lastValue(values.ema) != null) seriesRef.current.ema?.update({ time: lastTime, value: lastValue(values.ema) as number });
    if (enabled.has("ema3")) {
      if (lastValue(values.ema7) != null) seriesRef.current.ema7?.update({ time: lastTime, value: lastValue(values.ema7) as number });
      if (lastValue(values.ema20) != null) seriesRef.current.ema20?.update({ time: lastTime, value: lastValue(values.ema20) as number });
      if (lastValue(values.ema99) != null) seriesRef.current.ema99?.update({ time: lastTime, value: lastValue(values.ema99) as number });
    }
    if (enabled.has("stochrsi")) {
      if (lastValue(values.stochK) != null) seriesRef.current.stochK?.update({ time: lastTime, value: lastValue(values.stochK) as number });
      if (lastValue(values.stochD) != null) seriesRef.current.stochD?.update({ time: lastTime, value: lastValue(values.stochD) as number });
      seriesRef.current.stochHigh?.update({ time: lastTime, value: STOCH_RSI_HIGH });
      seriesRef.current.stochLow?.update({ time: lastTime, value: STOCH_RSI_LOW });
    }
    if (enabled.has("bollinger")) {
      if (lastValue(values.upper) != null) seriesRef.current.upper?.update({ time: lastTime, value: lastValue(values.upper) as number });
      if (lastValue(values.lower) != null) seriesRef.current.lower?.update({ time: lastTime, value: lastValue(values.lower) as number });
    }
    if (enabled.has("vwap") && lastValue(values.vwap) != null) seriesRef.current.vwap?.update({ time: lastTime, value: lastValue(values.vwap) as number });
    if (enabled.has("rsi") && lastValue(values.rsi) != null) seriesRef.current.rsi?.update({ time: lastTime, value: lastValue(values.rsi) as number });
    if (enabled.has("adx") && lastValue(values.adx) != null) seriesRef.current.adx?.update({ time: lastTime, value: lastValue(values.adx) as number });
    if (enabled.has("atr") && lastValue(values.atr) != null) seriesRef.current.atr?.update({ time: lastTime, value: lastValue(values.atr) as number });
    if (enabled.has("macd") && lastValue(values.histogram) != null) seriesRef.current.macd?.update({ time: lastTime, value: lastValue(values.histogram) as number, color: (lastValue(values.histogram) as number) >= 0 ? "#08a66a" : "#e24755" });
  }, [candles, config.enabled, ready, values, symbol, interval]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!ready || !series) return;
    if (candles.length === 0) {
      markerApiRef.current?.setMarkers([]);
      return;
    }
    const markers: ChartMarker[] = [];
    const latest = [...signalMarks].sort((left, right) => Number(right.detected_at || 0) - Number(left.detected_at || 0))[0];
    if (latest) {
      const notified = barAtOrBefore(candles, Number(latest.detected_at || 0));
      if (notified != null) {
        markers.push({ time: notified as UTCTimestamp, position: "belowBar", color: "#3478e5", shape: "arrowUp", text: "Bildirim" });
        const target = Number(latest.expected_price || 0);
        const hit = target > 0 ? riseBar(candles, notified, target) : null;
        const recordedHit = String(latest.outcome_status || "").toUpperCase().includes("HEDEF")
          ? barAtOrBefore(candles, Number(latest.outcome_at || 0))
          : null;
        const rise = hit ?? recordedHit;
        if (rise != null) {
          markers.push({ time: rise as UTCTimestamp, position: "aboveBar", color: "#08a66a", shape: "arrowDown", text: "Hedef" });
        }
      }
    }
    if (config.enabled.includes("stochrsi")) {
      const kLine = values.stochK;
      const dLine = values.stochD;
      for (let index = 1; index < candles.length; index += 1) {
        const prevK = kLine[index - 1];
        const prevD = dLine[index - 1];
        const currK = kLine[index];
        const currD = dLine[index];
        if (prevK == null || prevD == null || currK == null || currD == null) continue;
        const crossUp = prevK <= prevD && currK > currD && currK < STOCH_RSI_LOW && prevK < STOCH_RSI_LOW;
        const crossDown = prevK >= prevD && currK < currD && currK > STOCH_RSI_HIGH && prevK > STOCH_RSI_HIGH;
        if (crossUp) {
          markers.push({ time: candles[index].time as UTCTimestamp, position: "belowBar", color: "#08a66a", shape: "arrowUp", text: "" });
        } else if (crossDown) {
          markers.push({ time: candles[index].time as UTCTimestamp, position: "aboveBar", color: "#e24755", shape: "arrowDown", text: "" });
        }
      }
    }
    markers.sort((left, right) => Number(left.time) - Number(right.time));
    if (!markerApiRef.current && markerFactoryRef.current) {
      markerApiRef.current = markerFactoryRef.current(series, markers);
    } else {
      markerApiRef.current?.setMarkers(markers);
    }
    const targetPrice = Number(latest?.expected_price || 0);
    if (targetLineRef.current && "applyOptions" in (series as object)) {
      try { series.removePriceLine(targetLineRef.current as never); } catch { /* seri yenilendiyse çizgi de gitmiştir */ }
      targetLineRef.current = null;
    }
    if (targetPrice > 0) {
      targetLineRef.current = series.createPriceLine({
        price: targetPrice,
        color: "#08a66a",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Hedef",
      });
    }
  }, [candles, config.enabled, ready, signalMarks, values]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!ready || !chart || !series || !config.enabled.includes("ema3")) {
      setBuyMarks([]);
      return;
    }
    const place = () => {
      const hits = ribbonBuyIndexes(symbol, candles, values.ema7, values.ema20, values.ema99);
      const next: Array<{ time: number; x: number; y: number }> = [];
      for (const index of hits) {
        const candle = candles[index];
        if (!candle) continue;
        const x = chart.timeScale().timeToCoordinate(candle.time as UTCTimestamp);
        const y = series.priceToCoordinate(candle.low);
        if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        next.push({ time: candle.time, x, y: y + 6 });
      }
      setBuyMarks(next.slice(-40));
    };
    place();
    const scale = chart.timeScale();
    scale.subscribeVisibleLogicalRangeChange(place);
    return () => scale.unsubscribeVisibleLogicalRangeChange(place);
  }, [candles, config.enabled, isFullscreen, ready, symbol, values]);

  const filteredSymbols = useMemo(() => {
    const query = normalizeSymbol(search);
    return query.length < 2 ? [] : symbols.filter((item) => normalizeSymbol(item).includes(query)).sort((a, b) => Number(normalizeSymbol(b).startsWith(query)) - Number(normalizeSymbol(a).startsWith(query))).slice(0, 12);
  }, [search, symbols]);
  const changeSymbol = (value: string) => { const next = normalizeSymbol(value); if (!next) return; setSymbol(next); onSymbolChange?.(next); setSearch(""); setSearchOpen(false); };
  const changeInterval = (value: string) => { setInterval(value); onIntervalChange?.(value); };
  const toggleIndicator = (id: Indicator) => setConfig((previous) => ({ ...previous, enabled: previous.enabled.includes(id) ? previous.enabled.filter((value) => value !== id) : [...previous.enabled, id] }));
  const updatePeriod = (key: keyof IndicatorConfig["periods"], raw: string) => setConfig((previous) => ({ ...previous, periods: { ...previous.periods, [key]: Math.max(2, Math.min(200, Number(raw) || 2)) } }));
  const last = candles[candles.length - 1];
  const activeCandle = hoveredCandle ?? last;
  const tickAge = tickAt == null ? null : Math.max(0, Math.floor((clock - tickAt) / 1000));
  const live = socketStatus === "open" && tickAge != null && tickAge <= 30;
  const restAge = restAt == null ? null : Math.max(0, Math.floor((clock - restAt) / 1000));
  const enabledIndicators = INDICATORS.filter(({ id }) => config.enabled.includes(id));

  return <section className={`rounded-xl border border-line bg-white transition-all ${isFullscreen ? "fixed inset-0 z-50 p-4 sm:p-6 flex flex-col justify-between overflow-y-auto" : compact ? "p-3" : "p-4 sm:p-5"}`} aria-label={`${symbol} canlı mum grafiği`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <div className="relative min-w-0">
          {compact ? <strong className="font-mono text-lg text-ink-900">{symbol}</strong> : <button type="button" onClick={() => { setSearchOpen((value) => !value); setSearch(""); }} className="font-mono text-lg font-bold text-ink-900 hover:text-accent" aria-expanded={searchOpen} aria-haspopup="listbox">{symbol}⌄</button>}
          <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${live ? "bg-gain-soft text-gain" : "bg-canvas text-ink-500"}`}>{live ? "CANLI" : "REST / ESKİ"}</span>
          {searchOpen && !compact && <div className="absolute left-0 top-8 z-30 w-64 rounded-lg border border-line bg-white p-2 shadow-pop">
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearchOpen(false); }} placeholder="İlk 2 harfi yazın…" aria-label="Sembol ara" role="combobox" aria-expanded={filteredSymbols.length > 0} aria-controls={`symbol-options-${symbol}`} className="w-full rounded-md border border-line px-2.5 py-2 font-mono text-sm outline-none focus:border-accent" />
            {search.length > 0 && search.length < 2 && <p className="px-2 py-2 text-xs text-ink-400">Öneriler için en az 2 harf yazın.</p>}
            {search.length >= 2 && <ul id={`symbol-options-${symbol}`} role="listbox" className="mt-1 max-h-56 overflow-auto">{filteredSymbols.length ? filteredSymbols.map((option) => <li key={option}><button type="button" role="option" aria-selected={normalizeSymbol(option) === symbol} onClick={() => changeSymbol(option)} className="w-full rounded px-2 py-1.5 text-left font-mono text-sm hover:bg-accent-soft">{option}</button></li>) : <li className="px-2 py-2 text-xs text-ink-400">Eşleşen sembol yok.</li>}</ul>}
          </div>}
        </div>

        {/* OHLCV Canlı İnceleme Şeridi */}
        {activeCandle && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas/70 border border-line px-2.5 py-1 font-mono text-[11px] text-ink-600">
            <span>A: <strong className="text-ink-900">{formatPrice(activeCandle.open)}</strong></span>
            <span>Y: <strong className="text-ink-900">{formatPrice(activeCandle.high)}</strong></span>
            <span>D: <strong className="text-ink-900">{formatPrice(activeCandle.low)}</strong></span>
            <span>K: <strong className={activeCandle.close >= activeCandle.open ? "text-gain font-semibold" : "text-loss font-semibold"}>{formatPrice(activeCandle.close)}</strong></span>
            <span className={`font-semibold ${activeCandle.close >= activeCandle.open ? "text-gain" : "text-loss"}`}>
              {activeCandle.close >= activeCandle.open ? "+" : ""}{(((activeCandle.close - activeCandle.open) / (activeCandle.open || 1)) * 100).toFixed(2)}%
            </span>
          </div>
        )}
        {(signalMarks.length > 0 || config.enabled.includes("ema3")) && (
          <span className="text-[10px] font-medium text-ink-500">son bildirim · son hedef · yeşil BUY: EMA 7 EMA 20’yi EMA 99 üstünde yukarı kesince · Stoch 20 altı yeşil ok, 80 üstü kırmızı ok</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!compact && (
          <div className="flex rounded-lg border border-line p-0.5" aria-label="Grafik zaman dilimi">
            {INTERVALS.map((value) => (
              <button key={value} type="button" aria-pressed={interval === value} onClick={() => changeInterval(value)} className={`rounded-md px-2 py-1 text-xs ${interval === value ? "bg-accent text-white" : "text-ink-500 hover:bg-canvas"}`}>{value}</button>
            ))}
          </div>
        )}
        {!compact && (
          <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)} className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-600 hover:border-accent hover:text-accent">
            Göstergeler ⚙
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsFullscreen((prev) => !prev)}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-600 hover:border-accent hover:text-accent flex items-center gap-1"
          title={isFullscreen ? "Tam ekrandan çık (Esc)" : "Tam ekran (Esc ile çıkış)"}
        >
          <span>{isFullscreen ? "✕" : "⛶"}</span>
          <span className="hidden sm:inline">{isFullscreen ? "Çıkış" : "Tam Ekran"}</span>
        </button>
      </div>
    </div>
    {!compact && settingsOpen && <div className="mb-3 rounded-lg border border-line bg-slate-50 p-3">
      {/* 1-Tık Hazır Paketler */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5 border-b border-line pb-2.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mr-1">Hazır Paketler:</span>
        <button type="button" onClick={() => setConfig((p) => ({ ...p, enabled: ["ema3", "stochrsi"] }))} className="rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink-800 hover:border-ink-400">◎ Varsayılan (EMA 7/20/99 + Stoch RSI)</button>
        <button type="button" onClick={() => setConfig((p) => ({ ...p, enabled: ["volume", "ema", "rsi", "vwap"] }))} className="rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-accent hover:border-accent hover:bg-accent-soft">🎯 Scalp (EMA+RSI+VWAP)</button>
        <button type="button" onClick={() => setConfig((p) => ({ ...p, enabled: ["volume", "sma", "bollinger", "macd"] }))} className="rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-violet-600 hover:border-violet-400 hover:bg-violet-50">📈 Trend (SMA+BB+MACD)</button>
        <button type="button" onClick={() => setConfig((p) => ({ ...p, enabled: ["volume", "atr", "adx", "bollinger"] }))} className="rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-amber-700 hover:border-amber-400 hover:bg-amber-50">⚡ Volatilite (ATR+ADX+BB)</button>
        <button type="button" onClick={() => setConfig((p) => ({ ...p, enabled: ["volume"] }))} className="rounded-md border border-line bg-white px-2 py-1 text-[11px] font-medium text-ink-500 hover:text-ink-900">🧹 Temizle</button>
      </div>
      <div className="flex flex-wrap gap-2">{INDICATORS.map(({ id, label }) => <button key={id} type="button" aria-pressed={config.enabled.includes(id)} onClick={() => toggleIndicator(id)} className={`rounded-md border px-2.5 py-1.5 text-xs ${config.enabled.includes(id) ? "border-accent bg-accent-soft text-accent" : "border-line bg-white text-ink-500"}`}>{label}</button>)}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{([ ["sma", "SMA"], ["ema", "EMA"], ["bollinger", "BB"], ["rsi", "RSI"], ["atr", "ATR"], ["adx", "ADX"] ] as const).map(([key, label]) => <label key={key} className="text-[10px] text-ink-500">{label} periyodu<input type="number" min={2} max={200} value={config.periods[key]} onChange={(event) => updatePeriod(key, event.target.value)} className="mt-1 w-full rounded border border-line bg-white px-2 py-1 font-mono text-xs text-ink-800" /></label>)}</div>
    </div>}
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]" aria-label="Gösterge değerleri">
      {enabledIndicators.map(({ id, label }) => {
        const index = candles.length - 1;
        const reading: Record<Indicator, number | null> = {
          volume: last?.volume ?? null,
          sma: calculatedValue("sma", index),
          ema: calculatedValue("ema", index),
          ema3: calculatedValue("ema7", index),
          bollinger: calculatedValue("upper", index),
          rsi: calculatedValue("rsi", index),
          stochrsi: calculatedValue("stochK", index),
          macd: calculatedValue("histogram", index),
          vwap: calculatedValue("vwap", index),
          atr: calculatedValue("atr", index),
          adx: calculatedValue("adx", index),
        };
        const extra = id === "ema3"
          ? ` 7 ${formatReading(calculatedValue("ema7", index))} · 20 ${formatReading(calculatedValue("ema20", index))} · 99 ${formatReading(calculatedValue("ema99", index))}`
          : id === "stochrsi"
            ? ` ${STOCH_RSI_PERIOD} · K ${formatReading(calculatedValue("stochK", index))} · D ${formatReading(calculatedValue("stochD", index))} · bant ${STOCH_RSI_LOW}/${STOCH_RSI_HIGH}`
            : `${id === "macd" ? " Hist" : id === "bollinger" ? ` Üst ${config.periods.bollinger},2` : id === "sma" || id === "ema" || id === "rsi" || id === "atr" || id === "adx" ? ` ${config.periods[id]}` : ""} · ${formatReading(reading[id])}`;
        return <span key={id} className="rounded-md border border-line bg-white px-2 py-1 font-mono text-ink-600">{label}{extra}</span>;
      })}
    </div>
    <div className="relative">
      <div
        ref={containerRef}
        style={{ height: isFullscreen ? `${fullscreenHeight}px` : undefined }}
        className={`w-full overflow-hidden rounded-t-lg bg-white ${
          isFullscreen ? "" : compact ? "h-[230px]" : "h-[360px]"
        }`}
      />
      {buyMarks.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
          {buyMarks.map((mark) => (
            <span key={mark.time} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: mark.x, top: mark.y }}>
              <span className="block h-0 w-0 border-x-[7px] border-b-[7px] border-x-transparent border-b-[#089981]" />
              <span className="-mt-px rounded-[3px] bg-[#089981] px-1.5 py-[3px] text-[10px] font-extrabold leading-none tracking-wide text-white shadow-sm">BUY</span>
            </span>
          ))}
        </div>
      )}
    </div>
    <div
      ref={subContainerRef}
      className={`w-full overflow-hidden rounded-b-lg border-t border-line/70 ${
        compact ? "h-[72px]" : "h-[115px]"
      } ${config.enabled.some((id) => SUB_PANE_IDS.includes(id)) ? "" : "hidden"}`}
    />
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-ink-400" role="status">
      <span>{live ? `WebSocket canlı · son mum ${tickAge}s önce` : `REST yedek · son yenileme ${restAge == null ? "bekleniyor" : `${restAge}s önce`}`}{error ? ` · ${error}` : ""}</span>
      <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer" className="underline decoration-dotted">TradingView Lightweight Charts™ attribution</a>
    </div>
  </section>;

  function calculatedValue(key: "sma" | "ema" | "ema7" | "ema20" | "ema99" | "upper" | "rsi" | "stochK" | "stochD" | "histogram" | "vwap" | "atr" | "adx", index: number): number | null {
    const value = values[key][index];
    return value == null ? null : value;
  }
}

export default MarketChart;
