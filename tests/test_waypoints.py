import json
import unittest
from datetime import date

from domains.health import weight_trend
from domains.training import waypoints
from infrastructure.db import oneoff_ftp_retest
from infrastructure.db.migrate_plan_session_structure import migrate as migrate_structure
from infrastructure.db.migrate_race_targets import migrate as migrate_targets
from tests.helpers import plan_db

TEST = "Test - Bike 20min FTP test (trainer)"


class WeightTrendTest(unittest.TestCase):
    def test_trend_smooths_noise_and_rate_is_weekly(self):
        # −0.5 kg/week with ±0.8 kg daily noise, every 3 days for 6 weeks
        entries = [{"date": date.fromordinal(date(2026, 9, 1).toordinal() + i * 3).isoformat(),
                    "weight_kg": round(85 - 0.5 * i * 3 / 7 + (0.8 if i % 2 else -0.8), 1)} for i in range(15)]
        tr = weight_trend.trend(entries)
        raw_swing = max(abs(b["weight_kg"] - a["weight_kg"]) for a, b in zip(entries, entries[1:]))
        trend_swing = max(abs(b - a) for a, b in zip(tr, tr[1:]))
        self.assertLess(trend_swing, raw_swing / 2)
        rate = weight_trend.rate_kg_week(entries, date(2026, 10, 13))
        self.assertAlmostEqual(rate, -0.5, delta=0.1)

    def test_goal_verdict_and_wkg(self):
        goal = {"start_date": "2026-10-05", "start_kg": 84.6, "target_kg": 79.5, "target_date": "2027-04-03",
                "target_ftp_w": 220}
        # only the start weigh-in: a gap in weighing is not falling behind
        a = weight_trend.analyse([{"date": "2026-10-05", "weight_kg": 84.6}], goal, 193, today=date(2026, 12, 1))
        self.assertEqual(a["goal"]["status"], "on_track")
        entries = [{"date": "2026-10-05", "weight_kg": 84.6}, {"date": "2026-12-01", "weight_kg": 84.6}]
        a = weight_trend.analyse(entries, goal, 193, today=date(2026, 12, 1))
        self.assertEqual(a["goal"]["status"], "behind")          # no loss in 2 months
        self.assertLess(a["goal"]["needed_kg_week"], 0)
        self.assertEqual(a["wkg"]["now"], round(193 / 84.6, 2))
        self.assertEqual(a["wkg"]["target"], round(220 / 79.5, 2))


class WaypointsTest(unittest.TestCase):
    def setUp(self):
        c = self.c = plan_db()
        migrate_structure(c)
        migrate_targets(c)
        c.executescript("""
            CREATE TABLE weight_log (date TEXT PRIMARY KEY, weight_kg REAL, note TEXT);
            CREATE TABLE athlete_zones (valid_from TEXT, sport TEXT, ftp_w REAL);
        """)
        c.execute("""INSERT INTO race_goals (id, name, race_type, race_date, plan_start_date, available_days)
                     VALUES (10, 'Mallorca 312', 'mallorca_312', '2027-04-24', '2026-10-19', 'Monday')""")
        for sid, d, st in ((908, "2026-10-23", "completed"), (939, "2026-11-30", "pending"), (990, "2027-01-25", "pending")):
            c.execute("""INSERT INTO plan_sessions (id, goal_id, session_date, original_date, week_number, session_type,
                         discipline, duration_min, intensity_zone, status, structure_json)
                         VALUES (?, 10, ?, ?, 1, ?, 'cycling', 55, 'Z4', ?, '[]')""", (sid, d, d, TEST, st))
        c.execute("INSERT INTO benchmark_results (date, sport, test_type, result_json, derived_json, session_id) "
                  "VALUES ('2026-10-23','ride','bike_20min','{}', ?, 908)", (json.dumps({"ftp_w": 193}),))
        c.execute("INSERT INTO athlete_zones VALUES ('2026-10-23','ride',193)")
        c.execute("INSERT INTO weight_log VALUES ('2026-10-05', 84.6, NULL)")
        c.commit()

    def test_no_targets_no_waypoints(self):
        self.assertIsNone(waypoints.waypoints(self.c, 10))

    def test_oneoff_retest_then_waypoints(self):
        oneoff_ftp_retest.run(self.c)
        oneoff_ftp_retest.run(self.c)    # idempotent
        rows = self.c.execute("SELECT id, session_date, session_type, status, structure_json FROM plan_sessions "
                              "ORDER BY session_date").fetchall()
        tests = [r for r in rows if r["session_type"] == TEST]
        self.assertEqual([r["session_date"] for r in tests], ["2026-10-25", "2026-11-30", "2027-01-25"])
        self.assertTrue(all(any(s["label"] == "Calibrate" for s in json.loads(r["structure_json"])) for r in tests))
        old = next(r for r in rows if r["id"] == 908)
        self.assertEqual((old["session_type"], old["status"]), ("Cycling - Threshold (trainer)", "completed"))
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM benchmark_results").fetchone()[0], 0)

        wp = waypoints.waypoints(self.c, 10)
        self.assertEqual(wp["targets"]["target_ftp_w"], 220)
        self.assertEqual(wp["targets"]["start_ftp_w"], 193)     # provisional FTP until Sunday's test
        pts = wp["points"]
        self.assertEqual([p["kind"] for p in pts], ["test", "test", "test", "goal"])
        self.assertLess(pts[0]["target_ftp_w"], pts[2]["target_ftp_w"])
        self.assertGreater(pts[0]["target_kg"], pts[2]["target_kg"])
        self.assertEqual((pts[-1]["date"], pts[-1]["target_ftp_w"], pts[-1]["target_kg"]), ("2027-04-03", 220, 79.5))

        # Sunday's result shows up as the actual for that waypoint
        sunday = next(r["id"] for r in tests if r["session_date"] == "2026-10-25")
        self.c.execute("INSERT INTO benchmark_results (date, sport, test_type, result_json, derived_json, session_id) "
                       "VALUES ('2026-10-25','ride','bike_20min','{}', ?, ?)", (json.dumps({"ftp_w": 205}), sunday))
        p0 = waypoints.waypoints(self.c, 10)["points"][0]
        self.assertEqual(p0["ftp_w"], 205)


if __name__ == "__main__":
    unittest.main()
