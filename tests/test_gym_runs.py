"""One gym a week, the other an easy run; no gym right before a race; off restores the plan exactly."""

import unittest
from datetime import date

import domains.training.reflow as rf
from domains.training import gym_runs
from domains.training.plan_templates import TEMPLATES
from domains.training.scheduler import generate_plan, get_discipline
from tests.helpers import fake_date, plan_db

ALL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
TODAY = date(2026, 11, 23)


class GymRunsTest(unittest.TestCase):
    def setUp(self):
        self._d = rf.date
        rf.date = fake_date(2026, 11, 23)
        c = plan_db()
        c.execute("INSERT INTO race_goals(name, race_type, race_date, plan_start_date, available_days) "
                  "VALUES('Mallorca 312','mallorca_312','2027-04-24','2026-10-19',?)", (",".join(ALL),))
        rf._ensure_columns(c)
        plan = generate_plan(TEMPLATES["mallorca_312"], "2027-04-24", ALL, start_from="2026-10-19", schedule_all_weeks=True)
        for w in plan["plan"]:
            for s in w["training_sessions"]:
                d = "2027-04-24" if s["type"] == "Race Day" else s["date"]
                c.execute("""INSERT INTO plan_sessions(goal_id, session_date, original_date, week_number, session_type,
                             discipline, duration_min, intensity_zone, is_optional, effective_duration_min, role)
                             VALUES(1,?,?,?,?,?,?,?,?,?,?)""",
                          (d, d, w["week"], s["type"], get_discipline(s["type"]), s["duration"], s["intensity_zone"],
                           1 if s.get("optional") else 0, s["duration"], s.get("role")))
        rf.reflow_goal(c, 1)
        self.c = c
        self.before = c.execute("SELECT id, session_date, status, schedule_note FROM plan_sessions ORDER BY id").fetchall()

    def tearDown(self):
        rf.date = self._d

    def gyms(self, a, b):
        return self.c.execute("SELECT * FROM plan_sessions WHERE status='pending' AND session_type LIKE 'Strength%' "
                              "AND session_date BETWEEN ? AND ?", (a, b)).fetchall()

    def runs(self, a, b):
        return self.c.execute("SELECT * FROM plan_sessions WHERE status='pending' AND session_type='Running - Easy Run' "
                              "AND session_date BETWEEN ? AND ?", (a, b)).fetchall()

    def test_two_gym_weeks_keep_one(self):
        weeks_with_two = [r[0] for r in self.c.execute(
            "SELECT week_number FROM plan_sessions WHERE status='pending' AND session_type LIKE 'Strength%' "
            "AND session_date >= '2026-11-23' AND session_date < '2027-04-14' GROUP BY week_number HAVING COUNT(*) >= 2")]
        self.assertTrue(weeks_with_two)
        out = gym_runs.set_enabled(self.c, 1, True, TODAY)
        self.assertTrue(out["enabled"])
        self.assertEqual(out["runs"], out["gyms_swapped"])
        for wk in weeks_with_two:
            n = self.c.execute("SELECT COUNT(*) FROM plan_sessions WHERE week_number=? AND status='pending' "
                               "AND session_type LIKE 'Strength%'", (wk,)).fetchone()[0]
            self.assertEqual(n, 1, f"week {wk}")
        run = self.c.execute("SELECT * FROM plan_sessions WHERE schedule_note IS NOT NULL AND role='run' "
                             "AND session_type='Running - Easy Run' ORDER BY session_date LIMIT 1").fetchone()
        self.assertEqual((run["discipline"], run["intensity_zone"]), ("running", "Z2"))
        self.assertIn(run["effective_duration_min"], (30, 35))

    def test_no_gym_in_the_last_ten_days(self):
        gym_runs.set_enabled(self.c, 1, True, TODAY)
        self.assertFalse(self.gyms("2027-04-14", "2027-04-24"))

    def test_off_restores_the_plan_exactly(self):
        gym_runs.set_enabled(self.c, 1, True, TODAY)
        gym_runs.set_enabled(self.c, 1, False, TODAY)
        after = self.c.execute("SELECT id, session_date, status, schedule_note FROM plan_sessions ORDER BY id").fetchall()
        self.assertEqual([(r[0], r[2]) for r in after], [(r[0], r[2]) for r in self.before])

    def test_apply_is_idempotent(self):
        a = gym_runs.set_enabled(self.c, 1, True, TODAY)
        n = self.c.execute("SELECT COUNT(*) FROM plan_sessions").fetchone()[0]
        b = gym_runs.apply(self.c, 1, TODAY)
        self.assertEqual(a, b)
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM plan_sessions").fetchone()[0], n)

    def test_b_race_taper(self):
        self.c.execute("CREATE TABLE b_races (id INTEGER PRIMARY KEY, goal_id INT, name TEXT, race_type TEXT, "
                       "race_date TEXT, start_date TEXT, changes_json TEXT)")
        self.c.execute("INSERT INTO b_races VALUES (1, 1, 'Half marathon', 'half_marathon', '2027-03-21', '2026-11-30', '{}')")
        gym_runs.set_enabled(self.c, 1, True, TODAY)
        self.assertFalse(self.gyms("2027-03-14", "2027-03-21"))


if __name__ == "__main__":
    unittest.main()
