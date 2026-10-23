"""Garmin workout push: payload shape, targets, and the create/update/remove sync loop."""

import json
import unittest

import domains.health.garmin.workout_push as wp
from domains.training.plan_templates.mallorca_312 import climb_sim, ftp_test, long_ride
from tests.helpers import fake_date, plan_db


def session(sess, sid=1, eff=None, day="2026-12-08"):
    return {"id": sid, "session_type": sess["type"], "discipline": "cycling", "duration_min": sess["duration"],
            "effective_duration_min": eff or sess["duration"], "intensity_zone": sess["intensity_zone"],
            "structure_json": json.dumps(sess["structure"]), "session_date": day}


TG = {"ftp": 230, "hr": {"Z1": (100, 132), "Z2": (134, 147), "Z3": (149, 153), "Z4": (155, 163), "Z5": (165, 175)}}


class PayloadTest(unittest.TestCase):
    def test_trainer_session_gets_watts_and_repeat_group(self):
        w = wp.build_workout(session(climb_sim(3, 15)), TG)
        steps = w["workoutSegments"][0]["workoutSteps"]
        rep = [s for s in steps if s["type"] == "RepeatGroupDTO"][0]
        self.assertEqual(rep["numberOfIterations"], 3)
        work = rep["workoutSteps"][0]
        self.assertEqual(work["targetType"]["workoutTargetTypeKey"], "power.zone")
        self.assertEqual((work["targetValueOne"], work["targetValueTwo"]), (202, 216))   # 88–94% of 230 W
        orders = [steps[0]["stepOrder"], rep["stepOrder"], *[s["stepOrder"] for s in rep["workoutSteps"]]]
        self.assertEqual(len(set(orders)), len(orders))

    def test_outdoor_ride_gets_heart_rate(self):
        w = wp.build_workout(session(long_ride(240)), TG)
        main = w["workoutSegments"][0]["workoutSteps"][1]
        self.assertEqual(main["targetType"]["workoutTargetTypeKey"], "heart.rate.zone")
        self.assertEqual((main["targetValueOne"], main["targetValueTwo"]), (134, 147))

    def test_ftp_test_effort_is_one_uncapped_step(self):
        w = wp.build_workout(session(ftp_test()), TG)
        steps = w["workoutSegments"][0]["workoutSteps"]
        self.assertFalse([s for s in steps if s["type"] == "RepeatGroupDTO"])      # not a repeat ×1
        effort = [s for s in steps if s["stepType"]["stepTypeKey"] == "interval"][0]
        self.assertEqual(effort["endConditionValue"], 20 * 60)
        self.assertEqual(effort["targetType"]["workoutTargetTypeKey"], "no.target")

    def test_trainer_session_without_ftp_says_so(self):
        w = wp.build_workout(session(ftp_test()), {"ftp": None, "hr": TG["hr"]})
        self.assertTrue(w["description"].startswith("Trainer — no FTP yet"))

    def test_shortened_session_trims_the_main_block(self):
        w = wp.build_workout(session(long_ride(240), eff=180), TG)
        total = sum(s["endConditionValue"] for s in w["workoutSegments"][0]["workoutSteps"])
        self.assertEqual(total, 180 * 60)

    def test_gym_is_not_pushed(self):
        self.assertIsNone(wp.build_workout({"id": 1, "session_type": "Strength - Gym (legs + core)",
                                            "discipline": "other", "duration_min": 50,
                                            "effective_duration_min": 50, "intensity_zone": "Z2",
                                            "structure_json": None}, TG))


class FakeGarmin:
    """Older garth-based garminconnect: Garmin.garth.connectapi(path, method=..., json=...)."""
    def __init__(self):
        self.calls, self.next_id = [], 100
        self.garth = self

    def connectapi(self, path, method="GET", json=None):
        self.calls.append((method, path))
        if method == "POST" and path == "/workout-service/workout":
            self.next_id += 1
            return {"workoutId": self.next_id}
        if method == "POST" and path.startswith("/workout-service/schedule/"):
            return {"workoutScheduleId": 9000 + self.next_id}
        return None


class FakeResponse:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body
        self.content = b"{}" if body is not None else b""
        self.text = ""

    def json(self):
        return self._body


class FakeNewClient:
    """garminconnect ≥ 0.3 style: Garmin.client._run_request(method, path, **kw); connectapi is GET-only."""
    def __init__(self):
        self.calls, self.next_id = [], 100

    def _run_request(self, method, path, **kw):
        self.calls.append((method, path))
        if method == "POST" and path == "/workout-service/workout":
            self.next_id += 1
            return FakeResponse(200, {"workoutId": self.next_id})
        if method == "POST" and path.startswith("/workout-service/schedule/"):
            return FakeResponse(200, {"workoutScheduleId": 7})
        return FakeResponse(204)


class FakeNewGarmin:
    def __init__(self):
        self.client = FakeNewClient()

    def connectapi(self, path, **kw):            # the GET-only wrapper that broke on the Pi
        if "method" in kw:
            raise TypeError("Client._run_request() got multiple values for argument 'method'")


class SyncTest(unittest.TestCase):
    def setUp(self):
        self._date = wp.date
        wp.date = fake_date(2026, 12, 7)
        c = plan_db()
        c.execute("CREATE TABLE athlete_zones(valid_from, sport, max_hr, threshold_hr, ftp_w, zones_json)")
        c.execute("INSERT INTO athlete_zones VALUES('2026-12-01','ride',188,165,230,'[]')")
        c.execute("INSERT INTO race_goals(name, race_type, race_date, plan_start_date, available_days) "
                  "VALUES('M312','mallorca_312','2027-04-24','2026-12-07','Mon')")
        s = climb_sim(3, 15)
        c.execute("""INSERT INTO plan_sessions(goal_id, session_date, original_date, week_number, session_type,
                     discipline, duration_min, intensity_zone, effective_duration_min, structure_json)
                     VALUES(1,'2026-12-08','2026-12-08',1,?, 'cycling', ?, ?, ?, ?)""",
                  (s["type"], s["duration"], s["intensity_zone"], s["duration"], json.dumps(s["structure"])))
        self.c, self.g = c, FakeGarmin()

    def tearDown(self):
        wp.date = self._date

    def test_create_then_unchanged_then_move_then_skip(self):
        self.assertEqual(wp.push_upcoming(self.c, self.g, verbose=False)["created"], 1)
        self.assertEqual(wp.push_upcoming(self.c, self.g, verbose=False)["unchanged"], 1)
        self.c.execute("UPDATE plan_sessions SET session_date='2026-12-10'")
        r = wp.push_upcoming(self.c, self.g, verbose=False)
        self.assertEqual(r["updated"], 1)
        self.assertIn(("DELETE", "/workout-service/workout/101"), self.g.calls)
        self.assertIn(("POST", "/workout-service/schedule/102"), self.g.calls)
        self.c.execute("UPDATE plan_sessions SET status='skipped'")
        self.assertEqual(wp.push_upcoming(self.c, self.g, verbose=False)["removed"], 1)
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM garmin_workout_push").fetchone()[0], 0)

    def test_newer_garminconnect_without_garth(self):
        g = FakeNewGarmin()
        r = wp.push_upcoming(self.c, g, verbose=False)
        self.assertEqual((r["created"], r["errors"]), (1, []))
        self.assertIn(("POST", "/workout-service/schedule/101"), g.client.calls)


class RunWorkoutTest(unittest.TestCase):
    TGR = {"ftp": None, "hr": {}, "run_hr": {"Z1": (128, 154), "Z2": (156, 163), "Z5": (183, 194)},
           "run_pace": {"Z5": (round(1000 / (274 * 0.95), 3), round(1000 / (274 * 0.88), 3))},
           "run_threshold_pace": 274}

    def _run(self, kind):
        from domains.training import b_race
        p = {"easy": 349, "tempo": 293, "threshold": 274, "vo2": 255, "race": 285, "race_time_s": 6000}
        s = b_race.easy_run(p, 40) if kind == "easy" else b_race.quality_run(p, 0, False)
        return {"id": 7, "session_type": s["type"], "discipline": "running", "intensity_zone": s["zone"],
                "duration_min": s["duration"], "effective_duration_min": s["duration"],
                "structure_json": json.dumps(s["structure"])}

    def test_easy_run_by_heart_rate(self):
        w = wp.build_workout(self._run("easy"), self.TGR)
        self.assertEqual(w["sportType"]["sportTypeKey"], "running")
        step = w["workoutSegments"][0]["workoutSteps"][0]
        self.assertEqual(step["targetType"]["workoutTargetTypeKey"], "heart.rate.zone")
        self.assertEqual((step["targetValueOne"], step["targetValueTwo"]), (156, 163))

    def test_intervals_by_pace(self):
        w = wp.build_workout(self._run("intervals"), self.TGR)
        rep = next(s for s in w["workoutSegments"][0]["workoutSteps"] if s["type"] == "RepeatGroupDTO")
        work = rep["workoutSteps"][0]
        self.assertEqual(rep["numberOfIterations"], 5)
        self.assertEqual(work["targetType"]["workoutTargetTypeKey"], "pace.zone")
        self.assertLess(work["targetValueOne"], work["targetValueTwo"])          # slower → faster, in m/s
        self.assertTrue(w["workoutName"].startswith("Run · Intervals"))

    def test_race_not_pushed(self):
        self.assertIsNone(wp.build_workout({"id": 9, "session_type": "Race - Half marathon", "discipline": "running",
                                            "intensity_zone": "Z4", "duration_min": 100,
                                            "effective_duration_min": 100, "structure_json": None}, self.TGR))


if __name__ == "__main__":
    unittest.main()
