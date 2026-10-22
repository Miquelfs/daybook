"""Climbs from Garmin elevation: found, named (col > viewpoint > village > unnamed), counted, VAM records."""

import json
import sqlite3
import unittest
from unittest import mock

from domains.locations import climbs, cols

FOOT = (28.050, -16.700)         # Tenerife-ish
TOP = (28.095, -16.700)          # ~5 km north
PASS = (39.735, 2.711)


def _streams(c, aid, start, top, base, gain, secs_up):
    """Flat 3 km, climb `gain` m to `top` over ~5 km, flat 2 km — one sample every ~25 m, time in seconds."""
    pts = []
    n_flat, n_up = 120, 200
    for i in range(n_flat):
        pts.append((start[0] - (n_flat - i) * 0.000225, start[1], base, i * 6.0))
    t0 = n_flat * 6.0
    for i in range(n_up + 1):
        f = i / n_up
        pts.append((start[0] + (top[0] - start[0]) * f, start[1] + (top[1] - start[1]) * f, base + gain * f,
                    t0 + secs_up * f))
    for i in range(1, 80):
        pts.append((top[0] + i * 0.000225, top[1], base + gain, t0 + secs_up + i * 6.0))
    lat, lng, ele, t = (list(x) for x in zip(*pts))
    for name, vals in (("directlatitude", lat), ("directlongitude", lng), ("directelevation", ele), ("sumduration", t)):
        c.execute("INSERT INTO activity_streams VALUES (?,?,?)", (aid, name, json.dumps(vals)))


def _db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("CREATE TABLE activities (id TEXT, date TEXT, activity_type TEXT, polyline TEXT)")
    c.execute("CREATE TABLE activity_streams (activity_id TEXT, stream_type TEXT, data_json TEXT)")
    for aid, d, secs in (("t1", "2025-03-01", 1800), ("t2", "2025-04-01", 1500)):
        c.execute("INSERT INTO activities VALUES (?,?,'road_biking',NULL)", (aid, d))
        _streams(c, aid, FOOT, TOP, 100, 300, secs)
    c.execute("INSERT INTO activities VALUES ('col','2026-05-01','road_biking',NULL)")
    _streams(c, "col", (PASS[0] - 0.045, PASS[1]), PASS, 200, 297, 1700)
    c.execute("INSERT INTO activities VALUES ('flat','2026-05-02','road_biking',NULL)")
    _streams(c, "flat", (39.5, 2.6), (39.545, 2.6), 10, 30, 600)              # 30 m: not a climb
    c.execute("INSERT INTO activities VALUES ('run','2026-05-03','trail_running',NULL)")
    _streams(c, "run", FOOT, TOP, 100, 300, 2400)                              # runs don't count
    return c


def fake_overpass(q, **kw):
    if "mountain_pass" in q:
        return {"elements": [{"id": 9, "lat": PASS[0], "lon": PASS[1],
                              "tags": {"name": "Coll de Sóller", "mountain_pass": "yes", "ele": "497"}}]}
    return {"elements": [
        {"id": 1, "lat": TOP[0] + 0.001, "lon": TOP[1], "tags": {"name": "Mirador de Boca Tauce", "tourism": "viewpoint"}},
        {"id": 2, "lat": FOOT[0], "lon": FOOT[1] + 0.005, "tags": {"name": "Adeje", "place": "village"}},
    ]}


class ClimbsTest(unittest.TestCase):
    def setUp(self):
        self.c = _db()
        with mock.patch.object(cols.overpass, "query", side_effect=fake_overpass), \
             mock.patch.object(climbs.overpass, "query", side_effect=fake_overpass), \
             mock.patch.object(cols, "_road_grid", return_value=None), \
             mock.patch.object(cols.time, "sleep"), mock.patch.object(climbs.time, "sleep"):
            self.out = climbs.sync(self.c, None)

    def test_found_and_named(self):
        self.assertEqual(self.out["scanned"], 4)                  # 3 climbing rides + the flat one; not the run
        s = {x["name"]: x for x in climbs.summary(self.c)["climbs"]}
        self.assertEqual(set(s), {"Mirador de Boca Tauce", "Coll de Sóller"})
        boca = s["Mirador de Boca Tauce"]
        self.assertEqual((boca["kind"], boca["times"], boca["ele"]), ("viewpoint", 2, 400))
        self.assertAlmostEqual(boca["gain_m"], 300, delta=10)
        self.assertAlmostEqual(boca["avg_pct"], 6.0, delta=0.6)
        self.assertEqual(boca["sides"], ["Adeje"])
        self.assertEqual(s["Coll de Sóller"]["kind"], "col")

    def test_vam_and_records(self):
        first, second = (climbs.for_activity(self.c, a)[0] for a in ("t1", "t2"))
        self.assertAlmostEqual(first["vam"], 300 / 0.5, delta=40)            # 300 m in ~30 min
        self.assertTrue(first["first_time"])
        self.assertEqual(second["nth"], 2)
        self.assertTrue(second["best_vam"])                                  # faster this time

    def test_unnamed_summit(self):
        name = climbs.name_summit(self.c, (40.5, 3.9), 812)
        self.assertEqual((name["kind"], name["name"]), ("summit", "Climb to 812 m"))


if __name__ == "__main__":
    unittest.main()
