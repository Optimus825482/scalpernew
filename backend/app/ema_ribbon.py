"""EMA 7/20/99 kurdele alımı.

Turuncu EMA 7, mavi EMA 20'yi yukarı keser ve ikisi de siyah EMA 99'un
üstündedir. Ölçüm kapanmış 5 dakikalık mumdadır; oluşan mum sayılmaz.
Grafikteki EMA ile aynı tohum kullanılır: ilk değer periyotluk SMA.
"""
from __future__ import annotations

import logging

from app.config import config

logger = logging.getLogger("scalper.ema_ribbon")

RIBBON_TIMEFRAME = "5m"
RIBBON_FAST = 7
RIBBON_MID = 20
RIBBON_SLOW = 99
RIBBON_SCORE = 75.0
RIBBON_HORIZON_MINUTES = 15


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
    """Aktif evrendeki kapanmış 5m kurdele alımları. Yazma yapmaz."""
    from app.state import market

    target = net_target_pct()
    rows: list[dict] = []
    symbols = [str(symbol).upper() for symbol in (getattr(market, "symbols", []) or []) if symbol]
    for symbol in symbols:
        history = (market.klines.get(RIBBON_TIMEFRAME, {}).get(symbol) or {})
        closes_raw = list(history.get("closes") or [])
        stamps = list(history.get("timestamps") or [])
        if len(closes_raw) < RIBBON_SLOW + 1 or len(stamps) != len(closes_raw):
            continue
        try:
            closes = [float(value) for value in closes_raw]
        except (TypeError, ValueError):
            continue
        if not closed_ribbon_buy(closes):
            continue
        price = closes[-1]
        if price <= 0:
            continue
        bar_ms = int(stamps[-1] or 0)
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
