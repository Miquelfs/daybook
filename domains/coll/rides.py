"""
Rides Coll recorded → Daybook activities (ciclocomputer/docs/DAYBOOK.md §5).

  upload        the GPX Coll writes (1 point/s, hr/cad in gpxtpx, <power>) or its compact
                ride log (.clg, converted with the vendored collog.py). X-Coll-Ride-Id makes
                it idempotent: Coll retries after a dropped Wi-Fi.
  activity      id coll_<start UTC>, source 'coll', type 'cycling'; streams in the Garmin
                vocabulary (sumduration, directheartrate, directspeed, sumdistance, …) so
                every analysis, metric, best effort and map just works.
  name          the course it followed (the name Coll writes, else the course it matches
                on the map), else "Ride".
  the watch     when the Garmin watch recorded the same ride (same day, starts ≤ 10 min
                apart, overlapping ≥ 80 % of the longer one), the watch's activity is the one that counts: it has
                Garmin's richer metrics. A Coll ride arriving after the watch's is filed
                against it; a watch ride arriving later (nightly sync) absorbs the Coll one
                (reconcile). A watch recording that stopped early doesn't overlap enough,
                so both stay.

The raw upload is kept (gzip) in coll_rides, so a ride can be re-imported after a fix.
Nothing here imports FastAPI: finish() runs the post-import steps with lazy imports.
"""

from __future__ import annotations

import gzip
import json
import math
import sqlite3
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from zoneinfo import ZoneInfo

from domains.coll import collog
from domains.health.geo import decode, dist_m, encode

ROOT = Path(__file__).resolve().parents[2]
RIDE_TYPES = ("cycling", "road_biking", "gravel_cycling", "mountain_biking")
TWIN_START_S = 600          # starts within 10 min
TWIN_OVERLAP = 0.8          # of the longer recording
MOVING_MPS = 1.0            # as on the device
MAX_STEP_S = 10             # longer gaps are pauses: not moving time
GENERIC_NAMES = {"", "ride", "simulated ride"}
# tables whose rows are yours to keep when the watch's copy takes over (else deleted with the ride)
KEEP_TABLES = ("fueling_logs", "activity_companions", "injuries")


# ── parsing ─────────────────────────────────────────────────────────────────

def _utc(s: str) -> float:
    s = s.strip().replace("Z", "+00:00")
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_gpx(data: bytes) -> dict:
    """{name, points: [(t, lat, lon, ele, hr, cad, power, seg)]}; streamed, so a 16 h ride stays small."""
    name, pts, seg = None, [], 0
    cur: dict | None = None
    for ev, el in ET.iterparse(BytesIO(data), events=("start", "end")):
        tag = _local(el.tag)
        if ev == "start":
            if tag == "trkpt":
                cur = {"lat": float(el.get("lat")), "lon": float(el.get("lon"))}
            elif tag == "trkseg" and pts:
                seg += 1
            continue
        if cur is not None and tag in ("ele", "time", "hr", "cad", "power") and el.text:
            cur[tag] = el.text
        elif tag == "name" and name is None and cur is None and el.text:
            name = el.text.strip()
        elif tag == "trkpt" and cur is not None:
            if "time" in cur:
                pts.append((_utc(cur["time"]), cur["lat"], cur["lon"],
                            float(cur["ele"]) if "ele" in cur else None,
                            int(float(cur["hr"])) if "hr" in cur else None,
                            int(float(cur["cad"])) if "cad" in cur else None,
                            int(float(cur["power"])) if "power" in cur else None, seg))
            cur = None
            el.clear()
    pts.sort(key=lambda p: p[0])
    dedup = [p for i, p in enumerate(pts) if i == 0 or p[0] > pts[i - 1][0]]
    return {"name": name, "points": dedup}


def decode_upload(raw: bytes) -> tuple[str, dict]:
    """(format, parsed). A .clg log starts with CLG1; anything else is read as GPX."""
    if raw[:4] == b"CLG1":
        return "clg", parse_gpx(collog.to_gpx(raw).encode())
    return "gpx", parse_gpx(raw)


# ── streams and summary ─────────────────────────────────────────────────────

def _smooth(vals: list, k: int) -> list:
    out, n = [], len(vals)
    for i in range(n):
        w = [v for v in vals[max(0, i - k):i + k + 1] if v is not None]
        out.append(sum(w) / len(w) if w else None)
    return out


def _ascent(eles: list, th: float = 1.0) -> float:
    e = [v for v in _smooth(eles, 3) if v is not None]
    if not e:
        return 0.0
    gain, ref = 0.0, e[0]
    for v in e[1:]:
        if v > ref + th:
            gain += v - ref
            ref = v
        elif v < ref - th:
            ref = v
    return gain


def _profile(conn) -> dict:
    def one(sql):
        try:
            r = conn.execute(sql).fetchone()
            return r[0] if r else None
        except sqlite3.OperationalError:
            return None
    bd = one("SELECT birthdate FROM user_profile WHERE id=1")
    age = None
    if bd:
        try:
            b, t = date.fromisoformat(bd[:10]), date.today()
            age = t.year - b.year - ((t.month, t.day) < (b.month, b.day))
        except ValueError:
            pass
    return {"weight": one("SELECT weight_kg FROM weight_log ORDER BY date DESC LIMIT 1"),
            "age": age, "sex": one("SELECT value FROM app_settings WHERE key='fitness_age_sex'")}


def calories(moving_s: float, avg_hr: float | None, work_kj: float | None, prof: dict) -> int | None:
    """Work done when there's power (kJ ≈ kcal at ~24 % efficiency), else Keytel et al. from heart rate."""
    if work_kj:
        return round(work_kj)
    if not avg_hr or not moving_s:
        return None
    w, a = prof.get("weight") or 75.0, prof.get("age") or 40
    if prof.get("sex") == "female":
        per_min = (-20.4022 + 0.4472 * avg_hr - 0.1263 * w + 0.074 * a) / 4.184
    else:
        per_min = (-55.0969 + 0.6309 * avg_hr + 0.1988 * w + 0.2017 * a) / 4.184
    return max(0, round(per_min * moving_s / 60))


def streams_and_summary(points: list) -> tuple[dict, dict]:
    t0 = points[0][0]
    t = [round(p[0] - t0) for p in points]
    dist, acc = [0.0], 0.0
    for a, b in zip(points, points[1:]):
        acc += dist_m((a[1], a[2]), (b[1], b[2]))
        dist.append(round(acc, 1))
    n = len(points)
    speed = []
    for i in range(n):
        lo, hi = max(0, i - 2), min(n - 1, i + 2)
        dt = t[hi] - t[lo]
        speed.append(round((dist[hi] - dist[lo]) / dt, 3) if dt > 0 and dt <= 4 * MAX_STEP_S else 0.0)
    moving, mv = [0], 0
    for i in range(1, n):
        dt = t[i] - t[i - 1]
        if dt <= MAX_STEP_S and points[i][7] == points[i - 1][7] and speed[i] >= MOVING_MPS:
            mv += dt
        moving.append(mv)

    st: dict[str, list] = {
        "sumduration": t, "sumelapsedduration": t,
        "directtimestamp": [round(p[0] * 1000) for p in points],
        "directlatitude": [p[1] for p in points], "directlongitude": [p[2] for p in points],
        "sumdistance": dist, "directspeed": speed, "summovingduration": moving,
    }
    for key, idx in (("directelevation", 3), ("directheartrate", 4), ("directbikecadence", 5), ("directpower", 6)):
        col = [p[idx] for p in points]
        if any(v is not None for v in col):
            st[key] = col

    hr = [p[4] for p in points if p[4]]
    pw = [p[6] for p in points if p[6] is not None]
    cad = [p[5] for p in points if p[5]]
    work = sum((points[i][6] or 0) * min(MAX_STEP_S, t[i] - t[i - 1]) for i in range(1, n)) / 1000 if pw else None
    summary = {
        "start_utc": datetime.fromtimestamp(t0, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "points": n, "segments": points[-1][7] + 1,
        "duration_s": t[-1], "moving_s": mv, "distance_m": dist[-1],
        "ascent_m": round(_ascent(st["directelevation"])) if "directelevation" in st else None,
        "avg_hr": round(sum(hr) / len(hr)) if hr else None, "max_hr": max(hr) if hr else None,
        "avg_power": round(sum(pw) / len(pw)) if pw else None, "max_power": max(pw) if pw else None,
        "avg_cadence": round(sum(cad) / len(cad)) if cad else None,
        "work_kj": round(work) if work else None,
        "max_speed_mps": max(speed) if speed else None,
    }
    return st, summary


def _thin(points: list, every_m: float = 10) -> list:
    out, run = [points[0][1:3]], 0.0
    for a, b in zip(points, points[1:]):
        run += dist_m(a[1:3], b[1:3])
        if run >= every_m:
            out.append(b[1:3])
            run = 0.0
    if out[-1] != points[-1][1:3]:
        out.append(points[-1][1:3])
    return out


# ── course it followed ──────────────────────────────────────────────────────

CELL = 0.002                # ~200 m grid for matching
NEAR_M = 80


def match_course(conn, name: str | None, points: list) -> dict | None:
    """The course this ride followed: Coll's own name for it, else ≥ 70 % of the ride on its line."""
    rows = conn.execute("SELECT id, name, polyline FROM coll_courses WHERE status='ready' AND polyline IS NOT NULL "
                        "ORDER BY id DESC").fetchall()
    if name and name.strip().lower() not in GENERIC_NAMES:
        for r in rows:
            if r["name"].strip().lower() == name.strip().lower():
                return {"id": r["id"], "name": r["name"], "how": "name"}
    step = max(1, len(points) // 300)
    sample = [(p[1], p[2]) for p in points[::step]]
    lat_lo, lat_hi = min(p[0] for p in sample), max(p[0] for p in sample)
    lon_lo, lon_hi = min(p[1] for p in sample), max(p[1] for p in sample)
    best = None
    for r in rows:
        line = decode(r["polyline"])
        if not line or max(p[0] for p in line) < lat_lo or min(p[0] for p in line) > lat_hi \
                or max(p[1] for p in line) < lon_lo or min(p[1] for p in line) > lon_hi:
            continue
        grid: dict[tuple, list] = {}
        for p in line:
            grid.setdefault((int(p[0] // CELL), int(p[1] // CELL)), []).append(p)
        hits = 0
        for p in sample:
            ci, cj = int(p[0] // CELL), int(p[1] // CELL)
            if any(dist_m(p, q) <= NEAR_M for di in (-1, 0, 1) for dj in (-1, 0, 1)
                   for q in grid.get((ci + di, cj + dj), ())):
                hits += 1
        frac = hits / len(sample)
        if frac >= 0.7 and (best is None or frac > best["frac"]):
            best = {"id": r["id"], "name": r["name"], "how": "map", "frac": round(frac, 2)}
    return best


# ── the watch's copy ────────────────────────────────────────────────────────

def _naive_local(s: str | None, tz: str) -> datetime | None:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d.astimezone(ZoneInfo(tz)).replace(tzinfo=None) if d.tzinfo else d


def find_twin(conn, start_local: datetime, duration_s: float, tz: str, source: str = "garmin",
              exclude: str | None = None) -> str | None:
    days = [(start_local.date() + timedelta(days=k)).isoformat() for k in (-1, 0, 1)]
    q = ",".join("?" * len(RIDE_TYPES))
    for r in conn.execute(f"SELECT id, start_time, duration_seconds FROM activities WHERE source=? "
                          f"AND date IN (?,?,?) AND lower(activity_type) IN ({q}) AND id IS NOT ?",
                          (source, *days, *RIDE_TYPES, exclude)):
        s = _naive_local(r["start_time"], tz)
        d = r["duration_seconds"] or 0
        if s is None or not d or abs((s - start_local).total_seconds()) > TWIN_START_S:
            continue
        a0, a1 = start_local, start_local + timedelta(seconds=duration_s)
        b0, b1 = s, s + timedelta(seconds=d)
        overlap = (min(a1, b1) - max(a0, b0)).total_seconds()
        if overlap >= TWIN_OVERLAP * max(duration_s, d):        # a watch that stopped halfway is no twin
            return r["id"]
    return None


def _tables_with(conn, column: str) -> list[str]:
    out = []
    for (t,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table'"):
        if t != "coll_rides" and any(c[1] == column for c in conn.execute(f'PRAGMA table_info("{t}")')):
            out.append(t)
    return out


def absorb(conn, coll_id: str, garmin_id: str) -> None:
    """The watch's activity takes over from the Coll one: your notes, fuel log, companions and the
    planned-session link move to it; everything computed from the Coll copy goes."""
    a = conn.execute("SELECT user_notes, user_rating FROM activities WHERE id=?", (coll_id,)).fetchone()
    if a is not None:
        conn.execute("UPDATE activities SET user_notes=COALESCE(user_notes, ?), user_rating=COALESCE(user_rating, ?) "
                     "WHERE id=?", (a["user_notes"], a["user_rating"], garmin_id))
    for t in _tables_with(conn, "activity_id"):
        if t in KEEP_TABLES:
            conn.execute(f'UPDATE OR IGNORE "{t}" SET activity_id=? WHERE activity_id=?', (garmin_id, coll_id))
        conn.execute(f'DELETE FROM "{t}" WHERE activity_id=?', (coll_id,))
    if "plan_sessions" in _tables_with(conn, "completed_activity_id"):
        taken = conn.execute("SELECT 1 FROM plan_sessions WHERE completed_activity_id=?", (garmin_id,)).fetchone()
        if taken:
            conn.execute("UPDATE plan_sessions SET completed_activity_id=NULL, status='pending' "
                         "WHERE completed_activity_id=?", (coll_id,))
        else:
            conn.execute("UPDATE plan_sessions SET completed_activity_id=? WHERE completed_activity_id=?",
                         (garmin_id, coll_id))
    conn.execute("DELETE FROM activities WHERE id=?", (coll_id,))
    conn.execute("UPDATE coll_rides SET status='merged', activity_id=? WHERE activity_id=?", (garmin_id, coll_id))


def reconcile(conn, tz: str, days: int = 21) -> list[tuple[str, str]]:
    """After a Garmin sync: Coll rides the watch also recorded give way to the watch's activity."""
    try:
        rows = conn.execute("SELECT id, start_time, duration_seconds FROM activities WHERE source='coll' AND date >= ?",
                            ((date.today() - timedelta(days=days)).isoformat(),)).fetchall()
    except sqlite3.OperationalError:
        return []
    done = []
    for r in rows:
        s = _naive_local(r["start_time"], tz)
        twin = find_twin(conn, s, r["duration_seconds"] or 0, tz) if s else None
        if twin:
            absorb(conn, r["id"], twin)
            done.append((r["id"], twin))
    if done:
        conn.commit()
    return done


# ── upload ──────────────────────────────────────────────────────────────────

def activity_id_for(start_utc: float) -> str:
    return "coll_" + datetime.fromtimestamp(start_utc, timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _ride_out(r: sqlite3.Row) -> dict:
    d = {k: r[k] for k in r.keys() if k != "raw_gz"}
    d["summary"] = json.loads(d.pop("summary_json") or "null")
    return d


def ingest(conn, raw: bytes, ride_id: str | None, tz: str) -> tuple[dict, bool]:
    """(ride, created). Raises ValueError on an unreadable or empty ride."""
    try:
        fmt, parsed = decode_upload(raw)
    except ET.ParseError as e:
        raise ValueError(f"GPX could not be read: {e}") from e
    pts = parsed["points"]
    if len(pts) < 2 or pts[-1][0] - pts[0][0] < 60:
        raise ValueError("ride too short: fewer than 2 timed points or under a minute")
    ride_id = (ride_id or "").strip() or datetime.fromtimestamp(pts[0][0], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    old = conn.execute("SELECT * FROM coll_rides WHERE ride_id=?", (ride_id,)).fetchone()
    if old is not None:
        return _ride_out(old), False
    ride = _store(conn, ride_id, fmt, raw, parsed, tz)
    conn.commit()
    return ride, True


def _store(conn, ride_id: str, fmt: str, raw: bytes, parsed: dict, tz: str, row_id: int | None = None) -> dict:
    pts = parsed["points"]
    streams, summary = streams_and_summary(pts)
    course = match_course(conn, parsed["name"], pts)
    name = course["name"] if course else (parsed["name"] if (parsed["name"] or "").lower() not in GENERIC_NAMES else "Ride")
    start = datetime.fromtimestamp(pts[0][0], ZoneInfo(tz)).replace(tzinfo=None)
    summary = {**summary, "course": course, "calories": calories(summary["moving_s"], summary["avg_hr"],
                                                                 summary["work_kj"], _profile(conn))}
    aid = activity_id_for(pts[0][0])
    twin = find_twin(conn, start, summary["duration_s"], tz, exclude=aid)
    if twin is None:
        _write_activity(conn, aid, name, start, streams, summary, pts, ride_id)
    vals = (aid if twin is None else twin, "activity" if twin is None else "merged",
            course["id"] if course else None, name, summary["start_utc"], fmt,
            gzip.compress(raw), json.dumps(summary))
    if row_id is None:
        cur = conn.execute("INSERT INTO coll_rides (ride_id, activity_id, status, course_id, name, start_utc, format, "
                           "raw_gz, summary_json) VALUES (?,?,?,?,?,?,?,?,?)", (ride_id, *vals))
        row_id = cur.lastrowid
    else:
        conn.execute("UPDATE coll_rides SET activity_id=?, status=?, course_id=?, name=?, start_utc=?, format=?, "
                     "raw_gz=?, summary_json=? WHERE id=?", (*vals, row_id))
    return _ride_out(conn.execute("SELECT * FROM coll_rides WHERE id=?", (row_id,)).fetchone())


def _write_activity(conn, aid, name, start, streams, summary, pts, ride_id) -> None:
    day = start.date().isoformat()
    conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (day,))
    mv = summary["moving_s"] or summary["duration_s"]
    conn.execute(
        """INSERT OR REPLACE INTO activities
           (id, date, source, activity_type, name, start_time, duration_seconds, moving_time_seconds,
            distance_meters, elevation_gain_meters, avg_heart_rate, max_heart_rate, avg_speed_mps,
            avg_power_watts, calories, polyline, start_lat, start_lng, raw_payload, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))""",
        (aid, day, "coll", "cycling", name, start.strftime("%Y-%m-%d %H:%M:%S"), summary["duration_s"],
         summary["moving_s"], summary["distance_m"], summary["ascent_m"], summary["avg_hr"], summary["max_hr"],
         round(summary["distance_m"] / mv, 3) if mv else None, summary["avg_power"], summary["calories"],
         encode(_thin(pts)), pts[0][1], pts[0][2],
         json.dumps({"source": "coll", "ride_id": ride_id, "points": summary["points"],
                     "segments": summary["segments"], "course": summary["course"]})))
    conn.execute("DELETE FROM activity_streams WHERE activity_id=?", (aid,))
    conn.executemany("INSERT INTO activity_streams (activity_id, stream_type, data_json) VALUES (?,?,?)",
                     [(aid, k, json.dumps(v)) for k, v in streams.items()])


def reimport(conn, rid: int, tz: str) -> dict | None:
    """Rebuild a ride's activity from the stored upload (after a parser fix)."""
    r = conn.execute("SELECT * FROM coll_rides WHERE id=?", (rid,)).fetchone()
    if r is None:
        return None
    if r["status"] == "activity" and r["activity_id"]:
        _drop_activity(conn, r["activity_id"])
    raw = gzip.decompress(r["raw_gz"])
    fmt, parsed = decode_upload(raw)
    out = _store(conn, r["ride_id"], fmt, raw, parsed, tz, row_id=rid)
    conn.commit()
    return out


def _drop_activity(conn, aid: str) -> None:
    for t in _tables_with(conn, "activity_id"):
        if t not in KEEP_TABLES:
            conn.execute(f'DELETE FROM "{t}" WHERE activity_id=?', (aid,))
    if _tables_with(conn, "completed_activity_id"):
        conn.execute("UPDATE plan_sessions SET completed_activity_id=NULL, status='pending' "
                     "WHERE completed_activity_id=?", (aid,))
    conn.execute("DELETE FROM activities WHERE id=?", (aid,))


def delete(conn, rid: int) -> bool:
    """Forget a ride (e.g. a test upload): its Coll activity goes too; a watch activity it was filed against stays."""
    r = conn.execute("SELECT activity_id, status FROM coll_rides WHERE id=?", (rid,)).fetchone()
    if r is None:
        return False
    if r["status"] == "activity" and r["activity_id"]:
        _drop_activity(conn, r["activity_id"])
        for t in KEEP_TABLES:
            if t in _tables_with(conn, "activity_id"):
                conn.execute(f'DELETE FROM "{t}" WHERE activity_id=?', (r["activity_id"],))
    conn.execute("DELETE FROM coll_rides WHERE id=?", (rid,))
    conn.commit()
    return True


def list_rides(conn, limit: int = 50) -> list[dict]:
    return [_ride_out(r) for r in conn.execute(
        "SELECT r.*, a.date AS activity_date, a.name AS activity_name FROM coll_rides r "
        "LEFT JOIN activities a ON a.id = r.activity_id ORDER BY r.start_utc DESC LIMIT ?", (limit,))]


def raw(conn, rid: int) -> tuple[bytes, str] | None:
    r = conn.execute("SELECT raw_gz, format, ride_id FROM coll_rides WHERE id=?", (rid,)).fetchone()
    return (gzip.decompress(r["raw_gz"]), r["format"]) if r else None


# ── after the import (API process) ──────────────────────────────────────────

def finish(conn, activity_id: str, day: str, log=print) -> None:
    """Metrics (hr TSS, zones, best efforts), the analysis cache, the planned-session link,
    then the training load from that day on — each step on its own, a failure doesn't stop the rest."""
    try:
        from domains.health.fit_import import recompute
        recompute(conn, activity_id)
    except Exception as e:                                   # noqa: BLE001
        log(f"coll ride {activity_id}: metrics failed: {e}")
    try:
        from infrastructure.api.routers.race_plans import autolink_sessions
        autolink_sessions(conn, on_date=day)
        conn.commit()
    except Exception as e:                                   # noqa: BLE001
        log(f"coll ride {activity_id}: session link failed: {e}")
    try:
        back = max(3, (date.today() - date.fromisoformat(day)).days + 3)
        subprocess.Popen(["nice", "-n", "10", sys.executable, "-m", "domains.health.compute_training_load",
                          "--backfill-days", str(back)], cwd=str(ROOT), stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except Exception as e:                                   # noqa: BLE001
        log(f"coll ride {activity_id}: training load kick failed: {e}")
