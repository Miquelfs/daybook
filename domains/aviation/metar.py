"""
METARs for every takeoff and landing — fetched from the Iowa Environmental
Mesonet archive (free, global, historical: mesonet.agron.iastate.edu), decoded,
and stored per flight phase in flight_metars.

For each flight: the observation at the departure airport closest before the
takeoff (fallback: off-block + 10 min) and at the arrival airport closest before
the landing (fallback: on-block − 5 min). "Before" within 75 min; if none, the
first one within 30 min after.

Decoded: wind dir/speed/gust (kt), visibility (m), ceiling (ft, lowest BKN/OVC/VV),
weather (RA, TS, FG…), CB/TCU, temp/dew, QNH, flight category (VFR/MVFR/IFR/LIFR).

  python -m domains.aviation.metar             # flights from the last 30 days lacking METARs
  python -m domains.aviation.metar --days 3650 # backfill the whole logbook (polite: 1 req/s)
"""

from __future__ import annotations

import argparse
import csv
import io
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

IEM_URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
BEFORE = timedelta(minutes=75)
AFTER = timedelta(minutes=30)

_WIND = re.compile(r"^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$")
_VIS_M = re.compile(r"^(\d{4})(NDV)?$")
_VIS_SM = re.compile(r"^(?:(\d+)\s)?(?:(\d+)/(\d+)|(\d+))SM$")
_CLOUD = re.compile(r"^(FEW|SCT|BKN|OVC|VV)(\d{3}|///)(CB|TCU)?$")
_TEMP = re.compile(r"^(M?\d{2})/(M?\d{2})?$")
_WX = re.compile(r"^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)?$")
_TREND = {"RMK", "TEMPO", "BECMG", "NOSIG"}


def _t(v: str) -> int:
    return -int(v[1:]) if v.startswith("M") else int(v)


def parse(raw: str) -> dict:
    """Decode the parts of a METAR that matter for a takeoff/landing."""
    out: dict = {"wind_dir": None, "wind_kt": None, "gust_kt": None, "vis_m": None, "ceiling_ft": None,
                 "wx": [], "cb": False, "temp_c": None, "dew_c": None, "qnh_hpa": None}
    tokens = raw.replace("=", "").split()
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok in _TREND:
            break
        if (m := _WIND.match(tok)):
            mult = 1.94384 if m.group(4) == "MPS" else 1.0
            out["wind_dir"] = None if m.group(1) == "VRB" else int(m.group(1))
            out["wind_kt"] = round(int(m.group(2)) * mult)
            out["gust_kt"] = round(int(m.group(3)) * mult) if m.group(3) else None
        elif tok == "CAVOK":
            out["vis_m"] = 10000
        elif (m := _VIS_M.match(tok)) and out["vis_m"] is None and out["wind_kt"] is not None:
            out["vis_m"] = 10000 if m.group(1) == "9999" else int(m.group(1))
        elif tok.endswith("SM") and out["vis_m"] is None:
            frac = tok
            if i > 0 and tokens[i - 1].isdigit() and "/" in tok:
                frac = f"{tokens[i - 1]} {tok}"
            if (m := _VIS_SM.match(frac)):
                miles = (int(m.group(1) or 0) + (int(m.group(2)) / int(m.group(3)) if m.group(2) else 0)) \
                    if m.group(2) else int(m.group(4))
                out["vis_m"] = min(10000, round(miles * 1609))
        elif (m := _CLOUD.match(tok)):
            if m.group(3) == "CB" or m.group(3) == "TCU":
                out["cb"] = True
            if m.group(1) in ("BKN", "OVC", "VV") and m.group(2) != "///":
                h = int(m.group(2)) * 100
                out["ceiling_ft"] = h if out["ceiling_ft"] is None else min(out["ceiling_ft"], h)
        elif (m := _TEMP.match(tok)) and out["temp_c"] is None:
            out["temp_c"] = _t(m.group(1))
            out["dew_c"] = _t(m.group(2)) if m.group(2) else None
        elif tok.startswith("Q") and tok[1:].isdigit() and len(tok) == 5:
            out["qnh_hpa"] = int(tok[1:])
        elif tok.startswith("A") and tok[1:].isdigit() and len(tok) == 5:
            out["qnh_hpa"] = round(int(tok[1:]) / 100 * 33.8639)
        elif i > 1 and (m := _WX.match(tok)) and (m.group(2) or m.group(3)) and not tok.isdigit():
            out["wx"].append(tok)
        i += 1
    out["category"] = category(out["ceiling_ft"], out["vis_m"])
    return out


def category(ceiling_ft: int | None, vis_m: int | None) -> str:
    c = ceiling_ft if ceiling_ft is not None else 99999
    v = vis_m if vis_m is not None else 99999
    if c < 500 or v < 1600:
        return "LIFR"
    if c < 1000 or v < 5000:
        return "IFR"
    if c <= 3000 or v <= 8000:
        return "MVFR"
    return "VFR"


def conditions(m: dict) -> dict:
    """Binary conditions used for the stress analysis."""
    wx = " ".join(m.get("wx") or [])
    return {
        "gusty": bool((m.get("gust_kt") or 0) >= 25 or (m.get("wind_kt") or 0) >= 20),
        "low_ceiling": m.get("ceiling_ft") is not None and m["ceiling_ft"] < 1000,
        "low_visibility": m.get("vis_m") is not None and m["vis_m"] < 5000,
        "precipitation": any(p in wx for p in ("RA", "SN", "DZ", "GR", "GS", "PL")),
        "thunderstorm": "TS" in wx or bool(m.get("cb")),
        "imc": m.get("category") in ("IFR", "LIFR"),
    }


# ── fetching ─────────────────────────────────────────────────────────────────

def fetch(station: str, start: datetime, end: datetime) -> list[tuple[datetime, str]]:
    q = [("station", station), ("data", "metar"), ("tz", "Etc/UTC"), ("format", "onlycomma"),
         ("latlon", "no"), ("elev", "no"), ("missing", "M"), ("trace", "T"), ("direct", "no"),
         ("report_type", "3"), ("report_type", "4"),
         ("year1", start.year), ("month1", start.month), ("day1", start.day),
         ("year2", end.year), ("month2", end.month), ("day2", end.day)]
    url = f"{IEM_URL}?{urllib.parse.urlencode(q)}"
    req = urllib.request.Request(url, headers={"User-Agent": "daybook-logbook/1.0 (personal logbook)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode("utf-8", "replace")
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            t = datetime.strptime(row["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        if row.get("metar") and row["metar"] != "M":
            out.append((t, row["metar"].strip()))
    return out


def _dt(v):
    if not v:
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _nearest(obs: list[tuple[datetime, str]], at: datetime):
    before = [o for o in obs if at - BEFORE <= o[0] <= at]
    if before:
        return max(before, key=lambda o: o[0])
    after = [o for o in obs if at < o[0] <= at + AFTER]
    return min(after, key=lambda o: o[0]) if after else None


def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS flight_metars (
        flight_id  TEXT NOT NULL,
        phase      TEXT NOT NULL,            -- takeoff | landing
        station    TEXT,
        obs_time   TEXT,                     -- NULL = looked up, nothing found
        raw        TEXT,
        wind_dir   INTEGER, wind_kt INTEGER, gust_kt INTEGER,
        vis_m      INTEGER, ceiling_ft INTEGER, wx TEXT, cb INTEGER,
        temp_c     REAL, dew_c REAL, qnh_hpa INTEGER, category TEXT,
        fetched_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        PRIMARY KEY (flight_id, phase))""")
    conn.commit()


def _events(conn, since: str) -> list[tuple[str, str, str, datetime]]:
    """(flight_id, phase, station, event_utc) still lacking a METAR lookup."""
    rows = conn.execute(
        """SELECT f.id,
                  COALESCE(f.dep_icao, (SELECT icao FROM airports WHERE iata = f.dep_iata LIMIT 1)) AS dep_icao,
                  COALESCE(f.arr_icao, (SELECT icao FROM airports WHERE iata = f.arr_iata LIMIT 1)) AS arr_icao,
                  f.takeoff_utc, f.landing_utc, f.off_block_utc, f.on_block_utc
           FROM flights f WHERE f.is_sim = 0 AND f.date >= ?""", (since,)).fetchall()
    done = {(r[0], r[1]) for r in conn.execute("SELECT flight_id, phase FROM flight_metars")}
    ev = []
    for r in rows:
        tk = _dt(r["takeoff_utc"]) or (_dt(r["off_block_utc"]) and _dt(r["off_block_utc"]) + timedelta(minutes=10))
        ld = _dt(r["landing_utc"]) or (_dt(r["on_block_utc"]) and _dt(r["on_block_utc"]) - timedelta(minutes=5))
        if r["dep_icao"] and tk and (r["id"], "takeoff") not in done:
            ev.append((r["id"], "takeoff", r["dep_icao"], tk))
        if r["arr_icao"] and ld and (r["id"], "landing") not in done:
            ev.append((r["id"], "landing", r["arr_icao"], ld))
    return ev


def sync(conn: sqlite3.Connection, days: int = 30, verbose: bool = True, fetcher=fetch) -> dict:
    ensure_table(conn)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    events = _events(conn, since)
    by_station: dict[str, list] = defaultdict(list)
    for e in events:
        by_station[e[2]].append(e)

    stats = {"events": len(events), "found": 0, "missing": 0, "requests": 0, "errors": []}
    for station, evs in by_station.items():
        evs.sort(key=lambda e: e[3])
        # one request per ≤ 31-day window of this station's events
        chunks, cur = [], [evs[0]]
        for e in evs[1:]:
            if e[3] - cur[0][3] > timedelta(days=31):
                chunks.append(cur)
                cur = [e]
            else:
                cur.append(e)
        chunks.append(cur)
        for chunk in chunks:
            start = chunk[0][3] - timedelta(days=1)
            end = chunk[-1][3] + timedelta(days=1)
            try:
                obs = fetcher(station, start, end)
                stats["requests"] += 1
            except Exception as e:  # network / IEM hiccup — retry next night
                stats["errors"].append(f"{station}: {e}")
                continue
            for fid, phase, st, at in chunk:
                hit = _nearest(obs, at)
                if hit:
                    m = parse(hit[1])
                    conn.execute(
                        """INSERT OR REPLACE INTO flight_metars
                           (flight_id, phase, station, obs_time, raw, wind_dir, wind_kt, gust_kt, vis_m,
                            ceiling_ft, wx, cb, temp_c, dew_c, qnh_hpa, category)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (fid, phase, st, hit[0].isoformat(), hit[1], m["wind_dir"], m["wind_kt"], m["gust_kt"],
                         m["vis_m"], m["ceiling_ft"], " ".join(m["wx"]) or None, int(m["cb"]),
                         m["temp_c"], m["dew_c"], m["qnh_hpa"], m["category"]))
                    stats["found"] += 1
                else:
                    conn.execute("INSERT OR REPLACE INTO flight_metars (flight_id, phase, station) VALUES (?,?,?)",
                                 (fid, phase, st))
                    stats["missing"] += 1
            conn.commit()
            if verbose:
                print(f"  {station}: {len(chunk)} events, {len(obs)} METARs", file=sys.stderr)
            time.sleep(1.0)   # be polite to IEM
    return stats


def main() -> None:
    from infrastructure.db.connection import get_connection

    p = argparse.ArgumentParser(description="Fetch METARs for takeoffs/landings")
    p.add_argument("--days", type=int, default=30)
    args = p.parse_args()
    conn = get_connection()
    try:
        s = sync(conn, days=args.days)
    finally:
        conn.close()
    print(f"METARs: {s}", file=sys.stderr)
    if s["errors"] and not s["found"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
