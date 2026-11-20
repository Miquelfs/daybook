"""The sleep page: stages add up to the night, clock averages across midnight, naps, nights before duties."""

import json
import sqlite3
import unittest
from datetime import date, datetime, timezone

from domains.health import sleep_view as sv
from infrastructure.db.migrate_sleep_hrv import migrate as migrate_hrv


def _local_ms(d: str, hhmm: str) -> int:
    """Garmin's *Local timestamps: epoch ms of the local wall clock."""
    return int(datetime.fromisoformat(f"{d}T{hhmm}:00").replace(tzinfo=timezone.utc).timestamp() * 1000)


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE sleep (date TEXT PRIMARY KEY, duration_seconds INT, deep_seconds INT, light_seconds INT,
            rem_seconds INT, awake_seconds INT, avg_hrv REAL, avg_spo2 REAL, score INT, raw_payload TEXT,
            source TEXT DEFAULT 'garmin', start_time TEXT, end_time TEXT);
        CREATE TABLE hrv (date TEXT PRIMARY KEY, last_night_avg REAL);
        CREATE TABLE roster (date TEXT PRIMARY KEY, duty_type TEXT, report_time TEXT);""")
    return c


def _night(c, d, bed_day, bed, wake, deep, light, rem, awake, score=80, naps=None, **top):
    raw = {"dailySleepDTO": {"sleepStartTimestampLocal": _local_ms(bed_day, bed), "sleepEndTimestampLocal": _local_ms(d, wake),
                             "averageRespirationValue": 14.5, "avgSleepStress": 18.0, "awakeCount": 2},
           "restingHeartRate": 48, "avgOvernightHrv": 62.0, "bodyBatteryChange": 55, "restlessMomentsCount": 30, **top}
    if naps:
        raw["dailyNapDTOS"] = naps
    c.execute("INSERT INTO sleep (date, duration_seconds, deep_seconds, light_seconds, rem_seconds, awake_seconds, "
              "avg_hrv, score, raw_payload) VALUES (?,?,?,?,?,?,?,?,?)",
              (d, deep + light + rem, deep, light, rem, awake, 18.0, score, json.dumps(raw)))


class NightTest(unittest.TestCase):
    def test_stages_are_shares_of_the_night_and_add_up(self):
        c = _db()
        # a jet-lagged night: 5 h asleep, 2.5 h awake — used to draw as 150 %
        _night(c, "2026-11-10", "2026-11-09", "23:30", "07:00", 3600, 9000, 5400, 9000)
        n = sv.nights(c, "2026-11-01", "2026-11-30")[0]
        self.assertEqual((n["bed"], n["wake"]), ("23:30", "07:00"))
        self.assertAlmostEqual(n["deep_pct"] + n["light_pct"] + n["rem_pct"] + n["awake_pct"], 100, delta=0.2)
        self.assertEqual(n["in_bed_s"], 27000)
        self.assertEqual((n["resting_hr"], n["hrv"], n["respiration"]), (48, 62.0, 14.5))

    def test_manual_night_keeps_its_clock(self):
        c = _db()
        c.execute("INSERT INTO sleep (date, duration_seconds, source, start_time, end_time) "
                  "VALUES ('2026-11-10', 25200, 'manual', '23:00', '06:00')")
        n = sv.nights(c, "2026-11-01", "2026-11-30")[0]
        self.assertEqual((n["source"], n["bed"], n["wake"], n["deep_pct"]), ("manual", "23:00", "06:00", None))

    def test_naps(self):
        c = _db()
        _night(c, "2026-11-10", "2026-11-09", "23:00", "07:00", 5000, 16000, 6000, 600, naps=[
            {"napStartTimestampLocal": _local_ms("2026-11-10", "14:10"),
             "napEndTimestampLocal": _local_ms("2026-11-10", "14:35"), "napTimeSec": 1500}])
        _night(c, "2026-11-11", "2026-11-10", "23:00", "07:00", 5000, 16000, 6000, 600)
        p = sv.period(c, 14, today=date(2026, 11, 12))
        self.assertEqual(p["naps"], [{"date": "2026-11-10", "start": "14:10", "end": "14:35", "seconds": 1500}])
        self.assertEqual(p["summary"]["naps"], {"count": 1, "seconds": 1500, "avg_s": 1500, "days": 1})


class SummaryTest(unittest.TestCase):
    def test_bedtimes_average_across_midnight(self):
        self.assertEqual(sv.clock_mean(["23:30", "00:30"])[0], "00:00")
        self.assertEqual(sv.clock_mean(["06:00", "08:00"], pivot=18 * 60)[0], "07:00")
        self.assertEqual(sv.clock_mean(["23:00", "23:00"])[1], 0)

    def test_period_debt_and_previous(self):
        c = _db()
        for i, (dur_h, bed) in enumerate([(6, "00:30"), (7, "23:30"), (8, "23:00"), (5, "01:00")]):
            d = f"2026-11-{10 + i:02d}"
            prev = f"2026-11-{9 + i:02d}"
            s = int(dur_h * 3600)
            _night(c, d, prev if bed > "12:00" else d, bed, "07:30", s // 5, s * 3 // 5, s // 5, 900)
        _night(c, "2026-10-20", "2026-10-19", "23:00", "07:00", 6000, 16000, 6000, 600)   # previous period
        p = sv.period(c, 14, today=date(2026, 11, 14))
        s = p["summary"]
        self.assertEqual(s["nights"], 4)
        self.assertEqual(s["short_nights"], 2)                   # 6 h and 5 h
        self.assertEqual(s["debt_s"], (2 + 1 + 0 + 3) * 3600)
        self.assertEqual(s["best"]["date"], "2026-11-12")          # same score: the longest night
        self.assertEqual(s["worst"]["date"], "2026-11-13")
        self.assertEqual(p["previous"]["nights"], 1)

    def test_nights_before_duties(self):
        c = _db()
        for d in ("2026-11-10", "2026-11-11", "2026-11-12"):
            _night(c, d, d, "00:10", "07:00", 5000, 14000, 5000, 600)
        c.executemany("INSERT INTO roster VALUES (?,?,?)", [
            ("2026-11-10", "flying_duty", "05:45"), ("2026-11-11", "flying_duty", "14:00"), ("2026-11-12", "day_off", None)])
        g = {x["key"]: x["nights"] for x in sv.by_duty(c, sv.nights(c, "2026-11-01", "2026-11-30"))}
        self.assertEqual(g, {"early": 1, "duty": 1, "off": 1})


class HrvBackfillTest(unittest.TestCase):
    def test_avg_hrv_is_overnight_hrv_not_sleep_stress(self):
        c = _db()
        _night(c, "2026-11-10", "2026-11-09", "23:00", "07:00", 5000, 16000, 6000, 600)
        self.assertEqual(migrate_hrv(c), 1)
        self.assertEqual(c.execute("SELECT avg_hrv FROM sleep").fetchone()[0], 62.0)
        self.assertEqual(migrate_hrv(c), 0)


if __name__ == "__main__":
    unittest.main()
