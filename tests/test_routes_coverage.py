"""Same-route matching by track overlap (with direction) and Mallorca road/village coverage."""

import gzip
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from domains.health.geo import encode
from domains.training.activity_impact import _matched
from domains.locations.mallorca import coverage

HOME = (39.5700, 2.6430)


def _loop(dlat: float, dlng: float, n: int = 120, reverse: bool = False):
    """A rectangular loop from HOME: north dlat, east dlng, back."""
    corners = [HOME, (HOME[0] + dlat, HOME[1]), (HOME[0] + dlat, HOME[1] + dlng), (HOME[0], HOME[1] + dlng), HOME]
    pts = []
    for a, b in zip(corners, corners[1:]):
        for i in range(n // 4):
            t = i / (n // 4)
            pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    pts.append(HOME)
    return pts[::-1] if reverse else pts


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("""CREATE TABLE activities (id TEXT, date TEXT, name TEXT, activity_type TEXT, distance_meters REAL,
                 moving_time_seconds INT, duration_seconds INT, avg_heart_rate INT, polyline TEXT)""")
    rides = [
        ("a", "2026-09-01", _loop(0.10, 0.10), 140, 25.0),
        ("b", "2026-09-15", _loop(0.10, 0.10), 133, 26.0),
        ("rev", "2026-09-20", _loop(0.10, 0.10, reverse=True), 138, 25.5),
        ("other", "2026-09-25", _loop(-0.10, -0.10), 140, 27.0),          # same length, same start, other roads
        ("now", "2026-10-21", _loop(0.10, 0.10), 128, 25.5),
    ]
    for rid, d, pts, hr, kmh in rides:
        dist = 44_000
        c.execute("INSERT INTO activities VALUES (?,?,?,?,?,?,?,?,?)",
                  (rid, d, rid, "cycling", dist, round(dist / (kmh / 3.6)), None, hr, encode(pts)))
    return c


class SameRouteTest(unittest.TestCase):
    def test_overlap_not_just_start_and_distance(self):
        c = _db()
        m = _matched(c, c.execute("SELECT * FROM activities WHERE id='now'").fetchone(), "ride")
        ids = {i["id"] for i in m["items"]}
        self.assertEqual(ids, {"a", "b", "rev", "now"})           # 'other' shares start + length only
        self.assertEqual(m["n"], 3)                                # compared with same-direction rides
        self.assertEqual(m["n_reverse"], 1)
        self.assertFalse(next(i for i in m["items"] if i["id"] == "rev")["same_direction"])

    def test_verdict_uses_effort(self):
        c = _db()
        m = _matched(c, c.execute("SELECT * FROM activities WHERE id='now'").fetchone(), "ride")
        v = m["verdict"]
        self.assertEqual(v["vs_date"], "2026-09-15")
        self.assertEqual(v["hr_delta"], -5)
        self.assertIn("0.5 km/h slower", v["text"])
        self.assertIn("lower HR", v["text"])
        self.assertIn("easier day, same fitness", v["read"])      # less speed, but per heartbeat ≈ the same


class CoverageTest(unittest.TestCase):
    def test_roads_and_villages(self):
        road_on = [(39.60, 2.70), (39.60, 2.72)]                  # ridden
        road_off = [(39.70, 2.90), (39.70, 2.92)]                 # never
        ref = {"built": "2026-10-22", "source": "OSM", "classes": ["tertiary", "unclassified"], "names": ["", "Ma-1"],
               "pieces": [[0, 1, 1720, encode(road_on)], [1, 0, 1720, encode(road_off)]],
               "villages": [["Ridden Town", 39.601, 2.71, "village", ""], ["Far Village", 39.80, 3.10, "village", ""]]}
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "ref.json.gz"
            with gzip.open(p, "wt") as f:
                json.dump(ref, f)
            c = sqlite3.connect(":memory:")
            c.row_factory = sqlite3.Row
            c.execute("CREATE TABLE activities (id TEXT, date TEXT, activity_type TEXT, polyline TEXT)")
            c.execute("INSERT INTO activities VALUES ('r','2026-10-01','road_biking',?)",
                      (encode([(39.5696, 2.6502), (39.60, 2.69), (39.60, 2.73)]),))
            c.execute("INSERT INTO activities VALUES ('i','2026-10-02','indoor_cycling',?)",
                      (encode([(39.70, 2.90), (39.70, 2.92)]),))                         # indoor: ignored
            with mock.patch.object(coverage, "REF", p):
                coverage.reference.cache_clear()
                out = coverage.get(c)
                again = coverage.get(c)                                                  # cached
                coverage.reference.cache_clear()
        self.assertEqual(out["rides"], 1)
        self.assertEqual((out["roads"]["ridden_km"], out["roads"]["total_km"]), (2, 3))
        self.assertEqual(out["villages_visited"], 1)
        self.assertEqual(out["villages"][0]["name"], "Far Village")                       # missing first
        self.assertEqual(next(v for v in out["villages"] if v["visited"])["first_date"], "2026-10-01")
        self.assertEqual(len(out["ridden"]), 1)
        self.assertEqual(out, again)


if __name__ == "__main__":
    unittest.main()
