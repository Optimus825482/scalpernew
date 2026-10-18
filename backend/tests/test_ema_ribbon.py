"""EMA 7, EMA 20'yi EMA 99 üstünde yukarı kesince alım; aksi halde değil."""
import unittest
from unittest import mock

from app.ema_ribbon import bodies_are_flat, ema_series, is_pegged_symbol, ribbon_buy_at, ribbon_is_compressed, select_recent_cross, stoch_rsi_too_high, tape_is_flat


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

    def test_pegged_and_flat_tape_are_skipped(self):
        self.assertTrue(is_pegged_symbol("USDTTRY"))
        self.assertTrue(is_pegged_symbol("PAXGTRY"))
        self.assertFalse(is_pegged_symbol("SOLTRY"))
        self.assertTrue(ribbon_is_compressed(49.4704, 49.4712, 49.4717, 49.47))
        self.assertTrue(tape_is_flat([10.01] * 20, [10.00] * 20, 19))
        self.assertFalse(tape_is_flat([10.0, 10.2], [9.9, 10.0], 1, lookback=2, min_range_pct=0.8))
        flat_open = [359.2] * 20
        flat_close = [359.2] * 20
        self.assertTrue(bodies_are_flat(flat_open, flat_close, 19, flat_close, flat_open))
        moving_open = [100.0] * 20
        moving_close = [100.0 + (index % 2) * 0.5 for index in range(20)]
        self.assertFalse(bodies_are_flat(moving_open, moving_close, 19))

    def test_compressed_cross_is_ignored(self):
        closes = [1.0, 1.0, 1.0]
        stamps = [1_000, 2_000, 3_000]
        fast = [1.0, 1.000, 1.001]
        mid = [1.0, 1.002, 1.000]
        slow = [1.0, 1.000, 1.000]
        with mock.patch("app.ema_ribbon.ema_series", side_effect=[fast, mid, slow]):
            self.assertIsNone(select_recent_cross(closes, stamps, now_ms=3_500, window_ms=5_000))

    def test_m1_ignores_stoch_rsi_ceiling(self):
        closes = [1.0, 1.0, 1.0]
        stamps = [1_000, 2_000, 3_000]
        fast = [1.0, 1.0, 2.0]
        mid = [1.0, 2.0, 1.0]
        slow = [0.0, 0.0, 0.0]
        with mock.patch("app.ema_ribbon.ema_series", side_effect=[fast, mid, slow]), \
             mock.patch("app.ema_ribbon.stoch_rsi_k", return_value=[None, None, 91.0]):
            self.assertEqual(
                select_recent_cross(closes, stamps, now_ms=3_500, window_ms=5_000, apply_stoch=False),
                2,
            )

    def test_stoch_rsi_above_80_blocks_buy(self):
        self.assertTrue(stoch_rsi_too_high(80.1))
        self.assertFalse(stoch_rsi_too_high(80.0))
        self.assertFalse(stoch_rsi_too_high(None))
        closes = [1.0, 1.0, 1.0]
        stamps = [1_000, 2_000, 3_000]
        fast = [1.0, 1.0, 2.0]
        mid = [1.0, 2.0, 1.0]
        slow = [0.0, 0.0, 0.0]
        with mock.patch("app.ema_ribbon.ema_series", side_effect=[fast, mid, slow]), \
             mock.patch("app.ema_ribbon.stoch_rsi_k", return_value=[None, None, 91.0]):
            self.assertIsNone(select_recent_cross(closes, stamps, now_ms=3_500, window_ms=5_000))

    def test_down_cross_is_not_buy(self):
        fast = [1.4, 1.0]
        mid = [1.2, 1.1]
        slow = [0.4, 0.4]
        self.assertFalse(ribbon_buy_at(fast, mid, slow, 1))


if __name__ == "__main__":
    unittest.main()
