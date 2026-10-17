"""Training impact: load/form change, efficiency vs similar sessions, Mallorca 312 readiness."""

import sqlite3
import unittest

from domains.training.activity_impact import impact


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE activities (id TEXT PRIMARY KEY, date TEXT, activity_type TEXT, duration_seconds INTEGER,
            moving_time_seconds INTEGER, distance_meters REAL, elevation_gain_meters REAL, training_stress_score REAL,
            start_time TEXT);
        CREATE TABLE activity_detail (activity_id TEXT PRIMARY KEY, efficiency_factor REAL, decoupling_pct REAL,
            hr_tss REAL);
        CREATE TABLE training_load_daily (date TEXT, sport TEXT, daily_tss REAL, ctl REAL, atl REAL, tsb REAL,
            ramp_rate REAL, PRIMARY KEY (date, sport));
        CREATE TABLE race_goals (id INTEGER PRIMARY KEY, name TEXT, race_type TEXT, race_date TEXT, status TEXT);
    """)
    c.execute("INSERT INTO race_goals VALUES (1,'Mallorca 312','mallorca_312','2027-04-24','active')")
    # five earlier ~3 h Z2 rides, EF ~1.40; one earlier 95 km ride
    for i, (d, ef, km) in enumerate([("2026-09-06", 1.38, 70), ("2026-09-13", 1.40, 80), ("2026-09-20", 1.39, 95),
                                     ("2026-09-27", 1.41, 75), ("2026-10-04", 1.40, 85)]):
        c.execute("INSERT INTO activities VALUES (?,?,'road_biking',10800,10500,?,900,150,NULL)", (f"r{i}", d, km * 1000))
        c.execute("INSERT INTO activity_detail VALUES (?,?,4.0,NULL)", (f"r{i}", ef))
    c.execute("INSERT INTO activities VALUES ('indoor','2026-10-08','indoor_cycling',3600,3600,30000,0,60,NULL)")
    c.execute("INSERT INTO activity_detail VALUES ('indoor',1.9,1,NULL)")       # different kind → ignored
    # today: 120 km, 1500 m, EF 1.47, decoupling 3.8
    c.execute("INSERT INTO activities VALUES ('now','2026-10-12','road_biking',16200,15600,120000,1500,210,'2026-10-12 07:00:00')")
    c.execute("INSERT INTO activity_detail VALUES ('now',1.47,3.8,NULL)")
    c.execute("INSERT INTO training_load_daily VALUES ('2026-10-11','combined',0,50,45,6,NULL)")
    c.execute("INSERT INTO training_load_daily VALUES ('2026-10-12','combined',210,53.8,67.6,5,NULL)")
    c.execute("INSERT INTO training_load_daily VALUES ('2026-10-14','combined',140,0,0,0,NULL)")   # same week (Mon 12th)
    return c


class ImpactTest(unittest.TestCase):
    def test_full(self):
        c = _db()
        out = impact(c, "now", analysis={"hr": {"decoupling_pct": 3.8}}, fuel_target_fn=lambda m, z, d: 70)
        self.assertEqual(out["tss"], 210)
        self.assertEqual(out["tss_source"], "device")
        L = out["load"]
        self.assertEqual(L["fitness_delta"], 3.8)
        self.assertEqual(L["fatigue_delta"], 22.6)
        self.assertEqual(L["form_next"], -13.8)
        self.assertEqual(L["form_label"], "productive fatigue")
        self.assertEqual(L["week_tss"], 350)
        self.assertEqual(L["week_share_pct"], 60)
        e = out["efficiency"]
        self.assertEqual(e["n"], 5)                      # indoor session excluded
        self.assertEqual(e["baseline"], 1.40)
        self.assertEqual(e["pct"], 5.0)
        self.assertIn("building", e["verdict"])
        self.assertTrue(e["history"][-1]["this"])
        r = out["race"]
        self.assertEqual(r["km_pct"], 38)
        self.assertEqual(r["climb_pct"], 32)
        self.assertTrue(r["is_longest"])
        self.assertEqual(r["longest_before_km"], 95)
        self.assertTrue(r["durability"]["ok"])
        self.assertEqual(r["fuel"]["target_g_h"], 70)

    def test_run_has_no_race_block_and_few_similar(self):
        c = _db()
        c.execute("INSERT INTO activities VALUES ('run','2026-10-12','running',3600,3600,12000,80,NULL,NULL)")
        c.execute("INSERT INTO activity_detail VALUES ('run',2.1,2,55)")
        out = impact(c, "run")
        self.assertIsNone(out["race"])
        self.assertEqual(out["tss"], 55)
        self.assertEqual(out["tss_source"], "heart rate")
        self.assertIsNone(out["efficiency"]["trend"])


if __name__ == "__main__":
    unittest.main()
