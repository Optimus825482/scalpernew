"""EMA 7/20/99 kurdele alımı.

Turuncu EMA 7, mavi EMA 20'yi yukarı keser ve ikisi de siyah EMA 99'un
üstündedir. Ölçüm kapanmış 1 dakikalık mumdadır; oluşan mum sayılmaz.
Grafikteki EMA ile aynı tohum kullanılır: ilk değer periyotluk SMA.
"""
from __future__ import annotations

import logging
import time

from app.config import config

logger = logging.getLogger("scalper.ema_ribbon")

RIBBON_TIMEFRAME = "1m"
RIBBON_FAST = 7
RIBBON_MID = 20
RIBBON_SLOW = 99
RIBBON_SCORE = 75.0
RIBBON_HORIZON_MINUTES = 15
RIBBON_LIST_WINDOW_MS = 15 * 60 * 1000
RIBBON_TRADE_MAX_AGE_SEC = 180.0
RIBBON_FLAT_LOOKBACK = 20
RIBBON_MIN_RANGE_PCT = 0.80
RIBBON_MIN_SPAN_PCT = 0.40
RIBBON_DEAD_STICK_PCT = 0.08
RIBBON_DEAD_STICK_RATIO = 0.70
# Sabit veya altına endeksli tahta. Kesişim gürültüdür, bildirim ve paper açılmaz.
PEGGED_BASES = frozenset({
    "USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "EUR",
    "PAXG", "XAUT", "PAX", "USD1", "RLUSD",
})


def ema_series(values: list[float], period: int) -> list[float | None]:
    output: list[float | None] = [None] * len(values)
    if period < 1 or len(values) < period:
        return output
    alpha = 2 / (period + 1)
    current = sum(values[:period]) / period
    output[period - 1] = current
    for index in range(period, len(values)):
        current = values[index] * alpha + current * (1 - alpha)
        output[index] = current
    return output


def ribbon_buy_at(fast: list[float | None], mid: list[float | None], slow: list[float | None], index: int) -> bool:
    """EMA 7, EMA 20'yi yukarı kesiyor ve ikisi de EMA 99'un üstünde."""
    if index < 1:
        return False
    try:
        curr_fast = fast[index]
        curr_mid = mid[index]
        curr_slow = slow[index]
        prev_fast = fast[index - 1]
        prev_mid = mid[index - 1]
    except IndexError:
        return False
    if None in (curr_fast, curr_mid, curr_slow, prev_fast, prev_mid):
        return False
    crossed_up = prev_fast <= prev_mid and curr_fast > curr_mid
    above_slow = curr_fast > curr_slow and curr_mid > curr_slow
    return bool(crossed_up and above_slow)


def base_asset(symbol: str) -> str:
    name = str(symbol or "").upper()
    if name.endswith("TRY"):
        return name[:-3]
    if name.endswith("USDT"):
        return name[:-4]
    return name


def is_pegged_symbol(symbol: str) -> bool:
    return base_asset(symbol) in PEGGED_BASES


def ribbon_is_compressed(fast: float, mid: float, slow: float, price: float, min_span_pct: float = RIBBON_MIN_SPAN_PCT) -> bool:
    """Üç ortalama birbirine yapışıksa tahta durağandır."""
    if price <= 0:
        return True
    span = (max(fast, mid, slow) - min(fast, mid, slow)) / price * 100.0
    return span < min_span_pct


def bodies_are_flat(
    opens: list[float],
    closes: list[float],
    index: int,
    highs: list[float] | None = None,
    lows: list[float] | None = None,
    lookback: int = RIBBON_FLAT_LOOKBACK,
    dead_stick_pct: float = RIBBON_DEAD_STICK_PCT,
    min_dead_ratio: float = RIBBON_DEAD_STICK_RATIO,
) -> bool:
    """Son mumların çubuk boyu neredeyse sıfırsa tahta durağandır.

    Çubuk boyu, mumun kendi tepesi ile dibi. O yoksa gövde (kapanış-açılış).
    Bakılan mumların çoğu bu eşiğin altındaysa kesişim gürültüdür.
    """
    if index < 0 or not opens or not closes:
        return True
    start = max(0, index - lookback + 1)
    total = 0
    dead = 0
    for cursor in range(start, index + 1):
        try:
            opened = float(opens[cursor])
            closed = float(closes[cursor])
        except (IndexError, TypeError, ValueError):
            continue
        price = closed if closed > 0 else opened
        if price <= 0:
            continue
        height = abs(closed - opened)
        if highs is not None and lows is not None and cursor < len(highs) and cursor < len(lows):
            try:
                height = max(height, float(highs[cursor]) - float(lows[cursor]))
            except (TypeError, ValueError):
                pass
        total += 1
        if height / price * 100.0 < dead_stick_pct:
            dead += 1
    if total < 8:
        return True
    return dead / total >= min_dead_ratio


def tape_is_flat(highs: list[float], lows: list[float], index: int, lookback: int = RIBBON_FLAT_LOOKBACK, min_range_pct: float = RIBBON_MIN_RANGE_PCT) -> bool:
    """Son bakılan mumların tepeden dibe aralığı eşikten darsa durağandır."""
    if index < 0 or not highs or not lows:
        return True
    start = max(0, index - lookback + 1)
    window_high = highs[start:index + 1]
    window_low = lows[start:index + 1]
    if not window_high or not window_low:
        return True
    low = min(window_low)
    if low <= 0:
        return True
    return (max(window_high) - low) / low * 100.0 < min_range_pct


def select_recent_cross(
    closes: list[float],
    stamps: list[int],
    now_ms: int,
    window_ms: int = RIBBON_LIST_WINDOW_MS,
    highs: list[float] | None = None,
    lows: list[float] | None = None,
    opens: list[float] | None = None,
) -> int | None:
    """Penceredeki en yeni hareketli kurdele alımı. Durağan kesişim yok sayılır."""
    if len(closes) < 2 or len(stamps) != len(closes):
        return None
    fast = ema_series(closes, RIBBON_FAST)
    mid = ema_series(closes, RIBBON_MID)
    slow = ema_series(closes, RIBBON_SLOW)
    earliest = int(now_ms) - int(window_ms)
    for index in range(len(closes) - 1, 0, -1):
        if int(stamps[index]) < earliest:
            break
        if not ribbon_buy_at(fast, mid, slow, index):
            continue
        curr_fast = fast[index]
        curr_mid = mid[index]
        curr_slow = slow[index]
        price = closes[index]
        if curr_fast is None or curr_mid is None or curr_slow is None:
            continue
        if ribbon_is_compressed(curr_fast, curr_mid, curr_slow, price):
            continue
        if highs is not None and lows is not None and tape_is_flat(highs, lows, index):
            continue
        if opens is not None and bodies_are_flat(opens, closes, index, highs, lows):
            continue
        return index
    return None


def ribbon_bar_is_fresh(bar_ms: int, now: float | None = None, max_age_sec: float = RIBBON_TRADE_MAX_AGE_SEC) -> bool:
    """Yeni kapanmış 1 dk mumu. Eski kesişim paper veya bildirim açmaz."""
    if bar_ms <= 0:
        return False
    moment = time.time() if now is None else float(now)
    return (moment - (bar_ms / 1000.0)) <= float(max_age_sec)


def closed_ribbon_buy(closes: list[float]) -> bool:
    """Son kapanmış mumda kurdele alımı var mı. Seride oluşan mum olmamalı."""
    if len(closes) < RIBBON_SLOW + 1:
        return False
    fast = ema_series(closes, RIBBON_FAST)
    mid = ema_series(closes, RIBBON_MID)
    slow = ema_series(closes, RIBBON_SLOW)
    return ribbon_buy_at(fast, mid, slow, len(closes) - 1)


def net_target_pct() -> float:
    """Komisyon düşüldükten sonra en az %2 net kalacak brüt hedef."""
    fee_pct = (float(config.COMMISSION_TAKER_PCT) + float(config.COMMISSION_MAKER_PCT)) * 100.0
    floor = float(getattr(config, "SCALPING_NET_TARGET_PCT", 2.0)) + fee_pct
    return round(floor, 3)


def ribbon_candidates() -> list[dict]:
    """Aktif evrendeki son 15 dk içindeki kapanmış 1m kurdele alımları. Yazma yapmaz."""
    from app.state import market

    target = net_target_pct()
    now_ms = int(time.time() * 1000)
    rows: list[dict] = []
    symbols = [str(symbol).upper() for symbol in (getattr(market, "symbols", []) or []) if symbol]
    for symbol in symbols:
        if is_pegged_symbol(symbol):
            continue
        history = (market.klines.get(RIBBON_TIMEFRAME, {}).get(symbol) or {})
        closes_raw = list(history.get("closes") or [])
        opens_raw = list(history.get("opens") or [])
        highs_raw = list(history.get("highs") or [])
        lows_raw = list(history.get("lows") or [])
        stamps = list(history.get("timestamps") or [])
        if len(closes_raw) < RIBBON_SLOW + 1 or len(stamps) != len(closes_raw):
            continue
        try:
            closes = [float(value) for value in closes_raw]
            stamp_ms = [int(value) for value in stamps]
            opens = [float(value) for value in opens_raw] if len(opens_raw) == len(closes_raw) else closes
            highs = [float(value) for value in highs_raw] if len(highs_raw) == len(closes_raw) else closes
            lows = [float(value) for value in lows_raw] if len(lows_raw) == len(closes_raw) else closes
        except (TypeError, ValueError):
            continue
        index = select_recent_cross(closes, stamp_ms, now_ms, highs=highs, lows=lows, opens=opens)
        if index is None:
            continue
        price = closes[index]
        if price <= 0:
            continue
        bar_ms = stamp_ms[index]
        if bar_ms <= 0:
            continue
        rows.append({
            "symbol": symbol,
            "price": price,
            "target_pct": target,
            "horizon_minutes": RIBBON_HORIZON_MINUTES,
            "ceiling_pct": target,
            "ceiling_price": round(price * (1 + target / 100.0), 8),
            "potential_pct": target,
            "potential_price": round(price * (1 + target / 100.0), 8),
            "scan_score": RIBBON_SCORE,
            "quality_score": RIBBON_SCORE,
            "panel_score": RIBBON_SCORE,
            "signal_sources": ["ema_ribbon"],
            "unified_sources": ["ema_ribbon"],
            "supporting_sources": [],
            "opposing_sources": [],
            "source_evidence": {
                "timeframe": RIBBON_TIMEFRAME,
                "ema_fast": RIBBON_FAST,
                "ema_mid": RIBBON_MID,
                "ema_slow": RIBBON_SLOW,
            },
            "strategy": "ema_ribbon",
            "ribbon_bar_ms": bar_ms,
            "detected_at": bar_ms / 1000.0,
            "_hit": False,
        })
    if rows:
        logger.info("ema kurdele alımı: %s", ", ".join(row["symbol"] for row in rows))
    return rows
