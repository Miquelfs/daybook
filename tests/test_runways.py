import json
import math
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone

from domains.aviation import runways as rw

# LEPA-like parallels: 06L/24R and 06R/24L, ~1.4 km apart, true heading ~056/236
ENDS = [
    {"ident": "06L", "lat": 39.5410, "lon": 2.7080, "heading": 56.0, "length_ft": 10728},
    {"ident": "24R", "lat": 39.5590, "lon": 2.7440, "heading": 236.0, "length_ft": 10728},
    {"ident": "06R", "lat": 39.5300, "lon": 2.7200, "heading": 56.0, "length_ft": 9842},
    {"ident": "24L", "lat": 39.5480, "lon": 2.7560, "heading": 236.0, "length_ft": 9842},
]


def approach(end, n=10, spacing_m=900, offset_m=30):
    """Points on the extended centreline before the threshold, flying the runway heading."""
    h = math.radians(end["heading"])
    pts = []
    for i in range(n, 0, -1):
        d = -i * spacing_m
        x = d * math.sin(h) + offset_m * math.cos(h)
        y = d * math.cos(h) - offset_m * math.sin(h)
        lat = end["lat"] + y / 110_540
        lon = end["lon"] + x / (111_320 * math.cos(math.radians(end["lat"])))
        pts.append([1_700_000_000 + i, lat, lon, 300.0, end["heading"] + 1.5, False])
    pts.append([1_700_000_100, end["lat"], end["lon"], 0.0, end["heading"], True])
    return pts


class GeometryTest(unittest.TestCase):
    def test_track_picks_the_right_parallel(self):
        self.assertEqual(rw.from_track(approach(ENDS[2]), ENDS)["runway"], "06R")
        self.assertEqual(rw.from_track(approach(ENDS[1]), ENDS)["runway"], "24R")

    def test_wind_inference(self):
        res = rw.from_wind(ENDS, 240, 18)            # strong SW wind → 24s, parallels → both listed
        self.assertEqual(res["runway"], "24L/24R")
        self.assertIsNone(rw.from_wind(ENDS, 150, 3))  # calm: don't guess
        self.assertIsNone(rw.from_wind(ENDS, 146, 15))  # pure crosswind: no clear favourite

    def test_wind_components(self):
        hw, xw = rw.wind_components(236 + 30, 20, 236)
        self.assertAlmostEqual(hw, 17.3, delta=0.1)
        self.assertAlmostEqual(xw, 10.0, delta=0.1)


class SyncTest(unittest.TestCase):
    def test_adsb_then_manual_wins(self):
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        landed = datetime.now(timezone.utc) - timedelta(days=2)
        c.executescript("""CREATE TABLE flights(id, dep_icao, arr_icao, aircraft_reg, landing_utc, on_block_utc,
                                                is_sim INTEGER DEFAULT 0);
                           CREATE TABLE flight_metars(flight_id, phase, wind_dir, wind_kt);""")
        c.execute("INSERT INTO flights VALUES ('f1','EGKK','LEPA','EC-NJM',?,NULL,0)", (landed.isoformat(),))
        c.execute("INSERT INTO flights VALUES ('old','EGKK','LEPA','EC-NJM','2024-01-01T12:00:00+00:00',NULL,0)")
        c.execute("INSERT INTO flight_metars VALUES ('f1','landing',60,12), ('old','landing',240,20)")
        csv_text = "airport_ident,le_ident,le_latitude_deg,le_longitude_deg,le_heading_degT,he_ident,he_latitude_deg,he_longitude_deg,he_heading_degT,length_ft,closed\n" + \
            "\n".join(f"LEPA,{a['ident']},{a['lat']},{a['lon']},{a['heading']},{b['ident']},{b['lat']},{b['lon']},{b['heading']},{a['length_ft']},0"
                      for a, b in ((ENDS[0], ENDS[1]), (ENDS[2], ENDS[3])))

        def fake(url, timeout=60):
            if "runways.csv" in url:
                return csv_text
            if "hexdb" in url:
                return "3443c7"
            return json.dumps({"path": approach(ENDS[0])})

        s = rw.sync(c, fetcher=fake, verbose=False)
        self.assertEqual((s["adsb"], s["wind"]), (1, 1))
        r = c.execute("SELECT runway, source, headwind_kt, crosswind_kt FROM flight_runways WHERE flight_id='f1'").fetchone()
        self.assertEqual((r["runway"], r["source"]), ("06L", "adsb"))
        self.assertGreater(r["headwind_kt"], 10)
        self.assertEqual(c.execute("SELECT runway FROM flight_runways WHERE flight_id='old'").fetchone()[0], "24L/24R")
        rw.set_manual(c, "old", "24l")
        rw.sync(c, fetcher=fake, verbose=False)               # a later sync must not undo the manual choice
        r = c.execute("SELECT runway, source FROM flight_runways WHERE flight_id='old'").fetchone()
        self.assertEqual((r["runway"], r["source"]), ("24L", "manual"))


if __name__ == "__main__":
    unittest.main()
