"""EMA 7, EMA 20'yi EMA 99 üstünde yukarı kesince alım; aksi halde değil."""
import unittest
from unittest import mock

from app.ema_ribbon import ema_series, ribbon_buy_at, select_recent_cross


class EmaRibbonTests(unittest.TestCase):
    def test_ema_seed_matches_chart(self):
        series = ema_series([1, 2, 3, 4], 3)
        self.assertIsNone(series[0])
        self.assertIsNone(series[1])
        self.assertAlmostEqual(series[2], 2.0)
        self.assertAlmostEqual(series[3], 3.0)

    def test_cross_above_slow_is_buy(self):
        fast = [1.0, 1.1]
        mid = [1.2, 1.0]
        slow = [0.5, 0.5]
        self.assertTrue(ribbon_buy_at(fast, mid, slow, 1))

    def test_cross_below_slow_is_not_buy(self):
        fast = [1.0, 1.2]
        mid = [1.1, 1.0]
        slow = [2.0, 2.0]
        self.assertFalse(ribbon_buy_at(fast, mid, slow, 1))

    def test_already_above_without_cross_is_not_buy(self):
        fast = [1.3, 1.4]
        mid = [1.0, 1.1]
        slow = [0.5, 0.5]
        self.assertFalse(ribbon_buy_at(fast, mid, slow, 1))

    def test_cross_outside_fifteen_minutes_is_ignored(self):
        closes = [1.0, 1.0, 1.0]
        stamps = [1_000, 2_000, 3_000]
        fast = [1.0, 1.0, 2.0]
        mid = [1.0, 2.0, 1.0]
        slow = [0.0, 0.0, 0.0]
        with mock.patch("app.ema_ribbon.ema_series", side_effect=[fast, mid, slow]):
            self.assertIsNone(select_recent_cross(closes, stamps, now_ms=20_000, window_ms=1_000))

    def test_recent_cross_is_kept(self):
        closes = [1.0, 1.0, 1.0]
        stamps = [1_000, 2_000, 3_000]
        fast = [1.0, 1.0, 2.0]
        mid = [1.0, 2.0, 1.0]
        slow = [0.0, 0.0, 0.0]
        with mock.patch("app.ema_ribbon.ema_series", side_effect=[fast, mid, slow]):
            self.assertEqual(select_recent_cross(closes, stamps, now_ms=3_500, window_ms=1_000), 2)

    def test_down_cross_is_not_buy(self):
        fast = [1.4, 1.0]
        mid = [1.2, 1.1]
        slow = [0.4, 0.4]
        self.assertFalse(ribbon_buy_at(fast, mid, slow, 1))


if __name__ == "__main__":
    unittest.main()
