"""Learning plans: week maths, the two-week rule, the Today lane, the robotics seed."""

import sqlite3
import unittest
from datetime import date

from domains.learning import plan as lp
from domains.learning import robotics_seed
from infrastructure.db.migrate_learning import ROBOTICS_START, migrate


def db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    migrate(c)
    return c


def item(week, weeks=1, status="todo"):
    return {"week": week, "weeks": weeks, "status": status}


class WeekMathTest(unittest.TestCase):
    def test_week_of_counts_from_start_monday(self):
        self.assertEqual(lp.week_of("2026-10-26", date(2026, 10, 26)), 1)
        self.assertEqual(lp.week_of("2026-10-26", date(2026, 11, 1)), 1)      # Sunday
        self.assertEqual(lp.week_of("2026-10-26", date(2026, 11, 2)), 2)
        self.assertEqual(lp.week_of("2026-10-26", date(2026, 10, 25)), 0)     # before the start

    def test_item_states_and_two_week_rule(self):
        self.assertEqual(lp.item_state(item(3), 2), "upcoming")
        self.assertEqual(lp.item_state(item(3, weeks=2), 4), "now")
        self.assertEqual(lp.item_state(item(3), 4), "late")
        self.assertEqual(lp.item_state(item(3), 5), "stale")
        self.assertEqual(lp.item_state(item(3, status="done"), 9), "done")
        self.assertEqual(lp.item_state(item(None), 9), "anytime")


class SeedAndDayTest(unittest.TestCase):
    def setUp(self):
        self.c = db()
        self.pid = self.c.execute("SELECT id FROM learning_plans WHERE slug='robotics'").fetchone()[0]

    def test_seed_is_idempotent_and_fills_every_phase(self):
        self.assertIsNone(robotics_seed.seed(self.c, ROBOTICS_START))
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM learning_plans").fetchone()[0], 1)
        phases = self.c.execute("SELECT id, week_from, week_to FROM learning_phases ORDER BY ord").fetchall()
        self.assertEqual(len(phases), len(robotics_seed.PHASES))
        for ph in phases:
            n = self.c.execute("SELECT COUNT(*) FROM learning_items WHERE phase_id=?", (ph["id"],)).fetchone()[0]
            self.assertGreater(n, 0)
        # every scheduled item sits inside the detailed horizon or Robot 2's span
        bad = self.c.execute("SELECT i.title FROM learning_items i JOIN learning_phases p ON p.id = i.phase_id "
                             "WHERE i.week IS NOT NULL AND i.week + i.weeks - 1 > MAX(p.week_to, 26)").fetchall()
        self.assertEqual(bad, [])

    def test_today_lane_week1(self):
        [d] = lp.day(self.c, date(2026, 10, 29))
        self.assertEqual(d["week"], 1)
        self.assertTrue(d["phase"]["title"].startswith("Month 1"))
        self.assertTrue(all(i["state"] == "now" for i in d["due"]))
        self.assertEqual(d["week_total"], len(d["due"]))
        self.assertTrue(any("Multimeter" in i["title"] for i in d["due"]))

    def test_slipped_items_lead_and_time_logged(self):
        wk1 = self.c.execute("SELECT id FROM learning_items WHERE plan_id=? AND week=1 ORDER BY ord",
                             (self.pid,)).fetchall()
        self.c.execute("UPDATE learning_items SET status='done', done_at='2026-11-03' WHERE id=?", (wk1[0][0],))
        self.c.execute("INSERT INTO learning_logs (plan_id, date, minutes) VALUES (?, '2026-11-02', 45)", (self.pid,))
        self.c.execute("INSERT INTO learning_logs (plan_id, date, minutes) VALUES (?, '2026-11-03', 60)", (self.pid,))
        self.c.execute("INSERT INTO learning_logs (plan_id, date, minutes) VALUES (?, '2026-11-01', 30)", (self.pid,))
        [d] = lp.day(self.c, date(2026, 11, 3))                                # week 2, Tuesday
        self.assertEqual(d["week"], 2)
        self.assertEqual(d["due"][0]["state"], "late")                          # week-1 leftovers first
        self.assertNotIn(wk1[0][0], [i["id"] for i in d["due"]])
        self.assertEqual([i["id"] for i in d["done_today"]], [wk1[0][0]])
        self.assertEqual(d["minutes_today"], 60)
        self.assertEqual(d["minutes_week"], 105)                                # Sunday's 30 was week 1

    def test_detail_totals(self):
        out = lp.detail(self.c, self.pid, date(2026, 11, 20))                   # week 4
        self.assertEqual(out["week"], 4)
        self.assertEqual(sum(ph["current"] for ph in out["phases"]), 1)
        self.assertGreater(out["core_total"], 30)
        self.assertGreater(out["behind"], 0)                                    # nothing ticked yet
        self.assertEqual([w["week"] for w in out["hours_by_week"]], [1, 2, 3, 4])


if __name__ == "__main__":
    unittest.main()
