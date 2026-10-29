"""Stress: the day timeline's spans across midnight, and the life-wide insights."""

import sqlite3
import unittest
from datetime import date, timedelta

from domains.health import stress_insights as si

try:
    from infrastructure.api.routers import wellness
except ImportError:                       # FastAPI not installed (Mac) — router tests skip
    wellness = None


def db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE intraday_stress(date TEXT, time TEXT, level INTEGER);
        CREATE TABLE intraday_body_battery(date TEXT, time TEXT, level INTEGER);
        CREATE TABLE intraday_hr(date TEXT, time TEXT, heart_rate INTEGER);
        CREATE TABLE wellness_daily(date TEXT PRIMARY KEY, stress_avg INTEGER, stress_rest_min INTEGER,
                                    stress_med_min INTEGER, stress_high_min INTEGER, utc_offset_min INTEGER);
        CREATE TABLE daily_stats(date TEXT PRIMARY KEY, stress_avg INTEGER);
        CREATE TABLE activities(id TEXT, date TEXT, name TEXT, activity_type TEXT, start_time TEXT,
                                duration_seconds INTEGER);
        CREATE TABLE flights(id TEXT, date TEXT, is_sim INTEGER DEFAULT 0, dep_iata TEXT, arr_iata TEXT,
                             off_block_utc TEXT, on_block_utc TEXT, takeoff_utc TEXT, landing_utc TEXT,
                             takeoff_crew TEXT, landing_crew TEXT);
        CREATE TABLE food_entries(date TEXT, meal_type TEXT, eaten_at TEXT, logged_at TEXT, kcal REAL);
        CREATE TABLE tags(id INTEGER PRIMARY KEY, slug TEXT, name TEXT, icon TEXT);
        CREATE TABLE day_tags(date TEXT, tag_id INTEGER, note TEXT);
        CREATE TABLE roster(date TEXT PRIMARY KEY, duty_type TEXT);
        CREATE TABLE sleep(date TEXT PRIMARY KEY, duration_seconds INTEGER);
    """)
    return c


@unittest.skipIf(wellness is None, "FastAPI not installed")
class TimelineMidnightTest(unittest.TestCase):
    def setUp(self):
        self.c = db()
        self.c.execute("INSERT INTO wellness_daily(date, utc_offset_min) VALUES ('2026-10-20', 120), ('2026-10-21', 120)")
        self.c.execute("INSERT INTO intraday_stress VALUES ('2026-10-20', '12:00', 30), ('2026-10-20', '12:03', -1)")
        # PMI→CPH 18:38–21:56 local, CPH→PMI 22:38 → lands 01:38 local the next day
        self.c.executemany("INSERT INTO flights(id, date, dep_iata, arr_iata, off_block_utc, on_block_utc, "
                           "takeoff_utc, landing_utc) VALUES (?,?,?,?,?,?,?,?)", [
            ("f1", "2026-10-20", "PMI", "CPH", "16:38", "19:56", "16:50", "19:48"),
            ("f2", "2026-10-20", "CPH", "PMI", "20:38", "23:38", "20:50", "23:30"),
        ])

    def test_late_sector_clipped_at_midnight(self):
        t = wellness.get_timeline("2026-10-20", self.c)
        spans = {s["id"]: s for s in t["spans"]}
        self.assertEqual((spans["f1"]["start"], spans["f1"]["end"]), ("18:38", "21:56"))
        self.assertEqual((spans["f2"]["start"], spans["f2"]["end"]), ("22:38", "24:00"))
        self.assertTrue(spans["f2"]["continues"])
        self.assertNotIn("01:30", [e["t"] for e in t["events"]])               # landing is tomorrow's
        self.assertEqual([p["v"] for p in t["stress"]], [30])                   # unmeasured dropped

    def test_tail_opens_the_next_day(self):
        t = wellness.get_timeline("2026-10-21", self.c)
        [s] = t["spans"]
        self.assertEqual((s["id"], s["start"], s["end"], s["carried"]), ("f2", "00:00", "01:38", True))
        self.assertEqual([(e["type"], e["t"]) for e in t["events"]], [("landing", "01:30")])


class StressInsightsTest(unittest.TestCase):
    TODAY = date(2026, 10, 29)

    def setUp(self):
        self.c = db()
        self.c.execute("INSERT INTO tags VALUES (1, 'alcohol', 'Alcohol', '🍷')")
        for i in range(60):
            d = (self.TODAY - timedelta(days=i)).isoformat()
            flying = i % 3 == 0
            self.c.execute("INSERT INTO roster VALUES (?, ?)", (d, "flying_duty" if flying else "day_off"))
            self.c.execute("INSERT INTO wellness_daily(date, stress_avg, utc_offset_min) VALUES (?,?,0)",
                           (d, 40 if flying else 25))
            self.c.execute("INSERT INTO sleep VALUES (?, ?)", (d, 5.5 * 3600 if flying else 8 * 3600))
            for h in range(24):
                self.c.execute("INSERT INTO intraday_stress VALUES (?, ?, ?)",
                               (d, f"{h:02d}:00", (60 if 9 <= h < 15 else 20) if flying else 20))
            if i % 3 and i < 15:                                               # drinks only on days off
                self.c.execute("INSERT INTO day_tags VALUES (?, 1, NULL)", (d,))
        # a 07:00 run on one flying day must not paint 07:00
        self.c.execute("INSERT INTO activities VALUES ('a', ?, 'Run', 'running', ?, 3600)",
                       (self.TODAY.isoformat(), f"{self.TODAY.isoformat()}T07:00:00"))
        self.c.execute("UPDATE intraday_stress SET level=95 WHERE date=? AND time='07:00'", (self.TODAY.isoformat(),))

    def test_rhythm_splits_by_kind_of_day_and_skips_exercise(self):
        r = {k["key"]: k for k in si.rhythm(self.c, self.TODAY, 30)["kinds"]}
        self.assertEqual(set(r), {"flying", "off"})
        self.assertEqual(r["flying"]["hours"][10], 60)
        self.assertEqual(r["flying"]["hours"][7], 20)
        self.assertEqual(r["off"]["hours"][10], 20)
        self.assertIn(r["flying"]["peak_hour"], range(9, 15))

    def test_drivers_duty_and_sleep(self):
        d = si.drivers(self.c, self.TODAY, 60)
        groups = {g["key"]: {r["label"]: r for r in g["rows"]} for g in d["groups"]}
        self.assertGreater(groups["duty"]["Flying duty"]["delta"], 0)
        self.assertLess(groups["duty"]["Day off"]["delta"], 0)
        self.assertGreater(groups["sleep"]["Under 6h"]["delta"], groups["sleep"]["8h+"]["delta"])
        self.assertIn("Alcohol", groups["tags"])                                # only on calm days off

    def test_overview_and_extremes(self):
        o = si.overview(self.c, self.TODAY, 30)
        self.assertEqual(len(o["series"]), 30)
        self.assertIsNotNone(o["prev_avg"])
        x = si.extremes(self.c, self.TODAY, 30)
        self.assertEqual(x["high"][0]["avg"], 40)
        self.assertIn("Flying duty", x["high"][0]["context"])


if __name__ == "__main__":
    unittest.main()
