"""Activity ↔ plan session matching: suggest the better-fitting session, swap without losing the skipped one."""

import json
import sqlite3
import unittest

from domains.training.session_match import suggest, swap


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE activities (id TEXT, date TEXT, activity_type TEXT, moving_time_seconds INT, duration_seconds INT,
            avg_heart_rate INT, max_heart_rate INT);
        CREATE TABLE athlete_zones (sport TEXT, valid_from TEXT, max_hr INT, zones_json TEXT);
        CREATE TABLE plan_sessions (id INTEGER PRIMARY KEY, goal_id INT, session_date TEXT, session_type TEXT,
            discipline TEXT, intensity_zone TEXT, duration_min INT, effective_duration_min INT, status TEXT,
            completed_activity_id TEXT, rpe_actual INT, auto_matched INT, updated_at TEXT);
        CREATE TABLE fueling_logs (id INTEGER PRIMARY KEY, plan_session_id INT, activity_id TEXT);
    """)
    zones = [{"name": "Z1", "min_hr": 0, "max_hr": 132}, {"name": "Z2", "min_hr": 132, "max_hr": 152},
             {"name": "Z3", "min_hr": 152, "max_hr": 166}, {"name": "Z4", "min_hr": 166, "max_hr": 179},
             {"name": "Z5", "min_hr": 179, "max_hr": 999}]
    c.execute("INSERT INTO athlete_zones VALUES ('ride','2026-01-01',195,?)", (json.dumps(zones),))
    # this week (Mon 19 Oct): the Thursday easy ride was auto-linked to a hard 57-min ride
    c.execute("INSERT INTO activities VALUES ('long','2026-10-21','cycling',7182,7223,128,162)")
    c.execute("INSERT INTO activities VALUES ('hard','2026-10-22','cycling',3416,3450,168,189)")
    c.executemany("INSERT INTO plan_sessions VALUES (?,1,?,?,?,?,?,?,?,?,?,?,NULL)", [
        (910, "2026-10-21", "Cycling - Long Ride", "cycling", "Z2", 90, 90, "completed", "long", 8, 1),
        (909, "2026-10-22", "Cycling - Zone 2 Ride", "cycling", "Z2", 45, 45, "completed", "hard", 7, 1),
        (908, "2026-10-23", "Test - Bike 20min FTP test (trainer)", "cycling", "Z4", 55, 55, "pending", None, None, 0),
        (911, "2026-10-19", "Strength - Gym", "other", "Z2", 50, 50, "completed", None, None, 0),
    ])
    c.execute("INSERT INTO fueling_logs VALUES (1, 909, 'hard')")
    return c


class MatchTest(unittest.TestCase):
    def test_hard_ride_suggests_the_z4_session(self):
        m = suggest(_db(), "hard")
        self.assertEqual(m["current"]["id"], 909)
        self.assertEqual(m["suggestion"]["id"], 908)
        self.assertGreater(m["suggestion"]["score"], m["current"]["score"] + 0.2)

    def test_easy_ride_keeps_its_session(self):
        m = suggest(_db(), "long")
        self.assertEqual(m["current"]["id"], 910)
        self.assertIsNone(m["suggestion"])

    def test_swap(self):
        c = _db()
        out = swap(c, "hard", 908)
        self.assertEqual(out, {"linked": 908, "moved": 909, "moved_to": "2026-10-23"})
        test = c.execute("SELECT * FROM plan_sessions WHERE id=908").fetchone()
        easy = c.execute("SELECT * FROM plan_sessions WHERE id=909").fetchone()
        self.assertEqual((test["status"], test["completed_activity_id"], test["session_date"], test["rpe_actual"]),
                         ("completed", "hard", "2026-10-22", 7))
        self.assertEqual((easy["status"], easy["completed_activity_id"], easy["session_date"], easy["rpe_actual"]),
                         ("pending", None, "2026-10-23", None))
        self.assertEqual(c.execute("SELECT plan_session_id FROM fueling_logs").fetchone()[0], 908)
        self.assertIsNone(suggest(c, "hard")["suggestion"])          # settled — no ping-pong

    def test_swap_refuses_taken_session(self):
        with self.assertRaises(ValueError):
            swap(_db(), "hard", 910)


if __name__ == "__main__":
    unittest.main()
