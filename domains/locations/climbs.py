"""
Climbs from your own elevation data — every real climb you've ridden, named and counted.

Cols only exist where OpenStreetMap tags a pass, so climbs that top out at a
viewpoint, a village or a plateau (most of Tenerife) never showed up. Here each
outdoor ride with Garmin streams (GPS + elevation + time) is resampled every
100 m and its climbs are found with the same finder as the GPX courses
(≥ 100 m gained at ≥ 3 % average, dips under 40 m tolerated).

Each climb's summit is named after what's there: a col / pass within 150 m
(then it is that col), else the nearest named viewpoint or peak within 300 m,
else the nearest village / hamlet / locality within 600 m, else "Climb to
1,234 m" (keyed by a ~400 m grid so repeats still add up). The side it was
ridden from is the nearest place to the climb's foot.

Per ascent: length, gain, avg / max gradient, time and VAM (m climbed per hour).

    python -m domains.locations.climbs            # rides of the last 7 days
    python -m domains.locations.climbs --all      # everything with streams
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
import time
from datetime import date, timedelta

from domains.health.geo import dist_m
from domains.locations import overpass
from domains.locations.cols import PAUSE_S, _drop_strava_twins, _ele, _has_twin_columns, _TWIN, counts, \
    ensure_tables as ensure_col_tables
from domains.training.gpx_course import STEP_M, climb_spans, climb_stats

MIN_GAIN_M, MIN_GRADE = 100, 0.03
NAME_RADIUS = {"col": 150, "viewpoint": 300, "peak": 300, "place": 600}
SIDE_RADIUS_M = 3000
UNNAMED_GRID = 0.004                      # ~400 m: repeats of an unnamed top still add up


def ensure_tables(conn) -> None:
    ensure_col_tables(conn)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS climb_poi (osm_id INTEGER PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL,
            lng REAL NOT NULL, kind TEXT NOT NULL, ele REAL);
        CREATE INDEX IF NOT EXISTS idx_climb_poi_latlng ON climb_poi(lat, lng);
        CREATE TABLE IF NOT EXISTS climb_poi_cells (cell TEXT PRIMARY KEY,
            fetched_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
        CREATE TABLE IF NOT EXISTS climbs (key TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
            lat REAL NOT NULL, lng REAL NOT NULL, ele REAL, osm_id INTEGER);
        CREATE TABLE IF NOT EXISTS climb_visits (climb_key TEXT NOT NULL, activity_id TEXT NOT NULL, date TEXT NOT NULL,
            side TEXT, length_km REAL, gain_m REAL, avg_pct REAL, max_pct REAL, secs REAL, vam REAL, top_ele REAL,
            PRIMARY KEY (climb_key, activity_id));
        CREATE INDEX IF NOT EXISTS idx_climb_visits_date ON climb_visits(date);
        CREATE TABLE IF NOT EXISTS climb_scan (activity_id TEXT PRIMARY KEY,
            scanned_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
    """)


# ── the ride's profile ───────────────────────────────────────────────────────

def _stream(raw: dict, *names: str) -> list | None:
    for n in names:
        if raw.get(n):
            return raw[n]
    return None


def ride_points(conn, activity_id: str) -> list[tuple[float, float, float, float]]:
    """(lat, lng, elevation, seconds) per stream sample — only samples with all four."""
    raw = {}
    for r in conn.execute("SELECT stream_type, data_json FROM activity_streams WHERE activity_id=?", (activity_id,)):
        try:
            raw[r[0].lower()] = json.loads(r[1])
        except (ValueError, TypeError):
            pass
    lat, lng = _stream(raw, "directlatitude", "latitude"), _stream(raw, "directlongitude", "longitude")
    ele = _stream(raw, "directelevation", "altitude", "elevation")
    t = _stream(raw, "sumduration", "sumelapsedduration", "time")
    if t is None and raw.get("directtimestamp"):
        ts = raw["directtimestamp"]
        t0 = next((x for x in ts if x is not None), 0)
        t = [(x - t0) / 1000 if x is not None else None for x in ts]
    if not (lat and lng and ele and t):
        return []
    n = min(len(lat), len(lng), len(ele), len(t))
    return [(lat[i], lng[i], ele[i], t[i]) for i in range(n)
            if None not in (lat[i], lng[i], ele[i], t[i]) and (lat[i] or lng[i])]


def resample(pts: list[tuple[float, float, float, float]], step: float = STEP_M) -> list[tuple[float, float, float, float]]:
    """Every `step` metres along the track, each field interpolated."""
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + dist_m(a[:2], b[:2]))
    out, j, d = [], 0, 0.0
    while d <= cum[-1]:
        while j < len(cum) - 2 and cum[j + 1] < d:
            j += 1
        span = cum[j + 1] - cum[j] or 1.0
        f = min(1.0, max(0.0, (d - cum[j]) / span))
        a, b = pts[j], pts[j + 1]
        out.append(tuple(a[k] + (b[k] - a[k]) * f for k in range(4)))
        d += step
    return out


def find_climbs(pts) -> list[dict]:
    if len(pts) < 20:
        return []
    prof = resample(pts)
    eles = [p[2] for p in prof]
    out = []
    for a, b in climb_spans(eles, MIN_GAIN_M, MIN_GRADE):
        st = climb_stats(eles, a, b)
        secs = max(0.0, prof[b][3] - prof[a][3])
        out.append(st | {"foot": prof[a][:2], "top": prof[b][:2], "top_ele": round(prof[b][2]),
                         "secs": round(secs), "vam": round(st["gain_m"] / (secs / 3600)) if secs > 60 else None})
    return out


# ── naming ───────────────────────────────────────────────────────────────────

CELL = 0.01                    # ~1 km naming cells
NEAR_M, PLACE_M = 1400, 3600   # around a cell centre: covers the 150–600 m naming radii / the 3 km side radius
CELLS_PER_QUERY = 25


def cell(p) -> str:
    return f"{round(p[0] / CELL) * CELL:.2f}:{round(p[1] / CELL) * CELL:.2f}"


def fetch_poi_cells(conn, cells: set[str]) -> None:
    """Named passes, viewpoints, peaks (≤ 1.4 km) and villages (≤ 3.6 km) around each cell — small queries that
    overloaded public Overpass servers still answer. Raises on failure; cells already in stay cached."""
    have = {r[0] for r in conn.execute("SELECT cell FROM climb_poi_cells")}
    todo = sorted(cells - have)
    for i in range(0, len(todo), CELLS_PER_QUERY):
        if i:
            time.sleep(PAUSE_S)
        batch = todo[i:i + CELLS_PER_QUERY]
        parts = []
        for c in batch:
            lat, lng = c.split(":")
            near, far = f"(around:{NEAR_M},{lat},{lng})", f"(around:{PLACE_M},{lat},{lng})"
            parts.append(f'node["mountain_pass"="yes"]["name"]{near};node["natural"="saddle"]["name"]{near};'
                         f'node["tourism"="viewpoint"]["name"]{near};node["natural"="peak"]["name"]{near};'
                         f'node["place"~"^(town|village|hamlet|locality|isolated_dwelling)$"]["name"]{far};')
        data = overpass.query(f"[out:json][timeout:90];({''.join(parts)});out;", attempts=4, timeout_s=100, backoff_s=5)
        for el in data.get("elements", []):
            tg = el.get("tags", {})
            kind = ("col" if tg.get("mountain_pass") == "yes" or tg.get("natural") == "saddle" else
                    "viewpoint" if tg.get("tourism") == "viewpoint" else "peak" if tg.get("natural") == "peak" else "place")
            conn.execute("INSERT OR REPLACE INTO climb_poi VALUES (?,?,?,?,?,?)",
                         (el["id"], tg["name"], el["lat"], el["lon"], kind, _ele(tg.get("ele"))))
        conn.executemany("INSERT OR REPLACE INTO climb_poi_cells (cell) VALUES (?)", [(c,) for c in batch])
        conn.commit()


def _nearest(conn, table: str, p, radius_m: float, where: str = "", params: tuple = ()):
    d = radius_m / 110_540
    dl = d / max(0.2, math.cos(math.radians(p[0])))
    best, best_d = None, radius_m
    for r in conn.execute(f"SELECT * FROM {table} WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? {where}",
                          (p[0] - d, p[0] + d, p[1] - dl, p[1] + dl, *params)).fetchall():
        dd = dist_m(p, (r["lat"], r["lng"]))
        if dd <= best_d:
            best, best_d = r, dd
    return best


def name_summit(conn, top, top_ele: float) -> dict:
    col = _nearest(conn, "cols", top, NAME_RADIUS["col"])
    poi_col = _nearest(conn, "climb_poi", top, NAME_RADIUS["col"], "AND kind='col'")
    if not col and poi_col:
        return {"key": f"osm:{poi_col['osm_id']}", "name": poi_col["name"], "kind": "col", "lat": poi_col["lat"],
                "lng": poi_col["lng"], "ele": poi_col["ele"] or top_ele, "osm_id": poi_col["osm_id"]}
    if col:
        return {"key": f"osm:{col['osm_id']}", "name": col["name"], "kind": "col", "lat": col["lat"],
                "lng": col["lng"], "ele": col["ele"] or top_ele, "osm_id": col["osm_id"]}
    for kind in ("viewpoint", "peak", "place"):
        poi = _nearest(conn, "climb_poi", top, NAME_RADIUS[kind], "AND kind=?", (kind,))
        if poi:
            return {"key": f"osm:{poi['osm_id']}", "name": poi["name"], "kind": kind, "lat": poi["lat"],
                    "lng": poi["lng"], "ele": top_ele, "osm_id": poi["osm_id"]}
    g = (round(top[0] / UNNAMED_GRID) * UNNAMED_GRID, round(top[1] / UNNAMED_GRID) * UNNAMED_GRID)
    near = _nearest(conn, "climb_poi", top, PLACE_M - 700, "AND kind='place'")
    label = f"Climb to {round(top_ele):,} m" + (f" near {near['name']}" if near else "")
    return {"key": f"geo:{g[0]:.3f}:{g[1]:.3f}", "name": label, "kind": "summit", "lat": top[0], "lng": top[1],
            "ele": top_ele, "osm_id": None}


def _side(conn, foot) -> str | None:
    r = _nearest(conn, "climb_poi", foot, SIDE_RADIUS_M, "AND kind='place'")
    return r["name"] if r else None


# ── scan ─────────────────────────────────────────────────────────────────────

def scan_activity(conn, act, found: list[dict] | None = None) -> list[str]:
    found = find_climbs(ride_points(conn, act["id"])) if found is None else found
    keys = []
    for c in found:
        s = name_summit(conn, c["top"], c["top_ele"])
        conn.execute("INSERT OR IGNORE INTO climbs (key, name, kind, lat, lng, ele, osm_id) VALUES (?,?,?,?,?,?,?)",
                     (s["key"], s["name"], s["kind"], s["lat"], s["lng"], s["ele"], s["osm_id"]))
        conn.execute("""INSERT OR REPLACE INTO climb_visits (climb_key, activity_id, date, side, length_km, gain_m,
                        avg_pct, max_pct, secs, vam, top_ele) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                     (s["key"], act["id"], act["date"], _side(conn, c["foot"]), c["length_km"], c["gain_m"],
                      c["avg_pct"], c["max_200m_pct"], c["secs"], c["vam"], c["top_ele"]))
        keys.append(s["key"])
    conn.execute("INSERT OR REPLACE INTO climb_scan (activity_id) VALUES (?)", (act["id"],))
    conn.commit()
    return keys


def sync(conn, days: int | None = 7, verbose: bool = False) -> dict:
    """Rides with streams not scanned yet: find climbs, fetch names for their areas (politely), record them.
    Rides whose areas can't be downloaded right now wait for the next run."""
    ensure_tables(conn)
    _drop_strava_twins(conn)
    q = """SELECT id, date, activity_type FROM activities
           WHERE id NOT IN (SELECT activity_id FROM climb_scan)
             AND id IN (SELECT activity_id FROM activity_streams WHERE stream_type IN ('directelevation','altitude'))"""
    if _has_twin_columns(conn):
        q += f" AND NOT ({_TWIN})"
    params: tuple = ()
    if days is not None:
        q += " AND date >= ?"
        params = ((date.today() - timedelta(days=days)).isoformat(),)
    acts = [a for a in conn.execute(q + " ORDER BY date", params).fetchall() if counts(a["activity_type"])]
    pending, no_data = [], 0
    for a in acts:
        pts = ride_points(conn, a["id"])
        if len(pts) < 20:                     # GPS / elevation / time incomplete: don't mark it done
            no_data += 1
            continue
        found = find_climbs(pts)
        cells = {cell(c[k]) for c in found for k in ("top", "foot")}
        pending.append((a, found, cells))
    error = None
    try:
        fetch_poi_cells(conn, set().union(*(c for _, _, c in pending)) if pending else set())
    except RuntimeError as e:
        error = str(e)
        print(f"  climbs: OpenStreetMap unavailable ({error[:120]}) — some rides wait for the next run", file=sys.stderr)
    have = {r[0] for r in conn.execute("SELECT cell FROM climb_poi_cells")}
    scanned = climbs = waiting = 0
    for a, found, cells in pending:
        if not cells <= have:
            waiting += 1
            continue
        keys = scan_activity(conn, a, found)
        scanned += 1
        climbs += len(keys)
        if verbose and keys:
            print(f"  {a['date']} {a['id']}: {len(keys)} climb(s)", file=sys.stderr)
    out = {"scanned": scanned, "climbs": climbs, "waiting": waiting, "no_data": no_data}
    if error:
        out["error"] = error
    return out


# ── read side ────────────────────────────────────────────────────────────────

def summary(conn) -> dict:
    try:
        ensure_tables(conn)
    except sqlite3.OperationalError:
        return {"total": 0, "climbs": []}
    rows = conn.execute(
        """SELECT c.*, COUNT(*) AS times, MIN(v.date) AS first_date, MAX(v.date) AS last_date,
                  MAX(v.vam) AS best_vam, MAX(v.gain_m) AS max_gain, MAX(v.top_ele) AS top_ele,
                  GROUP_CONCAT(DISTINCT v.side) AS sides,
                  (SELECT activity_id FROM climb_visits v2 WHERE v2.climb_key = c.key ORDER BY v2.date DESC LIMIT 1) AS last_activity_id,
                  (SELECT length_km FROM climb_visits v3 WHERE v3.climb_key = c.key ORDER BY v3.gain_m DESC LIMIT 1) AS length_km,
                  (SELECT avg_pct FROM climb_visits v4 WHERE v4.climb_key = c.key ORDER BY v4.gain_m DESC LIMIT 1) AS avg_pct
           FROM climbs c JOIN climb_visits v ON v.climb_key = c.key
           GROUP BY c.key ORDER BY max_gain DESC""").fetchall()
    out = [{"key": r["key"], "name": r["name"], "kind": r["kind"], "lat": r["lat"], "lng": r["lng"],
            "ele": round(r["top_ele"] or r["ele"] or 0), "times": r["times"], "first_date": r["first_date"],
            "last_date": r["last_date"], "last_activity_id": r["last_activity_id"], "best_vam": r["best_vam"],
            "gain_m": round(r["max_gain"] or 0), "length_km": r["length_km"], "avg_pct": r["avg_pct"],
            "sides": [x for x in (r["sides"] or "").split(",") if x]} for r in rows]
    return {"total": len(out), "ascents": sum(c["times"] for c in out),
            "metres": round(conn.execute("SELECT COALESCE(SUM(gain_m),0) FROM climb_visits").fetchone()[0]),
            "climbs": out}


def for_activity(conn, activity_id: str) -> list[dict]:
    try:
        rows = conn.execute(
            """SELECT c.key, c.name, c.kind, v.*,
                      (SELECT COUNT(*) FROM climb_visits v2 WHERE v2.climb_key = c.key AND v2.date <= v.date) AS nth,
                      (SELECT MAX(vam) FROM climb_visits v3 WHERE v3.climb_key = c.key AND v3.activity_id != v.activity_id
                         AND v3.date <= v.date) AS prev_best_vam
               FROM climb_visits v JOIN climbs c ON c.key = v.climb_key
               WHERE v.activity_id = ? ORDER BY v.gain_m DESC""", (activity_id,)).fetchall()
    except sqlite3.OperationalError:
        return []
    return [{"key": r["key"], "name": r["name"], "kind": r["kind"], "side": r["side"], "length_km": r["length_km"],
             "gain_m": round(r["gain_m"]), "avg_pct": r["avg_pct"], "max_pct": r["max_pct"], "secs": r["secs"],
             "vam": r["vam"], "top_ele": r["top_ele"], "nth": r["nth"], "first_time": r["nth"] == 1,
             "best_vam": bool(r["vam"] and r["prev_best_vam"] and r["vam"] > r["prev_best_vam"])} for r in rows]


if __name__ == "__main__":
    from infrastructure.db.connection import get_connection
    c = get_connection()
    if "--all" in sys.argv:                  # re-check rides recorded without climbs (cheap: no network unless named)
        ensure_tables(c)
        c.execute("DELETE FROM climb_scan WHERE activity_id NOT IN (SELECT activity_id FROM climb_visits)")
        c.commit()
    out = sync(c, None if "--all" in sys.argv else 7, verbose=True)
    print(f"climbs: scanned {out['scanned']} rides, {out['climbs']} climbs"
          + (f", {out['waiting']} rides waiting for map data (next run)" if out.get("waiting") else "")
          + (f", {out['no_data']} rides without full GPS/elevation/time" if out.get("no_data") else ""), file=sys.stderr)
    c.close()
