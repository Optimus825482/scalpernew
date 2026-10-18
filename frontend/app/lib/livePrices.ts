"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { useLiveMessages } from "./liveSocket";

type TickerRow = { symbol: string; available?: boolean; last?: number | null };

/** Görünen sembollerin son fiyatını toplu çeker. Tarama anlık görüntüsü donmasın diye. */
export function useLivePrices(symbols: string[], intervalMs = 10_000): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const key = Array.from(new Set(symbols.map((symbol) => symbol.toUpperCase()).filter(Boolean))).sort().join(",");

  useEffect(() => {
    if (!key) return;
    let active = true;
    const load = async () => {
      try {
        const response = await apiRequest(`/api/market-tickers?symbols=${encodeURIComponent(key)}`, { cache: "no-store" });
        if (!response.ok || !active) return;
        const body = await response.json() as { tickers?: TickerRow[] };
        if (!active) return;
        const next: Record<string, number> = {};
        for (const row of body.tickers ?? []) {
          const last = Number(row.last);
          if (row.symbol && Number.isFinite(last) && last > 0) next[String(row.symbol).toUpperCase()] = last;
        }
        setPrices(next);
      } catch {
        // Son bilinen fiyat kalır.
      }
    };
    void load();
    const timer = window.setInterval(load, intervalMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [key, intervalMs]);

  return prices;
}

type PriceTick = { price?: number; symbol?: string };

/** Açık işlem fiyatı. REST listesi yapı içindir; fiyat `binance_price` akışından gelir. */
export function useSymbolPrices(symbols: string[]): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const wanted = useRef(new Set<string>());
  wanted.current = new Set(symbols.map((symbol) => symbol.toUpperCase()).filter(Boolean));

  useLiveMessages((message) => {
    if (message.type !== "binance_price") return;
    const ticks = (message.data as { ticks?: Record<string, PriceTick> } | undefined)?.ticks;
    if (!ticks) return;
    setPrices((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const symbol of wanted.current) {
        const tick = ticks[symbol];
        const price = Number(tick?.price);
        if (!Number.isFinite(price) || price <= 0 || next[symbol] === price) continue;
        next[symbol] = price;
        changed = true;
      }
      return changed ? next : previous;
    });
  });

  return prices;
}

export function livePrice(symbol: string, fallback: number | null | undefined, prices: Record<string, number>): number | null {
  const live = prices[symbol.toUpperCase()];
  if (live > 0) return live;
  const current = Number(fallback);
  return Number.isFinite(current) && current > 0 ? current : null;
}

type ChainMark = { at: number; base: number };
type NoticeMark = { price: number; peak: number; at: number };
type ScanBook = {
  scanId: string;
  symbols: string[];
  chains: Record<string, ChainMark>;
  notices: Record<string, NoticeMark>;
};

const BOOK_KEY = "odak_signal_book";

export type SignalMark = {
  chainAt: number;
  chainBase: number;
  noticeAt: number;
  noticePrice: number;
  peak: number;
  continued: boolean;
};

function emptyBook(): ScanBook {
  return { scanId: "", symbols: [], chains: {}, notices: {} };
}

function loadBook(): ScanBook {
  try {
    const raw = sessionStorage.getItem(BOOK_KEY);
    if (!raw) return emptyBook();
    const parsed = JSON.parse(raw) as ScanBook;
    if (!parsed || typeof parsed !== "object" || !parsed.notices) return emptyBook();
    return parsed;
  } catch {
    return emptyBook();
  }
}

function saveBook(book: ScanBook) {
  try {
    sessionStorage.setItem(BOOK_KEY, JSON.stringify(book));
  } catch {
    // Oturum deposu kapalıysa bu tur bellekte kalmaz; kart yine kendi fiyatını kullanır.
  }
}

/**
 * Yeni tarama listesini işler.
 * Sembol bir önceki listede de varsa zincir (ilk saat ve ilk fiyat) sürer.
 * Listeden çıkıp dönen sembolde zincir kopar.
 * Hedef her tarama bildiriminin kendi fiyatından başlar; eski zirve taşınmaz.
 */
export function rememberScan(scanId: string, rows: Array<{ symbol: string; price: number | null }>) {
  const id = String(scanId || "");
  if (!id) return;
  const book = loadBook();
  if (book.scanId === id) return;
  const previous = new Set(book.symbols);
  const now = Date.now() / 1000;
  const chains: Record<string, ChainMark> = {};
  const notices: Record<string, NoticeMark> = {};
  const symbols: string[] = [];
  for (const row of rows) {
    const symbol = String(row.symbol || "").toUpperCase();
    const price = Number(row.price);
    if (!symbol || !Number.isFinite(price) || price <= 0) continue;
    symbols.push(symbol);
    const chain = previous.has(symbol) ? book.chains[symbol] : undefined;
    chains[symbol] = chain ?? { at: now, base: price };
    notices[symbol] = { price, peak: price, at: now };
  }
  saveBook({ scanId: id, symbols, chains, notices });
}

export function readSignal(symbol: string): SignalMark | null {
  const key = symbol.toUpperCase();
  const book = loadBook();
  const chain = book.chains[key];
  const notice = book.notices[key];
  if (!chain || !notice) return null;
  return {
    chainAt: chain.at,
    chainBase: chain.base,
    noticeAt: notice.at,
    noticePrice: notice.price,
    peak: notice.peak,
    continued: chain.at + 2 < notice.at,
  };
}

/** Bu bildirimin zirvesini canlı fiyatla günceller. Eski bildirimin zirvesini kullanmaz. */
export function touchPeak(symbol: string, price: number | null): SignalMark | null {
  const key = symbol.toUpperCase();
  const seen = Number(price);
  const book = loadBook();
  const notice = book.notices[key];
  const chain = book.chains[key];
  if (!notice || !chain) return null;
  if (Number.isFinite(seen) && seen > notice.peak) {
    notice.peak = seen;
    book.notices[key] = notice;
    saveBook(book);
  }
  return readSignal(key);
}

export function elapsedLabel(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  if (sec < 60) return `${sec} sn`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} dk`;
  const hour = Math.floor(min / 60);
  if (hour < 48) return `${hour} sa ${min % 60} dk`;
  return `${Math.floor(hour / 24)} gün`;
}
