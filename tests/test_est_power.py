"""Estimated ride power (physics + trainer-learned HR line) and the plan streak around a session."""

import sqlite3
import unittest

from domains.training import est_power as ep
from domains.training.plan_streak import for_activity


class PhysicsTest(unittest.TestCase):
    def test_climb_matches_hand_calculation(self):
        # 95 kg system, 5 % at 15 km/h, still air: gravity + rolling ≈ 213.6 W, air ≈ 14.2 W, ÷ 0.975
        v = 15 / 3.6
        p = ep.physics([v] * 10, [5.0] * 10, [0.0] * 10, [15.0] * 10, [0.0] * 10, 95.0)
        self.assertAlmostEqual(p[-1], 233.4, delta=3)
        # the per-climb shortcut agrees with the per-second model
        self.assertAlmostEqual(ep.climb_watts(250, 5.0, 5000 / v, 95.0), p[-1], delta=5)

    def test_headwind_costs_watts_and_coasting_is_zero(self):
        v = 30 / 3.6
        still = ep.physics([v] * 10, [0.0] * 10, None, None, [0.0] * 10, 95.0)[-1]
        head = ep.physics([v] * 10, [0.0] * 10, None, None, [20.0] * 10, 95.0)[-1]
        self.assertGreater(head, still * 1.4)
        self.assertEqual(ep.physics([v] * 10, [-6.0] * 10, None, None, [0.0] * 10, 95.0)[-1], 0.0)


class HrLineTest(unittest.TestCase):
    def test_fit_recovers_the_line(self):
        blocks = [(hr, -120 + 1.9 * hr + (3 if hr % 2 else -3)) for hr in range(100, 180, 2)]
        m = ep.fit(blocks)
        self.assertAlmostEqual(m["b"], 1.9, delta=0.05)
        self.assertAlmostEqual(m["a"], -120, delta=5)
        self.assertGreater(m["r2"], 0.95)

    def test_too_few_blocks(self):
        self.assertIsNone(ep.fit([(120, 100)] * 5))


class PlanStreakTest(unittest.TestCase):
    def _db(self, statuses):
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.execute("CREATE TABLE race_goals (id INTEGER PRIMARY KEY, name TEXT)")
        c.execute("""CREATE TABLE plan_sessions (id INTEGER PRIMARY KEY, goal_id INTEGER, session_date TEXT,
                     status TEXT, is_optional INTEGER, completed_activity_id TEXT)""")
        c.execute("INSERT INTO race_goals VALUES (1, 'Mallorca 312')")
        for i, (st, opt) in enumerate(statuses):
            c.execute("INSERT INTO plan_sessions VALUES (?,1,?,?,?,?)",
                      (i + 1, f"2026-10-{10 + i:02d}", st, opt, f"a{i}" if st == "completed" else None))
        return c

    def test_streak_breaks_on_a_miss_not_on_an_optional(self):
        c = self._db([("completed", 0), ("skipped", 0), ("completed", 0), ("pending", 1), ("displaced", 0),
                      ("completed", 0)])
        s = for_activity(c, "a5")
        self.assertEqual(s["streak"], 2)
        self.assertEqual((s["done_4w"], s["planned_4w"]), (3, 4))


if __name__ == "__main__":
    unittest.main()
