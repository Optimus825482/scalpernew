"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "../lib/api";
import { useWatchlist } from "../lib/watchlist";
import { sound } from "../lib/sound";
import type { MarketSymbols } from "../lib/types";

export type CommandAction = {
  id: string;
  category: "Semboller" | "Hızlı Eylemler" | "Navigasyon";
  title: string;
  subtitle?: string;
  badge?: string;
  icon: string;
  onSelect: () => void;
};

function normalizeSearchText(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/i̇/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

const DEFAULT_POPULAR_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLTRY", "AVAXTRY", "PEPEUSDT", "BTCTRY", "ETHTRY"];

export default function CommandPalette({
  isOpen,
  onClose,
  onSelectSymbol,
  onTriggerScan,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectSymbol?: (symbol: string) => void;
  onTriggerScan?: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { isFavorite, toggleFavorite } = useWatchlist();

  // Sembolleri getir
  useEffect(() => {
    let active = true;
    void apiRequest("/api/market-symbols")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MarketSymbols | null) => {
        if (active && data?.symbols) setSymbols(data.symbols);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Son aramaları yükle
  useEffect(() => {
    try {
      const stored = localStorage.getItem("odak_recent_searches");
      if (stored) setRecents(JSON.parse(stored));
    } catch {}
  }, []);

  const saveRecent = (symbol: string) => {
    try {
      const next = [symbol, ...recents.filter((s) => s !== symbol)].slice(0, 8);
      setRecents(next);
      localStorage.setItem("odak_recent_searches", JSON.stringify(next));
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const normQuery = normalizeSearchText(query);
  const cleanSymbolQuery = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  const actions: CommandAction[] = useMemo(() => {
    const list: CommandAction[] = [];

    const navDefinitions: Array<{
      id: string;
      category: "Hızlı Eylemler" | "Navigasyon";
      title: string;
      subtitle: string;
      badge: string;
      icon: string;
      keywords: string[];
      onSelect: () => void;
    }> = [
      {
        id: "action-scan",
        category: "Hızlı Eylemler",
        title: "Piyasayı Tara (Salt-Veri Tarama)",
        subtitle: "Tüm piyasayı birleşik motorla tara",
        badge: "Eylem",
        icon: "⚡",
        keywords: ["tara", "tarama", "scan", "piyasa", "bul", "motor"],
        onSelect: () => {
          onClose();
          if (onTriggerScan) {
            onTriggerScan();
          } else {
            window.dispatchEvent(new CustomEvent("odak:trigger-scan"));
            if (typeof window !== "undefined" && window.location.pathname !== "/") {
              router.push("/?scan=1");
            }
          }
        },
      },
      {
        id: "action-chart",
        category: "Navigasyon",
        title: "Canlı Grafik & Teknik Analiz",
        subtitle: "Çoklu panel TradingView grafikleri",
        badge: "Sayfa",
        icon: "📊",
        keywords: ["grafik", "grafikler", "chart", "charts", "analiz", "teknik", "mum", "tradingview"],
        onSelect: () => {
          onClose();
          router.push("/grafik");
        },
      },
      {
        id: "action-orders",
        category: "Navigasyon",
        title: "Açık Emirler & İptal",
        subtitle: "Bekleyen limit ve stop emirlerini yönet",
        badge: "Sayfa",
        icon: "📑",
        keywords: ["emir", "emirler", "orders", "acik", "limit", "stop", "iptal", "bekleyen"],
        onSelect: () => {
          onClose();
          router.push("/emirler");
        },
      },
      {
        id: "action-opportunities",
        category: "Navigasyon",
        title: "Fırsatlar & Sinyal Akışı",
        subtitle: "Tespit edilen canlı yükseliş sinyalleri",
        badge: "Sayfa",
        icon: "🎯",
        keywords: ["firsat", "firsatlar", "sinyal", "opportunities", "radar"],
        onSelect: () => {
          onClose();
          router.push("/firsatlar");
        },
      },
      {
        id: "action-history",
        category: "Navigasyon",
        title: "İşlem Geçmişi & K/Z Raporu",
        subtitle: "Tamamlanan alım-satım kayıtları",
        badge: "Sayfa",
        icon: "📜",
        keywords: ["gecmis", "gecmis islemler", "history", "kar", "zarar", "rapor", "pnl"],
        onSelect: () => {
          onClose();
          router.push("/gecmis-islemler");
        },
      },
      {
        id: "action-alerts",
        category: "Navigasyon",
        title: "Fiyat & Sinyal Alarmları",
        subtitle: "Hedef ve stop bildirimleri",
        badge: "Sayfa",
        icon: "🔔",
        keywords: ["alarm", "alarmlar", "alerts", "bildirim", "fiyat", "zil"],
        onSelect: () => {
          onClose();
          router.push("/alarmlar");
        },
      },
      {
        id: "action-settings",
        category: "Navigasyon",
        title: "Sistem ve Borsa Ayarları",
        subtitle: "API anahtarları ve parametreler",
        badge: "Sayfa",
        icon: "⚙️",
        keywords: ["ayar", "ayarlar", "settings", "api", "anahtar", "borsa", "hesap"],
        onSelect: () => {
          onClose();
          router.push("/ayarlar");
        },
      },
    ];

    // Navigasyon eylemleri filtreleme
    navDefinitions.forEach((def) => {
      const match =
        !normQuery ||
        def.keywords.some((k) => k.includes(normQuery) || normQuery.includes(k)) ||
        normalizeSearchText(def.title).includes(normQuery) ||
        normalizeSearchText(def.subtitle).includes(normQuery);

      if (match) {
        list.push({
          id: def.id,
          category: def.category,
          title: def.title,
          subtitle: def.subtitle,
          badge: def.badge,
          icon: def.icon,
          onSelect: def.onSelect,
        });
      }
    });

    // Sembol Eşleşmeleri
    let matchedSymbols: string[] = [];
    const pool = symbols.length > 0 ? symbols : DEFAULT_POPULAR_SYMBOLS;

    if (cleanSymbolQuery) {
      matchedSymbols = pool
        .filter((s) => s.includes(cleanSymbolQuery))
        .sort((a, b) => {
          const aStarts = a.startsWith(cleanSymbolQuery) ? 1 : 0;
          const bStarts = b.startsWith(cleanSymbolQuery) ? 1 : 0;
          if (aStarts !== bStarts) return bStarts - aStarts;
          return a.localeCompare(b);
        })
        .slice(0, 15);
    } else if (recents.length > 0) {
      matchedSymbols = recents;
    } else {
      matchedSymbols = DEFAULT_POPULAR_SYMBOLS;
    }

    matchedSymbols.forEach((sym) => {
      const fav = isFavorite(sym);
      list.push({
        id: `symbol-${sym}`,
        category: "Semboller",
        title: sym,
        subtitle: fav ? "★ Favorilerinizde kayıtlı" : "Binance TR işlem çifti",
        badge: sym.endsWith("TRY") ? "TRY" : "USDT",
        icon: fav ? "★" : "◎",
        onSelect: () => {
          saveRecent(sym);
          onClose();
          if (onSelectSymbol) {
            onSelectSymbol(sym);
          } else {
            window.dispatchEvent(new CustomEvent("odak:select-symbol", { detail: sym }));
            if (typeof window !== "undefined") {
              const path = window.location.pathname;
              if (path !== "/" && path !== "/grafik") {
                router.push(`/grafik?symbol=${encodeURIComponent(sym)}`);
              }
            }
          }
        },
      });
    });

    return list;
  }, [normQuery, cleanSymbolQuery, symbols, recents, isFavorite, onClose, onSelectSymbol, onTriggerScan, router]);

  // Klavye olayları (Up/Down, Enter, Esc)
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, actions.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + actions.length) % Math.max(1, actions.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const action = actions[selectedIndex];
        if (action) action.onSelect();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, actions, selectedIndex, onClose]);

  // Seçili öğeyi kaydır
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      activeEl?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 p-4 pt-16 backdrop-blur-sm sm:pt-24"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Komut ve Sembol Arama Paleti"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-white shadow-2xl transition-all"
      >
        {/* Arama Kutusu */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <span className="text-lg text-ink-400">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Sembol veya komut arayın… (örn: BTC, SOL, Tara, Grafik)"
            className="flex-1 bg-transparent font-mono text-sm text-ink-900 placeholder:text-ink-400 outline-none"
          />
          <kbd className="rounded-md border border-line bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink-500">
            ESC
          </kbd>
        </div>

        {/* Sonuç Listesi */}
        <ul ref={listRef} className="max-h-[60vh] overflow-y-auto p-2" role="listbox">
          {actions.length === 0 ? (
            <li className="px-4 py-8 text-center text-xs text-ink-400">
              Eşleşen sembol veya komut bulunamadı.
            </li>
          ) : (
            actions.map((action, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <li
                  key={action.id}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => action.onSelect()}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                    isSelected ? "bg-accent text-white" : "text-ink-800 hover:bg-canvas"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm ${
                        isSelected ? "bg-white/20 text-white" : "bg-canvas text-ink-600"
                      }`}
                    >
                      {action.icon}
                    </span>
                    <div className="min-w-0">
                      <p className={`font-mono text-sm font-semibold truncate ${isSelected ? "text-white" : "text-ink-900"}`}>
                        {action.title}
                      </p>
                      {action.subtitle && (
                        <p className={`text-[11px] truncate ${isSelected ? "text-white/80" : "text-ink-400"}`}>
                          {action.subtitle}
                        </p>
                      )}
                    </div>
                  </div>
                  {action.badge && (
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                        isSelected ? "bg-white/20 text-white" : "bg-canvas text-ink-500"
                      }`}
                    >
                      {action.badge}
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ul>

        {/* Alt Bilgi */}
        <div className="flex items-center justify-between border-t border-line bg-canvas/50 px-4 py-2.5 text-[11px] text-ink-400">
          <div className="flex items-center gap-2">
            <span>Seçmek için</span>
            <kbd className="rounded border border-line bg-white px-1 font-mono text-[10px]">↑↓</kbd>
            <span>Onaylamak için</span>
            <kbd className="rounded border border-line bg-white px-1 font-mono text-[10px]">↵</kbd>
          </div>
          <span>Scalper Intelligent Pro</span>
        </div>
      </div>
    </div>
  );
}
