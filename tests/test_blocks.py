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

    def test_travel_days(self):
        b = blocks.create(self.c, 1, "Taiwan", "2026-11-12", "2026-11-17",
                          [{"date": d, "km": km, "climb_m": cl} for d, km, cl in TAIWAN if "2026-11-12" <= d <= "2026-11-17"])
        b = blocks.set_travel(self.c, b["id"], [{"date": "2026-11-09", "mode": "z2"}, {"date": "2026-11-10", "mode": "rest"},
                                                {"date": "2026-11-11", "mode": "rest"}])
        self.assertEqual((b["start_date"], b["riding_start"], len(b["travel"])), ("2026-11-09", "2026-11-12", 3))
        early = self.c.execute("SELECT session_type, intensity_zone, effective_duration_min FROM plan_sessions "
                               "WHERE status='pending' AND session_date BETWEEN '2026-11-09' AND '2026-11-11'").fetchall()
        self.assertEqual([tuple(r) for r in early], [(blocks.TRAVEL_TYPE, "Z2", blocks.TRAVEL_Z2_MIN)])
        with self.assertRaises(ValueError):                       # a riding day can't be a travel day
            blocks.set_travel(self.c, b["id"], [{"date": "2026-11-12", "mode": "rest"}])
        b = blocks.set_travel(self.c, b["id"], [])                # back to the plain block
        self.assertEqual(b["start_date"], "2026-11-12")
        blocks.delete(self.c, b["id"])
        after = self.c.execute("SELECT id, session_date, status, effective_duration_min, intensity_zone "
                               "FROM plan_sessions ORDER BY id").fetchall()
        self.assertEqual([tuple(r) for r in after], [tuple(r) for r in self.before])

    def test_replan_leaves_travel_days_alone(self):
        b = blocks.create(self.c, 1, "Taiwan", "2026-11-12", "2026-11-17", [{"date": "2026-11-12", "km": 50, "climb_m": 900}])
        blocks.set_travel(self.c, b["id"], [{"date": "2026-11-09", "mode": "z2"}, {"date": "2026-11-10", "mode": "rest"}])
        rf.reflow_goal(self.c, 1)
        early = self.c.execute("SELECT session_type FROM plan_sessions WHERE status='pending' AND session_date "
                               "BETWEEN '2026-11-09' AND '2026-11-11'").fetchall()
        self.assertEqual([r[0] for r in early], [blocks.TRAVEL_TYPE])

    def test_no_overlapping_blocks(self):
        self.make()
        with self.assertRaises(ValueError):
            blocks.create(self.c, 1, "Other", "2026-11-20", "2026-11-25", [])



class RecoveryWeekKeyWorkTest(BlockTest):
    """The Puig Major climb after Taiwan: cut to 60 % Z2 for the recovery week, then left cut after it moved."""

    def puig(self):
        return self.c.execute("SELECT * FROM plan_sessions WHERE session_type LIKE '%Puig Major%' "
                              "AND week_number=6").fetchone()

    def test_no_key_work_in_the_recovery_week(self):
        self.make()
        ctx = DayContextReader(self.c).context("2026-11-24")
        self.assertFalse(ctx["intense_ok"])
        self.assertIn("easy week after Taiwan", ctx["label"])
        self.assertTrue(DayContextReader(self.c).context("2026-11-29")["intense_ok"])

    def test_cut_key_session_moved_past_the_recovery_week_is_ridden_in_full(self):
        self.make()
        p = self.puig()
        self.assertLess(p["effective_duration_min"], p["duration_min"])          # cut for the recovery week
        self.assertEqual(p["intensity_zone"], "Z2")
        rf.date = fake_date(2026, 11, 23)
        rf.reflow_goal(self.c, 1)
        p = self.puig()
        self.assertEqual(p["session_date"], "2026-11-29")                        # first day after the easy week
        self.assertEqual((p["effective_duration_min"], p["intensity_zone"], p["eff_override"]),
                         (p["duration_min"], "Z3", None))

    def test_restore_a_cut_left_behind(self):
        """What happened on the Pi: set aside while the recovery was resized, so it kept the provisional cut."""
        from domains.training.restore import recovery_windows, restore_full
        self.make()
        p = self.puig()
        self.c.execute("UPDATE training_blocks SET changes_json=json_set(changes_json, '$.recovery', json('[]'))")
        self.c.execute("UPDATE plan_sessions SET session_date='2026-11-23', status='pending', structure_json=? WHERE id=?",
                       ('[{"kind":"steady","zone":"Z1","duration_min":15},{"kind":"intervals","work_zone":"Z3",'
                        '"rest_zone":"Z1","reps":2,"work_min":12}]', p["id"]))
        rf.date = fake_date(2026, 11, 23)
        out = restore_full(self.c, p["id"])
        self.assertEqual((out["effective_duration_min"], out["intensity_zone"]), (p["duration_min"], "Z3"))
        p = self.puig()
        self.assertEqual(p["session_date"], "2026-11-29")
        self.assertNotIn(p["id"], recovery_windows(self.c)[0]["entries"])

    def test_resizing_the_recovery_also_restores_set_aside_sessions(self):
        self.make()
        p = self.puig()
        self.c.execute("UPDATE plan_sessions SET status='displaced', schedule_note='No free slot this week' WHERE id=?",
                       (p["id"],))
        import json as _j
        ch = _j.loads(self.c.execute("SELECT changes_json FROM training_blocks").fetchone()[0])
        blocks._restore_recovery(self.c, ch["recovery"])
        p = self.puig()
        self.assertEqual((p["effective_duration_min"], p["intensity_zone"], p["status"], p["schedule_note"]),
                         (p["duration_min"], "Z3", "displaced", "No free slot this week"))


if __name__ == "__main__":
    unittest.main()
