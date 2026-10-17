"""Activity analysis cards from Garmin- and Strava-style streams."""

import json
import sqlite3
import unittest

from domains.health import activity_analysis as aa


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("""CREATE TABLE activities (id TEXT PRIMARY KEY, date TEXT, activity_type TEXT, start_time TEXT,
                 duration_seconds INTEGER, moving_time_seconds INTEGER, max_heart_rate INTEGER, polyline TEXT)""")
    c.execute("CREATE TABLE activity_streams (activity_id TEXT, stream_type TEXT, data_json TEXT)")
    c.execute("""CREATE TABLE athlete_zones (valid_from TEXT, sport TEXT, max_hr INTEGER, threshold_hr INTEGER,
                 ftp_w REAL, threshold_pace_s_per_km REAL, css_pace_s_per_100m REAL, zones_json TEXT)""")
    c.execute("INSERT INTO athlete_zones VALUES ('2026-01-01','ride',190,170,250,NULL,NULL,?)",
              (json.dumps([{"name": "Z1", "min_hr": 0, "max_hr": 124}, {"name": "Z2", "min_hr": 124, "max_hr": 143},
                           {"name": "Z3", "min_hr": 143, "max_hr": 156}, {"name": "Z4", "min_hr": 156, "max_hr": 167},
                           {"name": "Z5", "min_hr": 167, "max_hr": 999}]),))
    return c


def _ride(c, aid="garmin_1", atype="road_biking", power=True):
    """2 h ride sampled every 3 s: 20 km flat @ 30 km/h, 5 km climb @ 6 % (300 m) @ 15 km/h, rest flat.
    One 5-minute auto-pause in the middle of the flat."""
    t = d = 0.0
    T, D, HR, SPD, ALT, PW, CAD = [], [], [], [], [], [], []
    alt = 100.0
    while t < 7200:
        on_climb = 20000 <= d < 25000
        v = 15 / 3.6 if on_climb else 30 / 3.6
        if on_climb:
            alt += v * 3 * 0.06
        T.append(t); D.append(d); SPD.append(v); ALT.append(alt)
        HR.append(150 if on_climb else 135); PW.append(260 if on_climb else 180); CAD.append(85)
        d += v * 3
        t += 3
        if abs(t - 1800) < 2:
            t += 300          # auto-pause
    rows = {"sumduration": T, "sumdistance": D, "directheartrate": HR, "directspeed": SPD,
            "directelevation": ALT, "directbikecadence": CAD}
    if power:
        rows["directpower"] = PW
    c.execute("INSERT INTO activities VALUES (?, '2026-10-12', ?, '2026-10-12 07:00:00', 7500, 7200, 155, NULL)",
              (aid, atype))
    for k, v in rows.items():
        c.execute("INSERT INTO activity_streams VALUES (?,?,?)", (aid, k, json.dumps(v)))


class AnalysisTest(unittest.TestCase):
    def test_garmin_ride(self):
        c = _db()
        _ride(c)
        a = aa.analyze(c, "garmin_1")
        self.assertEqual(a["sport"], "ride")
        # pause excluded from moving time
        self.assertAlmostEqual(a["moving_s"], 6900, delta=30)
        self.assertAlmostEqual(a["elapsed_s"], 7200, delta=10)
        # HR: mostly Z2 (135), climb in Z3 (150)
        z = {x["zone"]: x["pct"] for x in a["hr"]["zones"]}
        self.assertGreater(z["Z2"], 70)
        self.assertGreater(z["Z3"], 5)
        self.assertIn("Aerobic", a["hr"]["verdict"])
        # elevation: one ~300 m cat climb
        e = a["elevation"]
        self.assertAlmostEqual(e["gain_m"], 300, delta=25)
        self.assertEqual(len(e["climbs"]), 1)
        cl = e["climbs"][0]
        self.assertAlmostEqual(cl["avg_grade"], 6, delta=0.8)
        self.assertAlmostEqual(cl["from_km"], 20, delta=0.5)
        self.assertEqual(cl["category"], "3")
        self.assertAlmostEqual(cl["vam"], 900, delta=120)
        self.assertAlmostEqual(cl["avg_w"], 260, delta=15)
        # pace: climb slower than flat
        p = a["pace"]
        self.assertAlmostEqual(p["flat_mps"] * 3.6, 30, delta=1)
        self.assertAlmostEqual(p["climb_mps"] * 3.6, 15, delta=1.5)
        # power with FTP 250
        pw = a["power"]
        self.assertEqual(pw["ftp"], 250)
        self.assertGreater(pw["np"], pw["avg"] - 1)
        self.assertEqual(pw["bests"][0]["label"], "5 s")
        self.assertEqual(pw["bests"][0]["watts"], 260)
        self.assertIn("Tempo (IF 0.80)", pw["verdict"])
        self.assertIn("Even on the flats", p["verdict"])
        zp = {x["zone"]: x["pct"] for x in pw["zones"]}
        self.assertGreater(zp["Z2"], 70)
        # cadence
        self.assertEqual(a["cadence"]["avg"], 85)
        # series: km x-axis, bounded size, carries grade
        s = a["series"]
        self.assertEqual(s["x_unit"], "km")
        self.assertLessEqual(len(s["points"]), 700)
        self.assertTrue(any(pt.get("grade", 0) > 4 for pt in s["points"]))

    def test_cached_and_invalidated_by_ftp(self):
        c = _db()
        _ride(c)
        a1 = aa.analyze(c, "garmin_1")
        c.execute("UPDATE activity_analysis SET result_json=? ", (json.dumps({"cached": True}),))
        self.assertEqual(aa.analyze(c, "garmin_1"), {"cached": True})
        c.execute("UPDATE athlete_zones SET ftp_w=300")          # new FTP → recomputed
        a2 = aa.analyze(c, "garmin_1")
        self.assertEqual(a2["power"]["ftp"], 300)
        self.assertLess(a2["power"]["if"], a1["power"]["if"])

    def test_indoor_trainer_uses_time_axis(self):
        c = _db()
        _ride(c, "garmin_2", "indoor_cycling")
        a = aa.analyze(c, "garmin_2")
        self.assertIsNone(a["elevation"])
        self.assertEqual(a["series"]["x_unit"], "min")
        self.assertTrue(a["power"]["indoor"])

    def test_strava_names_and_run_cadence_doubling(self):
        c = _db()
        c.execute("INSERT INTO activities VALUES ('s1','2026-10-12','run','2026-10-12T07:00:00Z',1800,1800,170,NULL)")
        n = 1800
        streams = {"time": list(range(n)), "distance": [i * 3.0 for i in range(n)],
                   "heartrate": [150] * n, "velocity_smooth": [3.0] * n, "cadence": [86] * n}
        for k, v in streams.items():
            c.execute("INSERT INTO activity_streams VALUES ('s1',?,?)", (k, json.dumps(v)))
        a = aa.analyze(c, "s1")
        self.assertEqual(a["sport"], "run")
        self.assertEqual(a["cadence"]["avg"], 172)
        self.assertAlmostEqual(a["pace"]["best"]["1 km"], 334, delta=1)
        self.assertIn("Even", a["pace"]["verdict"])

    def test_no_streams(self):
        c = _db()
        c.execute("INSERT INTO activities VALUES ('x','2026-10-12','road_biking',NULL,1,1,NULL,NULL)")
        self.assertIsNone(aa.analyze(c, "x"))


if __name__ == "__main__":
    unittest.main()
