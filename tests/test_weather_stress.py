import random
import sqlite3
import unittest

from domains.aviation import weather_stress as ws


class WeatherStressTest(unittest.TestCase):
    def setUp(self):
        rnd = random.Random(3)
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.executescript("""
            CREATE TABLE flights(id, notes, dep_icao, arr_icao, is_sim INTEGER DEFAULT 0, takeoffs_day, takeoffs_night, landings_day, landings_night);
            CREATE TABLE airports(icao, latitude, longitude);
            CREATE TABLE flight_physio(flight_id, date, dep_iata, arr_iata, landing_stress, landing_stress_delta,
                                       landing_hr_delta, landing_you_flew, landing_crew,
                                       takeoff_stress, takeoff_stress_delta, takeoff_hr_delta, takeoff_you_flew, takeoff_crew);
            CREATE TABLE flight_metars(flight_id, phase, station, obs_time, raw, wind_dir, wind_kt, gust_kt, vis_m,
                                       ceiling_ft, wx, cb, temp_c, dew_c, qnh_hpa, category);""")
        for i in range(40):
            gusty = i % 4 == 0
            fid = f"f{i}"
            c.execute("INSERT INTO flights VALUES (?,?,?,?,0,0,0,?,0)", (fid, "Rough one, windshear" if gusty and i == 0 else None,
                                                                  "LEPA", "EGKK", 1 if i % 3 == 0 else 0))
            stress = 12 + rnd.gauss(0, 3) + (14 if gusty else 0)
            c.execute("INSERT INTO flight_physio VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL)",
                      (fid, "2026-01-01", "PMI", "LGW", 40 + stress, stress, 10 + stress / 2, 0, "CAPT"))
            c.execute("INSERT INTO flight_metars VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?)",
                      (fid, "landing", "EGKK", "2026-01-01T12:00:00+00:00", "EGKK ...", 230,
                       28 if gusty else 8, 42 if gusty else None, 9999, None, None, 0, "VFR"))
        self.c = c

    def test_gusts_raise_landing_stress(self):
        r = ws.effects(self.c, "landing")
        g = next(e for e in r["effects"] if e["condition"] == "gusty")
        self.assertTrue(g["enough_data"])
        self.assertAlmostEqual(g["delta"], 14, delta=3)
        self.assertEqual(g["strength"], "strong")

    def test_toughest_carries_weather_and_notes(self):
        top = ws.toughest(self.c, "landing", limit=3)
        self.assertTrue(all("G42" in t["weather"] for t in top))
        self.assertTrue(any(t["notes"] == "Rough one, windshear" for t in ws.toughest(self.c, "landing", limit=10)))


if __name__ == "__main__":
    unittest.main()


class PilotFlyingFromLogbookTest(WeatherStressTest):
    def test_logged_landing_counts_as_pilot_flying(self):
        e = next(x for x in ws.effects(self.c, "landing")["effects"] if x["condition"] == "you_flew")
        self.assertEqual(e["n_with"], 14)     # i % 3 == 0 for i in range(40)
