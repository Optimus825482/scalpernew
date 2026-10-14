"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const SESSION_KEY = "scalper-splash-shown";
// 2026-10-14 performans düzeltmesi: yapay 3 saniyelik minimum bekleme
// "uygulama çok geç yükleniyor" şikayetinin ana nedeniydi — içerik hazır
// olsa bile kullanıcı en az 3 sn (en kötü 4,5 sn) splash'a bakti. Bütçe
// ~1 sn'e indirildi: görsel flash'i önlemeye yeter, algılanan yüklenme
// süresini ~2 sn kısaltır.
const MIN_DISPLAY_MS = 900;
const MAX_DISPLAY_MS = 1800;

const STATUS_TEXTS = [
  "Bağlantı kuruluyor…",
  "Piyasa verileri hazırlanıyor…",
  "Sinyal motoru başlatılıyor…",
];

const SUBTITLE = "INTELLIGENT SCANNER";

// useLayoutEffect on client, useEffect on server (SSR-safe, avoids warning).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function SplashScreen() {
  const [mounted, setMounted] = useState(true);
  const [fading, setFading] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const [typeCount, setTypeCount] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const markedRef = useRef(false);
  const minDoneRef = useRef(false);

  const hide = useCallback(() => {
    if (markedRef.current) return;
    markedRef.current = true;
    setFading(true);
    window.setTimeout(() => setMounted(false), 520);
  }, []);

  // Runs synchronously BEFORE first paint:
  // - repeat views within the session are removed instantly (no flash)
  // - first view is marked as shown right away
  useIsomorphicLayoutEffect(() => {
    let already = false;
    try {
      already = sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {}
    if (already) {
      setMounted(false);
      return;
    }
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {}
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setReduceMotion(true);
      }
    } catch {}
  }, []);

  // Timers: minimum display gate, hard force-hide, cycling status text.
  useEffect(() => {
    if (!mounted) return;

    const minTimer = window.setTimeout(() => {
      minDoneRef.current = true;
    }, MIN_DISPLAY_MS);

    const maxTimer = window.setTimeout(hide, MAX_DISPLAY_MS);

    const statusTimer = reduceMotion
      ? undefined
      : window.setInterval(() => {
          setStatusIdx((i) => (i + 1) % STATUS_TEXTS.length);
        }, 900);

    // Fade out once minimum display elapsed and the document finished loading.
    const gateTimer = window.setInterval(() => {
      if (minDoneRef.current && document.readyState !== "loading") {
        window.clearInterval(gateTimer);
        hide();
      }
    }, 120);

    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
      window.clearInterval(gateTimer);
      if (statusTimer) window.clearInterval(statusTimer);
    };
  }, [mounted, hide, reduceMotion]);

  // Typing/decrypt effect for the subtitle.
  useEffect(() => {
    if (!mounted || reduceMotion || typeCount >= SUBTITLE.length) return;
    const t = window.setTimeout(
      () => setTypeCount((c) => c + 1),
      45 + Math.random() * 55
    );
    return () => window.clearTimeout(t);
  }, [typeCount, mounted, reduceMotion]);

  if (!mounted) return null;

  const typed = reduceMotion ? SUBTITLE : SUBTITLE.slice(0, typeCount);

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[100] flex select-none items-center justify-center overflow-hidden"
      style={{
        background:
          "linear-gradient(160deg, #0A1128 0%, #0A1128 45%, #10224F 100%)",
        opacity: fading ? 0 : 1,
        transition: reduceMotion
          ? "opacity 300ms ease"
          : fading
            ? "opacity 500ms ease-out"
            : "opacity 200ms ease-in",
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      {/* Subtle tech grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,102,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,102,255,0.06) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />

      <div className="relative flex flex-col items-center gap-5 px-6">
        {/* Radar pulse rings behind icon */}
        <div className="relative flex items-center justify-center">
          {!reduceMotion && (
            <>
              <span className="splash-pulse absolute h-28 w-28 rounded-full border border-[#0066FF]/40" />
              <span className="splash-pulse splash-pulse-delay absolute h-28 w-28 rounded-full border border-[#0066FF]/30" />
            </>
          )}
          <img
            src="/icons/icon-512.png"
            alt=""
            width={96}
            height={96}
            draggable={false}
            className="relative h-24 w-24 rounded-2xl shadow-[0_0_40px_rgba(0,102,255,0.35)]"
          />
        </div>

        {/* Wordmark */}
        <div className="text-center">
          <h1
            className="text-3xl font-bold tracking-[0.35em] text-white sm:text-4xl"
            style={{ textIndent: "0.35em" }}
          >
            SCALPER
          </h1>
          <p
            className="mt-2 font-mono text-xs tracking-[0.3em] text-[#3D8BFF] sm:text-sm"
            style={{ minHeight: "1.5em" }}
          >
            {typed}
            {!reduceMotion && typed.length < SUBTITLE.length ? (
              <span className="splash-caret ml-0.5 inline-block h-3 w-[7px] translate-y-[1px] bg-[#0066FF]" />
            ) : null}
          </p>
        </div>

        {/* Scanning line / progress bar */}
        <div className="relative mt-1 h-[3px] w-56 overflow-hidden rounded-full bg-white/10">
          <div
            className={
              reduceMotion
                ? "splash-fill-static h-full rounded-full bg-[#0066FF]"
                : "splash-fill h-full rounded-full bg-[#0066FF]"
            }
          />
        </div>

        {/* Turkish status text */}
        <p
          className="mt-1 font-mono text-[11px] tracking-wide text-white/45"
          style={{ minHeight: "1.2em" }}
        >
          {reduceMotion ? STATUS_TEXTS[1] : STATUS_TEXTS[statusIdx]}
        </p>
      </div>

      {/* Scoped keyframes (globals.css untouched) */}
      <style>{`
        @keyframes splash-pulse-kf {
          0% { transform: scale(0.6); opacity: 0.8; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        .splash-pulse { animation: splash-pulse-kf 1.8s ease-out infinite; }
        .splash-pulse-delay { animation-delay: 0.9s; }
        @keyframes splash-scan-kf {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(260%); }
        }
        .splash-fill { width: 40%; animation: splash-scan-kf 1.4s ease-in-out infinite; }
        .splash-fill-static { width: 100%; }
        @keyframes splash-caret-kf { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        .splash-caret { animation: splash-caret-kf 0.8s step-end infinite; }
        @media (prefers-reduced-motion: reduce) {
          .splash-pulse, .splash-fill, .splash-caret { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
