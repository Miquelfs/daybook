import json
import math
import sqlite3
import struct
import unittest

from domains.health import fit_import
from domains.health.fit_file import FIT_EPOCH, FitError, parse_fit
from tests.helpers import ROOT


def fit_bytes(rows, compressed_every=0):
    """Tiny FIT writer: record messages (ts, hr, cadence, distance, power).
    Every `compressed_every`-th record uses a compressed-timestamp header (no ts field)."""
    body = bytearray()
    # local 0: full record; local 1: same without timestamp (for compressed headers)
    full = [(253, 4, 0x86), (3, 1, 0x02), (4, 1, 0x02), (5, 4, 0x86), (7, 2, 0x84)]
    for local, fields in ((0, full), (1, full[1:])):
        body += bytes([0x40 | local, 0, 0]) + struct.pack("<HB", 20, len(fields))
        for f in fields:
            body += bytes(f)
    for i, (ts, hr, cad, dist, pw) in enumerate(rows):
        if compressed_every and i % compressed_every == 1:
            body += bytes([0x80 | (1 << 5) | ((ts - FIT_EPOCH) & 0x1F)])
            body += struct.pack("<BBIH", hr, cad, int(dist * 100), pw)
        else:
            body += bytes([0]) + struct.pack("<IBBIH", ts - FIT_EPOCH, hr, cad, int(dist * 100), pw)
    header = struct.pack("<BBHI4s", 12, 0x10, 2132, len(body), b".FIT")
    return header + bytes(body) + b"\0\0"


def hr_curve(s):
    """Heart rate with structure to correlate: warm-up ramp + intervals."""
    return int(110 + min(s, 600) / 20 + 25 * (1 if (s // 180) % 2 else 0) + 4 * math.sin(s / 37))


class FitFileTest(unittest.TestCase):
    def test_decodes_scales_and_compressed_timestamps(self):
        t0 = 1_792_770_000
        rows = [(t0 + s, 100 + s % 50, 90, s * 8.5, 150 + s) for s in range(120)]
        p = parse_fit(fit_bytes(rows, compressed_every=3))
        self.assertEqual(len(p["records"]), 120)
        r = p["records"][61]
        self.assertEqual(r["ts"], t0 + 61)
        self.assertEqual(r["power"], 211)
        self.assertAlmostEqual(r["distance"], 61 * 8.5, places=2)
        self.assertEqual(r["hr"], 100 + 61 % 50)

    def test_rejects_non_fit(self):
        with self.assertRaises(FitError):
            parse_fit(b"not a fit file at all")


class AlignTest(unittest.TestCase):
    def test_heart_rate_beats_a_wrong_clock(self):
        # Watch started 73 s after the app; the app's clock is ~29 min off
        n = 2000
        fit_hr = [hr_curve(s) for s in range(n + 100)]
        watch_hr = [hr_curve(s + 73) for s in range(n)]
        lag, method, corr = fit_import.align(watch_hr, fit_hr, len(fit_hr), clock_offset=1753)
        self.assertEqual((lag, method), (73, "hr"))
        self.assertGreater(corr, 0.95)

    def test_falls_back_to_clock_then_start(self):
        self.assertEqual(fit_import.align([None] * 1000, None, 1000, 30)[:2], (30, "clock"))
        self.assertEqual(fit_import.align([None] * 1000, None, 1000, 5000)[:2], (0, "start"))


class AttachTest(unittest.TestCase):
    def setUp(self):
        self.c = sqlite3.connect(":memory:")
        self.c.row_factory = sqlite3.Row
        self.c.executescript((ROOT / "infrastructure/db/schema.sql").read_text())
        self.c.execute("PRAGMA foreign_keys=OFF")
        self.ts0 = 1_792_768_198
        self.c.execute("""INSERT INTO activities (id, date, source, activity_type, name, duration_seconds,
                          distance_meters, avg_heart_rate, raw_payload)
                          VALUES ('garmin_1','2026-10-23','garmin','indoor_cycling','FTP test',1500,0,150,'{}')""")
        secs = list(range(0, 1500, 3))   # watch samples every 3 s
        streams = {"sumduration": [float(s) for s in secs],
                   "directtimestamp": [(self.ts0 + s) * 1000.0 for s in secs],
                   "directheartrate": [float(hr_curve(s + 40)) for s in secs],
                   "sumdistance": [0.0] * len(secs)}
        for k, v in streams.items():
            self.c.execute("INSERT INTO activity_streams VALUES ('garmin_1',?,?)", (k, json.dumps(v)))
        self.c.execute("INSERT INTO athlete_zones (valid_from, sport, max_hr, threshold_hr, ftp_w, zones_json) "
                       "VALUES ('2026-01-01','ride',190,173,200,'[]')")
        # app started 40 s before the watch, its clock 30 min ahead
        app0 = self.ts0 - 40 + 1800
        self.fit = fit_bytes([(app0 + s, hr_curve(s), 90, s * 2.5, 180) for s in range(1600)])

    def test_merge_then_detach(self):
        st = fit_import.attach(self.c, "garmin_1", self.fit, "ride.fit")
        self.assertEqual((st["offset_s"], st["align_method"]), (40, "hr"))
        self.assertEqual(st["avg_power_w"], 180)
        a = self.c.execute("SELECT distance_meters, avg_power_watts, training_stress_score FROM activities").fetchone()
        self.assertAlmostEqual(a["distance_meters"], 1497 * 2.5, delta=5)
        self.assertEqual(a["avg_power_watts"], 180)
        self.assertIsNotNone(a["training_stress_score"])       # power TSS saved (no Garmin TSS)
        names = {r[0] for r in self.c.execute("SELECT stream_type FROM activity_streams")}
        self.assertTrue({"directpower", "directbikecadence", "sumdistance"} <= names)
        self.assertNotIn("directelevation", names)              # virtual world stays out

        # Re-uploading merges into the watch originals, not the previous merge
        st2 = fit_import.attach(self.c, "garmin_1", self.fit, "ride.fit")
        self.assertEqual(st2["offset_s"], 40)

        self.assertTrue(fit_import.detach(self.c, "garmin_1"))
        a = self.c.execute("SELECT distance_meters, avg_power_watts FROM activities").fetchone()
        self.assertEqual((a["distance_meters"], a["avg_power_watts"]), (0, None))
        names = {r[0] for r in self.c.execute("SELECT stream_type FROM activity_streams")}
        self.assertEqual(names, {"sumduration", "directtimestamp", "directheartrate", "sumdistance"})


if __name__ == "__main__":
    unittest.main()
