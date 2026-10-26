"""The plan card, the session cues and the watch targets must read the same run zones.

They once drifted apart: the card's run table put threshold at Z3, so an easy run
said 5:15/km on the card while its cue and the Garmin target said ~5:48/km. Now the
card and the cues both read b_race.PACE_MULT; the Garmin bands are ranges, so they
are held to it here.
"""

import unittest

from domains.health.garmin import workout_push
from domains.training import b_race


class RunPaceScaleTest(unittest.TestCase):
    def test_cues_use_the_scale(self):
        conn = __import__("sqlite3").connect(":memory:")
        t = b_race.threshold_pace(conn)
        p = b_race.paces(conn, "half_marathon")
        self.assertEqual((p["easy"], p["tempo"], p["threshold"], p["vo2"]),
                         tuple(t * b_race.PACE_MULT[z] for z in ("Z2", "Z3", "Z4", "Z5")))

    def test_garmin_pace_bands_hold_the_scale(self):
        for zone, (slow, fast) in workout_push.RUN_PACE_X.items():
            self.assertTrue(fast <= b_race.PACE_MULT[zone] <= slow, zone)

    def test_threshold_is_z4_and_easy_is_easy(self):
        self.assertEqual(b_race.PACE_MULT["Z4"], 1.0)
        self.assertGreaterEqual(b_race.PACE_MULT["Z2"], 1.2)    # easy ≥ 20% slower than threshold
        mults = [b_race.PACE_MULT[z] for z in ("Z1", "Z2", "Z3", "Z4", "Z5")]
        self.assertEqual(mults, sorted(mults, reverse=True))     # each zone faster than the last


class LiveCuesTest(unittest.TestCase):
    """Cues never store a pace — a new threshold must reach sessions already in the plan."""

    def setUp(self):
        import sqlite3
        self.conn = sqlite3.connect(":memory:")
        self.p = {**b_race.paces(self.conn, "half_marathon"), "race_token": b_race.race_token("half_marathon")}

    def test_generated_runs_store_no_pace(self):
        import json
        sessions = [b_race.easy_run(self.p, 40, strides=True), b_race.long_run(self.p, 90, race_finish=20)]
        sessions += [b_race.quality_run(self.p, i, late) for i in range(3) for late in (False, True)]
        for s in sessions:
            self.assertNotRegex(json.dumps(s["structure"]), r"\d:\d\d/km", s["type"])

    def test_race_pace_renders_from_todays_threshold(self):
        st = b_race.long_run(self.p, 90, race_finish=20)["structure"]
        out = b_race.render_structure(st, self.conn)
        t = b_race.threshold_pace(self.conn)
        self.assertEqual(out[-1]["cue"], "~" + b_race.fmt_pace(t * b_race.RACE_PACE_FACTOR["half_marathon"]))
        self.assertIn("{pace:race:", st[-1]["cue"])              # the stored copy keeps the token

    def test_strip_stored_pace(self):
        for old, new in (("conversational, ~5:48/km", "conversational"),
                         ("easy, ~5:48/km; gel after 60 min", "easy; gel after 60 min"),
                         ("~4:15/km — the VO2max session", "the VO2max session"),
                         ("~4:34/km", "")):
            self.assertEqual(b_race.strip_stored_pace(old), new)

    def test_migration_rewrites_old_cues(self):
        from infrastructure.db.migrate_live_cues import rewrite
        old = [{"kind": "steady", "label": "Easy run", "zone": "Z2", "duration_min": 40,
                "cue": "conversational, ~5:48/km"},
               {"kind": "steady", "label": "Race", "zone": "Z4", "duration_min": 80, "cue": "hold ~4:45/km"},
               {"kind": "steady", "label": "First 5 km", "zone": "Z3", "duration_min": 24,
                "cue": "a touch slower than 4:45/km — settle"}]
        new = rewrite(old, "half_marathon")
        self.assertEqual([s.get("cue") for s in new],
                         ["conversational", "hold ~{pace:race:half_marathon}",
                          "a touch slower than {pace:race:half_marathon} — settle"])
        self.assertEqual(rewrite(new, "half_marathon"), new)   # idempotent

    def test_watch_targets_race_pace_steps_at_race_pace(self):
        import json
        st = b_race.long_run(self.p, 90, race_finish=20)["structure"]
        session = {"id": 1, "session_type": "Running - Long Run", "discipline": "running", "intensity_zone": "Z2",
                   "duration_min": 90, "effective_duration_min": 90, "structure_json": json.dumps(st)}
        tg = {"ftp": None, "hr": {}, "run_hr": {"Z2": (156, 163)}, "run_pace": {}, "run_threshold_pace": 274.0}
        steps = workout_push.build_workout(session, tg)["workoutSegments"][0]["workoutSteps"]
        race = 274.0 * b_race.RACE_PACE_FACTOR["half_marathon"]
        self.assertEqual(steps[-1]["targetType"]["workoutTargetTypeKey"], "pace.zone")
        self.assertTrue(steps[-1]["targetValueOne"] < 1000 / race < steps[-1]["targetValueTwo"])
        self.assertIn(b_race.fmt_pace(race), steps[-1]["description"])
        self.assertEqual(steps[0]["targetType"]["workoutTargetTypeKey"], "heart.rate.zone")   # easy part by HR


class HrZonesTest(unittest.TestCase):
    """The watch's HR targets and Daybook's grading come from the same stored table."""

    def _db(self):
        import sqlite3
        from domains.training import hr_zones
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.execute("CREATE TABLE athlete_zones (valid_from TEXT, sport TEXT, max_hr INT, threshold_hr INT, ftp_w REAL,"
                  " threshold_pace_s_per_km REAL, css_pace_s_per_100m REAL, zones_json TEXT)")
        for sport, thr in (("run", 183), ("ride", 168)):
            c.execute("INSERT INTO athlete_zones VALUES ('2026-10-25',?,203,?,240,274,NULL,?)",
                      (sport, thr, hr_zones.zones_json(sport, thr, 203)))
        return c

    def test_threshold_zones(self):
        from domains.training import hr_zones
        z = {b["name"]: (b["min_hr"], b["max_hr"]) for b in hr_zones.bands("run", 183, 203)}
        self.assertEqual(z["Z2"], (148, 165))        # the whole easy range, not a 7-beat slot
        self.assertEqual(z["Z5"][0], 183)            # threshold is the top of Z4, not inside Z5
        self.assertEqual(hr_zones.bands("run", None, 203)[1], {"name": "Z2", "min_hr": 132, "max_hr": 152})

    def test_watch_targets_match_the_graded_zones(self):
        import json
        from domains.training import hr_zones
        c = self._db()
        tg = workout_push._targets(c)
        for sport, key in (("run", "run_hr"), ("ride", "hr")):
            stored = {b["name"]: b for b in json.loads(c.execute(
                "SELECT zones_json FROM athlete_zones WHERE sport=?", (sport,)).fetchone()[0])}
            for zone, (lo, hi) in tg[key].items():
                self.assertGreaterEqual(lo, stored[zone]["min_hr"], (sport, zone))
                self.assertLessEqual(hi, min(stored[zone]["max_hr"], 203), (sport, zone))
        self.assertEqual(tg["run_hr"]["Z2"], (148, 164))
        self.assertEqual(hr_zones.watch_targets(hr_zones.bands("run", 183, 203), 203)["Z5"], (183, 203))


if __name__ == "__main__":
    unittest.main()
