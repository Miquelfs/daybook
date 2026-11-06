"""Coll: course packs built offline (fixture GPX + a cached Overpass answer), the pack format,
course storage and the build queue, the settings document, the device token, ride upload."""

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
from domains.coll import packread
from domains.coll import rides as R
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


read_pack = packread.read          # the device's reader (firmware Course::loadPack)


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

    def test_map_positions_from_the_pack(self):
        out = C.build_pack(GPX, self.cache, log=lambda m: None)
        g = packread.geometry(out["pack"])
        (t,) = g["turns"]
        jlat, jlon = _pt(4, 0)
        self.assertLess(abs(t["lat"] - jlat) * 111_000 + abs(t["lon"] - jlon) * 85_600, 50)   # at the junction
        self.assertEqual([w["kind"] for w in g["waypoints"]], ["feed", "poi"])
        self.assertAlmostEqual(g["km"], 0.88, delta=0.05)

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


START = 1796461200                    # 2026-12-05 09:00:00 UTC = 10:00 in Madrid


def coll_ride(seconds: int = 1800, start: int = START, name: str = "Ride", pause_at: int | None = None) -> bytes:
    """What Coll writes: 1 point/s along the fixture course and back, HR and cadence, one pause."""
    loop = (COURSE + COURSE[::-1]) * 5                   # ~8.8 km in 30 min
    line = [p for i, p in enumerate(loop) if i == 0 or p != loop[i - 1]]
    pts, out = [], []
    for s in range(seconds):
        f = (s / seconds) * (len(line) - 1)
        i = min(int(f), len(line) - 2)
        a, b = line[i], line[i + 1]
        k = f - i
        pts.append((a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k))
    iso = lambda t: __import__("datetime").datetime.utcfromtimestamp(t).strftime("%Y-%m-%dT%H:%M:%SZ")
    out.append('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Coll" '
               'xmlns="http://www.topografix.com/GPX/1/1" '
               'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">'
               f'<metadata><time>{iso(start)}</time></metadata><trk><name>{name}</name><type>cycling</type><trkseg>')
    for s, (la, lo) in enumerate(pts):
        t = start + s + (300 if pause_at is not None and s >= pause_at else 0)
        if pause_at is not None and s == pause_at:
            out.append("</trkseg><trkseg>")
        out.append(f'<trkpt lat="{la:.6f}" lon="{lo:.6f}"><ele>{100 + 20 * (s / seconds):.1f}</ele><time>{iso(t)}</time>'
                   f'<extensions><power>{150 + s % 7}</power><gpxtpx:TrackPointExtension><gpxtpx:hr>{120 + s % 10}'
                   f'</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>')
    out.append("</trkseg></trk></gpx>\n")
    return "".join(out).encode()


def clg(gpx: bytes) -> bytes:
    """The same ride as Coll's compact log (firmware ridelog.h / collog.py)."""
    p = R.parse_gpx(gpx)
    t0 = int(p["points"][0][0])
    name = (p["name"] or "").encode()
    b = bytearray(b"CLG1" + struct.pack("<qH", t0, len(name)) + name)
    last_seg = 0
    for t, la, lo, ele, hr, cad, pw, seg in p["points"]:
        flags = 1 | (4 if seg != last_seg else 0)
        last_seg = seg
        b += struct.pack("<IiiiHBBHBB", int(t) - t0, round(la * 1e7), round(lo * 1e7), round(ele * 100), 0,
                         hr or 0, 255 if cad is None else cad, 0xFFFF if pw is None else pw, flags, 9)
    return bytes(b + b"\x01\x02\x03")                 # + half a record, as after a crash


def rides_db() -> sqlite3.Connection:
    c = db()
    c.executescript("""
        DROP TABLE plan_sessions;
        CREATE TABLE plan_sessions (id INTEGER PRIMARY KEY, goal_id INTEGER, session_date TEXT, session_type TEXT,
                                    discipline TEXT, intensity_zone TEXT, duration_min INTEGER,
                                    effective_duration_min INTEGER, status TEXT DEFAULT 'pending',
                                    completed_activity_id TEXT);
        CREATE TABLE days (date TEXT PRIMARY KEY);
        CREATE TABLE activities (id TEXT PRIMARY KEY, date TEXT NOT NULL REFERENCES days(date), source TEXT NOT NULL,
            activity_type TEXT, name TEXT, start_time TEXT, duration_seconds INTEGER, moving_time_seconds INTEGER,
            distance_meters REAL, elevation_gain_meters REAL, avg_heart_rate INTEGER, max_heart_rate INTEGER,
            avg_speed_mps REAL, avg_power_watts INTEGER, calories INTEGER, training_stress_score REAL, polyline TEXT,
            start_lat REAL, start_lng REAL, raw_payload TEXT NOT NULL DEFAULT '{}', user_notes TEXT, user_rating INTEGER,
            updated_at TEXT);
        CREATE TABLE activity_streams (activity_id TEXT, stream_type TEXT, data_json TEXT,
                                       PRIMARY KEY (activity_id, stream_type));
        CREATE TABLE activity_detail (activity_id TEXT PRIMARY KEY, hr_tss REAL);
        CREATE TABLE fueling_logs (id INTEGER PRIMARY KEY, activity_id TEXT, carbs_g REAL);
    """)
    c.execute("PRAGMA foreign_keys=ON")
    return c


class Rides(unittest.TestCase):
    TZ = "Europe/Madrid"

    def setUp(self):
        self.c = rides_db()
        self.gpx = coll_ride(pause_at=900)

    def watch(self, start_local: str, seconds: int, aid: str = "garmin_1") -> None:
        self.c.execute("INSERT OR IGNORE INTO days VALUES (?)", (start_local[:10],))
        self.c.execute("INSERT INTO activities (id, date, source, activity_type, name, start_time, duration_seconds) "
                       "VALUES (?,?,?,?,?,?,?)", (aid, start_local[:10], "garmin", "cycling", "Morning ride",
                                                  start_local, seconds))

    def test_a_ride_becomes_an_activity(self):
        r, created = R.ingest(self.c, self.gpx, "2026-12-05T09:00:00Z", self.TZ)
        self.assertTrue(created)
        self.assertEqual((r["activity_id"], r["status"], r["format"]), ("coll_20261205T090000Z", "activity", "gpx"))
        a = self.c.execute("SELECT * FROM activities WHERE id=?", (r["activity_id"],)).fetchone()
        self.assertEqual((a["date"], a["start_time"], a["source"], a["activity_type"]),
                         ("2026-12-05", "2026-12-05 10:00:00", "coll", "cycling"))
        self.assertEqual(a["duration_seconds"], 1799 + 300)                 # elapsed, with the 5 min stop
        self.assertAlmostEqual(a["moving_time_seconds"], 1799, delta=10)   # the stop isn't moving time
        self.assertAlmostEqual(a["distance_meters"], 10 * 880, delta=150)
        self.assertEqual(a["avg_heart_rate"], 124)
        self.assertEqual(a["avg_power_watts"], 153)
        self.assertAlmostEqual(a["calories"], 153 * 1799 / 1000, delta=5)  # kJ of work
        self.assertGreater(a["elevation_gain_meters"], 10)
        st = {k: json.loads(v) for k, v in self.c.execute(
            "SELECT stream_type, data_json FROM activity_streams WHERE activity_id=?", (r["activity_id"],))}
        for k in ("sumduration", "directheartrate", "directspeed", "sumdistance", "directlatitude",
                  "directpower", "directbikecadence", "directelevation", "summovingduration"):
            self.assertEqual(len(st[k]), 1800, k)
        self.assertAlmostEqual(sum(st["directspeed"]) / 1800, 8800 / 1799, delta=0.3)

    def test_resending_is_idempotent(self):
        a, _ = R.ingest(self.c, self.gpx, "2026-12-05T09:00:00Z", self.TZ)
        b, created = R.ingest(self.c, self.gpx, "2026-12-05T09:00:00Z", self.TZ)
        self.assertFalse(created)
        self.assertEqual(a["activity_id"], b["activity_id"])
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM activities").fetchone()[0], 1)

    def test_the_compact_log_gives_the_same_ride(self):
        a, _ = R.ingest(self.c, self.gpx, "gpx", self.TZ)
        R.delete(self.c, a["id"])
        b, _ = R.ingest(self.c, clg(self.gpx), "clg", self.TZ)
        self.assertEqual(b["format"], "clg")
        for k in ("duration_s", "moving_s", "avg_hr", "avg_power", "segments"):
            self.assertEqual(a["summary"][k], b["summary"][k], k)
        self.assertAlmostEqual(a["summary"]["distance_m"], b["summary"]["distance_m"], delta=2)

    def test_named_after_the_course_it_followed(self):
        cache = str(tmpdir())
        seed_cache(cache)
        try:
            up, _ = C.create(self.c, "Inca loop", GPX)
            while C.build_next(self.c, cache, log=lambda m: None) is not None:
                pass
        finally:
            shutil.rmtree(cache, ignore_errors=True)
        r, _ = R.ingest(self.c, self.gpx, "a", self.TZ)                     # Coll called it "Ride": the map says
        self.assertEqual((r["name"], r["course_id"], r["summary"]["course"]["how"]), ("Inca loop", up["id"], "map"))
        r2, _ = R.ingest(self.c, coll_ride(start=START + 86400, name="inca LOOP"), "b", self.TZ)
        self.assertEqual(r2["summary"]["course"]["how"], "name")

    def test_the_watch_copy_wins_when_it_comes_later(self):
        r, _ = R.ingest(self.c, self.gpx, "x", self.TZ)
        aid = r["activity_id"]
        self.c.execute("UPDATE activities SET user_notes='felt strong' WHERE id=?", (aid,))
        self.c.execute("INSERT INTO fueling_logs (activity_id, carbs_g) VALUES (?, 60)", (aid,))
        self.c.execute("INSERT INTO activity_detail VALUES (?, 40)", (aid,))
        self.c.execute("INSERT INTO plan_sessions (id, session_date, status, completed_activity_id) "
                       "VALUES (7, '2026-12-05', 'completed', ?)", (aid,))
        self.watch("2026-12-05 10:01:30", 2000)
        self.assertEqual(R.reconcile(self.c, self.TZ, days=100000), [(aid, "garmin_1")])
        self.assertIsNone(self.c.execute("SELECT 1 FROM activities WHERE id=?", (aid,)).fetchone())
        self.assertIsNone(self.c.execute("SELECT 1 FROM activity_detail WHERE activity_id=?", (aid,)).fetchone())
        self.assertEqual(self.c.execute("SELECT user_notes FROM activities WHERE id='garmin_1'").fetchone()[0], "felt strong")
        self.assertEqual(self.c.execute("SELECT activity_id FROM fueling_logs").fetchone()[0], "garmin_1")
        self.assertEqual(self.c.execute("SELECT completed_activity_id FROM plan_sessions").fetchone()[0], "garmin_1")
        ride = R.list_rides(self.c)[0]
        self.assertEqual((ride["status"], ride["activity_id"], ride["activity_name"]), ("merged", "garmin_1", "Morning ride"))

    def test_a_ride_after_the_watch_copy_is_filed_against_it(self):
        self.watch("2026-12-05 09:58:00", 2200)
        r, _ = R.ingest(self.c, self.gpx, "x", self.TZ)
        self.assertEqual((r["status"], r["activity_id"]), ("merged", "garmin_1"))
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM activities WHERE source='coll'").fetchone()[0], 0)
        self.assertTrue(R.delete(self.c, r["id"]))                          # the watch's activity stays
        self.assertIsNotNone(self.c.execute("SELECT 1 FROM activities WHERE id='garmin_1'").fetchone())

    def test_a_watch_that_stopped_early_is_not_a_twin(self):
        self.watch("2026-12-05 10:00:10", 900)                              # half the ride
        r, _ = R.ingest(self.c, self.gpx, "x", self.TZ)
        self.assertEqual(r["status"], "activity")
        self.watch("2026-12-05 12:00:00", 2100, aid="garmin_2")             # a later ride the same day
        self.assertEqual(R.reconcile(self.c, self.TZ, days=100000), [])

    def test_reimport_and_delete(self):
        r, _ = R.ingest(self.c, self.gpx, "x", self.TZ)
        self.c.execute("UPDATE activities SET name='edited' WHERE id=?", (r["activity_id"],))
        again = R.reimport(self.c, r["id"], self.TZ)
        self.assertEqual(again["activity_id"], r["activity_id"])
        self.assertEqual(self.c.execute("SELECT name FROM activities").fetchone()[0], "Ride")
        self.assertTrue(R.delete(self.c, r["id"]))
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM activities").fetchone()[0], 0)
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM activity_streams").fetchone()[0], 0)

    def test_bad_rides_are_refused(self):
        for bad in (b"<gpx", b"<gpx></gpx>", coll_ride(seconds=30)):
            with self.assertRaises(ValueError):
                R.ingest(self.c, bad, None, self.TZ)

    def test_calories_from_heart_rate_without_power(self):
        self.assertEqual(R.calories(3600, None, None, {}), None)
        self.assertAlmostEqual(R.calories(3600, 140, None, {"weight": 84, "age": 40, "sex": "male"}), 830, delta=40)
        self.assertEqual(R.calories(3600, 140, 700, {}), 700)


class RoutePath(unittest.TestCase):
    """imported → converted → on Coll (as Coll reports it) → ridden"""

    def test_on_coll_only_when_coll_says_so(self):
        from domains.coll import device_state as D
        c = rides_db()
        cache = str(tmpdir())
        seed_cache(cache)
        try:
            up, _ = C.create(c, "Inca loop", GPX)
            off, _ = C.create(c, "Spare", ride_gpx(5))
            while C.build_next(c, cache, log=lambda m: None) is not None:
                pass
        finally:
            shutil.rmtree(cache, ignore_errors=True)
        C.update(c, off["id"], {"on_device": False})
        course = C.get(c, up["id"])
        listed = {x["id"] for x in C.device_courses(c)}
        self.assertEqual(D.steps(c, course, listed, D.state(c))["on_coll"], "next sync")     # offered, not taken
        D.report(c, {"have": [{"id": up["id"], "pack_sha1": "an older build"}], "battery_pct": 81})
        self.assertEqual(D.steps(c, course, listed, D.state(c))["on_coll"], "old version")
        dev = D.report(c, {"have": [{"id": up["id"], "pack_sha1": course["pack_sha1"]}], "firmware": "0.1"})
        self.assertEqual((dev["firmware"], dev["battery_pct"]), ("0.1", None))
        self.assertEqual(D.steps(c, course, listed, dev)["on_coll"], "yes")
        self.assertEqual(D.steps(c, C.get(c, off["id"]), listed, dev)["on_coll"], "no")
        r, _ = R.ingest(c, coll_ride(), "x", "Europe/Madrid")                              # rides it
        self.assertEqual(D.steps(c, course, listed, dev)["rides"],
                         [{"id": r["id"], "activity_id": r["activity_id"], "status": "activity", "date": "2026-12-05"}])
        with self.assertRaises(ValueError):
            D.report(c, {"have": [{"id": "x"}]})


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
