"""Üç radar eklentisi (2026-10-17).

Saf fonksiyonlar. Canlı tarama ve 7 günlük replay aynı tanımı kullanır.

1. Avize çıkışı (Chandelier): son N barın en yükseği − çarpan × ATR.
   Sabit %3 hedef tabanının yerine kârı ATR ile taşımak için.
2. Fonlama kalabalığı: vadeli fonlama aşırı long ise alım kesilir.
   Gerçek tasfiye kademesi spot mumda yoktur; aşırı long fonlama,
   long tasfiyesi riskinin eldeki vekilidir (derivatives_service ile aynı eşik).
3. Saatlik göreli hacim: bu saatin hacmi / önceki günlerde AYNI saatin
   ortalama hacmi. Son 20 bar ortalamasından farklıdır.
"""
from __future__ import annotations

HOUR_MS = 3_600_000


def base_asset(symbol: str) -> str:
    s = str(symbol or "").upper()
    if s.endswith("TRY"):
        return s[:-3]
    if s.endswith("USDT"):
        return s[:-4]
    return s


def chandelier_stop(highs, atr, length: int = 22, mult: float = 3.0) -> float | None:
    """Uzun avize stopu. ATR fiyat birimindedir, yüzde değil."""
    try:
        atr_v = float(atr)
        mult_v = float(mult)
        n = int(length)
    except (TypeError, ValueError):
        return None
    if atr_v <= 0 or mult_v <= 0 or n < 1 or not highs:
        return None
    window = [float(h) for h in list(highs)[-n:] if h is not None]
    if not window:
        return None
    return max(window) - mult_v * atr_v


def crowded_long_reason(funding_rate, crowded_min: float = 0.0004,
                        extreme_min: float = 0.0008) -> str | None:
    """Fonlama kesri (0.0004 = %0.04 / 8 saat). Yoksa veto yok."""
    if funding_rate is None:
        return None
    try:
        rate = float(funding_rate)
    except (TypeError, ValueError):
        return None
    if rate >= float(extreme_min):
        return "fonlama_asiri_long"
    if rate >= float(crowded_min):
        return "fonlama_kalabalik_long"
    return None


def hourly_rvol_from_klines(rows, now_ms: int, min_samples: int = 4) -> float | None:
    """Kapanmış 1s mumlarda, son saatin hacmi / aynı UTC saatinin geçmiş ortalaması.

    `rows`: Binance kline satırları, [açılış_ms, ..., hacim]. Oluşan mum düşer.
    Aynı saatten en az `min_samples` geçmiş gün yoksa None (veto uygulanmaz).
    """
    closed: list[tuple[int, float]] = []
    for row in rows or []:
        try:
            opened = int(row[0])
            volume = float(row[5])
        except (TypeError, ValueError, IndexError):
            continue
        if opened + HOUR_MS > int(now_ms):
            continue
        if volume < 0:
            continue
        closed.append((opened, volume))
    if len(closed) < int(min_samples) + 1:
        return None
    last_open, last_volume = closed[-1]
    hour = (last_open // HOUR_MS) % 24
    prior = [vol for opened, vol in closed[:-1]
             if (opened // HOUR_MS) % 24 == hour and vol > 0]
    if len(prior) < int(min_samples):
        return None
    baseline = sum(prior) / len(prior)
    if baseline <= 0:
        return None
    return last_volume / baseline


def _atr_price(highs, lows, closes, end: int, period: int = 14) -> float | None:
    if end < period:
        return None
    trs = []
    start = end - period + 1
    for i in range(start, end + 1):
        prev = closes[i - 1] if i else closes[0]
        trs.append(max(highs[i] - lows[i], abs(highs[i] - prev), abs(lows[i] - prev)))
    if len(trs) < period:
        return None
    return sum(trs) / len(trs)


def simulate_path(bars, entry: float, *, target_pct: float, horizon_min: float,
                  cost_pct: float = 0.35, sl_pct: float = 3.0,
                  exit_mode: str = "target",
                  chandelier_length: int = 22, chandelier_mult: float = 3.0) -> dict | None:
    """İleri mumlarda çıkış. `bars`: (epoch_sn, high, low, close) girişten sonra.

    exit_mode:
      * target — sabit TP ve %sl stop. Aynı mumda ikisi de olursa stop (kötümser).
      * chandelier — sabit TP yok. Stop = max(acil %sl, avize). Ufuk sonunda kapanış.
    """
    try:
        entry = float(entry)
    except (TypeError, ValueError):
        return None
    if entry <= 0 or not bars:
        return None
    mode = str(exit_mode or "target")
    tp = entry * (1 + float(target_pct) / 100.0) if mode == "target" else None
    hard_sl = entry * (1 - abs(float(sl_pct)) / 100.0)
    end = float(bars[0][0]) + float(horizon_min) * 60.0
    highs = [float(b[1]) for b in bars]
    lows = [float(b[2]) for b in bars]
    closes = [float(b[3]) for b in bars]
    peak = entry
    trail = hard_sl
    exit_px = None
    reason = "horizon_end"
    for i, (ot, hi, lo, cl) in enumerate(bars):
        if ot > end:
            break
        peak = max(peak, hi)
        if mode == "chandelier":
            atr = _atr_price(highs, lows, closes, i, 14)
            ch = chandelier_stop(highs[:i + 1], atr, chandelier_length, chandelier_mult) if atr else None
            if ch is not None:
                trail = max(trail, min(ch, hi))
            stop = trail
        else:
            stop = hard_sl
        hit_sl = lo <= stop
        hit_tp = tp is not None and hi >= tp
        if hit_sl and hit_tp:
            exit_px, reason = stop, "stop_loss"
            break
        if hit_sl:
            exit_px, reason = stop, ("chandelier_exit" if mode == "chandelier" and stop > hard_sl else "stop_loss")
            break
        if hit_tp:
            exit_px, reason = tp, "take_profit"
            break
        exit_px = cl
    if exit_px is None:
        return None
    gross = (exit_px / entry - 1) * 100
    return {
        "net_pct": round(gross - float(cost_pct), 4),
        "reason": reason,
        "mfe": round((peak / entry - 1) * 100, 3),
    }
