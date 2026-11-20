"""One night in full: the timeline on one axis, the HRV read against your range, what moves it."""

import json
import sqlite3
import unittest
from datetime import date, datetime, timedelta, timezone

from domains.health import sleep_night as sn


def _ms(s: str) -> int:
    return int(datetime.fromisoformat(s).replace(tzinfo=timezone.utc).timestamp() * 1000)


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE sleep (date TEXT PRIMARY KEY, duration_seconds INT, deep_seconds INT, light_seconds INT,
            rem_seconds INT, awake_seconds INT, avg_hrv REAL, avg_spo2 REAL, score INT, raw_payload TEXT,
            source TEXT DEFAULT 'garmin', start_time TEXT, end_time TEXT);
        CREATE TABLE hrv (date TEXT PRIMARY KEY, last_night_avg REAL, weekly_avg REAL, status TEXT, raw_payload TEXT);
        CREATE TABLE tags (id INTEGER PRIMARY KEY, slug TEXT);
        CREATE TABLE day_tags (date TEXT, tag_id INT, note TEXT);
        CREATE TABLE training_load_daily (date TEXT, sport TEXT, daily_tss REAL);
        INSERT INTO tags VALUES (1, 'alcohol');""")
    return c


def _sleep(c, d, asleep=27000):
    # bed 23:00 local = 22:00 GMT (UTC+1); woke 07:00
    prev = (date.fromisoformat(d) - timedelta(days=1)).isoformat()
    raw = {"dailySleepDTO": {"sleepStartTimestampGMT": _ms(f"{prev}T22:00:00"), "sleepEndTimestampGMT": _ms(f"{d}T06:00:00"),
                             "sleepStartTimestampLocal": _ms(f"{prev}T23:00:00"), "sleepEndTimestampLocal": _ms(f"{d}T07:00:00"),
                             "sleepScores": {"remPercentage": {"value": 19, "qualifierKey": "GOOD", "optimalStart": 21, "optimalEnd": 31}},
                             "sleepNeed": {"actual": 480}, "sleepScoreFeedback": "POSITIVE_LONG_AND_DEEP"},
           "sleepLevels": [{"startGMT": f"{prev}T22:00:00.0", "endGMT": f"{prev}T23:30:00.0", "activityLevel": 1},
                           {"startGMT": f"{prev}T23:30:00.0", "endGMT": f"{d}T00:30:00.0", "activityLevel": 0},
                           {"startGMT": f"{d}T00:30:00.0", "endGMT": f"{d}T00:40:00.0", "activityLevel": 3}],
           "sleepHeartRate": [{"value": 50, "startGMT": _ms(f"{prev}T22:00:00")}, {"value": 49, "startGMT": _ms(f"{prev}T22:01:00")},
                              {"value": 45, "startGMT": _ms(f"{prev}T22:04:00")}],
           "hrvData": [{"value": 80, "startGMT": _ms(f"{prev}T22:05:00")}]}
    c.execute("INSERT INTO sleep (date, duration_seconds, deep_seconds, light_seconds, rem_seconds, awake_seconds, score, raw_payload) "
              "VALUES (?,?,?,?,?,?,?,?)", (d, asleep, 5000, 16000, 6000, 600, 80, json.dumps(raw)))


def _hrv(c, d, night, week, status="balanced"):
    c.execute("INSERT INTO hrv VALUES (?,?,?,?,?)", (d, night, week, status, json.dumps(
        {"hrvSummary": {"baseline": {"balancedLow": 80, "balancedUpper": 105, "lowUpper": 70}, "lastNight5MinHigh": night + 20}})))


class NightTest(unittest.TestCase):
    def test_timeline_and_curves_share_one_axis_from_falling_asleep(self):
        c = _db()
        _sleep(c, "2026-11-20")
        out = sn.night_detail(c, "2026-11-20")
        n = out["night"]
        self.assertEqual(n["bed_min"], 23 * 60)
        self.assertEqual(n["timeline"], [{"from": 0, "to": 90, "stage": "light"}, {"from": 90, "to": 150, "stage": "deep"},
                                         {"from": 150, "to": 160, "stage": "awake"}])
        self.assertEqual(n["series"]["hr"], [{"m": 0, "v": 50.0}, {"m": 4, "v": 45.0}])   # thinned to every 2 min
        self.assertEqual(n["series"]["hrv"], [{"m": 5, "v": 80.0}])
        self.assertEqual(n["end_m"], 480)
        self.assertEqual(n["need_s"], 480 * 60)
        self.assertEqual(n["feedback"], "Long and deep")
        self.assertEqual(n["score_parts"][0]["optimal"], [21, 31])
        self.assertIsNone(out["hrv"])
        self.assertIsNone(sn.night_detail(c, "2026-11-19"))

    def test_prev_next_and_usual(self):
        c = _db()
        for d in ("2026-11-17", "2026-11-18", "2026-11-20"):
            _sleep(c, d, 25000)
        out = sn.night_detail(c, "2026-11-18")
        self.assertEqual((out["prev"], out["next"]), ("2026-11-17", "2026-11-20"))
        self.assertEqual(out["usual"]["nights"], 1)


class HrvTest(unittest.TestCase):
    def test_back_in_range_while_the_week_catches_up(self):
        c = _db()
        _sleep(c, "2026-11-20")
        _hrv(c, "2026-11-20", 97, 72, "unbalanced")
        h = sn.night_detail(c, "2026-11-20")["hrv"]
        self.assertEqual((h["direction"], h["week_direction"]), ("normal", "low"))
        self.assertEqual(h["reading"]["tone"], "ok")
        self.assertEqual(h["range"], [80, 105])
        self.assertEqual(h["history"][-1], {"date": "2026-11-20", "night": 97, "week": 72, "lo": 80, "hi": 105})
        self.assertNotIn("readings", h)

    def test_below_range_says_not_recovered(self):
        self.assertEqual(sn._reading("low", "normal")["tone"], "low")
        self.assertEqual(sn._reading("normal", "normal")["tone"], "good")

    def test_levers_compare_mornings_after_a_drink(self):
        c = _db()
        start = date(2026, 9, 1)
        for i in range(40):
            d = (start + timedelta(days=i)).isoformat()
            drink = i % 4 == 0                                   # the evening before morning i+1
            if drink:
                c.execute("INSERT INTO day_tags VALUES (?, 1, NULL)", (d,))
            nxt = (start + timedelta(days=i + 1)).isoformat()
            _hrv(c, nxt, 70 if drink else 90, 85)
        lv = {l["key"]: l for l in sn.levers(c, "2026-10-11")}
        self.assertEqual(lv["alcohol"]["delta"], -20.0)
        self.assertEqual(lv["alcohol"]["n_with"], 10)
        self.assertNotIn("hard", lv)                             # no training data → no lever


if __name__ == "__main__":
    unittest.main()
