"""Movement by mode (flights kept apart from ground) and new places per day / month."""

import json
import sqlite3
import unittest

from domains.locations import movement_modes as mm
from domains.locations import place_stats as ps


def _seg(t, lat, lng):
    return (t, json.dumps([{"lat": lat, "lng": lng, "t": 0}]))


class OverlandDayTest(unittest.TestCase):
    def test_flight_hop_is_not_ground(self):
        # Palma → ~6 km ride in 15 min, then the phone wakes in Barcelona an hour later (~200 km at ~200 km/h): a flight
        rows = [_seg("2026-10-01T08:00:00Z", 39.57, 2.65), _seg("2026-10-01T08:15:00Z", 39.60, 2.70),
                _seg("2026-10-01T09:15:00Z", 41.39, 2.15)]
        o = mm.overland_day(rows)
        self.assertAlmostEqual(o["ground"], 5.4, delta=1.0)
        self.assertGreater(o["flight"], 190)

    def test_gps_jump_is_dropped(self):
        rows = [_seg("2026-10-01T08:00:00Z", 39.57, 2.65), _seg("2026-10-01T08:00:20Z", 39.62, 2.65)]
        self.assertEqual(mm.overland_day(rows), {"ground": 0.0, "flight": 0.0})


class PlaceStatsTest(unittest.TestCase):
    def setUp(self):
        ps._CACHE.clear()
        c = sqlite3.connect(":memory:")
        c.execute("CREATE TABLE visits (date TEXT, place_id TEXT)")
        c.execute("CREATE TABLE place_names (place_id TEXT, name TEXT, city TEXT, country TEXT)")
        c.execute("""CREATE TABLE tracks (date TEXT, segment_start TEXT, segment_end TEXT, points_json TEXT,
                     geocode_name TEXT, geocode_city TEXT, geocode_country TEXT)""")
        c.execute("INSERT INTO place_names VALUES ('p1', 'Plaça Major', 'Palma', 'España')")
        c.execute("INSERT INTO visits VALUES ('2026-04-01', 'p1')")
        c.executemany("INSERT INTO tracks VALUES (?, '', '', '[]', ?, ?, ?)", [
            ("2026-10-30", "Plaça Major", "Palma", "Spain"),          # seen before (España → Spain)
            ("2026-10-30", "Carrer Nou", "Sóller", "Spain"),          # new place, new city
            ("2026-10-31", "Nyhavn", "Copenhagen", "Denmark"),        # new country
        ])
        self.c = c

    def test_day_marks_first_visits(self):
        d = ps.day(self.c, "2026-10-30")
        self.assertEqual(d["places"], 2)
        self.assertEqual([p["name"] for p in d["new_places"]], ["Carrer Nou"])
        self.assertEqual([c["city"] for c in d["new_cities"]], ["Sóller"])
        self.assertEqual(d["new_countries"], [])
        self.assertEqual(ps.day(self.c, "2026-10-31")["new_countries"], ["Denmark"])

    def test_months_count_new(self):
        m = {x["month"]: x for x in ps.months(self.c, 2026)["months"]}
        self.assertEqual((m["2026-10"]["new_places"], m["2026-10"]["new_cities"]), (2, 2))
        self.assertEqual(m["2026-04"]["new_places"], 1)


if __name__ == "__main__":
    unittest.main()
