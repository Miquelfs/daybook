"""hrTSS sample weighting, strain scale, fitness vs race-day target, fitness age."""

import json
import sqlite3
import unittest
from datetime import date

from domains.health.compute_activity_metrics import _bucket_hr_to_zones, _compute_hr_tss
from domains.training.activity_impact import impact, strain_from_trimp
from domains.training.fitness_summary import summary


class HrTssTest(unittest.TestCase):
    def test_downsampled_stream_counts_real_time(self):
        # the same 2 h at 128 bpm, as 1 Hz and as Garmin's ~2000-point stream
        full = _compute_hr_tss([128] * 7200, 7200, 166, 195)
        sparse = _compute_hr_tss([128] * 2000, 7200, 166, 195)
        self.assertAlmostEqual(full, sparse, delta=0.5)
        self.assertGreater(sparse, 60)            # a 2 h aerobic ride is ~75 hrTSS, not ~20

    def test_zone_seconds_scaled(self):
        z = _bucket_hr_to_zones([120] * 1000, [{"name": "Z1", "min_hr": 0, "max_hr": 132}], dt=3.6)
        self.assertEqual(z["Z1"], 3600)


class StrainTest(unittest.TestCase):
    def test_scale(self):
        self.assertEqual(strain_from_trimp(0), 0)
        self.assertTrue(13 <= strain_from_trimp(181) <= 15)     # 2 h mostly Z1–Z2
        self.assertLess(strain_from_trimp(2000), 21.01)

    def test_from_analysis_zones(self):
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.execute("CREATE TABLE activities (id TEXT, date TEXT, activity_type TEXT, training_stress_score REAL,"
                  " moving_time_seconds INT, duration_seconds INT, distance_meters REAL, elevation_gain_meters REAL)")
        c.execute("INSERT INTO activities VALUES ('a','2026-10-21','cycling',NULL,7200,7300,51000,261)")
        zones = [{"zone": "Z1", "secs": 3780}, {"zone": "Z2", "secs": 3120}, {"zone": "Z3", "secs": 279}]
        out = impact(c, "a", analysis={"hr": {"zones": zones}})
        self.assertEqual(out["strain"]["trimp"], 181)
        self.assertEqual(out["strain"]["label"], "high")         # Whoop: 14–17.9


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE training_load_daily (date TEXT, sport TEXT, ctl REAL, atl REAL);
        CREATE TABLE race_goals (name TEXT, race_type TEXT, race_date TEXT, status TEXT);
        CREATE TABLE garmin_physio (date TEXT, vo2max_run REAL, vo2max_bike REAL, raw_payload TEXT);
        CREATE TABLE user_profile (id INTEGER, birthdate TEXT);
    """)
    c.execute("INSERT INTO race_goals VALUES ('Mallorca 312','mallorca_312','2027-04-24','active')")
    c.execute("INSERT INTO training_load_daily VALUES ('2026-09-23','combined',30,20)")
    c.execute("INSERT INTO training_load_daily VALUES ('2026-10-21','combined',42,34)")
    c.execute("INSERT INTO user_profile VALUES (1,'1990-05-01')")
    return c


class SummaryTest(unittest.TestCase):
    def test_goal(self):
        out = summary(_db(), today=date(2026, 10, 21))
        self.assertEqual(out["load"]["ramp_per_week"], 3.0)
        g = out["goal"]
        self.assertEqual(g["target_fitness"], 70)
        self.assertEqual(g["weeks_to_race"], 26)
        self.assertEqual(g["needed_ramp_per_week"], round(28 / 24, 1))
        self.assertEqual(g["status"], "on track")

    def test_fitness_age(self):
        c = _db()
        c.execute("INSERT INTO garmin_physio VALUES ('2026-10-20', 49.0, NULL, '{}')")
        fa = summary(c, today=date(2026, 10, 21))["fitness_age"]
        self.assertEqual(fa["source"], "estimate")
        self.assertEqual(fa["age"], 36)
        c.execute("INSERT INTO garmin_physio VALUES ('2026-10-21', 50.0, NULL, ?)",
                  (json.dumps({"max_metrics": [{"generic": {"fitnessAge": 29}}]}),))
        fa = summary(c, today=date(2026, 10, 21))["fitness_age"]
        self.assertEqual((fa["value"], fa["source"], fa["delta"]), (29, "garmin", -7))


    def test_garmin_fitness_age_wins(self):
        c = _db()
        c.execute("INSERT INTO garmin_physio VALUES ('2026-10-20', 52.6, NULL, '{}')")
        c.execute("CREATE TABLE garmin_fitness_age (date TEXT, fitness_age REAL, chronological_age INT,"
                  " achievable_fitness_age REAL, components_json TEXT, raw_payload TEXT)")
        c.execute("INSERT INTO garmin_fitness_age VALUES ('2026-10-21', 22.4, 36, 20.0,"
                  " '{\"rhr\": {\"value\": 48, \"target\": null}}', '{}')")
        fa = summary(c, today=date(2026, 10, 21))["fitness_age"]
        self.assertEqual((fa["value"], fa["source"], fa["delta"], fa["achievable"]), (22, "garmin", -14, 20))
        self.assertEqual(fa["components"]["rhr"]["value"], 48)

    def test_daily_strain(self):
        c = _db()
        c.execute("CREATE TABLE activities (id TEXT, date TEXT)")
        c.execute("CREATE TABLE activity_analysis (activity_id TEXT, result_json TEXT)")
        zones = {"hr": {"zones": [{"zone": "Z1", "secs": 3780}, {"zone": "Z2", "secs": 3120}, {"zone": "Z3", "secs": 279}]}}
        c.execute("INSERT INTO activities VALUES ('a','2026-10-21')")
        c.execute("INSERT INTO activity_analysis VALUES ('a', ?)", (json.dumps(zones),))
        st = summary(c, today=date(2026, 10, 21))["strain"]
        self.assertEqual(len(st["days"]), 7)
        self.assertEqual(st["today"], 14.0)
        self.assertEqual(st["today_label"], "high")
        self.assertEqual(st["days"][0]["value"], 0.0)


if __name__ == "__main__":
    unittest.main()
