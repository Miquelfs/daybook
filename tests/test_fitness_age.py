"""Daybook fitness age: VO2max base by norms + capped adjustments, achievable, history."""

import json
import sqlite3
import unittest
from datetime import date, timedelta

from domains.health import fitness_age as fa


def _db(rhr=41, hrv=68, steps=6500, sleep_h=7.2, train_min_day=60, vig_share=0.2, weight=84.6, bmi=24.5):
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE user_profile (id INTEGER, birthdate TEXT);
        CREATE TABLE garmin_physio (date TEXT, vo2max_run REAL, vo2max_bike REAL);
        CREATE TABLE daily_stats (date TEXT, steps INT, resting_hr INT);
        CREATE TABLE hrv (date TEXT, last_night_avg REAL);
        CREATE TABLE sleep (date TEXT, duration_seconds INT);
        CREATE TABLE activities (id TEXT, date TEXT, moving_time_seconds INT, duration_seconds INT);
        CREATE TABLE activity_detail (activity_id TEXT, zones_json TEXT);
        CREATE TABLE weight_log (date TEXT, weight_kg REAL);
        CREATE TABLE garmin_fitness_age (date TEXT, fitness_age REAL, components_json TEXT);
    """)
    c.execute("INSERT INTO user_profile VALUES (1, '1998-05-01')")
    today = date(2026, 10, 22)
    c.execute("INSERT INTO garmin_physio VALUES ('2026-10-20', 50.0, 52.6)")
    for i in range(28):
        d = (today - timedelta(days=i)).isoformat()
        c.execute("INSERT INTO daily_stats VALUES (?,?,?)", (d, steps, rhr))
        c.execute("INSERT INTO hrv VALUES (?,?)", (d, hrv))
        c.execute("INSERT INTO sleep VALUES (?,?)", (d, int(sleep_h * 3600)))
        secs = train_min_day * 60
        c.execute("INSERT INTO activities VALUES (?,?,?,?)", (f"a{i}", d, secs, secs))
        c.execute("INSERT INTO activity_detail VALUES (?,?)", (f"a{i}", json.dumps({"z3_s": secs * vig_share})))
    c.execute("INSERT INTO weight_log VALUES ('2026-10-01', ?)", (weight,))
    c.execute("INSERT INTO garmin_fitness_age VALUES ('2026-10-21', 22, ?)", (json.dumps({"bmi": {"value": bmi}}),))
    return c, today


class FitnessAgeTest(unittest.TestCase):
    def test_vo2_age(self):
        self.assertAlmostEqual(fa.vo2_age(54.4, "male"), 25, delta=0.1)
        self.assertAlmostEqual(fa.vo2_age(49.2, "male"), 35, delta=0.1)
        self.assertLess(fa.vo2_age(60, "male"), 25)                 # fitter than the youngest band
        self.assertLess(fa.vo2_age(45, "female"), fa.vo2_age(45, "male"))

    def test_your_profile(self):
        c, today = _db()
        r = fa.compute(c, today, "male")
        self.assertEqual(r["age"], 28)
        self.assertAlmostEqual(r["vo2_age"], 28.5, delta=0.3)       # VO2max 52.6 is average for a 28-year-old man
        k = {x["key"]: x for x in r["components"]}
        self.assertAlmostEqual(k["rhr"]["years"], -2.85, delta=0.06)  # 41 bpm
        self.assertEqual(k["activity"]["value"], 504)              # 7 h/wk, 20 % vigorous: 336 + 2×84
        self.assertEqual(k["activity"]["years"], -2.0)
        self.assertEqual(k["steps"]["years"], 0.5)
        self.assertEqual(k["bmi"]["value"], 24.5)
        self.assertLess(r["fitness_age"], 24)                      # Garmin says 22
        self.assertLessEqual(r["achievable"], r["fitness_age"])
        self.assertIn(r["biggest_gain"], ("steps", "activity", "hrv"))

    def test_poor_habits_age_you(self):
        c, today = _db(rhr=72, hrv=30, steps=3000, sleep_h=5.5, train_min_day=5)
        r = fa.compute(c, today, "male")
        self.assertGreater(r["fitness_age"], r["vo2_age"] + 5)

    def test_needs_age_and_vo2(self):
        c, today = _db()
        c.execute("DELETE FROM garmin_physio")
        self.assertIsNone(fa.compute(c, today))


if __name__ == "__main__":
    unittest.main()
