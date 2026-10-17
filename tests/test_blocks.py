"""Camp / tour blocks: plan set aside, tour days pinned and linkable, recovery week after, exact undo."""

import unittest

import domains.training.reflow as rf
from domains.training import blocks
from domains.training.day_context import DayContextReader, today_advice
from domains.training.plan_templates import TEMPLATES
from domains.training.scheduler import generate_plan, get_discipline
from tests.helpers import fake_date, plan_db

ALL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
TAIWAN = [("2026-11-11", 53, 900), ("2026-11-12", 88, 540), ("2026-11-13", 66, 500), ("2026-11-14", 76, 750),
          ("2026-11-15", 78, 525), ("2026-11-17", 84, 860), ("2026-11-18", 125, 1400), ("2026-11-19", 89, 525)]


class BlockTest(unittest.TestCase):
    def setUp(self):
        self._d = rf.date
        rf.date = fake_date(2026, 10, 19)
        c = plan_db()
        c.execute("INSERT INTO race_goals(name, race_type, race_date, plan_start_date, available_days) "
                  "VALUES('M312','mallorca_312','2027-04-24','2026-10-19',?)", (",".join(ALL),))
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
        self.c = c
        self.before = c.execute("SELECT id, session_date, status, effective_duration_min, intensity_zone "
                                "FROM plan_sessions ORDER BY id").fetchall()

    def tearDown(self):
        rf.date = self._d

    def make(self):
        return blocks.create(self.c, 1, "Taiwan", "2026-11-10", "2026-11-21",
                             [{"date": d, "km": km, "climb_m": cl} for d, km, cl in TAIWAN])

    def test_create(self):
        b = self.make()
        self.assertEqual((b["riding_days"], b["total_km"]), (8, 659))
        inside = self.c.execute("SELECT session_type, status FROM plan_sessions WHERE session_date BETWEEN "
                                "'2026-11-10' AND '2026-11-21'").fetchall()
        self.assertTrue(all(r["status"] == "displaced" or r["session_type"] == "Cycling - Tour day" for r in inside))
        big = self.c.execute("SELECT effective_duration_min, role, is_displaced FROM plan_sessions "
                             "WHERE session_type='Cycling - Tour day' AND session_date='2026-11-18'").fetchone()
        self.assertEqual((big["effective_duration_min"], big["role"], big["is_displaced"]), (420, "long", 1))  # 125 km/1400 m ≈ 7 h
        after = self.c.execute("SELECT intensity_zone, effective_duration_min, session_type FROM plan_sessions "
                               "WHERE session_date BETWEEN '2026-11-22' AND '2026-11-28' AND status='pending'").fetchall()
        self.assertTrue(after)
        for r in after:
            if not r["session_type"].startswith("Strength"):
                self.assertIn(r["intensity_zone"], ("Z1", "Z2"))
                self.assertLessEqual(r["effective_duration_min"], 120)

    def test_replan_leaves_the_block_alone(self):
        self.make()
        rf.reflow_goal(self.c, 1)
        inside = self.c.execute("SELECT session_type FROM plan_sessions WHERE status='pending' AND session_date "
                                "BETWEEN '2026-11-10' AND '2026-11-21'").fetchall()
        self.assertEqual({r["session_type"] for r in inside}, {"Cycling - Tour day"})
        self.assertEqual(len(inside), 8)
        ctx = DayContextReader(self.c).context("2026-11-18")
        self.assertIn("Taiwan", ctx["label"])
        self.assertIn("Z2", today_advice(ctx, {"effective_duration_min": 420, "intensity_zone": "Z2"})["notes"][0])

    def test_delete_restores_exactly(self):
        b = self.make()
        blocks.delete(self.c, b["id"])
        after = self.c.execute("SELECT id, session_date, status, effective_duration_min, intensity_zone "
                               "FROM plan_sessions ORDER BY id").fetchall()
        self.assertEqual([tuple(r) for r in after], [tuple(r) for r in self.before])

    def test_no_overlapping_blocks(self):
        self.make()
        with self.assertRaises(ValueError):
            blocks.create(self.c, 1, "Other", "2026-11-20", "2026-11-25", [])


if __name__ == "__main__":
    unittest.main()
