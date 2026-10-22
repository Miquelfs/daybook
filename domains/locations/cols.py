"""
Cols you've climbed — a personal MyCols.

Cols are OpenStreetMap passes (mountain_pass=yes) and named saddles, fetched
on demand in 0.5° tiles around your activities (each tile once, cached in
`col_tiles`). Mallorca's tiles are always fetched, so its road cols make a
complete "still to climb" list.

Only Garmin activity GPS is used (never the all-day phone location history), and
only outdoor bike rides count — no trainer rides, runs, hikes or walks.
An activity counts a col when its track passes within
~25–50 m of it (~40–80 m for older activities that only have the simplified
summary polyline). Each activity is scanned once (`col_scan`); visits land in
`col_visits`.

    python -m domains.locations.cols            # activities of the last 7 days
    python -m domains.locations.cols --all      # everything (first run / backfill)
"""

from __future__ import annotations

import math
import re
import sqlite3
import sys
import time
from datetime import date, timedelta

from domains.health.activity_analysis import is_indoor, sport_of
from domains.health.geo import Grid, activity_track, decode, dist_m, sample
from domains.locations import overpass

TILE = 0.5
BATCH = 12           # tiles per Overpass query
PAUSE_S = 8          # between queries — the public servers rate-limit bursts (HTTP 429)
def counts(activity_type: str | None) -> bool:
    """Outdoor bike rides only."""
    t = (activity_type or "").lower()
    return sport_of(t) == "ride" and not is_indoor(t)
MALLORCA = (39.25, 2.30, 39.97, 3.49)
ROAD_M = 30


def ensure_tables(conn) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS cols (
            osm_id   INTEGER PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
            ele      REAL, kind TEXT, on_road INTEGER, in_mallorca INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS idx_cols_latlng ON cols(lat, lng);
        CREATE TABLE IF NOT EXISTS col_tiles (tile TEXT PRIMARY KEY,
            fetched_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
        CREATE TABLE IF NOT EXISTS col_visits (osm_id INTEGER NOT NULL, activity_id TEXT NOT NULL, date TEXT NOT NULL,
            sport TEXT, PRIMARY KEY (osm_id, activity_id));
        CREATE INDEX IF NOT EXISTS idx_col_visits_date ON col_visits(date);
        CREATE TABLE IF NOT EXISTS col_scan (activity_id TEXT PRIMARY KEY,
            scanned_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
    """)


def _ele(v) -> float | None:
    m = re.match(r"\s*(-?\d+(?:[.,]\d+)?)", str(v or ""))
    return float(m.group(1).replace(",", ".")) if m else None


def _in_mallorca(lat: float, lng: float) -> bool:
    return MALLORCA[0] <= lat <= MALLORCA[2] and MALLORCA[1] <= lng <= MALLORCA[3]


def _tile(lat: float, lng: float) -> str:
    return f"{math.floor(lat / TILE)}:{math.floor(lng / TILE)}"


def _tile_bbox(t: str) -> tuple[float, float, float, float]:
    y, x = (int(v) for v in t.split(":"))
    return y * TILE, x * TILE, (y + 1) * TILE, (x + 1) * TILE


def _mallorca_tiles() -> set[str]:
    return {_tile(lat, lng) for lat in (MALLORCA[0], MALLORCA[2]) for lng in (MALLORCA[1], 2.75, MALLORCA[3])}


def _road_grid():
    try:
        from domains.locations.mallorca.coverage import reference
        from domains.health.geo import decode
    except Exception:
        return None
    g = Grid(ROAD_M)
    for p in reference()["pieces"]:
        for q in sample(decode(p[3]), 20):
            g.add(q)
    return g


def fetch_tiles(conn, tiles: set[str]) -> int:
    """Download passes + named saddles for tiles not cached yet: a few tiles per Overpass query, with a pause
    between queries so the public servers don't rate-limit us. Raises on failure; tiles already in stay cached."""
    have = {r[0] for r in conn.execute("SELECT tile FROM col_tiles")}
    todo = sorted(tiles - have)
    roads = None
    added = 0
    for i in range(0, len(todo), BATCH):
        if i:
            time.sleep(PAUSE_S)
        batch = todo[i:i + BATCH]
        parts = []
        for t in batch:
            s_, w, n, e = _tile_bbox(t)
            parts.append(f'node["mountain_pass"="yes"]["name"]({s_},{w},{n},{e});'
                         f'node["natural"="saddle"]["name"]({s_},{w},{n},{e});')
        data = overpass.query(f"[out:json][timeout:120];({''.join(parts)});out;", attempts=4, timeout_s=130, backoff_s=5)
        for el in data.get("elements", []):
            tg = el.get("tags", {})
            lat, lng = el["lat"], el["lon"]
            mall = _in_mallorca(lat, lng)
            on_road = None
            if mall:
                roads = roads if roads is not None else _road_grid()
                on_road = int(bool(roads and roads.near((lat, lng))))
            conn.execute("""INSERT OR REPLACE INTO cols (osm_id, name, lat, lng, ele, kind, on_road, in_mallorca)
                            VALUES (?,?,?,?,?,?,?,?)""",
                         (el["id"], tg["name"], lat, lng, _ele(tg.get("ele")),
                          "pass" if tg.get("mountain_pass") == "yes" else "saddle", on_road, int(mall)))
            added += 1
        conn.executemany("INSERT OR REPLACE INTO col_tiles (tile) VALUES (?)", [(t,) for t in batch])
        conn.commit()
    return added


def _tiles_of(track) -> set[str]:
    pts = sample(track, 2000) if len(track) > 1 else track      # 0.5° tiles: a point every 2 km is plenty
    return {_tile(*p) for p in pts} | ({_tile(*track[-1])} if track else set())


def scan_activity(conn, act) -> list[int]:
    """Cols this activity went over (and record them)."""
    track = activity_track(conn, act["id"], act["polyline"])
    if len(track) < 2:
        return []
    spacing = sum(dist_m(a, b) for a, b in zip(track, track[1:])) / (len(track) - 1)
    grid = Grid(25 if spacing <= 50 else 40, track[0][0])
    pts = sample(track, 20)
    for p in pts:
        grid.add(p)
    lat0, lat1 = min(p[0] for p in pts) - .01, max(p[0] for p in pts) + .01
    lng0, lng1 = min(p[1] for p in pts) - .01, max(p[1] for p in pts) + .01
    hit = []
    for c in conn.execute("SELECT osm_id, lat, lng FROM cols WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
                          (lat0, lat1, lng0, lng1)).fetchall():
        if grid.near((c["lat"], c["lng"])):
            hit.append(c["osm_id"])
            conn.execute("INSERT OR IGNORE INTO col_visits (osm_id, activity_id, date, sport) VALUES (?,?,?,?)",
                         (c["osm_id"], act["id"], act["date"], sport_of(act["activity_type"])))
    conn.execute("INSERT OR REPLACE INTO col_scan (activity_id) VALUES (?)", (act["id"],))
    conn.commit()
    return hit


# A Strava import of a ride Garmin already has (with its route) is the same ride — count it once.
_TWIN = """source='strava' AND EXISTS (
    SELECT 1 FROM activities g WHERE g.source='garmin' AND g.date = activities.date
      AND g.strava_id = CAST(SUBSTR(activities.id, 8) AS TEXT) AND g.polyline IS NOT NULL AND g.polyline != '')"""


def _has_twin_columns(conn) -> bool:
    return {"source", "strava_id"} <= {r[1] for r in conn.execute("PRAGMA table_info(activities)")}


def _drop_strava_twins(conn) -> int:
    """Remove visits recorded from Strava copies of Garmin rides (before this rule existed)."""
    if not _has_twin_columns(conn):
        return 0
    n = conn.execute(f"DELETE FROM col_visits WHERE activity_id IN (SELECT id FROM activities WHERE {_TWIN})").rowcount
    conn.commit()
    return n


def sync(conn, days: int | None = 7, verbose: bool = False) -> dict:
    """1. work out every map tile the pending rides need; 2. download the missing ones politely (stop at the
    first Overpass failure, keep what came in); 3. scan every ride whose tiles are all here — the rest wait
    for the next run."""
    ensure_tables(conn)
    _drop_strava_twins(conn)
    q = """SELECT id, date, activity_type, polyline FROM activities
           WHERE polyline IS NOT NULL AND polyline != '' AND id NOT IN (SELECT activity_id FROM col_scan)"""
    if _has_twin_columns(conn):
        q += f" AND NOT ({_TWIN})"
    params: tuple = ()
    if days is not None:
        q += " AND date >= ?"
        params = ((date.today() - timedelta(days=days)).isoformat(),)
    acts = [a for a in conn.execute(q + " ORDER BY date", params).fetchall() if counts(a["activity_type"])]
    need = {a["id"]: _tiles_of(decode(a["polyline"])) for a in acts}

    error = None
    try:
        fetch_tiles(conn, _mallorca_tiles())                      # home first: most rides only need these
        fetch_tiles(conn, set().union(*need.values()))
    except RuntimeError as e:                        # OSM busy / down: use what we have, retry the rest next run
        error = str(e)
        print(f"  cols: OpenStreetMap unavailable ({error[:120]}) — rides in areas not downloaded yet wait "
              f"for the next run", file=sys.stderr)
    have = {r[0] for r in conn.execute("SELECT tile FROM col_tiles")}

    found = scanned = waiting = 0
    for a in acts:
        if not need[a["id"]] <= have:
            waiting += 1
            continue
        hits = scan_activity(conn, a)
        scanned += 1
        found += len(hits)
        if verbose and hits:
            print(f"  {a['date']} {a['id']}: {len(hits)} col(s)", file=sys.stderr)
    out = {"scanned": scanned, "visits": found, "waiting": waiting}
    if error:
        out["error"] = error
    return out


# ── read side ────────────────────────────────────────────────────────────────

def summary(conn, home: tuple[float, float] | None = None) -> dict:
    try:
        ensure_tables(conn)
    except sqlite3.OperationalError:
        return {"total": 0, "climbed": [], "mallorca": None}
    rows = conn.execute(
        """SELECT c.*, COUNT(*) AS times, MIN(v.date) AS first_date, MAX(v.date) AS last_date,
                  GROUP_CONCAT(DISTINCT v.sport) AS sports,
                  (SELECT activity_id FROM col_visits v2 WHERE v2.osm_id = c.osm_id ORDER BY v2.date DESC LIMIT 1) AS last_activity_id
           FROM cols c JOIN col_visits v ON v.osm_id = c.osm_id
           GROUP BY c.osm_id ORDER BY last_date DESC, c.ele DESC""").fetchall()
    climbed = [{"osm_id": r["osm_id"], "name": r["name"], "ele": r["ele"], "lat": r["lat"], "lng": r["lng"],
                "kind": r["kind"], "times": r["times"], "first_date": r["first_date"], "last_date": r["last_date"],
                "last_activity_id": r["last_activity_id"], "sports": (r["sports"] or "").split(","),
                "in_mallorca": bool(r["in_mallorca"]), "on_road": r["on_road"]} for r in rows]
    year = str(date.today().year)
    mall_road = conn.execute("SELECT * FROM cols WHERE in_mallorca=1 AND on_road=1 ORDER BY ele DESC").fetchall()
    done = {c["osm_id"] for c in climbed}
    home = home or (39.5696, 2.6502)                     # Palma
    todo = sorted(({"osm_id": c["osm_id"], "name": c["name"], "ele": c["ele"], "lat": c["lat"], "lng": c["lng"],
                    "km_from_home": round(dist_m(home, (c["lat"], c["lng"])) / 1000, 1)}
                   for c in mall_road if c["osm_id"] not in done), key=lambda c: -(c["ele"] or 0))
    highest = max(climbed, key=lambda c: c["ele"] or 0, default=None)
    return {
        "total": len(climbed), "visits": sum(c["times"] for c in climbed),
        "this_year": sum(1 for c in climbed if (c["last_date"] or "") >= year and (c["first_date"] or "") >= year),
        "highest": highest, "climbed": climbed,
        "mallorca": {"road_total": len(mall_road),
                     "road_climbed": sum(1 for c in mall_road if c["osm_id"] in done),
                     "todo": todo},
    }


def for_activity(conn, activity_id: str) -> list[dict]:
    """Cols on one activity, each with how many times you've been there up to and including this one."""
    try:
        rows = conn.execute(
            """SELECT c.osm_id, c.name, c.ele, c.lat, c.lng, v.date,
                      (SELECT COUNT(*) FROM col_visits v2 WHERE v2.osm_id = c.osm_id
                         AND (v2.date < v.date OR (v2.date = v.date AND v2.activity_id <= v.activity_id))) AS nth,
                      (SELECT COUNT(*) FROM col_visits v3 WHERE v3.osm_id = c.osm_id) AS total
               FROM col_visits v JOIN cols c ON c.osm_id = v.osm_id
               WHERE v.activity_id = ? ORDER BY c.ele DESC""", (activity_id,)).fetchall()
    except sqlite3.OperationalError:
        return []
    return [{"osm_id": r["osm_id"], "name": r["name"], "ele": r["ele"], "nth": r["nth"], "total": r["total"],
             "first_time": r["nth"] == 1} for r in rows]


if __name__ == "__main__":
    from infrastructure.db.connection import get_connection
    c = get_connection()
    out = sync(c, None if "--all" in sys.argv else 7, verbose=True)
    print(f"cols: scanned {out['scanned']} rides, {out['visits']} col visits"
          + (f", {out['waiting']} rides waiting for map data (next run)" if out.get("waiting") else ""), file=sys.stderr)
    c.close()
