"""SMA 7/20/99 kurdele alımı.

Turuncu SMA 7, mavi SMA 20'yi yukarı keser ve ikisi de siyah SMA 99'un
üstündedir. Fiyatı hareket eden coinlerde kapanmış 5, 15, 30 dakika ve 1 saat
mumlarda aranır. 1 dakika sinyal üretmez. 30 dakika ve 1 saat hedefi %3'tür.
Grafikteki üç ortalama ile aynı hesap: basit aritmetik ortalama.
"""
from __future__ import annotations

import logging
import time

from app.config import config

logger = logging.getLogger("scalper.ema_ribbon")

RIBBON_TIMEFRAMES = ("5m", "15m", "30m", "1h")
_TF_MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000}
RIBBON_TARGET_PCT = {"15m": 4.0, "30m": 5.0, "1h": 4.0}
RIBBON_STOP_PCT = {"15m": 2.0, "30m": 5.0, "1h": 4.0}
RIBBON_HORIZON = {"5m": 15, "15m": 15, "30m": 240, "1h": 480}
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
STOCH_RSI_PERIOD = 14
STOCH_RSI_MAX = 80.0
# Sabit veya altına endeksli tahta. Kesişim gürültüdür, bildirim ve paper açılmaz.
PEGGED_BASES = frozenset({
    "USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "EUR",
    "PAXG", "XAUT", "PAX", "USD1", "RLUSD",
})


def sma_series(values: list[float], period: int) -> list[float | None]:
    """Grafikteki SMA 7/20/99 ile aynı basit ortalama."""
    output: list[float | None] = [None] * len(values)
    if period < 1:
        return output
    total = 0.0
    for index, value in enumerate(values):
        total += value
        if index >= period:
            total -= values[index - period]
        if index >= period - 1:
            output[index] = total / period
    return output


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


def _wilder_rsi(closes: list[float], period: int = STOCH_RSI_PERIOD) -> list[float | None]:
    rsi: list[float | None] = [None] * len(closes)
    if len(closes) <= period:
        return rsi
    gains: list[float] = []
    losses: list[float] = []
    for index in range(1, len(closes)):
        delta = closes[index] - closes[index - 1]
        gains.append(max(0.0, delta))
        losses.append(max(0.0, -delta))
    if len(gains) < period:
        return rsi
    gain = sum(gains[:period]) / period
    loss = sum(losses[:period]) / period

    def reading(average_gain: float, average_loss: float) -> float:
        if average_loss == 0:
            return 100.0
        return 100.0 - 100.0 / (1.0 + average_gain / average_loss)

    rsi[period] = reading(gain, loss)
    for index in range(period + 1, len(closes)):
        gain = (gain * (period - 1) + gains[index - 1]) / period
        loss = (loss * (period - 1) + losses[index - 1]) / period
        rsi[index] = reading(gain, loss)
    return rsi


def stoch_rsi_k(closes: list[float], period: int = STOCH_RSI_PERIOD, smooth: int = 3) -> list[float | None]:
    """Grafikteki Stoch RSI %K. RSI 14, stokastik 14, K yumuşatma 3."""
    rsi = _wilder_rsi(closes, period)
    raw: list[float | None] = [None] * len(closes)
    for index in range(period - 1, len(rsi)):
        window = rsi[index - period + 1:index + 1]
        if any(point is None for point in window) or rsi[index] is None:
            continue
        low = min(window)
        high = max(window)
        raw[index] = 50.0 if high == low else (float(rsi[index]) - low) / (high - low) * 100.0
    k_line: list[float | None] = [None] * len(closes)
    for index in range(smooth - 1, len(raw)):
        window = raw[index - smooth + 1:index + 1]
        if any(point is None for point in window):
            continue
        k_line[index] = sum(float(point) for point in window if point is not None) / smooth
    return k_line


def stoch_rsi_too_high(k_value: float | None, ceiling: float = STOCH_RSI_MAX) -> bool:
    """BUY için %K 80'in üzerinde olamaz. Ölçülemiyorsa engelleme."""
    return k_value is not None and k_value > ceiling


def ribbon_buy_at(fast: list[float | None], mid: list[float | None], slow: list[float | None], index: int) -> bool:
    """SMA 7, SMA 20'yi yukarı kesiyor ve ikisi de SMA 99'un üstünde."""
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


def _rsi_series(closes: list[float], period: int = 14) -> list[float | None]:
    return _wilder_rsi(closes, period)


def _macd_hist(closes: list[float]) -> list[float | None]:
    fast = ema_series(closes, 12)
    slow = ema_series(closes, 26)
    macd = [None if fast[i] is None or slow[i] is None else fast[i] - slow[i] for i in range(len(closes))]
    raw = [value for value in macd if value is not None]
    signal = ema_series(raw, 9) if raw else []
    out: list[float | None] = [None] * len(closes)
    cursor = 0
    for index, value in enumerate(macd):
        if value is None:
            continue
        if cursor < len(signal) and signal[cursor] is not None:
            out[index] = value - signal[cursor]
        cursor += 1
    return out


def _adx_series(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(closes)
    if len(closes) <= period * 2:
        return out
    trs: list[float] = []
    plus: list[float] = []
    minus: list[float] = []
    for index in range(1, len(closes)):
        tr = max(highs[index] - lows[index], abs(highs[index] - closes[index - 1]), abs(lows[index] - closes[index - 1]))
        up = highs[index] - highs[index - 1]
        down = lows[index - 1] - lows[index]
        trs.append(tr)
        plus.append(up if up > down and up > 0 else 0.0)
        minus.append(down if down > up and down > 0 else 0.0)
    atr = sum(trs[:period])
    plus_dm = sum(plus[:period])
    minus_dm = sum(minus[:period])
    dx: list[float] = []
    for index in range(period, len(trs)):
        atr = atr - atr / period + trs[index]
        plus_dm = plus_dm - plus_dm / period + plus[index]
        minus_dm = minus_dm - minus_dm / period + minus[index]
        if atr <= 0:
            dx.append(0.0)
            continue
        plus_di = 100.0 * plus_dm / atr
        minus_di = 100.0 * minus_dm / atr
        total = plus_di + minus_di
        dx.append(0.0 if total == 0 else 100.0 * abs(plus_di - minus_di) / total)
    if len(dx) < period:
        return out
    value = sum(dx[:period]) / period
    start = period + period
    if start < len(out):
        out[start] = value
    for step, move in enumerate(dx[period:], start=1):
        value = (value * (period - 1) + move) / period
        close_index = start + step
        if close_index < len(out):
            out[close_index] = value
    return out


def timeframe_combo_ok(
    timeframe: str,
    closes: list[float],
    highs: list[float] | None,
    lows: list[float] | None,
    index: int,
    rsi: list[float | None] | None = None,
    hist: list[float | None] | None = None,
    adx: list[float | None] | None = None,
) -> bool:
    """Backtestte hem beklemeyi kısaltan hem iki yarıda da artı kalan süzgeç.

    5 dk için böyle bir kombinasyon çıkmadı. 15 dk, 30 dk ve 1 saat kendi
    kuralını kullanır.
    """
    if timeframe not in {"15m", "30m", "1h"}:
        return True
    if highs is None or lows is None or index < 14 or closes[index] <= 0:
        return False
    if timeframe == "15m":
        span = highs[index] - lows[index]
        if span / closes[index] * 100.0 < 1.0:
            return False
        value = None if rsi is None else rsi[index]
        return value is not None and 45.0 <= value <= 65.0
    if timeframe == "30m":
        previous = None if hist is None or index == 0 else hist[index - 1]
        current = None if hist is None else hist[index]
        if previous is None or current is None or not (current > 0 and current > previous):
            return False
        reading = None if adx is None else adx[index]
        return reading is not None and reading >= 20.0
    if not recent_rise(closes, index):
        return False
    atr = sum((highs[cursor] - lows[cursor]) / closes[cursor] for cursor in range(index - 13, index + 1) if closes[cursor] > 0) / 14.0 * 100.0
    if atr < 1.2:
        return False
    value = None if rsi is None else rsi[index]
    if value is None or not 45.0 <= value <= 65.0:
        return False
    reading = None if adx is None else adx[index]
    return reading is not None and reading >= 20.0


def recent_rise(closes: list[float], index: int, bars: int = 3, min_return: float = 0.004) -> bool:
    """Son birkaç mum çoktan yukarı gittiyse True. 30 dk kesişiminde beklemeyi kısaltır."""
    if index < bars:
        return False
    base = closes[index - bars]
    if base <= 0:
        return False
    return closes[index] / base - 1.0 >= min_return


def select_recent_cross(
    closes: list[float],
    stamps: list[int],
    now_ms: int,
    window_ms: int = RIBBON_LIST_WINDOW_MS,
    highs: list[float] | None = None,
    lows: list[float] | None = None,
    opens: list[float] | None = None,
    apply_stoch: bool = True,
    timeframe: str = "",
) -> int | None:
    """Penceredeki en yeni hareketli kurdele alımı. Durağan kesişim yok sayılır.

    Stochastic RSI 80 sınırı 1 dakikada kapalıdır (`apply_stoch=False`).
    """
    if len(closes) < 2 or len(stamps) != len(closes):
        return None
    fast = sma_series(closes, RIBBON_FAST)
    mid = sma_series(closes, RIBBON_MID)
    slow = sma_series(closes, RIBBON_SLOW)
    k_line = stoch_rsi_k(closes)
    rsi = _rsi_series(closes) if timeframe in {"15m", "1h"} else None
    hist = _macd_hist(closes) if timeframe == "30m" else None
    adx = _adx_series(highs, lows, closes) if timeframe in {"30m", "1h"} and highs is not None and lows is not None else None
    earliest = int(now_ms) - int(window_ms)
    for index in range(len(closes) - 1, 0, -1):
        if int(stamps[index]) < earliest:
            break
        if not ribbon_buy_at(fast, mid, slow, index):
            continue
        if apply_stoch and stoch_rsi_too_high(k_line[index] if index < len(k_line) else None):
            continue
        if timeframe and not timeframe_combo_ok(timeframe, closes, highs, lows, index, rsi, hist, adx):
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


def ribbon_bar_is_fresh(
    bar_ms: int,
    now: float | None = None,
    max_age_sec: float = RIBBON_TRADE_MAX_AGE_SEC,
    timeframe: str = "1m",
) -> bool:
    """Mum yeni kapandıysa True. Süre kapanıştan ölçülür, açılıştan değil."""
    if bar_ms <= 0:
        return False
    moment = time.time() if now is None else float(now)
    close_at = (bar_ms / 1000.0) + (_TF_MS.get(timeframe, 60_000) / 1000.0)
    age = moment - close_at
    return -5.0 <= age <= float(max_age_sec)


def closed_ribbon_buy(closes: list[float]) -> bool:
    """Son kapanmış mumda kurdele alımı var mı. Seride oluşan mum olmamalı."""
    if len(closes) < RIBBON_SLOW + 1:
        return False
    fast = sma_series(closes, RIBBON_FAST)
    mid = sma_series(closes, RIBBON_MID)
    slow = sma_series(closes, RIBBON_SLOW)
    return ribbon_buy_at(fast, mid, slow, len(closes) - 1)


def net_target_pct() -> float:
    """Komisyon düşüldükten sonra en az %2 net kalacak brüt hedef."""
    fee_pct = (float(config.COMMISSION_TAKER_PCT) + float(config.COMMISSION_MAKER_PCT)) * 100.0
    floor = float(getattr(config, "SCALPING_NET_TARGET_PCT", 2.0)) + fee_pct
    return round(floor, 3)


def _scan_timeframe(symbol: str, history: dict, timeframe: str, now_ms: int, target: float) -> dict | None:
    closes_raw = list(history.get("closes") or [])
    opens_raw = list(history.get("opens") or [])
    highs_raw = list(history.get("highs") or [])
    lows_raw = list(history.get("lows") or [])
    stamps = list(history.get("timestamps") or [])
    if len(closes_raw) < RIBBON_SLOW + 1 or len(stamps) != len(closes_raw):
        return None
    try:
        closes = [float(value) for value in closes_raw]
        stamp_ms = [int(value) for value in stamps]
        opens = [float(value) for value in opens_raw] if len(opens_raw) == len(closes_raw) else closes
        highs = [float(value) for value in highs_raw] if len(highs_raw) == len(closes_raw) else closes
        lows = [float(value) for value in lows_raw] if len(lows_raw) == len(closes_raw) else closes
    except (TypeError, ValueError):
        return None
    window_ms = max(RIBBON_LIST_WINDOW_MS, _TF_MS.get(timeframe, 60_000) * 2)
    if timeframe in RIBBON_TARGET_PCT:
        target = RIBBON_TARGET_PCT[timeframe]
    index = select_recent_cross(
        closes, stamp_ms, now_ms, window_ms=window_ms,
        highs=highs, lows=lows, opens=opens,
        apply_stoch=timeframe not in {"1m", "15m"},
        timeframe=timeframe,
    )
    if index is None:
        return None
    price = closes[index]
    bar_ms = stamp_ms[index]
    if price <= 0 or bar_ms <= 0:
        return None
    return {
        "symbol": symbol,
        "price": price,
        "target_pct": target,
        "stop_pct": RIBBON_STOP_PCT.get(timeframe),
        "horizon_minutes": RIBBON_HORIZON.get(timeframe, RIBBON_HORIZON_MINUTES),
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
            "timeframe": timeframe,
            "ema_fast": RIBBON_FAST,
            "ema_mid": RIBBON_MID,
            "ema_slow": RIBBON_SLOW,
        },
        "strategy": "ema_ribbon",
        "ribbon_timeframe": timeframe,
        "ribbon_bar_ms": bar_ms,
        "detected_at": (bar_ms + _TF_MS.get(timeframe, 60_000)) / 1000.0,
        "_hit": False,
    }


def ribbon_candidates() -> list[dict]:
    """Hareketli coinlerde 1m, 5m ve 15m kurdele alımları. Yazma yapmaz."""
    from app.state import market

    target = net_target_pct()
    now_ms = int(time.time() * 1000)
    rows: list[dict] = []
    symbols = [str(symbol).upper() for symbol in (getattr(market, "symbols", []) or []) if symbol]
    for symbol in symbols:
        if is_pegged_symbol(symbol):
            continue
        events = []
        best = None
        for timeframe in RIBBON_TIMEFRAMES:
            history = (market.klines.get(timeframe, {}).get(symbol) or {})
            hit = _scan_timeframe(symbol, history, timeframe, now_ms, target)
            if hit is None:
                continue
            events.append({"bar_ms": hit["ribbon_bar_ms"], "timeframe": timeframe})
            best = hit
        if best is None:
            continue
        best["ribbon_events"] = events
        rows.append(best)
    if rows:
        logger.info("ema kurdele alımı: %s", ", ".join(
            f"{row['symbol']}({row.get('ribbon_timeframe')})" for row in rows))
    return rows
