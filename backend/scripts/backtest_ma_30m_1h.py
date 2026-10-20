"""SMA 7/20/99 kesişiminin 30 dk ve 1 saatlik geriye dönük testi.

Hedef brüt %3. Stop, canlı otonom paper varsayılanı olan %5. Aynı mumda
ikisi birden olursa stop sayılır. Komisyon: giriş binde 1,125, hedefe satış
binde 0,675, stop ve süre dolumu binde 1,125.

Kullanım (backend klasöründen):
    python scripts/backtest_ma_30m_1h.py
"""
from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.request

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

TARGET = 0.03
STOP = 0.05
TAKER = 0.001125
MAKER = 0.000675
MINUTES = {"5m": 5, "15m": 15, "30m": 30, "1h": 60}
LOOKAHEAD_HOURS = 24
HORIZON = {name: int(LOOKAHEAD_HOURS * 60 / minutes) for name, minutes in MINUTES.items()}
LIMIT = 1000
TOP = 40
CTX = ssl.create_default_context()


def get_json(path: str):
    request = urllib.request.Request(
        "https://api.binance.me" + path,
        headers={"User-Agent": "scalper-backtest"},
    )
    with urllib.request.urlopen(request, timeout=25, context=CTX) as response:
        return json.loads(response.read().decode())


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
        if volume <= 0:
            continue
        ranked.append((volume, symbol))
    ranked.sort(reverse=True)
    return [symbol for _, symbol in ranked[:TOP]]


def candles(symbol: str, interval: str) -> list[dict]:
    rows = get_json(f"/api/v3/klines?symbol={symbol}&interval={interval}&limit={LIMIT}")
    out = []
    for row in rows:
        out.append({
            "time": int(row[0]),
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5]),
        })
    return out


def net_pct(entry: float, exit_price: float, maker_exit: bool) -> float:
    gross = exit_price / entry - 1.0
    fee = TAKER + (MAKER if maker_exit else TAKER)
    return (gross - fee) * 100.0


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


def adx_series(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> list[float | None]:
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
    # dx[0] aligns with bar index `period` of the TR series, which is close index period+? 
    # TR index 0 is close index 1. dx starts after `period` TR values, so close index = period + period.
    start = period + period
    if start < len(out):
        out[start] = value
    for step, move in enumerate(dx[period:], start=1):
        value = (value * (period - 1) + move) / period
        close_index = start + step
        if close_index < len(out):
            out[close_index] = value
    return out


def replay(bars: list[dict], interval: str, use_stoch: bool = True) -> list[dict]:
    if len(bars) < 120:
        return []
    closes = [bar["close"] for bar in bars]
    opens = [bar["open"] for bar in bars]
    highs = [bar["high"] for bar in bars]
    lows = [bar["low"] for bar in bars]
    fast = sma_series(closes, 7)
    mid = sma_series(closes, 20)
    slow = sma_series(closes, 99)
    k_line = stoch_rsi_k(closes)
    rsi = rsi_series(closes)
    hist = macd_hist(closes)
    adx = adx_series(highs, lows, closes)
    volumes = [bar.get("volume") or 0.0 for bar in bars]
    horizon = HORIZON[interval]
    trades = []
    signals = []
    busy_until = -1
    last = len(closes) - 1
    for index in range(99, last):
        if index <= busy_until:
            continue
        if not ribbon_buy_at(fast, mid, slow, index):
            continue
        if use_stoch and stoch_rsi_too_high(k_line[index] if index < len(k_line) else None):
            continue
        price = closes[index]
        if fast[index] is None or mid[index] is None or slow[index] is None:
            continue
        if ribbon_is_compressed(fast[index], mid[index], slow[index], price):
            continue
        if tape_is_flat(highs, lows, index):
            continue
        if bodies_are_flat(opens, closes, index, highs, lows):
            continue
        entry = price
        target = entry * (1.0 + TARGET)
        stop = entry * (1.0 - STOP)
        end = min(last, index + horizon)
        outcome = "süre"
        exit_price = closes[end]
        maker = False
        exit_index = end
        for step in range(index + 1, end + 1):
            hit_stop = lows[step] <= stop
            hit_target = highs[step] >= target
            if hit_stop:
                outcome = "stop"
                exit_price = stop
                exit_index = step
                break
            if hit_target:
                outcome = "hedef"
                exit_price = target
                maker = True
                exit_index = step
                break
        peak = entry
        peak_step = index
        first_target = None
        for step in range(index + 1, end + 1):
            if highs[step] > peak:
                peak = highs[step]
                peak_step = step
            if first_target is None and highs[step] >= target:
                first_target = step
        bar_range = (highs[index] - lows[index]) / price * 100.0
        thrust = closes[index] / closes[index - 3] - 1.0
        atr = sum((highs[j] - lows[j]) / closes[j] for j in range(index - 13, index + 1)) / 14.0 * 100.0
        trades.append({
            "net": net_pct(entry, exit_price, maker),
            "outcome": outcome,
            "mfe": (peak / entry - 1.0) * 100.0,
            "bars_to_mfe": peak_step - index,
            "bars_to_target": None if first_target is None else first_target - index,
            "wide_bar": bar_range >= 1.0,
            "already_up": thrust >= 0.004,
            "lively": atr >= 1.2,
            "rsi_band": rsi[index] is not None and 45.0 <= rsi[index] <= 65.0,
            "macd_up": hist[index] is not None and hist[index - 1] is not None and hist[index] > 0 and hist[index] > hist[index - 1],
            "adx_trend": adx[index] is not None and adx[index] >= 20.0,
            "strong_close": highs[index] > lows[index] and (closes[index] - lows[index]) / (highs[index] - lows[index]) >= 0.75,
            "volume_spike": sum(volumes[index - 19:index + 1]) > 0 and volumes[index] >= 1.5 * (sum(volumes[index - 19:index + 1]) / 20.0),
            "time": bars[index]["time"],
            "path": [
                (highs[step] / entry - 1.0, lows[step] / entry - 1.0, closes[step] / entry - 1.0)
                for step in range(index + 1, end + 1)
            ],
        })
        signals.append(trades[-1])
        busy_until = exit_index
    return trades, signals


def percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    rank = (len(ordered) - 1) * pct
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    weight = rank - low
    return ordered[low] * (1.0 - weight) + ordered[high] * weight


FLAGS = (
    "wide_bar", "already_up", "lively", "rsi_band", "macd_up",
    "adx_trend", "strong_close", "volume_spike",
)


def resimulate(trade: dict, target: float, stop: float) -> float:
    exit_return = trade["path"][-1][2] if trade["path"] else 0.0
    for high_return, low_return, close_return in trade["path"]:
        if low_return <= -stop:
            return (-stop - TAKER - TAKER) * 100.0
        if high_return >= target:
            return (target - TAKER - MAKER) * 100.0
        exit_return = close_return
    return (exit_return - TAKER - TAKER) * 100.0


def search_combo(interval: str, rows: list[dict], minutes: int, min_count: int = 30, require_halves: bool = True) -> None:
    if len(rows) < min_count:
        print(f"{interval}: arama için örnek az ({len(rows)})")
        return
    base_wait = percentile([item["bars_to_mfe"] for item in rows], 0.5) * minutes
    best = None
    for mask in range(1, 1 << len(FLAGS)):
        names = [FLAGS[bit] for bit in range(len(FLAGS)) if mask & (1 << bit)]
        chosen = [item for item in rows if all(item[name] for name in names)]
        if len(chosen) < min_count:
            continue
        wait = percentile([item["bars_to_mfe"] for item in chosen], 0.5) * minutes
        if wait > base_wait * 0.85:
            continue
        ordered = sorted(chosen, key=lambda item: item["time"])
        mid = len(ordered) // 2
        for target in (0.02, 0.025, 0.03, 0.035, 0.04, 0.05):
            for stop in (0.015, 0.02, 0.03, 0.04, 0.05):
                halves = (ordered[:mid], ordered[mid:])
                if min(len(half) for half in halves) < 12:
                    continue
                if require_halves and any(sum(resimulate(item, target, stop) for item in half) <= 0 for half in halves):
                    continue
                nets = [resimulate(item, target, stop) for item in chosen]
                ev = sum(nets) / len(nets)
                if ev <= 0:
                    continue
                score = ev * (len(chosen) ** 0.5)
                if best is None or score > best[0]:
                    best = (score, ev, wait, len(chosen), names, target, stop)
    if best is None:
        print(f"{interval}: hem daha kısa hem iki yarıda da artı kombinasyon yok (taban bekleme {base_wait:.0f} dk)")
        return
    _, ev, wait, count, names, target, stop = best
    print(
        f"{interval}: {count} işlem, bekleme {wait:.0f} dk (taban {base_wait:.0f}), "
        f"hedef %{target * 100:.1f}, stop %{stop * 100:.1f}, işlem başı {ev:+.2f}% | "
        + " + ".join(names)
    )


def summarize(name: str, trades: list[dict], minutes: int) -> None:
    count = len(trades)
    if not count:
        print(f"{name}: sinyal yok")
        return
    wins = [item for item in trades if item["net"] > 0]
    hits = [item for item in trades if item["outcome"] == "hedef"]
    stops = [item for item in trades if item["outcome"] == "stop"]
    expired = count - len(hits) - len(stops)
    average = sum(item["net"] for item in trades) / count
    mfes = [item["mfe"] for item in trades]
    bars = [item["bars_to_mfe"] for item in trades]
    target_bars = [item["bars_to_target"] for item in trades if item["bars_to_target"] is not None]
    print(
        f"{name}: {count} işlem, kârlı %{100 * len(wins) / count:.1f}, "
        f"hedef %{100 * len(hits) / count:.1f}, stop %{100 * len(stops) / count:.1f}, "
        f"süre %{100 * expired / count:.1f}, işlem başına {average:+.3f}%"
    )
    print(
        f"  tepe kâr (MFE): ortanca %{percentile(mfes, 0.5):.2f}, "
        f"ortalama %{sum(mfes) / count:.2f}, "
        f"%75 %{percentile(mfes, 0.75):.2f}, en yüksek %{max(mfes):.2f}"
    )
    print(
        f"  kendi tepesine: ortanca {percentile(bars, 0.5):.1f} mum "
        f"({percentile(bars, 0.5) * minutes:.0f} dk), "
        f"ortalama {sum(bars) / count:.1f} mum ({sum(bars) / count * minutes:.0f} dk)"
    )
    if target_bars:
        print(
            f"  +%3 ilk temas: {len(target_bars)}/{count} işlem, "
            f"ortanca {percentile(target_bars, 0.5):.1f} mum "
            f"({percentile(target_bars, 0.5) * minutes:.0f} dk), "
            f"ortalama {sum(target_bars) / len(target_bars):.1f} mum "
            f"({sum(target_bars) / len(target_bars) * minutes:.0f} dk)"
        )


def main() -> None:
    started = time.time()
    names = symbols()
    print(f"Evren: hacimce ilk {len(names)} TRY çifti, {LIMIT} mum")
    with_stoch = {name: [] for name in MINUTES}
    without_stoch = {name: [] for name in MINUTES}
    for index, symbol in enumerate(names, start=1):
        for interval in MINUTES:
            try:
                bars = candles(symbol, interval)
            except Exception as exc:
                print(f"{symbol} {interval} alınamadı: {type(exc).__name__}")
                continue
            kept, _ = replay(bars, interval, True)
            opened, _ = replay(bars, interval, False)
            with_stoch[interval].extend(kept)
            without_stoch[interval].extend(opened)
            time.sleep(0.05)
        if index % 10 == 0:
            print(f"  {index}/{len(names)}")
    print(f"Tepe, girişten sonraki {LOOKAHEAD_HOURS} saat içinde ölçüldü")
    print("Stoch RSI 80 üstü elenmiş")
    for interval, minutes in MINUTES.items():
        summarize(interval, with_stoch[interval], minutes)
    print("Beklemeyi kısaltma denemesi, Stoch RSI 80 açık")
    for interval, minutes in MINUTES.items():
        rows = with_stoch[interval]
        print(interval)
        for label, picked in (
            ("olduğu gibi", rows),
            ("sinyal mumu en az %1 boy", [item for item in rows if item["wide_bar"]]),
            ("son 3 mum en az %0,4 yükseliş", [item for item in rows if item["already_up"]]),
            ("14 mum ort. dalga en az %1,2", [item for item in rows if item["lively"]]),
        ):
            if len(picked) < 8:
                print(f"  {label}: {len(picked)} işlem, örnek az")
                continue
            wait = percentile([item["bars_to_mfe"] for item in picked], 0.5) * minutes
            peak = percentile([item["mfe"] for item in picked], 0.5)
            ev = sum(item["net"] for item in picked) / len(picked)
            print(f"  {label}: {len(picked)} işlem, tepe %{peak:.1f}, bekleme {wait:.0f} dk, işlem başı {ev:+.2f}%")
    print("M5 ve M15 için ayrı gösterge denemeleri")
    trials = (
        ("olduğu gibi", lambda item: True),
        ("RSI 45-65", lambda item: item["rsi_band"]),
        ("MACD histogram artıyor", lambda item: item["macd_up"]),
        ("ADX 20 üstü", lambda item: item["adx_trend"]),
        ("mum kapanışı üst %25", lambda item: item["strong_close"]),
        ("hacim 1,5 kat", lambda item: item["volume_spike"]),
    )
    for interval in ("5m", "15m"):
        rows = with_stoch[interval]
        minutes = MINUTES[interval]
        print(interval)
        for label, gate in trials:
            picked = [item for item in rows if gate(item)]
            if len(picked) < 8:
                print(f"  {label}: {len(picked)} işlem, örnek az")
                continue
            wait = percentile([item["bars_to_mfe"] for item in picked], 0.5) * minutes
            peak = percentile([item["mfe"] for item in picked], 0.5)
            ev = sum(item["net"] for item in picked) / len(picked)
            print(f"  {label}: {len(picked)} işlem, tepe %{peak:.1f}, bekleme {wait:.0f} dk, işlem başı {ev:+.2f}%")
    print("Kısa bekleme ve iki dönemde de artı kalan kombinasyon")
    for interval, minutes in MINUTES.items():
        search_combo(interval, with_stoch[interval], minutes)
    print("Aynı arama, Stoch sınırı olmadan")
    for interval, minutes in MINUTES.items():
        search_combo(interval, without_stoch[interval], minutes)
    print("M5 ve M15 için daha geniş arama: 25 işlem, tek dönem artısı da kabul")
    for interval in ("5m", "15m"):
        search_combo(interval, without_stoch[interval], MINUTES[interval], min_count=25, require_halves=False)
        search_combo(interval, with_stoch[interval], MINUTES[interval], min_count=25, require_halves=False)
    print("Stoch RSI sınırı yok")
    for interval, minutes in MINUTES.items():
        summarize(interval, without_stoch[interval], minutes)
    print(f"Süre: {time.time() - started:.0f} sn")


if __name__ == "__main__":
    main()
