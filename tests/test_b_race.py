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

    def test_runs_on_top_until_the_allowance_runs_out(self):
        wk = self.runs("2026-10-26", "2026-11-01")
        self.assertEqual(sorted(r["session_type"] for r in wk), ["Running - Easy Run", "Running - Intervals"])
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM plan_sessions WHERE status='displaced' "
                                        "AND session_date BETWEEN '2026-10-26' AND '2026-11-01'").fetchone()[0], 0)
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM plan_sessions WHERE status='displaced' "
                                        "AND session_type='Cycling - Recovery Spin'").fetchone()[0], 0)
        # January: easy + quality on top, the long run takes a Zone 2 ride's place (past the 2.5 h extra)
        jan = self.c.execute("SELECT session_type FROM plan_sessions WHERE status='displaced' "
                             "AND session_date BETWEEN '2027-01-04' AND '2027-01-10'").fetchall()
        self.assertEqual([r[0] for r in jan], ["Cycling - Zone 2 Ride"])
        self.assertEqual({r["role"] for r in wk}, {"run", "key"})        # easy runs can share a day

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


class RealPlanReflowTest(unittest.TestCase):
    """The half on the real Mallorca 312 template, placed by the real reflow."""

    def setUp(self):
        import domains.training.reflow as rf
        from domains.training.plan_templates import TEMPLATES
        from domains.training.scheduler import generate_plan, get_discipline
        from tests.helpers import fake_date, plan_db
        self.rf, self._d = rf, rf.date
        rf.date = fake_date(2026, 10, 23)
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        c = plan_db()
        c.execute("INSERT INTO race_goals(name, race_type, race_date, plan_start_date, available_days) "
                  "VALUES('M312','mallorca_312','2027-04-24','2026-10-19',?)", (",".join(days),))
        rf._ensure_columns(c)
        plan = generate_plan(TEMPLATES["mallorca_312"], "2027-04-24", days, start_from="2026-10-19",
                             schedule_all_weeks=True)
        for w in plan["plan"]:
            for s in w["training_sessions"]:
                d = "2027-04-24" if s["type"] == "Race Day" else s["date"]
                c.execute("""INSERT INTO plan_sessions(goal_id, session_date, original_date, week_number, session_type,
                             discipline, duration_min, intensity_zone, is_optional, effective_duration_min, role)
                             VALUES(1,?,?,?,?,?,?,?,?,?,?)""",
                          (d, d, w["week"], s["type"], get_discipline(s["type"]), s["duration"], s["intensity_zone"],
                           1 if s.get("optional") else 0, s["duration"], s.get("role")))
        c.execute("CREATE TABLE IF NOT EXISTS athlete_zones (sport TEXT, valid_from TEXT, threshold_pace_s_per_km REAL)")
        c.execute("INSERT INTO athlete_zones VALUES ('run','2026-01-01',274)")
        self.c = c
        b_race.create(c, 1, "Half marathon", "2027-03-21", today=date(2026, 10, 23))

    def tearDown(self):
        self.rf.date = self._d

    def test_runs_fit_without_pushing_bike_sessions_out(self):
        pushed = self.c.execute("SELECT COUNT(*) FROM plan_sessions WHERE status='displaced' "
                                "AND schedule_note LIKE 'No free slot%'").fetchone()[0]
        self.assertEqual(pushed, 0)

    def test_race_week_lengths_survive_reflow(self):
        self.rf.reflow_goal(self.c, 1)                                      # nightly reflow again
        long_ride = self.c.execute("SELECT effective_duration_min FROM plan_sessions WHERE session_type='Cycling - Long Ride' "
                                   "AND session_date BETWEEN '2027-03-15' AND '2027-03-20'").fetchall()
        self.assertTrue(long_ride and all(r[0] == 60 for r in long_ride))

    def test_easy_runs_never_on_hard_days_or_before_a_long_ride(self):
        rows = self.c.execute("SELECT * FROM plan_sessions WHERE status='pending'").fetchall()
        by_day = {}
        for r in rows:
            by_day.setdefault(r["session_date"], []).append(r)
        doubled = 0
        for d, ss in by_day.items():
            runs = [s for s in ss if s["role"] == "run"]
            if not runs:
                continue
            others = [s for s in ss if s["role"] != "run"]
            self.assertFalse(any(s["role"] in ("key", "long", "long2") for s in others), d)
            nxt = (date.fromisoformat(d) + timedelta(days=1)).isoformat()
            if others:                                   # doubled: never the day before a long ride
                self.assertFalse(any(s["role"] == "long" for s in by_day.get(nxt, [])), d)
            self.assertLessEqual(len(ss), 2, d)
            doubled += bool(others)
        self.assertGreater(doubled, 0)                   # some runs share a day with an easy ride or gym
