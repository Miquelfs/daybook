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


if __name__ == "__main__":
    unittest.main()
