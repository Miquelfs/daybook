"""A ride's profile: elevation along the distance, cols / climbs placed at their km, a col's climb shown once."""

import json
import sqlite3
import unittest

from domains.locations import ride_profile


def ride_db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE activity_streams(activity_id TEXT, stream_type TEXT, data_json TEXT);
        CREATE TABLE cols(osm_id INTEGER PRIMARY KEY, name TEXT, ele REAL, lat REAL, lng REAL);
        CREATE TABLE col_visits(osm_id INTEGER, activity_id TEXT, date TEXT);
        CREATE TABLE climbs(key TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, lat REAL, lng REAL, ele REAL, osm_id INTEGER);
        CREATE TABLE climb_visits(climb_key TEXT, activity_id TEXT, date TEXT, side TEXT, length_km REAL, gain_m REAL,
                                  avg_pct REAL, max_pct REAL, secs REAL, vam REAL, top_ele REAL);
    """)
    # 20 km due north, one sample every ~111 m: up 500 m over the first 10 km, back down over the next 10
    n = 181
    lat = [39.6 + i * 0.001 for i in range(n)]
    ele = [50 + 500 * (i / 90 if i <= 90 else (180 - i) / 90) for i in range(n)]
    for k, v in (("directlatitude", lat), ("directlongitude", [2.7] * n), ("directelevation", ele),
                 ("sumduration", [i * 20.0 for i in range(n)])):
        c.execute("INSERT INTO activity_streams VALUES ('a1', ?, ?)", (k, json.dumps(v)))
    c.execute("INSERT INTO cols VALUES (7, 'Coll de Test', 550, ?, 2.7)", (lat[90],))
    c.execute("INSERT INTO col_visits VALUES (7, 'a1', '2026-10-31')")
    c.execute("INSERT INTO climbs VALUES ('k', 'Coll de Test', 'pass', ?, 2.7, 550, 7)", (lat[90],))
    c.execute("INSERT INTO climb_visits VALUES ('k', 'a1', '2026-10-31', 'south', 9.5, 480, 5.1, 7, 2000, 860, 550)")
    return c


class RideProfileTest(unittest.TestCase):
    def test_profile_and_markers(self):
        p = ride_profile.profile(ride_db(), "a1")
        self.assertAlmostEqual(p["km"], 20, delta=0.3)
        top = max(p["profile"], key=lambda x: x[1])
        self.assertAlmostEqual(top[0], 10, delta=0.6)
        self.assertEqual([(m["kind"], m["name"]) for m in p["markers"]], [("col", "Coll de Test")])   # climb merged in
        col = p["markers"][0]
        self.assertAlmostEqual(col["km"], 10, delta=0.3)
        self.assertEqual((col["first"], col["gain_m"], col["avg_pct"]), (True, 480, 5.1))
        self.assertAlmostEqual(col["from_km"], 0.5, delta=0.3)

    def test_no_streams_no_profile(self):
        self.assertIsNone(ride_profile.profile(ride_db(), "nope"))


if __name__ == "__main__":
    unittest.main()
