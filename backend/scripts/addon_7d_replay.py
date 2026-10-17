"""7 günlük kıyas: mevcut TP/SL çıkışı, avize çıkışı, fonlama vetosu, saatlik hacim.

Adaylar `velocity_candidates` (passes=true, son 7 gün). Fiyat Binance TR
mumlarından, fonlama Binance USD-M geçmişinden okunur.
Maliyet: alış taker %0,1125, hedef satış maker %0,0675, stop satış taker %0,1125.

    python backend/scripts/addon_7d_replay.py --days 7
"""
from __future__ import annotations

import json
import os
import statistics
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("SCALPER_ENV", "development")

from app.radar_addons import (  # noqa: E402
    base_asset, crowded_long_reason, simulate_path,
)

_COST_TP = 0.1125 + 0.0675
_COST_STOP = 0.1125 + 0.1125
_COST = _COST_STOP
_NET_FLOOR = _COST_TP + 0.50
_SL = 3.0
_RVOL_MIN = 0.70
_RVOL_SAMPLES = 4
_HOUR = 3_600_000


def _get(url: str, timeout: float = 20.0):
    req = urllib.request.Request(url, headers={"User-Agent": "ScalperAddonReplay/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _klines(symbol: str, interval: str, start_ms: int, end_ms: int) -> list:
    rows = []
    cursor = start_ms
    hosts = ("https://api.binance.me", "https://api.binance.com")
    while cursor < end_ms:
        params = urllib.parse.urlencode({
            "symbol": symbol, "interval": interval, "startTime": cursor,
            "endTime": end_ms, "limit": 1000,
        })
        batch = None
        last_err = None
        for host in hosts:
            try:
                batch = _get(f"{host}/api/v3/klines?{params}")
                break
            except Exception as exc:
                last_err = exc
                batch = None
        if not batch:
            if last_err:
                raise last_err
            break
        if not isinstance(batch, list) or not batch:
            break
        rows.extend(batch)
        nxt = int(batch[-1][0]) + 1
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
        time.sleep(0.05)
    return rows


def _funding(base: str, start_ms: int, end_ms: int) -> list[tuple[int, float]]:
    params = urllib.parse.urlencode({
        "symbol": f"{base}USDT", "startTime": start_ms, "endTime": end_ms, "limit": 1000,
    })
    try:
        data = _get(f"https://fapi.binance.com/fapi/v1/fundingRate?{params}")
    except Exception:
        return []
    out = []
    if not isinstance(data, list):
        return out
    for row in data:
        try:
            out.append((int(row["fundingTime"]), float(row["fundingRate"])))
        except (KeyError, TypeError, ValueError):
            continue
    out.sort()
    return out


def _rate_at(points: list[tuple[int, float]], ts_ms: int) -> float | None:
    rate = None
    for t, value in points:
        if t > ts_ms:
            break
        rate = value
    return rate


def _rvol_at(hour_rows: list, ts_ms: int) -> float | None:
    """Sinyal anında kapanmış son saatin hacmi / önceki aynı UTC saatlerinin ortalaması."""
    closed = []
    for row in hour_rows:
        try:
            opened = int(row[0])
            vol = float(row[5])
        except (TypeError, ValueError, IndexError):
            continue
        if opened + _HOUR <= ts_ms and vol >= 0:
            closed.append((opened, vol))
    if len(closed) < _RVOL_SAMPLES + 1:
        return None
    last_open, last_vol = closed[-1]
    hour = (last_open // _HOUR) % 24
    prior = [vol for opened, vol in closed[:-1] if (opened // _HOUR) % 24 == hour and vol > 0]
    if len(prior) < _RVOL_SAMPLES:
        return None
    base = sum(prior) / len(prior)
    return (last_vol / base) if base > 0 else None


def _bars_after(rows5: list, ts_ms: int, horizon_min: float):
    end = ts_ms + horizon_min * 60_000
    out = []
    for row in rows5:
        try:
            opened = int(row[0])
        except (TypeError, ValueError, IndexError):
            continue
        if opened < ts_ms or opened > end:
            continue
        out.append((opened / 1000.0, float(row[2]), float(row[3]), float(row[4])))
    return out


def _metrics(nets: list[float]) -> dict:
    if not nets:
        return {"n": 0, "ev": None, "median": None, "win": None}
    wins = [x for x in nets if x > 0]
    return {
        "n": len(nets),
        "ev": round(statistics.mean(nets), 3),
        "median": round(statistics.median(nets), 3),
        "win": round(100 * len(wins) / len(nets), 1),
    }


def _load_candidates(days: float, db_url: str) -> list[dict]:
    import psycopg
    since = time.time() - days * 86400.0
    out = []
    with psycopg.connect(db_url, connect_timeout=8) as conn:
        for ts, sym, px, tgt, profile in conn.execute(
            "SELECT created_at, symbol, price, target_pct, candidate_id "
            "FROM velocity_candidates "
            "WHERE passes=true AND created_at>=%s AND price>0 ORDER BY created_at",
            (since,)):
            try:
                from app.routers.velocity import _velocity_horizon_from_candidate_id as horizon_of
                out.append({
                    "ts": float(ts), "sym": str(sym).upper(), "price": float(px),
                    "target": float(tgt or 2.0), "h": float(horizon_of(str(profile or "")) or 30),
                })
            except (TypeError, ValueError):
                continue
    return out


def _ret_1h(rows: list, ts_ms: int) -> float | None:
    """Son kapanmış 1s getirisi. Veri yoksa None (veto uygulanmaz)."""
    closed = [r for r in rows if int(r[6]) <= ts_ms]
    if len(closed) < 2:
        return None
    prev = float(closed[-2][4])
    last = float(closed[-1][4])
    if prev <= 0:
        return None
    return (last / prev - 1.0) * 100.0


def main() -> int:
    days = 7.0
    db_url = os.environ.get(
        "DATABASE_URL", "postgresql://postgres:518518Erkan@localhost:5432/scalper")
    out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                            "work", "addon_7d_replay.json")
    if len(sys.argv) > 1:
        for i, arg in enumerate(sys.argv):
            if arg == "--days" and i + 1 < len(sys.argv):
                days = float(sys.argv[i + 1])
    print("=== 7 GUN EKLENTI REPLAY ===")
    try:
        cands = _load_candidates(days, db_url)
    except Exception as exc:
        print(f"adaylar okunamadi: {exc}")
        return 1
    print(f"  gecen aday: {len(cands)}")
    if not cands:
        print("  aday yok")
        return 1
    # Aynı sembolde 30 dk içinde tek giriş (canlı tekrarını şişirmesin).
    cands.sort(key=lambda c: c["ts"])
    deduped = []
    last_ts: dict[str, float] = {}
    for c in cands:
        prev = last_ts.get(c["sym"], 0)
        if c["ts"] - prev < 1800:
            continue
        last_ts[c["sym"]] = c["ts"]
        deduped.append(c)
    cands = deduped
    print(f"  30 dk tekilleştirme sonrası: {len(cands)}")

    t0 = min(c["ts"] for c in cands) - 8 * 86400
    t1 = max(c["ts"] for c in cands) + 6 * 3600
    start_ms, end_ms = int(t0 * 1000), int(t1 * 1000)
    by_sym: dict[str, list] = defaultdict(list)
    for c in cands:
        by_sym[c["sym"]].append(c)

    print(f"  sembol: {len(by_sym)} — mum ve fonlama çekiliyor")
    k5: dict[str, list] = {}
    k1h: dict[str, list] = {}
    funds: dict[str, list] = {}
    for i, sym in enumerate(sorted(by_sym)):
        try:
            k5[sym] = _klines(sym, "5m", int(min(c["ts"] for c in by_sym[sym]) * 1000) - 6 * 3600_000, end_ms)
            k1h[sym] = _klines(sym, "1h", start_ms, end_ms)
        except Exception as exc:
            print(f"  mum yok {sym}: {exc}")
            k5[sym], k1h[sym] = [], []
        base = base_asset(sym)
        if base not in funds:
            funds[base] = _funding(base, start_ms, end_ms)
        if (i + 1) % 10 == 0:
            print(f"  ... {i + 1}/{len(by_sym)}")
        time.sleep(0.02)

    btc_1h = _klines("BTCTRY", "1h", start_ms, end_ms)
    arms = {
        "mevcut_tp": [],
        "avize": [],
        "fonlama_veto_tp": [],
        "rvol_veto_tp": [],
        "ucu_birden_avize": [],
        "btc_rs_veto": [],
        "genislik_veto": [],
        "maliyet_tabani": [],
        "uc_kapi_tp": [],
    }
    skipped = {"mum": 0, "fonlama_yok": 0, "rvol_yok": 0}
    for c in cands:
        bars = _bars_after(k5.get(c["sym"]) or [], int(c["ts"] * 1000), max(30.0, c["h"]))
        if len(bars) < 2:
            skipped["mum"] += 1
            continue
        base = simulate_path(bars, c["price"], target_pct=c["target"], horizon_min=max(30.0, c["h"]),
                             cost_pct=_COST, cost_tp_pct=_COST_TP, cost_stop_pct=_COST_STOP,
                             sl_pct=_SL, exit_mode="target")
        chand = simulate_path(bars, c["price"], target_pct=c["target"], horizon_min=max(30.0, c["h"]),
                              cost_pct=_COST, cost_tp_pct=_COST_TP, cost_stop_pct=_COST_STOP,
                              sl_pct=_SL, exit_mode="chandelier")
        if base:
            arms["mevcut_tp"].append(base["net_pct"])
        if chand:
            arms["avize"].append(chand["net_pct"])
        rate = _rate_at(funds.get(base_asset(c["sym"]), []), int(c["ts"] * 1000))
        if rate is None:
            skipped["fonlama_yok"] += 1
        blocked_funding = crowded_long_reason(rate) is not None
        rvol = _rvol_at(k1h.get(c["sym"]) or [], int(c["ts"] * 1000))
        if rvol is None:
            skipped["rvol_yok"] += 1
        blocked_rvol = rvol is not None and rvol < _RVOL_MIN
        if base and not blocked_funding:
            arms["fonlama_veto_tp"].append(base["net_pct"])
        if base and not blocked_rvol:
            arms["rvol_veto_tp"].append(base["net_pct"])
        if chand and not blocked_funding and not blocked_rvol:
            arms["ucu_birden_avize"].append(chand["net_pct"])
        sym_ret = _ret_1h(k1h.get(c["sym"]) or [], int(c["ts"] * 1000))
        btc_ret = _ret_1h(btc_1h, int(c["ts"] * 1000))
        blocked_rs = sym_ret is not None and btc_ret is not None and sym_ret < btc_ret
        up = 0
        known = 0
        for sym, rows in k1h.items():
            ret = _ret_1h(rows, int(c["ts"] * 1000))
            if ret is None:
                continue
            known += 1
            if ret > 0:
                up += 1
        breadth = (up / known) if known else None
        blocked_breadth = breadth is not None and breadth < 0.45
        blocked_cost = float(c["target"]) < _NET_FLOOR
        if base and not blocked_rs:
            arms["btc_rs_veto"].append(base["net_pct"])
        if base and not blocked_breadth:
            arms["genislik_veto"].append(base["net_pct"])
        if base and not blocked_cost:
            arms["maliyet_tabani"].append(base["net_pct"])
        if base and not blocked_rs and not blocked_breadth and not blocked_cost and not blocked_rvol:
            arms["uc_kapi_tp"].append(base["net_pct"])

    report = {name: _metrics(nets) for name, nets in arms.items()}
    report["atlandi"] = skipped
    report["aday"] = len(cands)
    print("\n  == SONUCLAR (net %, taker 0.1125 / maker 0.0675) ==")
    for name, row in report.items():
        if name in ("atlandi", "aday"):
            print(f"  {name}: {row}")
        else:
            print(f"  {name}: n={row['n']} ev={row['ev']} ortanca={row['median']} kazanma={row['win']}%")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(f"  rapor: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
