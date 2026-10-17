"""M5 düz ve hacimsiz şerit pasif sayılır; hareketli veya verisiz şerit sayılmaz."""
import unittest

from app.routers.runtime import m5_tape_is_dead


def _bar(opened: int, low: float, high: float, volume: float) -> list:
    return [opened, low, high, low, low, volume, opened + 300_000]


class M5FlatTapeTests(unittest.TestCase):
    def test_six_flat_dead_bars_are_passive(self):
        now = 10_000_000
        rows = []
        for index in range(12):
            opened = now - (20 - index) * 300_000
            if index < 6:
                rows.append(_bar(opened, 10.0, 10.20, 1000))
            else:
                rows.append(_bar(opened, 10.0, 10.005, 0))
        dead, reason = m5_tape_is_dead(rows, now)
        self.assertTrue(dead)
        self.assertIn("m5_duz_hacimsiz", reason)

    def test_flat_but_volume_stays_active(self):
        now = 10_000_000
        rows = [_bar(now - (12 - index) * 300_000, 10.0, 10.005, 500) for index in range(12)]
        dead, reason = m5_tape_is_dead(rows, now)
        self.assertFalse(dead)
        self.assertEqual(reason, "m5_hareketli")

    def test_wide_candle_stays_active_even_without_volume(self):
        now = 10_000_000
        rows = []
        for index in range(12):
            opened = now - (14 - index) * 300_000
            high = 10.40 if index == 11 else 10.005
            rows.append(_bar(opened, 10.0, high, 0))
        dead, _reason = m5_tape_is_dead(rows, now)
        self.assertFalse(dead)

    def test_short_history_is_not_passive(self):
        now = 10_000_000
        rows = [_bar(now - 600_000, 10.0, 10.001, 0)]
        dead, reason = m5_tape_is_dead(rows, now)
        self.assertFalse(dead)
        self.assertEqual(reason, "m5_veri_yok")


if __name__ == "__main__":
    unittest.main()
