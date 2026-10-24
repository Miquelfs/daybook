"""Trainer sessions → Intervals.icu workout text (→ MyWhoosh), and the idempotent push."""

import json
import sqlite3
import unittest
from datetime import date, timedelta

from domains.health import intervals_push as ip
from domains.health.garmin.workout_push import trimmed_structure
from domains.training.plan_templates.mallorca_312 import ftp_test


def session(stype, structure, minutes, day=None, sid=1, zone="Z3", discipline="cycling"):
    return {"id": sid, "session_type": stype, "discipline": discipline, "intensity_zone": zone,
            "duration_min": minutes, "effective_duration_min": minutes, "structure_json": json.dumps(structure),
            "session_date": day or date.today().isoformat()}


CLIMB = [{"kind": "steady", "label": "Warm-up", "duration_min": 15, "zone": "Z1"},
         {"kind": "intervals", "label": "Seated climbing 3× 20min", "reps": 3, "work_min": 20, "rest_min": 6,
          "work_zone": "Z3", "rest_zone": "Z1", "cue": "88–92% FTP in ERG, cadence 70–80 to mimic the climb"},
         {"kind": "steady", "label": "Cool-down", "duration_min": 10, "zone": "Z1"}]


class WorkoutTextTest(unittest.TestCase):
    def test_ftp_test_is_uncapped_and_calibrated(self):
        t = ftp_test()
        text, mins = ip.build_text(session(t["type"], t["structure"], t["duration"]))
        self.assertEqual(mins, 62)
        self.assertIn("- Test all out 20m freeride", text)
        self.assertRegex(text, r"- Calibrate stop pedalling run the spindown 2m \d+%")
        self.assertNotIn("+5", text)     # the pacing cue's numbers never leak into steps

    def test_repeats_cadence_and_clean_prompts(self):
        text, _ = ip.build_text(session("Cycling - Puig Major Climb Sim (trainer)", CLIMB, 103))
        lines = text.splitlines()
        self.assertIn("3x", lines)
        self.assertIn("- Seated climbing 20m 91% 70-80rpm", lines)
        self.assertIn("- Recovery 6m 48%", lines)

    def test_only_trainer_rides(self):
        self.assertIsNone(ip.build_text(session("Cycling - Long Ride", CLIMB, 103)))
        self.assertIsNone(ip.build_text(session("Running - Intervals (trainer)", CLIMB, 60, discipline="running")))

    def test_prompt_strips_syntax(self):
        self.assertEqual(ip.prompt("2× 8min @ FTP"), "FTP")
        self.assertEqual(ip.prompt("Ramp 5x freeride"), "Ride")

    def test_short_session_drops_repeats(self):
        s = session("Cycling - Puig Major Climb Sim (trainer)", CLIMB, 54)
        st, eff = trimmed_structure(s)
        total = sum(x.get("duration_min") or x["reps"] * (x["work_min"] + x["rest_min"]) for x in st)
        self.assertEqual(eff, 54)
        self.assertLessEqual(total, 54 + 26)            # within one repeat of the target
        self.assertEqual(st[1]["reps"], 2)
        self.assertEqual(st[0]["duration_min"], 5)


class FakeClient:
    def __init__(self):
        self.events, self.calls, self.n = {}, [], 0

    def create(self, ev):
        self.n += 1
        self.events[str(self.n)] = ev
        self.calls.append("create")
        return str(self.n)

    def update(self, eid, ev):
        self.calls.append("update")
        if eid not in self.events:
            return False
        self.events[eid] = ev
        return True

    def delete(self, eid):
        self.calls.append("delete")
        self.events.pop(eid, None)


class PushTest(unittest.TestCase):
    def setUp(self):
        c = self.c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.executescript("""
            CREATE TABLE race_goals (id INTEGER PRIMARY KEY, status TEXT);
            CREATE TABLE plan_sessions (id INTEGER PRIMARY KEY, goal_id INT, session_date TEXT, session_type TEXT,
              discipline TEXT, duration_min INT, effective_duration_min INT, intensity_zone TEXT, status TEXT,
              structure_json TEXT);
            CREATE TABLE athlete_zones (valid_from TEXT, sport TEXT, ftp_w REAL);
            INSERT INTO race_goals VALUES (10, 'active');
            INSERT INTO athlete_zones VALUES ('2026-10-23', 'ride', 193);
        """)
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        t = ftp_test()
        for sid, stype, st, mins in ((1, t["type"], t["structure"], 62),
                                     (2, "Cycling - Puig Major Climb Sim (trainer)", CLIMB, 103),
                                     (3, "Cycling - Long Ride", CLIMB, 103)):
            c.execute("INSERT INTO plan_sessions VALUES (?,10,?,?, 'cycling', ?, ?, 'Z3', 'pending', ?)",
                      (sid, tomorrow, stype, mins, mins, json.dumps(st)))
        self.api = FakeClient()

    def push(self):
        return ip.push_upcoming(self.c, client=self.api, verbose=False)

    def test_create_then_unchanged_update_and_remove(self):
        self.assertEqual(self.push()["created"], 2)                 # the long ride stays outdoors
        ev = next(e for e in self.api.events.values() if "Test" in e["name"])
        self.assertEqual((ev["category"], ev["type"], ev["moving_time"]), ("WORKOUT", "Ride", 62 * 60))
        self.assertTrue(ev["start_date_local"].endswith("T00:00:00"))
        self.assertIn("Daybook FTP 193 W", ev["description"])

        self.assertEqual(self.push()["unchanged"], 2)
        self.c.execute("UPDATE plan_sessions SET effective_duration_min=54 WHERE id=2")
        self.assertEqual(self.push()["updated"], 1)
        self.c.execute("UPDATE plan_sessions SET status='skipped' WHERE id=2")
        self.assertEqual(self.push()["removed"], 1)
        self.assertEqual(len(self.api.events), 1)

    def test_deleted_on_intervals_is_recreated(self):
        self.push()
        self.api.events.clear()                                     # removed by hand on Intervals
        self.c.execute("UPDATE plan_sessions SET effective_duration_min=50 WHERE id=1")
        s = self.push()
        self.assertEqual(s["created"], 1)
        self.assertEqual(len(self.api.events), 1)

    def test_completed_sessions_are_left_alone(self):
        self.push()
        self.c.execute("UPDATE plan_sessions SET status='completed' WHERE id=1")
        self.assertEqual(self.push()["removed"], 0)


if __name__ == "__main__":
    unittest.main()
