"""Cols (bike rides only): OSM tiles fetched once, tracks matched to passes, counts, Mallorca to-do, outage-safe."""

import sqlite3
import unittest
from unittest import mock

from domains.health.geo import encode
from domains.locations import cols

SOLLER = (39.7351, 2.7110)          # Coll de Sóller-ish
HONOR = (39.7140, 2.8000)
FAR = (39.6500, 2.6200)             # a col the rides never go near


def _el(i, name, p, ele):
    return {"type": "node", "id": i, "lat": p[0], "lon": p[1], "tags": {"name": name, "mountain_pass": "yes", "ele": ele}}


FAKE = {"elements": [_el(1, "Coll de Sóller", SOLLER, "497"), _el(2, "Coll d'Honor", HONOR, "550 m"),
                     _el(3, "Coll des Far", FAR, "300")]}


def _line(a, b, n=60):
    return [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1)]


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("CREATE TABLE activities (id TEXT, date TEXT, activity_type TEXT, polyline TEXT)")
    home = (39.5696, 2.6502)
    c.execute("INSERT INTO activities VALUES ('r1','2026-09-01','road_biking',?)",
              (encode(_line(home, SOLLER) + _line(SOLLER, home)),))
    c.execute("INSERT INTO activities VALUES ('r2','2026-10-01','cycling',?)",
              (encode(_line(home, SOLLER) + _line(SOLLER, HONOR) + _line(HONOR, home)),))
    for aid, kind in (("swim", "open_water_swimming"), ("run", "trail_running"), ("walk", "walking"),
                      ("trainer", "indoor_cycling")):
        c.execute("INSERT INTO activities VALUES (?,'2026-10-02',?,?)", (aid, kind, encode(_line(home, SOLLER))))
    c.execute("INSERT INTO activities VALUES ('hike','2026-10-05','hiking',?)", (encode(_line(home, SOLLER)),))
    return c


class ColsTest(unittest.TestCase):
    def test_sync_and_summary(self):
        c = _db()
        with mock.patch.object(cols.overpass, "query", return_value=FAKE) as q, \
             mock.patch.object(cols, "_road_grid", return_value=None):
            out = cols.sync(c, None)
            calls = q.call_count
            cols.sync(c, None)                                   # nothing new: no more downloads
            self.assertEqual(q.call_count, calls)
        self.assertEqual(out["scanned"], 2)                       # outdoor rides only: no hike, run, walk, swim, trainer
        s = cols.summary(c)
        got = {x["name"]: x for x in s["climbed"]}
        self.assertEqual(set(got), {"Coll de Sóller", "Coll d'Honor"})
        self.assertEqual(got["Coll de Sóller"]["times"], 2)
        self.assertEqual(got["Coll de Sóller"]["sports"], ["ride"])
        self.assertEqual(got["Coll de Sóller"]["first_date"], "2026-09-01")
        self.assertEqual(got["Coll d'Honor"]["ele"], 550)
        self.assertEqual(s["highest"]["name"], "Coll d'Honor")
        per = {x["name"]: x for x in cols.for_activity(c, "r2")}
        self.assertEqual((per["Coll de Sóller"]["nth"], per["Coll de Sóller"]["first_time"]), (2, False))
        self.assertTrue(per["Coll d'Honor"]["first_time"])

    def test_mallorca_todo_road_cols(self):
        c = _db()
        road = mock.Mock()
        road.near = lambda p: True                                # all three are road cols
        with mock.patch.object(cols.overpass, "query", return_value=FAKE), \
             mock.patch.object(cols, "_road_grid", return_value=road):
            cols.sync(c, None)
        m = cols.summary(c)["mallorca"]
        self.assertEqual((m["road_climbed"], m["road_total"]), (2, 3))
        self.assertEqual([t["name"] for t in m["todo"]], ["Coll des Far"])

    def test_outage_leaves_activities_for_next_run(self):
        c = _db()
        with mock.patch.object(cols.overpass, "query", side_effect=RuntimeError("502")):
            out = cols.sync(c, None)
        self.assertEqual(out["scanned"], 0)
        self.assertEqual(c.execute("SELECT COUNT(*) FROM col_scan").fetchone()[0], 0)
        with mock.patch.object(cols.overpass, "query", return_value=FAKE), \
             mock.patch.object(cols, "_road_grid", return_value=None):
            self.assertEqual(cols.sync(c, None)["scanned"], 2)

    def test_rides_in_downloaded_areas_dont_wait_for_new_ones(self):
        c = _db()
        alps = [(45.90 + i * 0.001, 6.90) for i in range(60)]               # a ride in a tile not downloaded yet
        c.execute("INSERT INTO activities VALUES ('alps','2024-04-10','road_biking',?)", (encode(alps),))

        # Mallorca downloads fine, then the server starts saying 429 for the new area
        with mock.patch.object(cols.overpass, "query", side_effect=[FAKE, RuntimeError("429")]), \
             mock.patch.object(cols, "_road_grid", return_value=None), mock.patch.object(cols.time, "sleep"):
            out = cols.sync(c, None)
        self.assertEqual((out["scanned"], out["waiting"]), (2, 1))          # Mallorca rides done, the Alps one waits
        self.assertIn("429", out["error"])
        self.assertEqual(c.execute("SELECT COUNT(*) FROM col_scan WHERE activity_id='alps'").fetchone()[0], 0)
        with mock.patch.object(cols.overpass, "query", return_value={"elements": []}), \
             mock.patch.object(cols, "_road_grid", return_value=None):
            self.assertEqual(cols.sync(c, None)["scanned"], 1)              # next run picks it up

    def test_batched_downloads(self):
        tiles = {f"{y}:{x}" for y in range(90, 95) for x in range(0, 5)}    # 25 tiles
        c = _db()
        cols.ensure_tables(c)
        with mock.patch.object(cols.overpass, "query", return_value={"elements": []}) as q, \
             mock.patch.object(cols.time, "sleep") as sl:
            cols.fetch_tiles(c, tiles)
        self.assertEqual(q.call_count, 3)                                   # 12 + 12 + 1
        self.assertEqual(sl.call_count, 2)                                  # a pause between queries

    def test_strava_copy_of_a_garmin_ride_counts_once(self):
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.execute("CREATE TABLE activities (id TEXT, date TEXT, activity_type TEXT, polyline TEXT, source TEXT, strava_id TEXT)")
        ride = encode(_line((39.5696, 2.6502), SOLLER))
        c.execute("INSERT INTO activities VALUES ('garmin_1','2026-05-14','cycling',?,'garmin','999')", (ride,))
        c.execute("INSERT INTO activities VALUES ('strava_999','2026-05-14','Ride',?,'strava',NULL)", (ride,))
        c.execute("INSERT INTO activities VALUES ('strava_5','2023-06-01','Ride',?,'strava',NULL)", (ride,))   # no twin
        cols.ensure_tables(c)
        c.execute("INSERT INTO col_visits VALUES (1, 'strava_999', '2026-05-14', 'ride')")                 # old double
        with mock.patch.object(cols.overpass, "query", return_value=FAKE), \
             mock.patch.object(cols, "_road_grid", return_value=None):
            out = cols.sync(c, None)
        self.assertEqual(out["scanned"], 2)
        sol = next(x for x in cols.summary(c)["climbed"] if x["name"] == "Coll de Sóller")
        self.assertEqual(sol["times"], 2)                     # garmin_1 + the 2023 Strava-only ride


if __name__ == "__main__":
    unittest.main()
