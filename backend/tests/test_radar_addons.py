"""Avize stopu, fonlama vetosu ve saatlik hacim — saf fonksiyon testleri."""
import unittest

from app.radar_addons import (
    chandelier_stop, crowded_long_reason, hourly_rvol_from_klines, simulate_path,
)
from app.radar_addons import HOUR_MS


class ChandelierTests(unittest.TestCase):
    def test_stop_is_highest_high_minus_atr_multiple(self):
        highs = [10, 12, 11, 15, 13]
        # Son 3 tepe: 11, 15, 13 → 15 − 3×1 = 12
        self.assertAlmostEqual(chandelier_stop(highs, atr=1.0, length=3, mult=3.0), 12.0)

    def test_short_window_uses_what_exists(self):
        self.assertAlmostEqual(chandelier_stop([8, 9], atr=0.5, length=22, mult=2.0), 8.0)

    def test_bad_atr_returns_none(self):
        self.assertIsNone(chandelier_stop([1, 2], atr=0))
        self.assertIsNone(chandelier_stop([], atr=1))


class FundingTests(unittest.TestCase):
    def test_thresholds_match_derivatives_bands(self):
        self.assertIsNone(crowded_long_reason(None))
        self.assertIsNone(crowded_long_reason(0.0003))
        self.assertEqual(crowded_long_reason(0.0004), "fonlama_kalabalik_long")
        self.assertEqual(crowded_long_reason(0.001), "fonlama_asiri_long")

    def test_negative_funding_is_not_a_long_crowd(self):
        self.assertIsNone(crowded_long_reason(-0.001))


class HourlyRvolTests(unittest.TestCase):
    def test_same_hour_baseline_ignores_other_hours(self):
        # Saat 15, dört geçmiş gün 100, bugün 200 → rvol 2.
        # Araya başka saatler serpiştirilir; onlar tabana girmez.
        rows = []
        start = 15 * HOUR_MS
        for day in range(5):
            rows.append([start + day * 24 * HOUR_MS, 0, 0, 0, 0, 100 if day < 4 else 200])
            rows.append([start + day * 24 * HOUR_MS + HOUR_MS, 0, 0, 0, 0, 9999])
        now = start + 4 * 24 * HOUR_MS + HOUR_MS
        self.assertAlmostEqual(hourly_rvol_from_klines(rows, now, min_samples=4), 2.0)

    def test_too_few_same_hours_returns_none(self):
        rows = [[HOUR_MS * h, 0, 0, 0, 0, 10] for h in range(1, 6)]
        self.assertIsNone(hourly_rvol_from_klines(rows, 6 * HOUR_MS, min_samples=4))


class SimulateTests(unittest.TestCase):
    def test_target_mode_takes_profit(self):
        bars = [(0, 101, 100, 100.5), (300, 104, 101, 103)]
        out = simulate_path(bars, 100, target_pct=2.0, horizon_min=30, cost_pct=0.35)
        self.assertEqual(out["reason"], "take_profit")
        self.assertAlmostEqual(out["net_pct"], 1.65)

    def test_same_bar_stop_and_target_is_the_stop(self):
        bars = [(0, 103, 96, 100)]
        out = simulate_path(bars, 100, target_pct=2.0, horizon_min=30, sl_pct=3.0, cost_pct=0)
        self.assertEqual(out["reason"], "stop_loss")

    def test_chandelier_trails_without_a_fixed_target(self):
        # Yavaş yükseliş, sonra avize stopunun altına inen fitil.
        bars = []
        price = 100.0
        for i in range(30):
            price += 0.4
            bars.append((i * 300, price + 0.2, price - 0.3, price))
        # Son bar tepeden avize mesafesinin altına iner.
        last = bars[-1][1]
        bars.append((30 * 300, last, last - 8, last - 6))
        out = simulate_path(bars, 100, target_pct=50, horizon_min=300,
                            cost_pct=0, exit_mode="chandelier",
                            chandelier_length=10, chandelier_mult=2.0)
        self.assertIn(out["reason"], ("chandelier_exit", "stop_loss", "horizon_end"))
        self.assertLess(out["net_pct"], 30)


if __name__ == "__main__":
    unittest.main()
