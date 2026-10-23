"""B race (half marathon) inside the Mallorca plan: runs swapped in, taper, race pinned, exact undo."""

import sqlite3
import unittest
from datetime import date, timedelta

from domains.training import b_race


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE race_goals (id INTEGER PRIMARY KEY, name TEXT, race_date TEXT, plan_start_date TEXT,
            status TEXT, available_days TEXT, volume_factor REAL);
        CREATE TABLE plan_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id INT, session_date TEXT,
            original_date TEXT, week_number INT, session_type TEXT, discipline TEXT, duration_min INT,
            intensity_zone TEXT, is_optional INT DEFAULT 0, is_displaced INT DEFAULT 0, effective_duration_min INT,
            status TEXT DEFAULT 'pending', completed_activity_id TEXT, rpe_actual INT, notes TEXT,
            structure_json TEXT, schedule_note TEXT, role TEXT, updated_at TEXT);
        CREATE TABLE athlete_zones (sport TEXT, valid_from TEXT, threshold_pace_s_per_km REAL);
        CREATE TABLE training_blocks (id INTEGER PRIMARY KEY, start_date TEXT, end_date TEXT);
    """)
    c.execute("INSERT INTO race_goals VALUES (10,'Mallorca 312','2027-04-24','2026-10-19','active','mon,tue,wed,thu,fri,sat,sun',1)")
    c.execute("INSERT INTO athlete_zones VALUES ('run','2026-01-01',274)")
    c.execute("INSERT INTO training_blocks VALUES (1,'2026-11-11','2026-11-18')")       # Taiwan
    # a plain weekly pattern: Mon gym, Tue key, Wed Z2 60, Thu recovery spin 45, Sat long; every 4th week lighter
    mon = date(2026, 10, 26)
    w = 0
    while mon < date(2027, 4, 19):
        light = w % 4 == 3
        f = 0.5 if light else 1.0
        rows = [(0, "Strength - Gym (legs + core)", "other", 50, "Z2"),
                (1, "Cycling - Threshold (trainer)", "cycling", 60, "Z4"),
                (2, "Cycling - Zone 2 Ride", "cycling", round(60 * f), "Z2"),
                (3, "Cycling - Recovery Spin", "cycling", 45, "Z1"),
                (4, "Strength - Gym (legs + core)", "other", 50, "Z2"),
                (5, "Cycling - Long Ride", "cycling", round(180 * f), "Z2")]
        if mon >= date(2027, 1, 4):
            rows.append((6, "Cycling - Zone 2 Ride", "cycling", 90, "Z2"))
        for k, t, disc, mins, z in rows:
            d = (mon + timedelta(days=k)).isoformat()
            c.execute("INSERT INTO plan_sessions (goal_id, session_date, original_date, week_number, session_type, "
                      "discipline, duration_min, intensity_zone, effective_duration_min) VALUES (10,?,?,?,?,?,?,?,?)",
                      (d, d, w + 2, t, disc, mins, z, mins))
        mon += timedelta(days=7)
        w += 1
    return c


class BRaceTest(unittest.TestCase):
    def setUp(self):
        self.c = _db()
        self.before = [tuple(r) for r in self.c.execute(
            "SELECT id, session_date, status, effective_duration_min, intensity_zone, schedule_note FROM plan_sessions")]
        self.b = b_race.create(self.c, 10, "Half marathon", "2027-03-21", today=date(2026, 10, 23))

    def runs(self, a, b):
        return self.c.execute("SELECT * FROM plan_sessions WHERE discipline='running' AND session_date BETWEEN ? AND ?",
                              (a, b)).fetchall()

    def test_paces_from_threshold(self):
        self.assertEqual(self.b["race_pace"], "4:45/km")         # 274 s × 1.04
        self.assertEqual(self.b["target_time"], "1:40")

    def test_early_weeks_swap_recovery_spins_only(self):
        wk = self.runs("2026-10-26", "2026-11-01")
        self.assertEqual(sorted(r["session_type"] for r in wk), ["Running - Easy Run", "Running - Intervals"])
        spin = self.c.execute("SELECT status FROM plan_sessions WHERE session_type='Cycling - Recovery Spin' "
                              "AND session_date='2026-10-29'").fetchone()[0]
        z2 = self.c.execute("SELECT status FROM plan_sessions WHERE session_type='Cycling - Zone 2 Ride' "
                            "AND session_date='2026-10-28'").fetchone()[0]
        self.assertEqual((spin, z2), ("displaced", "pending"))   # bike Z2 kept before New Year

    def test_nothing_around_the_tour(self):
        self.assertEqual(self.runs("2026-11-09", "2026-11-29"), [])

    def test_long_runs_from_january(self):
        longs = [r["duration_min"] for r in self.c.execute(
            "SELECT * FROM plan_sessions WHERE session_type='Running - Long Run' ORDER BY session_date")]
        self.assertEqual(longs[0], 70)
        self.assertLessEqual(max(longs), 100)
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM plan_sessions WHERE session_type='Cycling - Long Ride' "
                                        "AND status='displaced' AND session_date < '2027-03-15'").fetchone()[0], 0)

    def test_race_week_and_after(self):
        race = self.c.execute("SELECT * FROM plan_sessions WHERE session_type='Race - Half marathon'").fetchone()
        self.assertEqual((race["session_date"], race["is_displaced"]), ("2027-03-21", 1))
        week = {r["session_type"]: r for r in self.c.execute(
            "SELECT * FROM plan_sessions WHERE session_date BETWEEN '2027-03-15' AND '2027-03-20'")}
        self.assertEqual(week["Cycling - Threshold (trainer)"]["status"], "displaced")
        self.assertEqual(week["Cycling - Long Ride"]["effective_duration_min"], 60)
        self.assertIn("Running - Shake-out", week)
        gym_fri = self.c.execute("SELECT status FROM plan_sessions WHERE session_date='2027-03-19' "
                                 "AND session_type LIKE 'Strength%'").fetchone()[0]
        self.assertEqual(gym_fri, "displaced")                   # legs fresh for Sunday
        after = self.c.execute("SELECT * FROM plan_sessions WHERE session_date='2027-03-23' "
                               "AND session_type='Cycling - Threshold (trainer)'").fetchone()
        self.assertEqual(after["intensity_zone"], "Z2")

    def test_undo_restores_the_plan(self):
        b_race.delete(self.c, self.b["id"])
        after = [tuple(r) for r in self.c.execute(
            "SELECT id, session_date, status, effective_duration_min, intensity_zone, schedule_note FROM plan_sessions")]
        self.assertEqual(after, self.before)


if __name__ == "__main__":
    unittest.main()
