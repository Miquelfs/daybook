"""GPX courses (climbing, tunnel correction, time) and tour blocks built from them (structure, undo, projection)."""

import json
import sqlite3
import unittest
from datetime import date

from domains.training import blocks, gpx_course


def _gpx(name: str, km: float, profile) -> str:
    """A straight north-going course; `profile(x_km) -> elevation`, a point every 25 m."""
    pts = []
    n = int(km * 40)
    for i in range(n + 1):
        x = i / 40
        pts.append(f'<trkpt lat="{24.0 + x / 110.54:.6f}" lon="121.6"><ele>{profile(x):.1f}</ele></trkpt>')
    return ('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">'
            f"<metadata><name>{name}</name></metadata><trk><name>{name}</name><trkseg>{''.join(pts)}</trkseg></trk></gpx>")


def hill_and_tunnel(x: float) -> float:
    if 10 <= x < 15:                    # a real 5 km climb at 4 %: +200 m
        return 20 + (x - 10) * 40
    if 15 <= x < 20:                    # back down
        return 220 - (x - 15) * 40
    if 30 <= x < 32:                    # a coastal tunnel: the map climbs 300 m at 30 % and drops straight back
        return 20 + (1 - abs(x - 31)) * 300
    return 20.0


class CourseTest(unittest.TestCase):
    def test_tunnel_removed_real_climb_kept(self):
        c = gpx_course.parse(_gpx("Coast", 50, hill_and_tunnel))
        self.assertEqual(c["name"], "Coast")
        self.assertAlmostEqual(c["km"], 50, delta=0.3)
        self.assertAlmostEqual(c["climb_raw_m"], 500, delta=15)      # what Garmin would show
        self.assertAlmostEqual(c["climb_m"], 200, delta=15)          # the real climb only
        self.assertEqual(len(c["tunnels"]), 1)
        self.assertAlmostEqual(c["tunnels"][0]["from_km"], 30, delta=0.3)
        self.assertEqual([(x["km"], round(x["gain_m"], -1)) for x in c["climbs"]], [(10, 200)])
        flat_h = 40 / 21.5 + 5 / 12.5 + 5 / 30.0                   # flat, the 4 % climb, the descent
        self.assertAlmostEqual(c["minutes"], flat_h * 60, delta=3)
        steps = gpx_course.structure(c, "Coast")
        self.assertEqual(sum(s["duration_min"] for s in steps), c["minutes"])
        self.assertEqual([s["zone"] for s in steps], ["Z2", "Z3", "Z2"])

    def test_bad_gpx(self):
        with self.assertRaises(ValueError):
            gpx_course.parse('<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg></trkseg></trk></gpx>')


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE race_goals (id INTEGER PRIMARY KEY, name TEXT, plan_start_date TEXT);
        CREATE TABLE plan_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id INT, session_date TEXT,
            original_date TEXT, week_number INT, session_type TEXT, discipline TEXT, duration_min INT,
            intensity_zone TEXT, is_optional INT DEFAULT 0, is_displaced INT DEFAULT 0, effective_duration_min INT,
            status TEXT DEFAULT 'pending', completed_activity_id TEXT, rpe_actual INT, notes TEXT,
            structure_json TEXT, schedule_note TEXT, role TEXT);
        CREATE TABLE training_load_daily (date TEXT, sport TEXT, ctl REAL, atl REAL);
    """)
    c.execute("INSERT INTO race_goals VALUES (10, 'Mallorca 312', '2026-10-19')")
    c.executemany("INSERT INTO plan_sessions (goal_id, session_date, original_date, week_number, session_type, "
                  "discipline, duration_min, intensity_zone, effective_duration_min) VALUES (10,?,?,4,?,?,?,?,?)", [
        ("2026-11-14", "2026-11-14", "Cycling - Long Ride", "cycling", 165, "Z2", 165),
        ("2026-11-21", "2026-11-21", "Cycling - Sweet Spot", "cycling", 70, "Z3", 70),
    ])
    c.execute("INSERT INTO training_load_daily VALUES ('2026-11-10', 'combined', 30, 30)")
    return c


class TourBlockTest(unittest.TestCase):
    def test_gpx_days_projection_and_undo(self):
        c = _db()
        gpx = _gpx("Taiwan Day1", 50, hill_and_tunnel)
        b = blocks.create(c, 10, "Taiwan", "2026-11-11", "2026-11-17",
                          [{"date": "2026-11-12", "gpx": gpx}, {"date": "2026-11-13", "km": 60, "climb_m": 400}]
                          + [{"date": f"2026-11-{d}", "gpx": gpx} for d in (14, 15, 16, 17)])
        day1 = b["ride_days"][0]
        self.assertEqual(day1["course"]["name"], "Taiwan Day1")
        self.assertAlmostEqual(day1["course"]["climb_m"], 200, delta=15)
        self.assertIsNone(b["ride_days"][1]["course"])               # typed-in day still works
        s = c.execute("SELECT * FROM plan_sessions WHERE id=?", (day1["session_id"],)).fetchone()
        self.assertEqual(s["effective_duration_min"], blocks.course_for(c, s["id"])["minutes"])
        self.assertIn("Climb at km 10", s["structure_json"])
        self.assertNotIn("gpx", c.execute("SELECT days_json FROM training_blocks").fetchone()[0])
        self.assertEqual(c.execute("SELECT status FROM plan_sessions WHERE session_date='2026-11-14'").fetchone()[0],
                         "displaced")
        p = blocks.projection(c, c.execute("SELECT * FROM training_blocks").fetchone(), today=date(2026, 11, 10))
        self.assertEqual(p["before"]["fitness"], 30)
        self.assertGreater(p["block_tss"], 150)
        self.assertGreater(p["after_block"]["fitness"], p["before"]["fitness"])
        self.assertLess(p["after_block"]["form"], 0)                 # carrying the tour's fatigue
        self.assertGreater(p["after_recovery"]["form"], p["after_block"]["form"])
        blocks.delete(c, b["id"])
        self.assertEqual(c.execute("SELECT COUNT(*) FROM session_courses").fetchone()[0], 0)
        self.assertEqual(c.execute("SELECT status FROM plan_sessions WHERE session_date='2026-11-14'").fetchone()[0],
                         "pending")


class AfterTheTripTest(unittest.TestCase):
    def _block(self):
        c = _db()
        c.execute("ALTER TABLE training_load_daily ADD COLUMN daily_tss REAL")
        gpx = _gpx("Taiwan Day1", 50, hill_and_tunnel)
        b = blocks.create(c, 10, "Taiwan", "2026-11-11", "2026-11-17",
                          [{"date": f"2026-11-{d}", "gpx": gpx} for d in (12, 13, 14, 15, 16, 17)])
        return c, b

    def _sweet_spot(self, c):
        return c.execute("SELECT effective_duration_min, intensity_zone, schedule_note FROM plan_sessions "
                         "WHERE session_date='2026-11-21'").fetchone()

    def test_provisional_then_settled_on_real_load(self):
        c, b = self._block()
        self.assertEqual(b["recovery"]["level"], "provisional")
        self.assertEqual(tuple(self._sweet_spot(c))[:2], (42, "Z2"))                # standard: 70 × 0.6
        self.assertIsNone(blocks.settle(c, c.execute("SELECT * FROM training_blocks").fetchone(),
                                        today=date(2026, 11, 17)))                 # not back yet
        # rode much more than planned and came back at form −60
        for i, d in enumerate(range(12, 18)):
            c.execute("INSERT INTO training_load_daily VALUES (?, 'combined', ?, ?, 300)",
                      (f"2026-11-{d}", 35 + i, 60 + 15 * i))
        out = blocks.settle(c, c.execute("SELECT * FROM training_blocks").fetchone(), today=date(2026, 11, 18))
        self.assertEqual(out["level"], "deep")
        self.assertEqual(out["actual_tss"], 1800)
        self.assertEqual(tuple(self._sweet_spot(c))[:2], (35, "Z2"))                # deep: 70 × 0.5
        self.assertIn("Deep recovery", self._sweet_spot(c)[2])
        self.assertIsNone(blocks.settle(c, c.execute("SELECT * FROM training_blocks").fetchone(),
                                        today=date(2026, 11, 19)))                 # once only
        blocks.delete(c, b["id"])
        self.assertEqual(tuple(self._sweet_spot(c))[:2], (70, "Z3"))                # undo restores the plan

    def test_light_when_the_trip_was_easy(self):
        self.assertEqual(blocks.recovery_level(-12, 500, 1100), "light")
        self.assertEqual(blocks.recovery_level(-30, 1000, 1100), "standard")
        self.assertEqual(blocks.recovery_level(None, 1000, 1100), "standard")
        self.assertEqual(blocks.recovery_level(-50, 1000, 1100), "deep")

    def test_replace_route(self):
        c, b = self._block()
        sid = b["ride_days"][2]["session_id"]
        flat = _gpx("Rest-ish loop", 30, lambda x: 10.0)
        out = blocks.replace_course(c, sid, flat)
        day = next(d for d in out["ride_days"] if d["session_id"] == sid)
        self.assertEqual(day["course"]["name"], "Rest-ish loop")
        self.assertEqual(day["course"]["climb_m"], 0)
        s = c.execute("SELECT effective_duration_min, structure_json FROM plan_sessions WHERE id=?", (sid,)).fetchone()
        self.assertAlmostEqual(s[0], 30 / 21.5 * 60, delta=2)
        self.assertNotIn("Climb", s[1])
        self.assertIn({"date": "2026-11-14", "km": day["course"]["km"], "climb_m": 0, "note": "Rest-ish loop",
                       "optional": False}, out["days"])
        self.assertLess(json.loads(c.execute("SELECT changes_json FROM training_blocks").fetchone()[0])["planned_tss"],
                        6 * 120)
        c.execute("UPDATE plan_sessions SET status='completed' WHERE id=?", (sid,))
        with self.assertRaises(ValueError):
            blocks.replace_course(c, sid, flat)


if __name__ == "__main__":
    unittest.main()
