"use client";

/**
 * RouteLoading — rota geçişleri için tam sayfa yükleme göstergesi.
 * Saf Tailwind/CSS; harici bağımlılık yok. prefers-reduced-motion
 * tercihinde animasyonlar devre dışı kalır, statik gösterge sunulur.
 */
export default function RouteLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-canvas/80 backdrop-blur-sm"
    >
      {/* Çift halkalı spinner — accent (#0066ff) */}
      <div className="relative h-16 w-16 motion-safe:animate-spin" style={{ animationDuration: "1.1s" }}>
        <span className="absolute inset-0 rounded-full border-4 border-accent-soft" />
        <span className="absolute inset-0 rounded-full border-4 border-transparent border-t-accent motion-safe:animate-spin" style={{ animationDuration: "1.1s" }} />
        <span className="absolute inset-2 rounded-full border-2 border-transparent border-b-accent/50 motion-safe:animate-spin" style={{ animationDuration: "1.6s", animationDirection: "reverse" }} />
      </div>
      <p className="text-sm font-medium text-ink-500">Yükleniyor…</p>
    </div>
  );
}
