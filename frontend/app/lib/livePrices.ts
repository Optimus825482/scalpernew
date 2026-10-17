"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "./api";

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

/** Kartın ilk görüldüğü an. Tarama her turda detected_at'i yenilediği için saat oturumda sabitlenir. */
export function signalSeenAt(symbol: string, serverTs: number | null): number {
  const now = Date.now() / 1000;
  const key = `odak_signal_seen:${symbol}`;
  let stored = 0;
  try {
    stored = Number(sessionStorage.getItem(key) || 0);
  } catch {
    stored = 0;
  }
  const server = serverTs && serverTs > 1_000_000_000 ? (serverTs > 1e12 ? serverTs / 1000 : serverTs) : 0;
  if (stored > 0 && (!server || now - server < 90 || Math.abs(server - stored) < 20 * 60)) return stored;
  const start = server && now - server >= 90 ? server : now;
  try {
    sessionStorage.setItem(key, String(start));
  } catch {
    // Oturum deposu kapalıysa saat yine de bu tur için döner.
  }
  return start;
}

/** Bildirim anındaki fiyat. Sonraki taramalar tabanı kaydırmaz. */
export function signalBasePrice(symbol: string, price: number | null): number | null {
  const key = `odak_signal_price:${symbol}`;
  let stored = 0;
  try {
    stored = Number(sessionStorage.getItem(key) || 0);
  } catch {
    stored = 0;
  }
  if (stored > 0) return stored;
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  try {
    sessionStorage.setItem(key, String(price));
  } catch {
    // Depo kapalıysa bu turdaki fiyat taban kabul edilir.
  }
  return price;
}

/** Bildirimden sonraki en yüksek görülen fiyat. Geri çekilse de hedef tutmuş sayılır. */
export function signalPeakPrice(symbol: string, price: number | null): number | null {
  const key = `odak_signal_peak:${symbol}`;
  let stored = 0;
  try {
    stored = Number(sessionStorage.getItem(key) || 0);
  } catch {
    stored = 0;
  }
  const seen = price != null && Number.isFinite(price) && price > 0 ? price : 0;
  const next = Math.max(stored, seen);
  if (!(next > 0)) return null;
  if (next !== stored) {
    try {
      sessionStorage.setItem(key, String(next));
    } catch {
      // Depo kapalıysa bu turdaki zirve yine döner.
    }
  }
  return next;
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
