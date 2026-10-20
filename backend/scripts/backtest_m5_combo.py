"""M5 SMA kurdele kesişimi için ayrı kombinasyon araması.

Yaklaşık üç haftalık 5 dk mum, hacimce ilk 40 TRY çifti. Aynı mumda hedef ve
stop birlikte gelirse stop sayılır. Komisyon: giriş binde 1,125, hedefe satış
binde 0,675, stop ve süre dolumu binde 1,125.

Geçer sayılması için: en az 30 işlem, bekleme tabanın %85'inden kısa, zamanın
iki yarısı ve son %30'u ayrı ayrı artı.

Kullanım (backend klasöründen):
    python scripts/backtest_m5_combo.py
"""
from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from bisect import bisect_right

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("SCALPER_ENV", "development")

from app.ema_ribbon import (  # noqa: E402
    bodies_are_flat,
    ema_series,
    is_pegged_symbol,
    ribbon_buy_at,
    ribbon_is_compressed,
    sma_series,
    stoch_rsi_k,
    stoch_rsi_too_high,
    tape_is_flat,
)

TAKER = 0.001125
MAKER = 0.000675
LOOKAHEAD = 288
PAGES_5M = 6
PAGES_15M = 2
TOP = 40
CTX = ssl.create_default_context()
FLAGS = (
    "green", "strong_close", "wide_06", "wide_10", "thrust_03", "thrust_06",
    "atr_06", "atr_10", "rsi_45_65", "rsi_40_55", "macd_up", "adx_18", "adx_25",
    "vol_13", "sma20_up", "near_sma99", "htf_stack", "htf_rise", "stoch_band", "higher_low",
)
TARGETS = (0.012, 0.015, 0.02, 0.025, 0.03, 0.04)
STOPS = (0.02, 0.025, 0.03, 0.04, 0.05)


def get_json(path: str):
    request = urllib.request.Request(
        "https://api.binance.me" + path,
        headers={"User-Agent": "scalper-m5-backtest"},
    )
    last_error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=25, context=CTX) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in {418, 429, 500, 503}:
                raise
            time.sleep(1.5 * (attempt + 1))
        except Exception as exc:
            last_error = exc
            time.sleep(0.8 * (attempt + 1))
    raise last_error


def symbols() -> list[str]:
    rows = get_json("/api/v3/ticker/24hr")
    ranked = []
    for row in rows:
        symbol = str(row.get("symbol") or "").upper()
        if not symbol.endswith("TRY") or is_pegged_symbol(symbol):
            continue
        try:
            volume = float(row.get("quoteVolume") or 0)
        except (TypeError, ValueError):
            continue
        if volume > 0:
            ranked.append((volume, symbol))
    ranked.sort(reverse=True)
    return [symbol for _, symbol in ranked[:TOP]]


def klines(symbol: str, interval: str, pages: int) -> list[dict]:
    rows: list = []
    end = None
    for _ in range(pages):
        path = f"/api/v3/klines?symbol={symbol}&interval={interval}&limit=1000"
        if end is not None:
            path += f"&endTime={end}"
        batch = get_json(path)
        if not batch:
            break
        rows = list(batch) + rows
        end = int(batch[0][0]) - 1
        time.sleep(0.04)
        if len(batch) < 1000:
            break
    seen = set()
    out = []
    for row in rows:
        stamp = int(row[0])
        if stamp in seen:
            continue
        seen.add(stamp)
        out.append({
            "time": stamp,
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5]),
        })
    out.sort(key=lambda bar: bar["time"])
    return out


def rsi_series(closes: list[float], period: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(closes)
    if len(closes) <= period:
        return out
    gains = [max(0.0, closes[i] - closes[i - 1]) for i in range(1, len(closes))]
    losses = [max(0.0, closes[i - 1] - closes[i]) for i in range(1, len(closes))]
    gain = sum(gains[:period]) / period
    loss = sum(losses[:period]) / period

    def reading(average_gain: float, average_loss: float) -> float:
        if average_loss == 0:
            return 100.0
        return 100.0 - 100.0 / (1.0 + average_gain / average_loss)

    out[period] = reading(gain, loss)
    for index in range(period + 1, len(closes)):
        gain = (gain * (period - 1) + gains[index - 1]) / period
        loss = (loss * (period - 1) + losses[index - 1]) / period
        out[index] = reading(gain, loss)
    return out


def macd_hist(closes: list[float]) -> list[float | None]:
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


def adx_series(highs, lows, closes, period: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(closes)
    if len(closes) <= period * 2:
        return out
    trs, plus, minus = [], [], []
    for index in range(1, len(closes)):
        trs.append(max(highs[index] - lows[index], abs(highs[index] - closes[index - 1]), abs(lows[index] - closes[index - 1])))
        up = highs[index] - highs[index - 1]
        down = lows[index - 1] - lows[index]
        plus.append(up if up > down and up > 0 else 0.0)
        minus.append(down if down > up and down > 0 else 0.0)
    atr = sum(trs[:period])
    plus_dm = sum(plus[:period])
    minus_dm = sum(minus[:period])
    dx = []
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
    start = period * 2
    if start < len(out):
        out[start] = value
    for step, move in enumerate(dx[period:], start=1):
        value = (value * (period - 1) + move) / period
        close_index = start + step
        if close_index < len(out):
            out[close_index] = value
    return out


def htf_state(bars_15: list[dict]) -> tuple[list[int], list[dict]]:
    closes = [bar["close"] for bar in bars_15]
    fast = sma_series(closes, 7)
    mid = sma_series(closes, 20)
    slow = sma_series(closes, 99)
    stamps = []
    states = []
    for index, bar in enumerate(bars_15):
        if fast[index] is None or mid[index] is None or slow[index] is None:
            continue
        earlier = closes[index - 3] if index >= 3 else None
        stamps.append(bar["time"])
        states.append({
            "stack": fast[index] > mid[index] > slow[index],
            "rise": earlier is not None and earlier > 0 and closes[index] / earlier - 1.0 >= 0.003,
        })
    return stamps, states


def crosses(bars: list[dict], htf_stamps: list[int], htf_states: list[dict], use_stoch: bool) -> list[dict]:
    if len(bars) < 140:
        return []
    closes = [bar["close"] for bar in bars]
    opens = [bar["open"] for bar in bars]
    highs = [bar["high"] for bar in bars]
    lows = [bar["low"] for bar in bars]
    volumes = [bar["volume"] for bar in bars]
    fast = sma_series(closes, 7)
    mid = sma_series(closes, 20)
    slow = sma_series(closes, 99)
    k_line = stoch_rsi_k(closes)
    rsi = rsi_series(closes)
    hist = macd_hist(closes)
    adx = adx_series(highs, lows, closes)
    last = len(closes) - 1
    found = []
    for index in range(99, last - 1):
        if not ribbon_buy_at(fast, mid, slow, index):
            continue
        k_value = k_line[index] if index < len(k_line) else None
        if use_stoch and stoch_rsi_too_high(k_value):
            continue
        price = closes[index]
        if fast[index] is None or mid[index] is None or slow[index] is None or price <= 0:
            continue
        if ribbon_is_compressed(fast[index], mid[index], slow[index], price):
            continue
        if tape_is_flat(highs, lows, index) or bodies_are_flat(opens, closes, index, highs, lows):
            continue
        end = min(last, index + LOOKAHEAD)
        peak = price
        peak_step = index
        path = []
        for step in range(index + 1, end + 1):
            if highs[step] > peak:
                peak = highs[step]
                peak_step = step
            path.append((highs[step] / price - 1.0, lows[step] / price - 1.0, closes[step] / price - 1.0))
        if not path:
            continue
        bar_range = (highs[index] - lows[index]) / price * 100.0
        thrust3 = closes[index] / closes[index - 3] - 1.0
        thrust6 = closes[index] / closes[index - 6] - 1.0
        atr = sum((highs[j] - lows[j]) / closes[j] for j in range(index - 13, index + 1) if closes[j] > 0) / 14.0 * 100.0
        vol_base = sum(volumes[index - 19:index + 1]) / 20.0
        dist99 = closes[index] / slow[index] - 1.0
        slot = bisect_right(htf_stamps, bars[index]["time"] - 10 * 60 * 1000) - 1
        higher = htf_states[slot] if slot >= 0 else {"stack": False, "rise": False}
        span = highs[index] - lows[index]
        found.append({
            "symbol": "",
            "time": bars[index]["time"],
            "bars_to_mfe": peak_step - index,
            "path": path,
            "green": closes[index] > opens[index],
            "strong_close": span > 0 and (closes[index] - lows[index]) / span >= 0.75,
            "wide_06": bar_range >= 0.6,
            "wide_10": bar_range >= 1.0,
            "thrust_03": thrust3 >= 0.003,
            "thrust_06": thrust6 >= 0.006,
            "atr_06": atr >= 0.6,
            "atr_10": atr >= 1.0,
            "rsi_45_65": rsi[index] is not None and 45.0 <= rsi[index] <= 65.0,
            "rsi_40_55": rsi[index] is not None and 40.0 <= rsi[index] <= 55.0,
            "macd_up": hist[index] is not None and hist[index - 1] is not None and hist[index] > 0 and hist[index] > hist[index - 1],
            "adx_18": adx[index] is not None and adx[index] >= 18.0,
            "adx_25": adx[index] is not None and adx[index] >= 25.0,
            "vol_13": vol_base > 0 and volumes[index] >= 1.3 * vol_base,
            "sma20_up": mid[index - 3] is not None and mid[index] > mid[index - 3],
            "near_sma99": 0.0 < dist99 <= 0.02,
            "htf_stack": bool(higher["stack"]),
            "htf_rise": bool(higher["rise"]),
            "stoch_band": k_value is not None and 20.0 <= k_value <= 60.0,
            "higher_low": lows[index] > lows[index - 1],
        })
    return found


def percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    rank = (len(ordered) - 1) * pct
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    weight = rank - low
    return ordered[low] * (1.0 - weight) + ordered[high] * weight


def simulate(rows: list[dict], target: float, stop: float) -> list[dict]:
    taken = []
    busy_until: dict[str, int] = {}
    for item in rows:
        if item["time"] <= busy_until.get(item["symbol"], -1):
            continue
        exit_return = item["path"][-1][2]
        exit_bars = len(item["path"])
        maker = False
        for step, (high_return, low_return, close_return) in enumerate(item["path"], start=1):
            if low_return <= -stop:
                exit_return = -stop
                exit_bars = step
                maker = False
                break
            if high_return >= target:
                exit_return = target
                exit_bars = step
                maker = True
                break
            exit_return = close_return
        fee = TAKER + (MAKER if maker else TAKER)
        taken.append({
            "time": item["time"],
            "net": (exit_return - fee) * 100.0,
            "bars": exit_bars,
            "bars_to_mfe": item["bars_to_mfe"],
        })
        busy_until[item["symbol"]] = item["time"] + exit_bars * 5 * 60 * 1000
    return taken


def ev(rows: list[dict]) -> float:
    if not rows:
        return 0.0
    return sum(item["net"] for item in rows) / len(rows)


def search(pool: list[dict], label: str) -> list[tuple]:
    ordered = sorted(pool, key=lambda item: item["time"])
    base_taken = simulate(ordered, 0.03, 0.05)
    base_wait = percentile([item["bars_to_mfe"] for item in ordered], 0.5) * 5
    base_exit = percentile([item["bars"] for item in base_taken], 0.5) * 5 if base_taken else 0
    print(
        f"{label}: {len(ordered)} kesişim, taban tepe beklemesi {base_wait:.0f} dk, "
        f"%3/%5 çıkış {len(base_taken)} işlem, bekleme {base_exit:.0f} dk, işlem başı {ev(base_taken):+.2f}%"
    )
    winners = []
    flag_count = len(FLAGS)
    for mask in range(1, 1 << flag_count):
        bits = [bit for bit in range(flag_count) if mask & (1 << bit)]
        if len(bits) > 3:
            continue
        names = [FLAGS[bit] for bit in bits]
        chosen = [item for item in ordered if all(item[name] for name in names)]
        if len(chosen) < 30:
            continue
        wait = percentile([item["bars_to_mfe"] for item in chosen], 0.5) * 5
        if wait > base_wait * 0.85:
            continue
        for target in TARGETS:
            for stop in STOPS:
                taken = simulate(chosen, target, stop)
                if len(taken) < 30:
                    continue
                mid = len(taken) // 2
                hold = int(len(taken) * 0.7)
                parts = (taken[:mid], taken[mid:], taken[hold:])
                if min(len(part) for part in parts) < 10:
                    continue
                part_ev = [ev(part) for part in parts]
                if any(value <= 0.05 for value in part_ev):
                    continue
                combined = ev(taken)
                exit_wait = percentile([item["bars"] for item in taken], 0.5) * 5
                score = combined * (len(taken) ** 0.5)
                winners.append((score, combined, wait, exit_wait, len(taken), names, target, stop, part_ev))
    winners.sort(key=lambda item: item[0], reverse=True)
    return winners


def show(title: str, winners: list[tuple], limit: int = 8) -> None:
    print(title)
    if not winners:
        print("  geçen kombinasyon yok")
        return
    seen = set()
    shown = 0
    for _, combined, wait, exit_wait, count, names, target, stop, part_ev in winners:
        key = (tuple(names), target, stop)
        if key in seen:
            continue
        seen.add(key)
        print(
            f"  {count} işlem, tepe {wait:.0f} dk, çıkış {exit_wait:.0f} dk, "
            f"hedef %{target * 100:.1f}, stop %{stop * 100:.1f}, işlem başı {combined:+.2f}% "
            f"(yarılar {part_ev[0]:+.2f} / {part_ev[1]:+.2f}, son %30 {part_ev[2]:+.2f}) | "
            + " + ".join(names)
        )
        shown += 1
        if shown >= limit:
            break


def main() -> None:
    started = time.time()
    names = symbols()
    print(f"Evren: {len(names)} TRY çifti, 5 dk x {PAGES_5M * 1000} mum")
    with_stoch = []
    without_stoch = []
    for index, symbol in enumerate(names, start=1):
        try:
            bars = klines(symbol, "5m", PAGES_5M)
            higher = klines(symbol, "15m", PAGES_15M)
        except Exception as exc:
            print(f"{symbol} alınamadı: {type(exc).__name__}")
            continue
        stamps, states = htf_state(higher)
        kept = crosses(bars, stamps, states, True)
        opened = crosses(bars, stamps, states, False)
        for item in kept + opened:
            item["symbol"] = symbol
        with_stoch.extend(kept)
        without_stoch.extend(opened)
        if index % 10 == 0:
            print(f"  {index}/{len(names)} kesişim {len(with_stoch)}")
    show("Stoch RSI 80 açık, üç hafta", search(with_stoch, "stoch açık"))
    show("Stoch RSI sınırı yok, üç hafta", search(without_stoch, "stoch yok"))
    print(f"Süre: {time.time() - started:.0f} sn")


if __name__ == "__main__":
    main()
