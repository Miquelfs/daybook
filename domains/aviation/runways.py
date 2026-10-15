"""
Landing runway for every flight — measured when possible, inferred otherwise.

Sources, best first (a better source never gets overwritten by a worse one):
  manual  you set it                                                  (exact)
  adsb    the aircraft's own ADS-B track from OpenSky Network: the final
          approach points line up with one runway end — heading within 25°,
          then the smallest cross-track distance to its centreline picks
          between parallels (06L vs 06R)                               (measured)
          OpenSky only keeps tracks ~30 days, so this runs nightly for
          recent landings. Registration → ICAO24 hex via hexdb.io (cached).
  wind    the runway end with the most headwind from the landing METAR —
          only when the wind is ≥ 5 kt and clearly favours one direction  (likely)

Runway data: OurAirports runways.csv (public domain), only the airports in your
logbook, refreshed every ~6 months. With the runway known, crosswind and
headwind components at landing are computed for the weather × stress analysis.

  python -m domains.aviation.runways            # nightly: ADS-B for the last ~29 days + wind inference
  python -m domains.aviation.runways --refresh  # re-download runway data
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sqlite3
import statistics
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

RUNWAYS_CSV = "https://davidmegginson.github.io/ourairports-data/runways.csv"
OPENSKY_TRACK = "https://opensky-network.org/api/tracks/all?icao24={hex}&time={t}"
HEXDB = "https://hexdb.io/reg-hex?reg={reg}"
UA = {"User-Agent": "daybook-logbook/1.0 (personal logbook)"}
SOURCE_RANK = {"manual": 3, "adsb": 2, "wind": 1}


def _get(url: str, timeout: int = 60) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def ensure_tables(conn) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS airport_runways (
            icao TEXT, ident TEXT, lat REAL, lon REAL, heading REAL, length_ft INTEGER,
            loaded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            PRIMARY KEY (icao, ident));
        CREATE TABLE IF NOT EXISTS flight_runways (
            flight_id TEXT PRIMARY KEY, runway TEXT, source TEXT, confidence TEXT,
            crosswind_kt REAL, headwind_kt REAL, details TEXT,
            updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
        CREATE TABLE IF NOT EXISTS aircraft_hex (reg TEXT PRIMARY KEY, hex TEXT);""")
    conn.commit()


# ── runway data ──────────────────────────────────────────────────────────────

def load_runways(conn, fetcher=None, force: bool = False, only: set[str] | None = None) -> int:
    """Load runway ends for the logbook's airports (or just `only`, e.g. a new
    airport typed into the add-flight form)."""
    ensure_tables(conn)
    if only is None:
        fresh = conn.execute("SELECT MIN(loaded_at) FROM airport_runways").fetchone()[0]
        if fresh and not force and fresh > (datetime.now(timezone.utc) - timedelta(days=180)).strftime("%Y-%m-%d"):
            return 0
    wanted = only or {r[0] for r in conn.execute(
        """SELECT COALESCE(dep_icao, (SELECT icao FROM airports WHERE iata = flights.dep_iata LIMIT 1)) FROM flights
           UNION SELECT COALESCE(arr_icao, (SELECT icao FROM airports WHERE iata = flights.arr_iata LIMIT 1)) FROM flights""")
        if r[0]}
    text = (fetcher or _get)(RUNWAYS_CSV)
    n = 0
    for row in csv.DictReader(io.StringIO(text)):
        icao = row.get("airport_ident")
        if icao not in wanted or row.get("closed") == "1":
            continue
        for end in ("le", "he"):
            ident = row.get(f"{end}_ident")
            try:
                lat, lon = float(row[f"{end}_latitude_deg"]), float(row[f"{end}_longitude_deg"])
            except (KeyError, ValueError):
                continue
            hdg = row.get(f"{end}_heading_degT")
            try:
                heading = float(hdg)
            except (TypeError, ValueError):
                digits = "".join(ch for ch in (ident or "") if ch.isdigit())
                if not digits:
                    continue
                heading = int(digits) * 10.0   # magnetic-ish fallback from the designator
            conn.execute("INSERT OR REPLACE INTO airport_runways (icao, ident, lat, lon, heading, length_ft) "
                         "VALUES (?,?,?,?,?,?)", (icao, ident, lat, lon, heading,
                                                  int(float(row["length_ft"])) if row.get("length_ft") else None))
            n += 1
    conn.commit()
    return n


def runways_for(conn, icao: str, fetcher=None) -> list[str]:
    """Runway designators at an airport, downloading its data on first use."""
    ensure_tables(conn)
    icao = icao.upper()
    if not runway_ends(conn, icao):
        try:
            load_runways(conn, fetcher=fetcher, only={icao})
        except Exception:
            return []
    return sorted({e["ident"] for e in runway_ends(conn, icao)})


def runway_ends(conn, icao: str) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT ident, lat, lon, heading, length_ft FROM airport_runways WHERE icao=?", (icao,))]


# ── geometry ─────────────────────────────────────────────────────────────────

def _angle_diff(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def _local_xy(lat0, lon0, lat, lon):
    return ((lon - lon0) * math.cos(math.radians(lat0)) * 111_320, (lat - lat0) * 110_540)


def wind_components(wind_dir: float | None, wind_kt: float | None, rwy_heading: float) -> tuple[float, float] | None:
    """(headwind, crosswind) in kt for landing on a runway with true heading rwy_heading."""
    if wind_dir is None or wind_kt is None:
        return None
    a = math.radians(wind_dir - rwy_heading)
    return round(wind_kt * math.cos(a), 1), round(abs(wind_kt * math.sin(a)), 1)


def from_wind(ends: list[dict], wind_dir, wind_kt) -> dict | None:
    if wind_dir is None or (wind_kt or 0) < 5 or not ends:
        return None
    scored = sorted(((wind_components(wind_dir, wind_kt, e["heading"])[0], e) for e in ends), key=lambda x: -x[0])
    best_hw, best = scored[0]
    # the opposite direction must be clearly worse (parallels tie — then pick none of them blindly)
    opposite = [hw for hw, e in scored if _angle_diff(e["heading"], best["heading"]) > 90]
    if best_hw < 3 or (opposite and best_hw - max(opposite) < 5):
        return None
    parallels = [e for hw, e in scored if _angle_diff(e["heading"], best["heading"]) < 10]
    ident = best["ident"] if len(parallels) == 1 else "/".join(sorted(p["ident"] for p in parallels))
    return {"runway": ident, "confidence": "likely", "heading": best["heading"]}


def from_track(path: list, ends: list[dict]) -> dict | None:
    """OpenSky path [[t, lat, lon, baro_alt_m, true_track, on_ground], …] → landing runway."""
    if not path or not ends:
        return None
    pts = [p for p in path if p[1] is not None and p[2] is not None and p[4] is not None]
    airborne = [p for p in pts if not p[5]]
    if len(airborne) < 3:
        return None
    final = airborne[-8:]
    track = statistics.median(p[4] for p in final)
    best = None
    for e in ends:
        if _angle_diff(track, e["heading"]) > 25:
            continue
        ux, uy = math.sin(math.radians(e["heading"])), math.cos(math.radians(e["heading"]))
        xs = []
        for p in final:
            x, y = _local_xy(e["lat"], e["lon"], p[1], p[2])
            along = x * ux + y * uy
            if -15_000 <= along <= 1_000:
                xs.append(abs(x * uy - y * ux))
        if len(xs) < 2:
            continue
        cross = statistics.median(xs)
        if cross < 800 and (best is None or cross < best[0]):
            best = (cross, e)
    if not best:
        return None
    return {"runway": best[1]["ident"], "confidence": "measured", "heading": best[1]["heading"],
            "cross_track_m": round(best[0])}


# ── sync ─────────────────────────────────────────────────────────────────────

def _dt(v):
    if not v:
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _hex_for(conn, reg: str, fetcher) -> str | None:
    row = conn.execute("SELECT hex FROM aircraft_hex WHERE reg=?", (reg,)).fetchone()
    if row:
        return row[0] or None
    try:
        h = fetcher(HEXDB.format(reg=reg), timeout=20).strip().lower()
        h = h if len(h) == 6 and all(c in "0123456789abcdef" for c in h) else None
    except Exception:
        return None            # transient — retry next run
    conn.execute("INSERT OR REPLACE INTO aircraft_hex (reg, hex) VALUES (?,?)", (reg, h))
    return h


def _store(conn, fid, res, source, wind) -> None:
    cur = conn.execute("SELECT source FROM flight_runways WHERE flight_id=?", (fid,)).fetchone()
    if cur and SOURCE_RANK.get(cur[0], 0) > SOURCE_RANK[source]:
        return
    comps = wind_components(wind[0], wind[1], res["heading"]) if wind else None
    conn.execute(
        """INSERT OR REPLACE INTO flight_runways (flight_id, runway, source, confidence, headwind_kt, crosswind_kt, details)
           VALUES (?,?,?,?,?,?,?)""",
        (fid, res["runway"], source, res["confidence"], comps[0] if comps else None, comps[1] if comps else None,
         json.dumps({k: v for k, v in res.items() if k not in ("runway", "confidence")})))


def sync(conn: sqlite3.Connection, adsb_days: int = 29, fetcher=None, verbose: bool = True) -> dict:
    fetcher = fetcher or _get
    ensure_tables(conn)
    try:
        load_runways(conn, fetcher=lambda url: fetcher(url))
    except Exception as e:
        if verbose:
            print(f"  runway data: {e}", file=sys.stderr)
    stats = {"adsb": 0, "wind": 0, "no_track": 0, "errors": 0}
    has_metars = bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name='flight_metars'").fetchone())
    rows = conn.execute(
        f"""SELECT f.id, COALESCE(f.arr_icao, (SELECT icao FROM airports WHERE iata = f.arr_iata LIMIT 1)) AS arr_icao,
                   f.aircraft_reg, f.landing_utc, f.on_block_utc, fr.source AS have
                   {", m.wind_dir, m.wind_kt" if has_metars else ", NULL AS wind_dir, NULL AS wind_kt"}
            FROM flights f
            LEFT JOIN flight_runways fr ON fr.flight_id = f.id
            {"LEFT JOIN flight_metars m ON m.flight_id = f.id AND m.phase = 'landing'" if has_metars else ""}
            WHERE f.is_sim = 0""").fetchall()
    cutoff = datetime.now(timezone.utc) - timedelta(days=adsb_days)
    for r in rows:
        if r["have"] == "manual" or not r["arr_icao"]:
            continue
        ends = runway_ends(conn, r["arr_icao"])
        if not ends:
            continue
        wind = (r["wind_dir"], r["wind_kt"]) if r["wind_dir"] is not None else None
        landed = _dt(r["landing_utc"]) or _dt(r["on_block_utc"])
        if r["have"] != "adsb" and landed and landed >= cutoff and r["aircraft_reg"]:
            hexid = _hex_for(conn, r["aircraft_reg"].replace(" ", ""), lambda u, timeout=20: fetcher(u))
            if hexid:
                try:
                    t = int((landed - timedelta(minutes=20)).timestamp())
                    data = json.loads(fetcher(OPENSKY_TRACK.format(hex=hexid, t=t)))
                    res = from_track(data.get("path") or [], ends)
                    if res:
                        _store(conn, r["id"], res, "adsb", wind)
                        stats["adsb"] += 1
                        conn.commit()
                        time.sleep(1.0)
                        continue
                    stats["no_track"] += 1
                except Exception:
                    stats["errors"] += 1
                time.sleep(1.0)
        if not r["have"] and wind:
            res = from_wind(ends, *wind)
            if res:
                _store(conn, r["id"], res, "wind", wind)
                stats["wind"] += 1
    conn.commit()
    return stats


def set_manual(conn, flight_id: str, runway: str) -> dict:
    ensure_tables(conn)
    f = conn.execute("SELECT COALESCE(arr_icao, (SELECT icao FROM airports WHERE iata = flights.arr_iata LIMIT 1)) "
                     "AS arr_icao FROM flights WHERE id=?", (flight_id,)).fetchone()
    if not f:
        raise ValueError("flight not found")
    rw = runway.strip().upper()
    end = next((e for e in runway_ends(conn, f["arr_icao"]) if e["ident"].upper() == rw), None)
    wind = None
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name='flight_metars'").fetchone():
        m = conn.execute("SELECT wind_dir, wind_kt FROM flight_metars WHERE flight_id=? AND phase='landing'",
                         (flight_id,)).fetchone()
        wind = (m["wind_dir"], m["wind_kt"]) if m and m["wind_dir"] is not None else None
    res = {"runway": rw, "confidence": "exact", "heading": end["heading"] if end else None}
    comps = wind_components(wind[0], wind[1], end["heading"]) if (wind and end) else None
    conn.execute(
        """INSERT OR REPLACE INTO flight_runways (flight_id, runway, source, confidence, headwind_kt, crosswind_kt, details)
           VALUES (?,?,?,?,?,?,?)""",
        (flight_id, rw, "manual", "exact", comps[0] if comps else None, comps[1] if comps else None, None))
    conn.commit()
    return {**res, "headwind_kt": comps[0] if comps else None, "crosswind_kt": comps[1] if comps else None}


def main() -> None:
    from infrastructure.db.connection import get_connection

    p = argparse.ArgumentParser(description="Landing runways (ADS-B / wind / manual)")
    p.add_argument("--refresh", action="store_true", help="re-download runway data")
    args = p.parse_args()
    conn = get_connection()
    try:
        if args.refresh:
            print(f"runway ends loaded: {load_runways(conn, force=True)}", file=sys.stderr)
        print(f"runways: {sync(conn)}", file=sys.stderr)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
