"""Today's "what now?" headline by time of day, and roster fatigue (rest between duties)."""

import sqlite3
import unittest

from domains.aviation.fatigue import _rest_h
from domains.plans.now import now


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE roster (date TEXT PRIMARY KEY, duty_type TEXT, report_time TEXT, end_time TEXT, raw_code TEXT);
        CREATE TABLE race_goals (id INTEGER PRIMARY KEY, status TEXT);
        CREATE TABLE plan_sessions (id INTEGER PRIMARY KEY, goal_id INTEGER, session_date TEXT, session_type TEXT,
            discipline TEXT, duration_min INTEGER, effective_duration_min INTEGER, intensity_zone TEXT, status TEXT,
            is_optional INTEGER DEFAULT 0, rpe_actual INTEGER, completed_activity_id TEXT);
        CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, kind TEXT, due_date TEXT, due_time TEXT, done_at TEXT);
        INSERT INTO race_goals VALUES (1, 'active');
        INSERT INTO roster VALUES ('2026-11-05', 'ground_duty', '09:00', '17:00', 'Dty');
        INSERT INTO roster VALUES ('2026-11-06', 'flying_duty', '05:30', '13:00', 'FlD');
        INSERT INTO roster VALUES ('2026-11-07', 'day_off', NULL, NULL, 'Off');
        INSERT INTO plan_sessions VALUES (1, 1, '2026-11-07', 'Cycling - Long Ride', 'cycling', 150, NULL, 'Z2', 'pending', 0, NULL, NULL);
        INSERT INTO tasks VALUES (1, 'Renew medical', 'task', '2026-11-05', NULL, NULL);
    """)
    return c


class NowTest(unittest.TestCase):
    def test_before_report_then_on_duty(self):
        c = _db()
        h = now(c, "2026-11-05", "07:00")["head"]
        self.assertEqual(h["title"], "Report 09:00")
        self.assertIn("in 2h 00m", h["detail"])
        self.assertEqual(now(c, "2026-11-05", "12:00")["head"]["title"], "On duty until 17:00")

    def test_evening_before_an_early_start(self):
        r = now(_db(), "2026-11-05", "20:00")
        self.assertEqual(r["head"]["title"], "Early start tomorrow")
        self.assertIn("lights out by 21:00", r["head"]["detail"])
        self.assertTrue(any("Renew medical" in n["text"] for n in r["next"]))

    def test_session_on_a_day_off(self):
        h = now(_db(), "2026-11-07", "08:30")["head"]
        self.assertEqual((h["kind"], h["title"]), ("train", "Long Ride"))


class RestTest(unittest.TestCase):
    def test_rest_between_duties(self):
        self.assertEqual(_rest_h("23:45", "06:55"), 7.2)       # late finish → early report
        self.assertEqual(_rest_h("00:30", "14:00"), 13.5)      # finished after midnight
        self.assertIsNone(_rest_h(None, "06:00"))


if __name__ == "__main__":
    unittest.main()
