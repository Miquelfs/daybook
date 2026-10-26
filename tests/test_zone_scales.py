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


if __name__ == "__main__":
    unittest.main()
