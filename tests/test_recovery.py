"""Today's recovery cue: Garmin's "unbalanced" HRV is only a warning when HRV is DOWN."""

import json
import sqlite3
import unittest

from domains.health.recovery import hrv_direction, recovery_flag


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE daily_stats (date TEXT PRIMARY KEY, resting_hr INT);
        CREATE TABLE hrv (date TEXT PRIMARY KEY, last_night_avg REAL, weekly_avg REAL, status TEXT, raw_payload TEXT);
        CREATE TABLE wellness_daily (date TEXT PRIMARY KEY, bb_min INT, bb_max INT, skin_temp_dev REAL);
        CREATE TABLE sleep (date TEXT PRIMARY KEY, duration_seconds INT);""")
    return c


def _hrv(c, d, night, status="BALANCED", lo=None, hi=None, week=None):
    raw = {"hrvSummary": {"baseline": {"balancedLow": lo, "balancedUpper": hi}}} if lo else {}
    c.execute("INSERT INTO hrv VALUES (?,?,?,?,?)", (d, night, week if week is not None else night, status, json.dumps(raw)))


class HrvDirectionTest(unittest.TestCase):
    def test_unbalanced_high_is_not_a_warning(self):
        c = _db()
        _hrv(c, "2026-11-20", 97, "UNBALANCED", lo=68, hi=86)          # back from a trip, well rested
        f = recovery_flag(c, "2026-11-20")
        self.assertEqual((f["status"], f["hrv_direction"], f["reasons"]), ("ok", "high", []))

    def test_unbalanced_low_is(self):
        c = _db()
        _hrv(c, "2026-11-20", 52, "UNBALANCED", lo=68, hi=86)
        f = recovery_flag(c, "2026-11-20")
        self.assertEqual((f["status"], f["hrv_direction"]), ("watch", "low"))
        self.assertEqual(f["reasons"], ["HRV below your normal range"])

    def test_range_from_history_without_garmin_baseline(self):
        c = _db()
        for i in range(10):
            _hrv(c, f"2026-11-{i + 1:02d}", 75 + (i % 3))
        _hrv(c, "2026-11-20", 98, "UNBALANCED")
        self.assertEqual(hrv_direction(c, "2026-11-20", c.execute("SELECT * FROM hrv WHERE date='2026-11-20'").fetchone()), "high")
        self.assertEqual(recovery_flag(c, "2026-11-20")["status"], "ok")

    def test_hard_week_still_in_the_average_but_last_night_is_back(self):
        # 20 Nov after Taiwan: last night 97, 7-day average 72 below the range → Garmin "UNBALANCED"
        c = _db()
        _hrv(c, "2026-11-20", 97, "UNBALANCED", lo=74, hi=100, week=72)
        f = recovery_flag(c, "2026-11-20")
        self.assertEqual((f["status"], f["hrv_direction"], f["hrv_week_direction"]), ("ok", "normal", "low"))

    def test_low_status_with_a_low_night_counts(self):
        c = _db()
        _hrv(c, "2026-11-20", 60, "LOW", lo=68, hi=86)
        self.assertEqual(recovery_flag(c, "2026-11-20")["status"], "watch")


if __name__ == "__main__":
    unittest.main()
