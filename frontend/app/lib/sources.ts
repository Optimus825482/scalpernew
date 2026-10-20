import type { Candidate } from "./types";

/**
 * Tespit kaynağı etiketleri — "bu sinyali hangi sistem üretti?".
 *
 * Backend `unified_signals.SOURCE_LABELS` (velocity→RADAR, jump→MACD SIRÇRAMA,
 * early→ERKEN SIRÇRAMA, rising→YÜKSELİŞ) ile hizalı; buna aday sözlüğündeki
 * `pool_source` (gainer/mover/discovery/symbol/extra) ve `strategy`
 * (daily_momentum/short_squeeze/both/velocity) etiketleri eklenir.
 */
const SOURCE_LABELS: Record<string, string> = {
  velocity: "Radar",
  jump: "MACD Sıçrama",
  early: "Erken Sıçrama",
  rising: "Yükseliş Eğilimi",
  ema_ribbon: "MA Kurdele",
  trend_devam: "Trend Devam",
  unified: "Birleşik tarama",
  bilinmiyor: "Kaynak yok",
  daily_momentum: "Günlük Momentum",
  short_squeeze: "Short Squeeze",
  both: "Momentum+Squeeze",
  fusion: "Füzyon",
  combined: "Kombine",
  macd_snapshot: "MACD Anlık",
  gainer: "Kazananlar Havuzu",
  mover: "Hareketli Havuz",
  discovery: "Keşif Akışı",
  symbol: "Takip Listesi",
  extra: "Ek Havuz",
  master_surge: "Hacim Patlaması",
  pulse: "Hızlı Nabız",
  snapback: "Snapback Dip",
  macd_mtf: "MACD Çoklu Zaman",
  four_badge: "4 Rozet",
  early_discovery: "Erken Keşif",
  whale: "Balina Girişi",
  dip_approach: "Dip Dönüşü",
  // Pozisyon/strateji kaynakları (aktif işlemler tablosu)
  auto_paper: "Otonom",
  AUTO_PAPER: "Otonom",
  chat_prediction: "Chat Tahmini",
  CHAT_PREDICTION: "Chat Tahmini",
  LLM_PAPER: "LLM Paper",
  global_lead_lag: "Global Lead-Lag",
  GLOBAL_LEAD_LAG: "Global Lead-Lag",
};

const RIBBON_TIMEFRAMES: Record<string, string> = {
  "1m": "1 dk",
  "3m": "3 dk",
  "5m": "5 dk",
  "15m": "15 dk",
  "30m": "30 dk",
  "1h": "1 sa",
  "4h": "4 sa",
  "1d": "1 gün",
};

const RIBBON_TIMEFRAME_CODES: Record<string, string> = {
  "1m": "M1",
  "3m": "M3",
  "5m": "M5",
  "15m": "M15",
  "30m": "M30",
  "1h": "H1",
  "4h": "H4",
  "1d": "D1",
};

/** Mum aralığını rozet metnine çevirir: 5m → 5 dk. */
export function ribbonTimeframeLabel(code: unknown): string {
  const key = String(code ?? "").trim().toLowerCase();
  if (!key) return "";
  return RIBBON_TIMEFRAMES[key] || key;
}

/** Otonom paper rozeti: 5m → M5, 15m → M15. */
export function ribbonTimeframeCode(code: unknown): string {
  const key = String(code ?? "").trim().toLowerCase();
  if (!key) return "";
  return RIBBON_TIMEFRAME_CODES[key] || key.toUpperCase();
}

/** "5m,15m" → "M5 · M15". */
export function ribbonTimeframeCodes(value: unknown): string {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,|]/);
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const item of raw) {
    const label = ribbonTimeframeCode(item);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels.join(" · ");
}

/** "5m,15m" veya dizi → "5 dk · 15 dk". */
export function ribbonTimeframeNote(value: unknown): string {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,|]/);
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const item of raw) {
    const label = ribbonTimeframeLabel(item);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels.join(" · ");
}

/** Tek bir kaynak kodunu okunur etikete çevirir. */
export function sourceLabel(code: unknown): string {
  const key = String(code ?? "").trim().toLowerCase();
  if (!key) return "";
  return SOURCE_LABELS[key] || key;
}

/**
 * Bir aday/bildirim için gösterilecek kaynak etiketleri (tekrarsız, sıralı).
 * Öncelik: `sources` (bildirim zarfı) → `unified_sources` (füzyon motorları) →
 * `pool_source` → `strategy`. Hiçbiri yoksa boş dizi.
 */
export function candidateSources(item: Candidate | Record<string, unknown>): string[] {
  const r = item as Record<string, unknown>;
  const raw = (Array.isArray(r.sources) && r.sources.length ? r.sources : null)
    || (Array.isArray(r.unified_sources) && r.unified_sources.length ? r.unified_sources : null);
  const codes: string[] = [];
  if (raw) {
    for (const s of raw) codes.push(String(s));
  }
  if (Array.isArray(r.signal_sources)) {
    for (const source of r.signal_sources) codes.push(String(source));
  }
  if (!raw && !Array.isArray(r.signal_sources)) {
    if (r.pool_source) codes.push(String(r.pool_source));
    if (r.strategy) codes.push(String(r.strategy));
  }
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const code of codes) {
    const label = sourceLabel(code);
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

/**
 * Kaynak KODLARI (etiketsiz, tekrarsız). Rozet bileşeni her koda özel stil
 * uygularken bu ham kodları kullanır.
 */
export function candidateSourceCodes(item: Candidate | Record<string, unknown>): string[] {
  const r = item as Record<string, unknown>;
  const raw = (Array.isArray(r.sources) && r.sources.length ? r.sources : null)
    || (Array.isArray(r.unified_sources) && r.unified_sources.length ? r.unified_sources : null);
  const codes: string[] = [];
  if (raw) {
    for (const s of raw) codes.push(String(s));
  }
  if (Array.isArray(r.signal_sources)) {
    for (const source of r.signal_sources) codes.push(String(source));
  }
  if (!raw && !Array.isArray(r.signal_sources)) {
    if (r.pool_source) codes.push(String(r.pool_source));
    if (r.strategy) codes.push(String(r.strategy));
  }
  return Array.from(new Set(codes.map((code) => code.trim()).filter(Boolean)));
}
