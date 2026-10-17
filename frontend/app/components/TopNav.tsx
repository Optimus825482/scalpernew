"use client";

import AppLink from "./AppLink";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useLiveStatus } from "../lib/liveSocket";
import { useWatchlist } from "../lib/watchlist";
import { apiRequest } from "../lib/api";
import { sound } from "../lib/sound";
import { Badge, Button } from "./ui";
import FavoriteTickerBand from "./FavoriteTickerBand";
import CommandPalette from "./CommandPalette";

const NAV = [
  { href: "/", label: "Anasayfa" },
  { href: "/firsatlar", label: "Sinyal & Tarama" },
  { href: "/grafik", label: "Grafikler" },
  { href: "/emirler", label: "Açık Emirler" },
  { href: "/gecmis-islemler", label: "İşlem Geçmişi" },
  { href: "/alarmlar", label: "Alarmlar" },
  { href: "/kullanicilar", label: "Kullanıcı Yönetimi", adminOnly: true },
  { href: "/ayarlar", label: "Ayarlar" },
];

export default function TopNav() {
  const pathname = usePathname();
  const { username, role, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [soundActive, setSoundActive] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const liveStatus = useLiveStatus();
  const { favorites } = useWatchlist();

  const isAdmin = role === "admin";
  const initial = (username || "?").charAt(0).toUpperCase();

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Ağ gecikmesi (Ping latency) ölçümü: backend API gidiş-dönüş süresi
  useEffect(() => {
    let active = true;
    async function measurePing() {
      if (document.hidden) return;
      const start = performance.now();
      try {
        const res = await apiRequest("/api/auth/status", { method: "GET", cache: "no-store" });
        if (active) {
          if (res.ok) {
            const delta = Math.round(performance.now() - start);
            setLatency(delta);
          } else {
            setLatency(null);
          }
        }
      } catch {
        if (active) setLatency(null);
      }
    }
    void measurePing();
    const interval = setInterval(measurePing, 20_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("odak_sound_enabled");
      if (stored !== null) setSoundActive(stored === "true");
    } catch {
      // pass
    }
  }, []);

  const toggleSound = () => {
    const next = !soundActive;
    setSoundActive(next);
    try {
      localStorage.setItem("odak_sound_enabled", String(next));
    } catch {
      // pass
    }
    if (next) sound.playSuccessTone();
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
        {/* Sol Logo ve Başlık — menü kayar, sağdaki arama düğmesinin altına taşmaz */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <AppLink href="/" className="flex shrink-0 items-center gap-2.5">
            <img
              src="/icons/icon-512.png"
              alt="Scalper Intelligent"
              className="h-9 w-9 rounded-xl shadow-sm"
              width={36}
              height={36}
            />
            <div className="hidden leading-tight sm:block">
              <span className="block text-sm font-bold tracking-tight text-ink-900">SCALPER INTELLIGENT</span>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.15em] text-accent">
                Unified Signal Engine
              </span>
            </div>
          </AppLink>

          {/* Menü Sekmeleri — mobilde alt tab bar var, burada yalnızca lg+ */}
          <nav className="odak-ticker-scroll hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex" aria-label="Ana navigasyon">
            {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <AppLink
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors ${
                    active
                      ? "bg-accent-soft text-accent font-semibold"
                      : "text-ink-500 hover:bg-canvas hover:text-ink-900"
                  }`}
                >
                  {item.label}
                </AppLink>
              );
            })}
          </nav>
        </div>

        {/* Sağ: Arama, Durum Göstergeleri ve Kullanıcı */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Hızlı Arama Butonu (Cmd+K) */}
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-line bg-canvas/60 px-2.5 py-1 text-xs text-ink-600 hover:border-accent hover:text-accent transition-colors"
            title="Hızlı Sembol & Komut Arama (Ctrl+K)"
          >
            <span className="text-ink-400">🔍</span>
            <span className="hidden md:inline font-mono text-[11px] text-ink-500">Hızlı Ara…</span>
            <kbd className="hidden sm:inline rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-400 border border-line shadow-2xs">
              ⌘K
            </kbd>
          </button>

          {/* Ağ Gecikmesi (Ping) Göstergesi */}
          {latency !== null && (
            <div
              className="hidden lg:flex items-center gap-1 font-mono text-[11px] text-ink-500"
              title={`Ağ gecikmesi: ${latency}ms`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  latency < 100 ? "bg-gain" : latency < 300 ? "bg-warn" : "bg-loss"
                }`}
              />
              <span>{latency}ms</span>
            </div>
          )}

          {/* Favoriler Rozeti */}
          {favorites.length > 0 && (
            <AppLink
              href="/?filter=favorites"
              className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas/70 px-2.5 py-1 text-xs font-medium text-ink-700 hover:border-accent hover:text-accent transition-colors"
              title="Favorilerimi Göster"
            >
              <span className="text-amber-500 font-bold">★</span>
              <span>{favorites.length} Favori</span>
            </AppLink>
          )}

          {/* Ses Bildirimi Butonu */}
          <button
            type="button"
            onClick={toggleSound}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors flex items-center gap-1 ${
              soundActive
                ? "border-accent/30 bg-accent-soft text-accent"
                : "border-line bg-canvas text-ink-400 hover:text-ink-700"
            }`}
            title={soundActive ? "Sinyal sesi açık (kapatmak için tıkla)" : "Sinyal sesi kapalı (açmak için tıkla)"}
          >
            <span>{soundActive ? "🔔" : "🔕"}</span>
            <span className="hidden xl:inline">{soundActive ? "Ses Açık" : "Sessiz"}</span>
          </button>

          {/* Canlı Bağlantı Rozeti */}
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                liveStatus === "open"
                  ? "bg-gain odak-live-dot"
                  : liveStatus === "connecting"
                  ? "bg-warn animate-pulse"
                  : "bg-loss"
              }`}
            />
            <span className="hidden sm:inline font-mono text-[11px] font-semibold uppercase text-ink-500">
              {liveStatus === "open" ? "CANLI" : liveStatus === "connecting" ? "BAĞLANIYOR" : "KOPUK"}
            </span>
          </div>

          {/* Kullanıcı ve Çıkış */}
          {username && (
            <div className="flex items-center gap-2 border-l border-line pl-2 sm:pl-3">
              <span className="hidden xl:block text-right leading-tight">
                <span className="block text-xs font-semibold text-ink-900">{username}</span>
                <span className="block text-[9px] uppercase tracking-wide text-ink-400">
                  {isAdmin ? "Yönetici" : "Kullanıcı"}
                </span>
              </span>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                {initial}
              </span>
              <Button
                variant="ghost"
                className="hidden min-h-0 px-2 py-1 text-xs sm:inline-flex"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await logout?.();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "…" : "Çıkış"}
              </Button>
            </div>
          )}
        </div>
      </div>
      </header>
      <FavoriteTickerBand favorites={favorites} />
      <CommandPalette isOpen={commandOpen} onClose={() => setCommandOpen(false)} />
    </>
  );
}
