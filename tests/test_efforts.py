"""Strava-style best efforts: sliding window, plausibility filter, ranking; same-route matching."""

import sqlite3
import unittest

from domains.training import efforts as ef
from domains.training.activity_impact import _matched


def _track(segments):
    """1 Hz cumulative distance from [(seconds, m/s), ...]."""
    d, out = 0.0, []
    for secs, v in segments:
        for _ in range(secs):
            out.append(d)
            d += v
    out.append(d)
    return out


class EffortsTest(unittest.TestCase):
    def test_fastest_window_finds_the_fast_part(self):
        # 2 km easy (5:00/km), 1 km hard (4:00/km), 2 km easy
        d = _track([(600, 1000 / 300), (240, 1000 / 240), (600, 1000 / 300)])
        self.assertAlmostEqual(ef.fastest(d, 1000), 240, delta=1)
        self.assertIsNone(ef.fastest(d, 10000))

    def test_implausible_run_rejected(self):
        car = _track([(600, 15.0)])                    # 9 km at 54 km/h saved as a "run"
        self.assertEqual(ef.compute("run", car, None), [])
        ok = _track([(1510, 1000 / 300)])              # 5 km at 5:00/km (+ a few metres)
        keys = [k for _, k, _ in ef.compute("run", ok, None)]
        self.assertEqual(keys, [400, 1000, 1609, 5000])

    def test_ride_power_and_speed_cap(self):
        fast = _track([(1200, 20.0)])                  # 24 km at 72 km/h → rejected
        self.assertEqual([e for e in ef.compute("ride", fast, None) if e[0] == "dist"], [])
        p = ef.compute("ride", None, [{"secs": 300, "watts": 280}, {"secs": 7, "watts": 900}])
        self.assertEqual(p, [("power", 300, 280.0)])

    def test_ranking(self):
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        for aid, day, t in [("a", "2025-05-01", 1500), ("b", "2026-03-01", 1440), ("c", "2026-09-01", 1470), ("d", "2026-10-10", 1460)]:
            ef.store(c, aid, day, "run", [("dist", 5000, float(t))])
        out = {e["key"]: e for e in ef.for_activity(c, "d")}
        self.assertEqual(out[5000]["rank_all"], 2)
        self.assertEqual(out[5000]["rank_year"], 2)
        self.assertEqual(out[5000]["pr"]["activity_id"], "b")
        self.assertEqual(out[5000]["n"], 4)
        b = ef.bests(c, "run")[0]
        self.assertEqual(b["all_time"]["activity_id"], "b")


class MatchedTest(unittest.TestCase):
    def test_same_route(self):
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.execute("""CREATE TABLE activities (id TEXT, date TEXT, name TEXT, activity_type TEXT, distance_meters REAL,
                     moving_time_seconds INTEGER, duration_seconds INTEGER, avg_heart_rate INTEGER, start_lat REAL, start_lng REAL)""")
        rows = [("r1", "2026-08-01", 8000, 2700), ("r2", "2026-09-01", 8100, 2600), ("r3", "2026-10-01", 7950, 2520),
                ("far", "2026-09-15", 8000, 2400), ("long", "2026-09-20", 12000, 3900)]
        for aid, d, dist, t in rows:
            lat = 40.0 if aid != "far" else 40.05
            c.execute("INSERT INTO activities VALUES (?,?,?,?,?,?,?,140,?,2.6)", (aid, d, aid, "running", dist, t, t, lat))
        act = c.execute("SELECT * FROM activities WHERE id='r3'").fetchone()
        m = _matched(c, act, "run")
        self.assertEqual(m["n"], 3)                    # 'far' start and 'long' distance excluded
        self.assertEqual(m["rank"], 1)
        self.assertGreater(m["vs_last_pct"], 0)


if __name__ == "__main__":
    unittest.main()
