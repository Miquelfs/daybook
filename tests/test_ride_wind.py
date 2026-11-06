"""Ride wind: head/tail/crosswind from the GPS track and hourly wind (fake provider)."""

import json
import sqlite3
import unittest

from domains.health import ride_wind as rw
from domains.health.garmin.polyline_backfill import encode


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("""CREATE TABLE activities (id TEXT PRIMARY KEY, date TEXT, activity_type TEXT, start_time TEXT,
                 duration_seconds INTEGER, moving_time_seconds INTEGER, polyline TEXT)""")
    c.execute("CREATE TABLE activity_streams (activity_id TEXT, stream_type TEXT, data_json TEXT)")
    return c


def _wind(speed, frm, n=3):
    hours = [f"2026-10-1{d}T{h:02d}:00" for d in (2, 3) for h in range(24)]
    one = {"hourly": {"time": hours, "wind_speed_10m": [speed] * 48, "wind_direction_10m": [frm] * 48,
                      "wind_gusts_10m": [speed * 1.5] * 48}}
    return lambda url: json.dumps([one] * n)


# 20 km due north, then 20 km back south (Mallorca-ish latitude)
OUT = [(39.5 + i * 0.0018, 2.9) for i in range(100)]
ROUTE = OUT + OUT[::-1][1:]


class WindTest(unittest.TestCase):
    def setUp(self):
        self.c = _db()
        self.c.execute("INSERT INTO activities VALUES ('a1','2026-10-12','road_biking','2026-10-12 07:00:00',"
                       "5400,5400,?)", (encode(ROUTE),))

    def test_components(self):
        h, x = rw.components(0, 20, 0)        # riding north, wind from north
        self.assertAlmostEqual(h, 20)
        self.assertAlmostEqual(x, 0, places=6)
        h, x = rw.components(90, 20, 0)       # wind from east
        self.assertAlmostEqual(h, 0, places=6)
        self.assertAlmostEqual(x, 20)

    def test_out_and_back_north_wind(self):
        w = rw.compute(self.c, "a1", fetcher=_wind(20, 0))
        self.assertEqual(w["source"], "polyline")
        self.assertAlmostEqual(w["pct"]["head"], 50, delta=3)
        self.assertAlmostEqual(w["pct"]["tail"], 50, delta=3)
        self.assertAlmostEqual(w["avg_headwind_kmh"], 0, delta=1)
        self.assertGreater(w["worst_head"]["km"], 18)
        self.assertLess(w["worst_head"]["from_km"], 1)
        self.assertEqual(w["wind_from_deg"], 0)
        self.assertTrue(all(v > 0 for v in w["profile_km"][:15]))
        self.assertTrue(all(v < 0 for v in w["profile_km"][-15:]))

    def test_crosswind(self):
        w = rw.compute(self.c, "a1", fetcher=_wind(25, 270))
        self.assertGreater(w["pct"]["cross"], 95)
        self.assertIsNone(w["worst_head"])

    def test_cached_and_indoor(self):
        rw.compute(self.c, "a1", fetcher=_wind(20, 0))
        boom = lambda url: (_ for _ in ()).throw(AssertionError("should be cached"))
        self.assertIsNotNone(rw.compute(self.c, "a1", fetcher=boom))
        self.c.execute("INSERT INTO activities VALUES ('a2','2026-10-12','indoor_cycling','2026-10-12 07:00:00',"
                       "3600,3600,NULL)")
        self.assertIsNone(rw.compute(self.c, "a2", fetcher=boom))

    def test_provider_failure_not_cached(self):
        def fail(url):
            raise OSError("down")
        self.assertIsNone(rw.compute(self.c, "a1", fetcher=fail))
        self.assertIsNotNone(rw.compute(self.c, "a1", fetcher=_wind(20, 0)))

    def test_streams_preferred(self):
        lats = [p[0] for p in ROUTE]
        self.c.execute("INSERT INTO activity_streams VALUES ('a1','directlatitude',?)", (json.dumps(lats),))
        self.c.execute("INSERT INTO activity_streams VALUES ('a1','directlongitude',?)",
                       (json.dumps([p[1] for p in ROUTE]),))
        self.c.execute("INSERT INTO activity_streams VALUES ('a1','sumduration',?)",
                       (json.dumps([i * 27.0 for i in range(len(ROUTE))]),))
        w = rw.compute(self.c, "a1", fetcher=_wind(20, 0), force=True)
        self.assertEqual(w["source"], "streams")

    def test_temperature_along_the_ride(self):
        hours = [f"2026-10-1{d}T{h:02d}:00" for d in (2, 3) for h in range(24)]
        one = {"hourly": {"time": hours, "wind_speed_10m": [10] * 48, "wind_direction_10m": [0] * 48,
                          "wind_gusts_10m": [15] * 48, "temperature_2m": [10 + h % 24 for h in range(48)],
                          "apparent_temperature": [8 + h % 24 for h in range(48)],
                          "relative_humidity_2m": [70] * 48, "precipitation": [0.5 if h % 24 == 8 else 0 for h in range(48)]}}
        self.c.execute("INSERT INTO activity_streams VALUES ('a1','directairtemperature',?)", (json.dumps([24.0] * 50),))
        w = rw.compute(self.c, "a1", fetcher=lambda url: json.dumps([one] * 3))
        t = w["temp"]
        self.assertEqual((t["min"], t["max"]), (17, 18))          # 07:00–08:30 UTC → 17 °C then 18 °C
        self.assertAlmostEqual(t["feels"], t["avg"] - 2, delta=0.01)
        self.assertEqual((t["humidity"], t["rain_mm"], t["wet_hours"]), (70, 0.5, 1))
        self.assertTrue(t["profile_km"])
        self.assertEqual(t["sensor"], {"avg": 24.0, "min": 24, "max": 24})

    def test_old_cache_gets_temperature(self):
        rw.ensure_table(self.c)
        self.c.execute("INSERT INTO activity_wind (activity_id, result_json) VALUES ('a1', ?)", (json.dumps({"wind_kmh": 5}),))
        w = rw.compute(self.c, "a1", fetcher=_wind(20, 0))
        self.assertEqual(w["v"], rw.VERSION)
        fail = lambda url: (_ for _ in ()).throw(OSError("down"))
        self.c.execute("UPDATE activity_wind SET result_json=? WHERE activity_id='a1'", (json.dumps({"wind_kmh": 5}),))
        self.assertEqual(rw.compute(self.c, "a1", fetcher=fail), {"wind_kmh": 5})   # offline: the old one stays

    def test_utc_start(self):
        self.assertEqual(rw._start_utc("2026-10-12T09:00:00+02:00").hour, 7)
        self.assertEqual(rw._start_utc("2026-10-12 07:00:00").hour, 7)


if __name__ == "__main__":
    unittest.main()
