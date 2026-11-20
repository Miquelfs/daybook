"""Activities on the local day (not GMT), one copy per workout, plan sessions re-matched — the Taiwan week."""

import json
import unittest

from domains.health import activity_dates as ad
from tests.helpers import ROOT, plan_db

WATCH, BIKE = 3602304824, 3448017023


def _db():
    c = plan_db()
    c.executescript((ROOT / "infrastructure/db/schema.sql").read_text())
    c.executescript("""ALTER TABLE activities ADD COLUMN user_notes TEXT;
                       ALTER TABLE activities ADD COLUMN user_rating INT;
                       CREATE TABLE IF NOT EXISTS coll_rides (id INTEGER PRIMARY KEY, activity_id TEXT, status TEXT);""")
    c.execute("INSERT INTO race_goals (id, name, race_type, race_date, status, plan_start_date, available_days) "
              "VALUES (10, 'Mallorca 312', 'mallorca_312', '2027-04-24', 'active', '2026-10-19', '[]')")
    return c


def _act(c, aid, gmt, local, dur, dev=BIKE, kind="cycling"):
    raw = {"startTimeGMT": gmt, "startTimeLocal": local, "deviceId": dev}
    c.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (gmt[:10],))
    c.execute("""INSERT INTO activities (id, date, source, activity_type, name, start_time, duration_seconds,
                 moving_time_seconds, raw_payload) VALUES (?,?,?,?,?,?,?,?,?)""",
              (aid, gmt[:10], "garmin", kind, aid, gmt, dur, dur, json.dumps(raw)))


def _session(c, sid, day, status="pending", act=None, auto=0):
    c.execute("""INSERT INTO plan_sessions (id, goal_id, week_number, session_date, original_date, discipline,
                 session_type, intensity_zone, duration_min, status, completed_activity_id, auto_matched)
                 VALUES (?,10,4,?,?,'cycling','Cycling - Tour day','Z2',300,?,?,?)""",
              (sid, day, day, status, act, auto))


class LocalDateTest(unittest.TestCase):
    def test_local_start_wins(self):
        self.assertEqual(ad.local_date("2026-11-12 22:44:17", "2026-11-13 06:44:17"), "2026-11-13")

    def test_gmt_without_local_or_place(self):
        self.assertEqual(ad.local_date("2026-11-12 22:44:17"), "2026-11-12")


class TaiwanWeekTest(unittest.TestCase):
    def setUp(self):
        c = self.c = _db()
        _act(c, "shilin", "2026-11-12 06:20:32", "2026-11-12 14:20:32", 10427)
        _act(c, "luzhou", "2026-11-12 22:44:17", "2026-11-13 06:44:17", 21531)
        _act(c, "hualien_bike", "2026-11-14 00:06:05", "2026-11-14 08:06:05", 19989)
        _act(c, "hualien_watch", "2026-11-14 00:06:09", "2026-11-14 08:06:09", 18729, dev=WATCH)
        _act(c, "fuli", "2026-11-14 23:51:34", "2026-11-15 07:51:34", 17952)
        _act(c, "hengchun", "2026-11-16 23:36:08", "2026-11-17 07:36:08", 14307)
        _act(c, "banqiao", "2026-11-17 12:47:47", "2026-11-17 20:47:47", 4377)
        _act(c, "run", "2026-10-01 07:00:00", "2026-10-01 09:00:00", 3000, dev=WATCH, kind="running")
        _session(c, 1, "2026-11-12", "completed", "luzhou")           # linked by the GMT day
        _session(c, 2, "2026-11-13", "completed")                     # ticked off by hand
        _session(c, 3, "2026-11-14", "completed", "hualien_watch", auto=1)
        _session(c, 4, "2026-11-15")                                  # read as missed
        _session(c, 5, "2026-11-17", "completed", "banqiao", auto=1)  # the short evening ride
        c.execute("INSERT INTO fueling_logs (activity_id) VALUES ('hualien_watch')") if self._has(
            "fueling_logs", "activity_id") else None
        c.commit()

    def _has(self, t, col):
        return any(r[1] == col for r in self.c.execute(f"PRAGMA table_info({t})"))

    def test_repair(self):
        c = self.c
        out = ad.repair(c)
        self.assertEqual(out["twins_merged"], 1)
        day = {r["id"]: r["date"] for r in c.execute("SELECT id, date FROM activities")}
        self.assertEqual(day["luzhou"], "2026-11-13")
        self.assertEqual(day["fuli"], "2026-11-15")
        self.assertEqual(day["hengchun"], "2026-11-17")
        self.assertEqual(day["banqiao"], "2026-11-17")
        self.assertEqual(day["run"], "2026-10-01")
        # the ride recorded twice: one copy, the bike computer's (more moving time; no usage history yet)
        self.assertIn("hualien_bike", day)
        self.assertNotIn("hualien_watch", day)
        self.assertTrue(ad.is_duplicate(c, "hualien_watch"))

        link = {r["id"]: (r["status"], r["completed_activity_id"]) for r in c.execute("SELECT * FROM plan_sessions")}
        self.assertEqual(link[1], ("completed", "shilin"))
        self.assertEqual(link[2], ("completed", "luzhou"))
        self.assertEqual(link[3], ("completed", "hualien_bike"))
        self.assertEqual(link[4], ("completed", "fuli"))
        self.assertEqual(link[5], ("completed", "hengchun"))

        # idempotent
        self.assertEqual(ad.repair(c), {"redated": 0, "twins_merged": 0, "sessions_relinked": 0})


class TwinPreferenceTest(unittest.TestCase):
    def test_usual_device_for_the_sport_keeps_it(self):
        c = _db()
        for i in range(3):
            _act(c, f"old{i}", f"2026-10-0{i + 1} 07:00:00", f"2026-10-0{i + 1} 09:00:00", 3600, dev=BIKE)
        _act(c, "w", "2026-11-14 00:06:00", "2026-11-14 08:06:00", 20000, dev=WATCH)   # longer, but the watch
        _act(c, "b", "2026-11-14 00:06:05", "2026-11-14 08:06:05", 19000, dev=BIKE)
        _act(c, "swim", "2026-11-14 00:07:00", "2026-11-14 08:07:00", 600, dev=WATCH, kind="open_water_swimming")
        done = ad.device_twins(c)
        self.assertEqual([(d, k) for d, k, _ in done], [("w", "b")])
        self.assertIsNotNone(c.execute("SELECT 1 FROM activities WHERE id='swim'").fetchone())


if __name__ == "__main__":
    unittest.main()
