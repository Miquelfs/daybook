"""Trip detection: evening rotations that land after midnight are NOT trips."""

import sqlite3
import unittest

import domains.locations.home_base as hb
import domains.locations.trip_detection as td
from tests.helpers import tmpdir

PMI, BCN, LHR = (39.57, 2.65), (41.30, 2.08), (51.47, -0.45)


class TripDetectionTest(unittest.TestCase):
    def setUp(self):
        d = tmpdir()
        self.L, self.D = d / "l.db", d / "d.db"
        l = sqlite3.connect(self.L)
        l.executescript("""
            CREATE TABLE visits(date, lat, lng, start_time, end_time, place_id);
            CREATE TABLE overland_locations(date, lat, lng, recorded_at);
            CREATE TABLE place_names(place_id, country, city);
            CREATE TABLE tracks(date, geocode_country, geocode_city);""")
        self.l = l
        c = sqlite3.connect(self.D)
        c.executescript("""
            CREATE TABLE life_periods(label, start_date, end_date, centroid_lat, centroid_lng, home_radius_km, category);
            INSERT INTO life_periods VALUES('Palma','2020-01-01',NULL,39.57,2.65,40,'location');
            CREATE TABLE trips(start_date, end_date, return_date, primary_country, countries_json, cities_json,
                               total_km, max_distance_from_home_km, auto_name, cover_photo_path, home_at_start,
                               user_name, hidden, UNIQUE(start_date, end_date));
            CREATE TABLE days(date, photo_path);
            CREATE TABLE airports(icao, latitude, longitude);
            INSERT INTO airports VALUES('LEPA',39.55,2.73),('LEBL',41.3,2.08);
            CREATE TABLE flights(date, on_block_utc, landing_utc, arr_icao, is_sim);""")
        c.commit()
        self.c = c
        self._orig = (td._LOCATIONS_DB, td._DAYBOOK_DB, hb._DAYBOOK_DB, hb._LOCATIONS_DB)
        td._LOCATIONS_DB, td._DAYBOOK_DB, hb._DAYBOOK_DB, hb._LOCATIONS_DB = self.L, self.D, self.D, self.L
        for f in (hb._location_periods, hb.home_for, hb._gps_centroid_fallback):
            f.cache_clear()

    def tearDown(self):
        td._LOCATIONS_DB, td._DAYBOOK_DB, hb._DAYBOOK_DB, hb._LOCATIONS_DB = self._orig
        for f in (hb._location_periods, hb.home_for, hb._gps_centroid_fallback):
            f.cache_clear()

    def ping(self, d, where, ts):
        self.l.execute("INSERT INTO overland_locations VALUES(?,?,?,?)", (d, *where, ts))

    def trips(self):
        td.detect("2026-10-01", "2026-10-31", verbose=False)
        return sqlite3.connect(self.D).execute("SELECT start_date, end_date FROM trips").fetchall()

    def test_late_landing_after_midnight_is_home(self):
        self.ping("2026-10-09", PMI, "2026-10-09T15:00:00Z")
        self.ping("2026-10-09", BCN, "2026-10-09T21:30:00Z")   # last fix of the day at the outstation
        self.ping("2026-10-10", PMI, "2026-10-09T23:40:00Z")   # home 01:40 local, next calendar day
        self.ping("2026-10-10", PMI, "2026-10-10T12:00:00Z")
        self.l.commit()
        self.assertEqual(self.trips(), [])

    def test_logbook_landing_at_base_is_home(self):
        self.ping("2026-10-10", BCN, "2026-10-10T21:00:00Z")   # no GPS afterwards
        self.c.execute("INSERT INTO flights VALUES('2026-10-10','2026-10-10T23:10:00+00:00',NULL,'LEPA',0)")
        self.c.commit(); self.l.commit()
        self.assertEqual(self.trips(), [])

    def test_real_layover_is_a_trip(self):
        self.ping("2026-10-20", LHR, "2026-10-20T20:00:00Z")
        self.ping("2026-10-21", LHR, "2026-10-21T06:00:00Z")   # woke up in London
        self.ping("2026-10-21", PMI, "2026-10-21T12:00:00Z")
        self.ping("2026-10-22", PMI, "2026-10-22T09:00:00Z")
        self.l.commit()
        self.assertEqual([tuple(r) for r in self.trips()], [("2026-10-20", "2026-10-20")])


    def _bcn_then_london(self):
        """Barcelona 3 nights, then straight on to London 2 nights, home on the 6th — one detected run."""
        for d in ("2026-10-01", "2026-10-02", "2026-10-03"):
            self.ping(d, BCN, f"{d}T21:00:00Z")
        for d in ("2026-10-04", "2026-10-05"):
            self.ping(d, LHR, f"{d}T21:00:00Z")
        self.ping("2026-10-06", PMI, "2026-10-06T21:00:00Z")
        self.l.commit()

    def test_split_survives_the_nightly_rebuild_and_joins_back(self):
        self._bcn_then_london()
        self.assertEqual([tuple(r) for r in self.trips()], [("2026-10-01", "2026-10-05")])
        self.c.execute("UPDATE trips SET user_name='Work + London'"); self.c.commit()

        out = td.split_trip("2026-10-01", "2026-10-05", "2026-10-04", (None, "London"))
        self.assertEqual([(p["start_date"], p["end_date"], p["name"]) for p in out],
                         [("2026-10-01", "2026-10-03", "Work + London"), ("2026-10-04", "2026-10-05", "London")])
        self.assertIsNone(out[0]["return_date"])                 # no night at home between them
        self.assertEqual(out[1]["return_date"], "2026-10-06")

        # the nightly rebuild cuts it the same way and keeps both names
        self.assertEqual([tuple(r) for r in self.trips()], [("2026-10-01", "2026-10-03"), ("2026-10-04", "2026-10-05")])
        names = [r[0] for r in sqlite3.connect(self.D).execute("SELECT user_name FROM trips ORDER BY start_date")]
        self.assertEqual(names, ["Work + London", "London"])

        joined = td.join_trip("2026-10-04", "2026-10-05")
        self.assertEqual([(p["start_date"], p["end_date"], p["name"]) for p in joined],
                         [("2026-10-01", "2026-10-05", "Work + London")])

    def test_split_rebuild_leaves_other_trips_alone(self):
        self._bcn_then_london()
        self.ping("2026-10-20", LHR, "2026-10-20T20:00:00Z")
        self.ping("2026-10-21", PMI, "2026-10-21T12:00:00Z")
        self.l.commit()
        self.trips()
        self.c.execute("UPDATE trips SET user_name='Later' WHERE start_date='2026-10-20'"); self.c.commit()
        td.split_trip("2026-10-01", "2026-10-05", "2026-10-04")
        rows = sqlite3.connect(self.D).execute("SELECT start_date, user_name FROM trips ORDER BY start_date").fetchall()
        self.assertEqual(rows, [("2026-10-01", None), ("2026-10-04", None), ("2026-10-20", "Later")])

    def test_split_day_must_be_inside(self):
        self._bcn_then_london()
        self.trips()
        with self.assertRaises(ValueError):
            td.split_trip("2026-10-01", "2026-10-05", "2026-10-01")

    def test_apply_splits_over_a_bridged_gap(self):
        run = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]      # 3–4 no data, bridged
        self.assertEqual(td.apply_splits([run], ["2026-10-04"]),
                         [["2026-10-01", "2026-10-02"], ["2026-10-05", "2026-10-06"]])
        self.assertEqual(td.apply_splits([run], ["2026-09-01", "2026-10-01"]), [run])

if __name__ == "__main__":
    unittest.main()
