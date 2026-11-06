"""Coll: course packs built offline (fixture GPX + a cached Overpass answer), the pack format,
course storage and the build queue, the settings document, the device token."""

import json
import os
import shutil
import sqlite3
import struct
import unittest
from datetime import date

from domains.coll import courses as C
from domains.coll import settings as S
from domains.coll import fuel as F
from domains.coll.coursepack import osm
from domains.coll.coursepack import gpx as G
from infrastructure.db.migrate_coll import SCHEMA
from tests.helpers import tmpdir

# A junction near Inca: the course rides east on Ma-1 for ~430 m, then turns left (north)
# onto Ma-2 for ~440 m. Ma-1 carries on east past the junction, so it is a real choice.
LAT0, LON0 = 39.7200, 2.9100
DLAT, DLON = 0.001, 0.0013            # ~111 m north, ~111 m east at this latitude


def _pt(i_east, j_north):
    return LAT0 + j_north * DLAT, LON0 + i_east * DLON


COURSE = [_pt(i, 0) for i in range(5)] + [_pt(4, j) for j in range(1, 5)]
GPX = ('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">'
       '<metadata><name>Inca junction</name></metadata>'
       f'<wpt lat="{_pt(4, 2)[0]}" lon="{_pt(4, 2)[1]}"><name>Water stop</name><sym>Water Source</sym></wpt>'
       f'<wpt lat="{_pt(4, 4)[0]}" lon="{_pt(4, 4)[1]}"><name>Temps tall</name></wpt>'
       '<trk><name>Inca junction</name><trkseg>'
       + "".join(f'<trkpt lat="{la}" lon="{lo}"><ele>{100 + k}</ele></trkpt>' for k, (la, lo) in enumerate(COURSE))
       + '</trkseg></trk></gpx>')


def overpass_answer():
    nodes, way_a, way_b = [], [], []
    for i in range(8):                               # Ma-1, west → east, past the junction at i = 4
        nodes.append({"type": "node", "id": 100 + i, "lat": _pt(i, 0)[0], "lon": _pt(i, 0)[1]})
        way_a.append(100 + i)
    way_b.append(104)
    for j in range(1, 6):                            # Ma-2, from the junction north
        nodes.append({"type": "node", "id": 200 + j, "lat": _pt(4, j)[0], "lon": _pt(4, j)[1]})
        way_b.append(200 + j)
    return {"elements": nodes + [
        {"type": "way", "id": 1, "nodes": way_a, "tags": {"highway": "secondary", "ref": "Ma-1"}},
        {"type": "way", "id": 2, "nodes": way_b, "tags": {"highway": "tertiary", "ref": "Ma-2"}},
    ]}


def seed_cache(cache_dir, gpx_text=GPX):
    """Write the Overpass answer under the keys the builder will ask for."""
    import hashlib
    from domains.coll.coursepack.build import CONTEXT
    pts = G.parse(gpx_text)["points"]
    coords = osm._thin(pts, 100)
    os.makedirs(cache_dir, exist_ok=True)
    for i in range(0, len(coords) - 1, osm.CHUNK_POINTS):
        q = osm._query(coords[i:i + osm.CHUNK_POINTS + 1], CONTEXT)
        with open(os.path.join(cache_dir, hashlib.sha1(q.encode()).hexdigest()[:20] + ".json"), "w") as f:
            json.dump(overpass_answer(), f)


def read_pack(b: bytes) -> dict:
    """A tiny reader of the COL1 format (coursepack/pack.py) — what the device does."""
    o = 4
    assert b[:4] == b"COL1"

    def u(fmt):
        nonlocal o
        v = struct.unpack_from("<" + fmt, b, o)
        o += struct.calcsize("<" + fmt)
        return v

    def s(wide=False):
        nonlocal o
        (n,) = u("H" if wide else "B")
        v = b[o:o + n].decode()
        o += n
        return v

    name = s(True)
    (n,) = u("I")
    pts = [u("iii") for _ in range(n)]
    (n,) = u("H")
    wps = [(*u("Bii"), s()) for _ in range(n)]
    (n,) = u("H")
    turns = [(*u("fhBB"), s()) for _ in range(n)]
    (n,) = u("I")
    roads = []
    for _ in range(n):
        cls, cnt, x, y = u("BHii")
        roads.append((cls, [u("hh") for _ in range(cnt - 1)]))
    assert o == len(b), "trailing bytes"
    return {"name": name, "points": pts, "waypoints": wps, "turns": turns, "roads": roads}


def db() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE race_goals (id INTEGER PRIMARY KEY, name TEXT, race_date TEXT, target_time TEXT);
        CREATE TABLE plan_sessions (id INTEGER PRIMARY KEY, goal_id INTEGER, session_date TEXT, session_type TEXT,
                                    discipline TEXT, intensity_zone TEXT, duration_min INTEGER,
                                    effective_duration_min INTEGER);
        CREATE TABLE nutrition_products (id INTEGER PRIMARY KEY, name TEXT, kind TEXT, carbs_g REAL, sodium_mg REAL,
                                         caffeine_mg REAL, fluid_ml REAL, archived INTEGER DEFAULT 0);
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE weight_log (date TEXT PRIMARY KEY, weight_kg REAL NOT NULL);
        CREATE TABLE user_profile (id INTEGER PRIMARY KEY, birthdate TEXT NOT NULL);
        CREATE TABLE athlete_zones (valid_from TEXT, sport TEXT, max_hr INTEGER, threshold_hr INTEGER,
                                    ftp_w REAL, threshold_pace_s_per_km REAL, css_pace_s_per_100m REAL,
                                    zones_json TEXT NOT NULL, PRIMARY KEY (valid_from, sport));
        CREATE TABLE race_nutrition_plans (goal_id INTEGER PRIMARY KEY, plan_json TEXT NOT NULL);
    """)
    c.executescript(SCHEMA)
    return c


class Builder(unittest.TestCase):
    def setUp(self):
        self.cache = str(tmpdir())
        seed_cache(self.cache)

    def tearDown(self):
        shutil.rmtree(self.cache, ignore_errors=True)

    def test_turn_at_the_junction_only(self):
        out = C.build_pack(GPX, self.cache, log=lambda m: None)
        turns = out["turns"]
        self.assertEqual(len(turns), 1, turns)
        t = turns[0]
        self.assertEqual(t["kind"], 0)                      # a turn, not a keep / roundabout
        self.assertLess(t["angle"], -60)                    # left
        self.assertEqual(t["road"], "Ma-2")
        self.assertAlmostEqual(t["at"], 4 * 111, delta=40)  # at the junction, ~444 m in
        s = out["summary"]
        self.assertGreater(s["matched_pct"], 95)
        self.assertEqual(s["waypoint_kinds"]["feed"], 1)
        self.assertEqual(s["bytes"], len(out["pack"]))

    def test_pack_round_trip(self):
        out = C.build_pack(GPX, self.cache, log=lambda m: None)
        p = read_pack(out["pack"])
        self.assertEqual(p["name"], "Inca junction")
        self.assertEqual(len(p["points"]), len(COURSE))
        self.assertEqual(p["points"][0][:2], (round(LAT0 * 1e7), round(LON0 * 1e7)))
        self.assertEqual([w[0] for w in p["waypoints"]], [1, 0])          # feed, POI
        self.assertEqual(p["turns"][0][4], "Ma-2")
        self.assertEqual(len(p["roads"]), 2)

    def test_tunnel_elevations_go_into_the_pack(self):
        # 6 km at 50 m spacing; a 200 m spike over 1.5 km in the middle = the hill above a tunnel
        pts = []
        for k in range(121):
            d = k * 50
            ele = 100 + max(0, 200 - abs(d - 3000) * 200 / 750)
            pts.append((LAT0, LON0 + d / 85_600, ele))
        fixed, tunnels = C.corrected_elevations(pts)
        self.assertEqual(len(tunnels), 1)
        self.assertLess(max(fixed), 110)
        self.assertEqual(C.corrected_elevations([(LAT0, LON0, 0.0), (LAT0, LON0 + 0.01, 0.0)]), (None, []))


class Storage(unittest.TestCase):
    def setUp(self):
        self.c = db()
        self.cache = str(tmpdir())
        seed_cache(self.cache)

    def tearDown(self):
        shutil.rmtree(self.cache, ignore_errors=True)

    def test_same_gpx_twice_is_one_course(self):
        a, created = C.create(self.c, None, GPX)
        b, again = C.create(self.c, "Other name", GPX)
        self.assertTrue(created)
        self.assertFalse(again)
        self.assertEqual(a["id"], b["id"])
        self.assertEqual(a["name"], "Inca junction")
        self.assertEqual(a["status"], "pending")

    def test_bad_gpx_is_refused(self):
        with self.assertRaises(Exception):
            C.create(self.c, None, "<gpx")
        with self.assertRaises(ValueError):
            C.create(self.c, None, '<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>'
                                   '<trkpt lat="1" lon="2"/></trkseg></trk></gpx>')

    def test_build_queue(self):
        a, _ = C.create(self.c, None, GPX)
        bad = self.c.execute("INSERT INTO coll_courses (name, gpx, gpx_sha1) VALUES ('Broken', '<gpx/>', 'x')").lastrowid
        self.assertTrue(C.needs_build(self.c))
        self.assertEqual(C.build_next(self.c, self.cache, log=lambda m: None), a["id"])
        self.assertEqual(C.build_next(self.c, self.cache, log=lambda m: None), bad)
        self.assertIsNone(C.build_next(self.c, self.cache, log=lambda m: None))
        ok = C.get(self.c, a["id"])
        self.assertEqual(ok["status"], "ready")
        self.assertEqual(ok["turns"][0]["road"], "Ma-2")
        self.assertTrue(ok["polyline"])
        data, etag = C.pack(self.c, a["id"])
        self.assertEqual(etag, C.sha1(data))
        self.assertEqual(C.get(self.c, bad)["status"], "failed")
        self.assertIsNone(C.pack(self.c, bad))
        self.assertFalse(C.needs_build(self.c))

    def test_recover_requeues_dead_builds_and_old_formats(self):
        a, _ = C.create(self.c, None, GPX)
        C.build_next(self.c, self.cache, log=lambda m: None)
        self.c.execute("UPDATE coll_courses SET pack_format='COL0' WHERE id=?", (a["id"],))
        self.c.execute("INSERT INTO coll_courses (name, gpx, gpx_sha1, status) VALUES ('x', '<gpx/>', 'y', 'building')")
        self.assertEqual(C.recover(self.c), 2)
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM coll_courses WHERE status='pending'").fetchone()[0], 2)

    def test_device_list_and_patch(self):
        a, _ = C.create(self.c, None, GPX)
        C.build_next(self.c, self.cache, log=lambda m: None)
        self.assertEqual([x["id"] for x in C.device_courses(self.c)], [a["id"]])
        C.update(self.c, a["id"], {"on_device": False, "cutoffs": "  ", "pack": b"no"})
        self.assertEqual(C.device_courses(self.c), [])
        self.assertIsNone(C.get(self.c, a["id"])["cutoffs"])
        self.assertTrue(C.rebuild(self.c, a["id"]))
        self.assertTrue(C.delete(self.c, a["id"]))
        self.assertIsNone(C.get(self.c, a["id"]))


class Settings(unittest.TestCase):
    def setUp(self):
        self.c = db()
        self.cache = str(tmpdir())
        seed_cache(self.cache)
        zones = [{"name": "Z1", "min_hr": 0, "max_hr": 136}, {"name": "Z2", "min_hr": 136, "max_hr": 151},
                 {"name": "Z3", "min_hr": 151, "max_hr": 158}, {"name": "Z4", "min_hr": 158, "max_hr": 168},
                 {"name": "Z5", "min_hr": 168, "max_hr": 999}]
        self.c.executescript(f"""
            INSERT INTO weight_log VALUES ('2026-11-01', 85.0), ('2026-11-04', 84.46);
            INSERT INTO user_profile VALUES (1, '1997-11-24');
            INSERT INTO app_settings VALUES ('fitness_age_sex', 'male'), ('timezone', 'Europe/Madrid');
            INSERT INTO athlete_zones (valid_from, sport, max_hr, threshold_hr, zones_json)
                VALUES ('2026-10-25', 'ride', 203, 168, '{json.dumps(zones)}'),
                       ('2026-12-01', 'ride', 203, 180, '[]');
            INSERT INTO race_goals VALUES (10, 'Mallorca 312', '2027-04-24', NULL);
        """)

    def tearDown(self):
        shutil.rmtree(self.cache, ignore_errors=True)

    def test_document(self):
        s = S.build(self.c, today=date(2026, 11, 5))
        self.assertEqual(s["profile"], {"weight_kg": 84.5, "age": 28, "sex": "male"})
        self.assertEqual(s["hr_zones"], [136, 151, 158, 168, 203])        # not the December row
        self.assertEqual(s["timezone"], "Europe/Madrid")
        self.assertIsNone(s["fuel_plan"])
        self.assertIsNone(s["cutoffs"])
        self.assertEqual(S.age_on("1997-11-24", date(2026, 11, 24)), 29)

    def test_race_course_cutoffs(self):
        a, _ = C.create(self.c, None, GPX, goal_id=10)
        C.build_next(self.c, self.cache, log=lambda m: None)
        C.update(self.c, a["id"], {"cutoffs": "Temps tall@13:30; 225@19:00 Sa Granja"})
        s = S.build(self.c, today=date(2026, 11, 5))
        self.assertEqual(s["cutoffs"], "Temps tall@13:30; 225@19:00 Sa Granja")
        self.assertIsNone(S.build(self.c, today=date(2027, 4, 25))["cutoffs"])   # race is over
        S.set_fuel_plan(self.c, "Water:20,Gel:40:25")
        self.assertEqual(S.build(self.c, today=date(2026, 11, 5))["fuel_plan"], "Water:20,Gel:40:25")

    def test_digest_follows_changes(self):
        d1 = S.sync(self.c, today=date(2026, 11, 5))["settings_sha1"]
        self.assertEqual(d1, S.sync(self.c, today=date(2026, 11, 5))["settings_sha1"])
        S.set_fuel_plan(self.c, "Gel:40:25")
        self.assertNotEqual(d1, S.sync(self.c, today=date(2026, 11, 5))["settings_sha1"])

    def test_validation(self):
        self.assertTrue(S.valid_fuel_plan("Water:20,Gel:40:25"))
        for bad in ("", "Gel", "Gel:x", "Gel:40:25:1", ":40"):
            self.assertFalse(S.valid_fuel_plan(bad), bad)
        with self.assertRaises(ValueError):
            S.set_fuel_plan(self.c, "every 20 min")
        self.assertTrue(S.valid_cutoffs("112.5@13:30 Lluc; Temps tall@19:00"))
        self.assertFalse(S.valid_cutoffs("Lluc 13:30"))


def ride_gpx(n: int) -> str:
    """Another valid GPX (a different course each n)."""
    return GPX.replace("<ele>100</ele>", f"<ele>{100 + n * 1000}</ele>")


class PlannedRoutes(unittest.TestCase):
    """Every routed session becomes a Coll course; each one rides with its own fuel plan."""

    def setUp(self):
        self.c = db()
        self.cache = str(tmpdir())
        seed_cache(self.cache)
        self.c.executescript("""
            INSERT INTO race_goals VALUES (10, 'Mallorca 312', '2027-04-24', NULL);
            INSERT INTO plan_sessions VALUES
                (1, 10, '2026-12-06', 'Cycling - Tour day', 'cycling', 'Z2', 240, 240),
                (2, 10, '2026-12-20', 'Cycling - Long ride', 'cycling', 'Z2', 75, 75),
                (3, 10, '2027-02-01', 'Cycling - Long ride', 'cycling', 'Z2', 300, 300),
                (4, 10, '2027-04-24', 'Race Day', 'cycling', 'Z2', 900, 900);
            INSERT INTO nutrition_products (id, name, kind, carbs_g, caffeine_mg, fluid_ml) VALUES
                (1, 'Caffeine gel', 'gel', 25, 100, 0), (2, 'Energy gel (generic)', 'gel', 25, 0, 0),
                (3, 'High-carb drink mix 500ml', 'drink_mix', 80, 0, 500);
            INSERT INTO weight_log VALUES ('2026-11-04', 84.5);
        """)

    def tearDown(self):
        shutil.rmtree(self.cache, ignore_errors=True)

    def build_all(self):
        while C.build_next(self.c, self.cache, log=lambda m: None) is not None:
            pass

    def test_session_gets_a_course_and_follows_new_routes(self):
        cid = C.attach_session(self.c, 1, GPX, "Pyrenees · Day 1")
        self.assertEqual(C.attach_session(self.c, 1, GPX), cid)             # same route: nothing to do
        self.build_all()
        self.assertEqual(C.get(self.c, cid)["status"], "ready")
        self.assertEqual(C.attach_session(self.c, 1, ride_gpx(1)), cid)     # new route: rebuilt
        self.assertEqual(C.get(self.c, cid)["status"], "pending")
        self.assertIsNone(C.attach_session(self.c, 2, "<gpx"))              # unreadable: ignored

    def test_the_same_loop_twice_reuses_the_pack(self):
        a = C.attach_session(self.c, 1, GPX)
        self.build_all()
        b = C.attach_session(self.c, 2, GPX)
        self.assertEqual(C.get(self.c, b)["status"], "ready")
        self.assertEqual(C.pack(self.c, a), C.pack(self.c, b))
        up, created = C.create(self.c, None, GPX)                           # an upload is still its own course
        self.assertTrue(created)

    def test_queue_builds_a_repeated_route_once(self):
        a, b = C.attach_session(self.c, 1, GPX), C.attach_session(self.c, 2, GPX)
        built = []
        from domains.coll import courses as mod
        real = mod.build_pack
        mod.build_pack = lambda *a, **k: built.append(1) or real(*a, **k)
        try:
            self.build_all()
        finally:
            mod.build_pack = real
        self.assertEqual(len(built), 1)
        self.assertEqual(C.pack(self.c, a), C.pack(self.c, b))

    def test_device_window(self):
        ids = {sid: C.attach_session(self.c, sid, ride_gpx(sid)) for sid in (1, 3, 4)}
        up, _ = C.create(self.c, "Home loop", ride_gpx(9))
        self.build_all()
        listed = lambda d: [x["id"] for x in C.device_courses(self.c, today=d)]
        self.assertEqual(listed(date(2026, 11, 20)), [ids[1], ids[4], up["id"]])  # Feb ride: too far ahead
        self.assertEqual(listed(date(2026, 12, 7)), [ids[1], ids[4], up["id"]])   # the day after: still there
        self.assertEqual(listed(date(2026, 12, 8)), [ids[4], up["id"]])
        self.assertEqual(listed(date(2027, 1, 20)), [ids[3], ids[4], up["id"]])
        self.assertEqual(C.get(self.c, ids[4])["goal_id"], 10)                    # race-day route = race course
        self.c.execute("UPDATE coll_courses SET session_id=NULL WHERE id=?", (ids[1],))   # session deleted
        self.assertNotIn(ids[1], listed(date(2026, 12, 6)))
        C.recover(self.c)
        self.assertIsNone(C.get(self.c, ids[1]))

    def test_fuel_follows_the_session_and_your_products(self):
        cid = C.attach_session(self.c, 1, GPX)                               # 4 h, 20 weeks out
        f = F.for_course(self.c, C.get(self.c, cid))
        self.assertEqual(f["source"], "planned session")
        self.assertEqual(f["fuel_plan"], "Gel:25:25,Drink:20")               # 60 g/h, the non-caffeine gel
        self.assertIn("Energy gel (generic)", f["note"])
        F.set_product(self.c, 3)                                             # the 80 g bottle instead
        self.assertEqual(F.for_course(self.c, C.get(self.c, cid))["fuel_plan"], "Bottle:60:80,Drink:20")
        short = C.attach_session(self.c, 2, ride_gpx(2))                     # 75 min: 30 g/h
        self.assertEqual(F.for_course(self.c, C.get(self.c, short))["fuel_plan"], "Bottle:60:80,Drink:20")
        C.update(self.c, cid, {"fuel_plan": "Gel:30:25"})
        self.assertEqual(F.for_course(self.c, C.get(self.c, cid))["source"], "course")

    def test_gut_training_ramps_towards_the_race(self):
        F.set_product(self.c, 2)
        early = F.for_course(self.c, C.get(self.c, C.attach_session(self.c, 1, ride_gpx(1))))   # 20 weeks out
        late = F.for_course(self.c, C.get(self.c, C.attach_session(self.c, 3, ride_gpx(3))))    # 11 weeks out
        race = F.for_course(self.c, C.get(self.c, C.attach_session(self.c, 4, ride_gpx(4))))    # race day
        self.assertIn("60 g/h", early["note"])
        self.assertIn("60 g/h", late["note"])
        self.assertIn("90 g/h", race["note"])
        self.assertEqual(race["fuel_plan"], "Gel:15:25,Drink:20")

    def test_race_nutrition_plan_wins_for_the_race(self):
        from domains.training.race_nutrition import build_race_plan
        plan = build_race_plan({"target_time": "5:30:00"}, weight_kg=84.5)
        self.c.execute("INSERT INTO race_nutrition_plans VALUES (10, ?)", (json.dumps(plan),))
        race = F.for_course(self.c, C.get(self.c, C.attach_session(self.c, 4, GPX)))
        self.assertEqual((race["fuel_plan"], race["source"]), ("Eat:30:40,Drink:20", "race nutrition plan"))

    def test_sync_carries_each_course_plan(self):
        C.attach_session(self.c, 1, GPX)
        self.build_all()
        S.set_fuel_plan(self.c, "Water:20")
        s = S.sync(self.c, today=date(2026, 12, 5))
        self.assertEqual([(x["date"], x["fuel_plan"]) for x in s["courses"]], [("2026-12-06", "Gel:25:25,Drink:20")])


class Token(unittest.TestCase):
    def test_closed_without_a_token(self):
        self.assertFalse(S.token_ok("anything", None))
        self.assertFalse(S.token_ok(None, "secret"))
        self.assertFalse(S.token_ok("wrong", "secret"))
        self.assertTrue(S.token_ok("secret", "secret"))

    def test_reads_env_file(self):
        d = tmpdir()
        (d / ".env").write_text("OTHER=1\nCOLL_TOKEN=abc123\n")
        old = os.environ.pop("COLL_TOKEN", None)
        try:
            self.assertEqual(S.expected_token(d / ".env"), "abc123")
        finally:
            if old is not None:
                os.environ["COLL_TOKEN"] = old
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
