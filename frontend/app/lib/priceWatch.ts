"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";
import { baseAsset } from "./opportunity";

const WATCH_EVENT = "odak:price-watch-updated";
const MAX_ENTRIES = 30;

export type PriceWatchEntry = {
  symbol: string;
  base: string;
  /** İzlemeye alınan andaki fiyat (TRY). */
  price: number;
  /** İzlemeye alınma zamanı (epoch ms). */
  watchedAt: number;
};

function storageKey(username: string | null) {
  return `odak_price_watch:${String(username || "anonymous").toLowerCase()}`;
}

function normalizeEntries(value: unknown): PriceWatchEntry[] {
  if (!Array.isArray(value)) return [];
  const bySymbol = new Map<string, PriceWatchEntry>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const symbol = String(row.symbol || "").toUpperCase().trim();
    const price = Number(row.price);
    if (!symbol || !Number.isFinite(price) || price <= 0) continue;
    if (bySymbol.has(symbol)) continue;
    bySymbol.set(symbol, {
      symbol,
      base: String(row.base || baseAsset(symbol)),
      price,
      watchedAt: Number(row.watchedAt) || Date.now(),
    });
  }
  return Array.from(bySymbol.values())
    .sort((left, right) => right.watchedAt - left.watchedAt)
    .slice(0, MAX_ENTRIES);
}

function loadEntries(username: string | null): PriceWatchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(username));
    return raw ? normalizeEntries(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: PriceWatchEntry[], username: string | null): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(username), JSON.stringify(entries));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(WATCH_EVENT, { detail: { username, entries } }));
}

export function usePriceWatch() {
  const { username } = useAuth();
  const [entries, setEntries] = useState<PriceWatchEntry[]>([]);
  const key = storageKey(username);

  useEffect(() => {
    setEntries(loadEntries(username));
    const handleUpdate = (event: Event) => {
      const custom = event as CustomEvent<{ username?: string | null; entries?: PriceWatchEntry[] }>;
      if (custom.detail && String(custom.detail.username || "").toLowerCase() === String(username || "").toLowerCase()) {
        setEntries(normalizeEntries(custom.detail.entries));
        return;
      }
      if (event.type === "storage" && (event as StorageEvent).key === key) {
        setEntries(loadEntries(username));
      }
    };
    window.addEventListener(WATCH_EVENT, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener(WATCH_EVENT, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [key, username]);

  const watch = useCallback((symbol: string, price: number) => {
    const upper = String(symbol || "").toUpperCase().trim();
    if (!upper || !Number.isFinite(price) || price <= 0) return;
    setEntries((previous) => {
      const next = previous.filter((entry) => entry.symbol !== upper);
      next.unshift({ symbol: upper, base: baseAsset(upper), price, watchedAt: Date.now() });
      const trimmed = normalizeEntries(next);
      saveEntries(trimmed, username);
      return trimmed;
    });
  }, [username]);

  const unwatch = useCallback((symbol: string) => {
    const upper = String(symbol || "").toUpperCase().trim();
    setEntries((previous) => {
      const next = previous.filter((entry) => entry.symbol !== upper);
      saveEntries(next, username);
      return next;
    });
  }, [username]);

  const isWatched = useCallback((symbol: string) => {
    const upper = String(symbol || "").toUpperCase().trim();
    return entries.some((entry) => entry.symbol === upper);
  }, [entries]);

  return { entries, watch, unwatch, isWatched };
}
