"""
Wind on a completed ride/run: how much of it was into a headwind, tailwind or
crosswind — computed from the GPS track and Open-Meteo's hourly wind (the same
provider as the daily weather; free, no key; archive for older dates).

  - Track: per-second GPS streams (directlatitude/longitude + sumduration) when
    the activity detail sync stored them, else the route polyline spread evenly
    over the moving time.
  - Wind: hourly 10 m wind speed/direction/gusts at up to 3 points along the
    route (start, middle, farthest point) — long rides cross weather.
  - Per stretch (~250 m): travel bearing vs wind-from direction →
    headwind = speed·cos(Δ) (positive = into the wind), crosswind = speed·|sin(Δ)|.
    Time-weighted when timestamps exist.

Result is cached per activity in activity_wind. Indoor/virtual activities → None.
"""

from __future__ import annotations

import json
import math
import sqlite3
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

FORECAST = "https://api.open-meteo.com/v1/forecast"
ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
STEP_M = 250
HEAD_KMH = 5.0          # |component| above this counts as head-/tailwind


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS activity_wind (
        activity_id TEXT PRIMARY KEY, result_json TEXT,
        computed_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")
    conn.commit()


def _hav_m(a, b) -> float:
    r = 6_371_000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _bearing(a, b) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def components(wind_from_deg: float, wind_kmh: float, bearing_deg: float) -> tuple[float, float]:
    """(headwind, crosswind) km/h for travelling on `bearing` with wind blowing FROM `wind_from`."""
    d = math.radians(wind_from_deg - bearing_deg)
    return wind_kmh * math.cos(d), abs(wind_kmh * math.sin(d))


# ── track ────────────────────────────────────────────────────────────────────

def _track(conn, act) -> list[tuple[float, float, float]]:
    """[(lat, lon, seconds_from_start)]."""
    t = _tables(conn)
    if "activity_streams" in t:
        st = {r[0]: r[1] for r in conn.execute(
            "SELECT stream_type, data_json FROM activity_streams WHERE activity_id=? AND stream_type IN "
            "('directlatitude','directlongitude','sumduration','sumelapsedduration')", (act["id"],))}
        if "directlatitude" in st and "directlongitude" in st:
            lats, lons = json.loads(st["directlatitude"]), json.loads(st["directlongitude"])
            secs = json.loads(st.get("sumduration") or st.get("sumelapsedduration") or "null")
            pts = []
            for i, (la, lo) in enumerate(zip(lats, lons)):
                if la is None or lo is None or (la == 0 and lo == 0):
                    continue
                s = secs[i] if secs and i < len(secs) and secs[i] is not None else None
                pts.append((la, lo, s))
            if len(pts) > 10:
                if any(p[2] is None for p in pts):
                    pts = [(la, lo, None) for la, lo, _ in pts]
                return _fill_times(pts, act)
    if act["polyline"]:
        pts = [(la, lo, None) for la, lo in _decode(act["polyline"])]
        return _fill_times(pts, act) if len(pts) > 5 else []
    return []


def _decode(poly: str) -> list[tuple[float, float]]:
    out, idx, lat, lng = [], 0, 0, 0
    while idx < len(poly):
        for k in range(2):
            shift = result = 0
            while True:
                b = ord(poly[idx]) - 63
                idx += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if result & 1 else result >> 1
            if k == 0:
                lat += d
            else:
                lng += d
        out.append((lat / 1e5, lng / 1e5))
    return out


def _fill_times(pts, act):
    """No timestamps → spread the moving time evenly by distance."""
    if all(p[2] is not None for p in pts):
        return pts
    total = act["moving_time_seconds"] or act["duration_seconds"] or 0
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + _hav_m(a, b))
    dist = cum[-1] or 1
    return [(p[0], p[1], total * c / dist) for p, c in zip(pts, cum)]


def _resample(pts, step_m=STEP_M):
    out = [pts[0]]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        acc += _hav_m(a, b)
        if acc >= step_m:
            out.append(b)
            acc = 0.0
    if out[-1] is not pts[-1]:
        out.append(pts[-1])
    return out


# ── wind ─────────────────────────────────────────────────────────────────────

def _fetch_wind(points: list[tuple[float, float]], day: str, fetcher=None) -> list[dict]:
    """Hourly wind per point (UTC hours) → [{"YYYY-MM-DDTHH:00" → (speed, from, gust)}]."""
    old = date.fromisoformat(day) < date.today() - timedelta(days=6)
    q = {"latitude": ",".join(f"{p[0]:.4f}" for p in points), "longitude": ",".join(f"{p[1]:.4f}" for p in points),
         "hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m", "wind_speed_unit": "kmh",
         "timezone": "GMT", "start_date": day,
         "end_date": (date.fromisoformat(day) + timedelta(days=1)).isoformat()}
    url = f"{ARCHIVE if old else FORECAST}?{urllib.parse.urlencode(q)}"
    if fetcher:
        raw = fetcher(url)
    else:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "daybook/1.0"}),
                                    timeout=30) as r:
            raw = r.read().decode()
    data = json.loads(raw)
    data = data if isinstance(data, list) else [data]
    out = []
    for d in data:
        h = d.get("hourly") or {}
        out.append({t: (s, w, g) for t, s, w, g in zip(h.get("time", []), h.get("wind_speed_10m", []),
                                                         h.get("wind_direction_10m", []), h.get("wind_gusts_10m", []))
                    if s is not None and w is not None})
    return out


class _NoWind(Exception):
    pass


def compute(conn: sqlite3.Connection, activity_id: str, fetcher=None, force: bool = False) -> dict | None:
    ensure_table(conn)
    if not force:
        c = conn.execute("SELECT result_json FROM activity_wind WHERE activity_id=?", (activity_id,)).fetchone()
        if c:
            return json.loads(c[0]) if c[0] else None
    act = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    if not act:
        return None
    atype = (act["activity_type"] or "").lower()
    if any(k in atype for k in ("indoor", "virtual", "trainer", "treadmill", "swim", "strength")):
        result = None
    else:
        try:
            result = _compute(conn, act, fetcher)
        except _NoWind:
            return None                       # network / provider hiccup — don't cache, retry next view
    conn.execute("INSERT OR REPLACE INTO activity_wind (activity_id, result_json) VALUES (?, ?)",
                 (activity_id, json.dumps(result) if result else None))
    conn.commit()
    return result


def _start_utc(s: str) -> datetime | None:
    """activities.start_time → naive UTC (Garmin stores startTimeGMT; Strava ISO with Z/offset)."""
    try:
        dt = datetime.fromisoformat(s.strip().replace(" ", "T").replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _compute(conn, act, fetcher) -> dict | None:
    pts = _track(conn, act)
    if len(pts) < 5 or not act["start_time"]:
        return None
    start = _start_utc(act["start_time"])
    if start is None:
        return None
    pts = _resample(pts)
    far = max(pts, key=lambda p: _hav_m(pts[0], p))
    anchors = [pts[0], pts[len(pts) // 2], far]
    try:
        winds = _fetch_wind([(a[0], a[1]) for a in anchors], start.date().isoformat(), fetcher)
    except Exception as e:
        raise _NoWind(str(e)) from e
    if not winds or not any(winds):
        raise _NoWind("no hourly wind returned")

    segs, head_t = [], {"head": 0.0, "tail": 0.0, "cross": 0.0}
    tot_w, sum_head, sum_speed, gust_max = 0.0, 0.0, 0.0, 0.0
    dist = 0.0
    for a, b in zip(pts, pts[1:]):
        d = _hav_m(a, b)
        if d < 1:
            continue
        dt = (b[2] - a[2]) if (a[2] is not None and b[2] is not None and b[2] > a[2]) else d / 6.0
        when = start + timedelta(seconds=a[2] or 0)
        hour = when.replace(minute=0, second=0).strftime("%Y-%m-%dT%H:00")
        k = min(range(len(anchors)), key=lambda i: _hav_m(a, anchors[i]))
        w = winds[k].get(hour) or next(iter(winds[k].values()), None)
        if not w:
            continue
        speed, wfrom, gust = w
        head, cross = components(wfrom, speed, _bearing(a, b))
        kind = "head" if head > HEAD_KMH else "tail" if head < -HEAD_KMH else "cross"
        head_t[kind] += dt
        tot_w += dt
        sum_head += head * dt
        sum_speed += speed * dt
        gust_max = max(gust_max, gust or 0)
        dist += d
        segs.append((dist / 1000, round(head, 1), round(cross, 1)))
    if not tot_w:
        return None

    # worst headwind stretch: longest run of consecutive head segments (km)
    best = (0.0, 0.0, 0.0, 0.0)   # length, from_km, to_km, avg head
    run_start, run_heads = None, []
    prev_km = 0.0
    for km, head, _ in segs + [(segs[-1][0] + 1, -99, 0)]:
        if head > HEAD_KMH:
            if run_start is None:
                run_start, run_heads = prev_km, []
            run_heads.append(head)
        elif run_start is not None:
            length = prev_km - run_start
            if length > best[0]:
                best = (length, run_start, prev_km, sum(run_heads) / len(run_heads))
            run_start = None
        prev_km = km

    # coarse per-km profile for the strip (signed headwind)
    profile, bucket, cur_km = [], [], 1.0
    for km, head, _ in segs:
        bucket.append(head)
        if km >= cur_km:
            profile.append(round(sum(bucket) / len(bucket), 1))
            bucket, cur_km = [], cur_km + 1
    if bucket:
        profile.append(round(sum(bucket) / len(bucket), 1))

    dirs = [w[1] for wk in winds for w in wk.values()]
    mean_from = (math.degrees(math.atan2(sum(math.sin(math.radians(x)) for x in dirs),
                                         sum(math.cos(math.radians(x)) for x in dirs))) + 360) % 360 if dirs else None
    return {
        "wind_kmh": round(sum_speed / tot_w, 1), "gust_max_kmh": round(gust_max, 1) if gust_max else None,
        "wind_from_deg": round(mean_from) if mean_from is not None else None,
        "avg_headwind_kmh": round(sum_head / tot_w, 1),          # + into the wind, − tailwind overall
        "pct": {k: round(v / tot_w * 100) for k, v in head_t.items()},
        "worst_head": {"km": round(best[0], 1), "from_km": round(best[1], 1), "to_km": round(best[2], 1),
                       "avg_kmh": round(best[3], 1)} if best[0] >= 1 else None,
        "profile_km": profile,
        "source": "streams" if conn.execute("SELECT 1 FROM activity_streams WHERE activity_id=? AND stream_type="
                                            "'directlatitude'", (act["id"],)).fetchone() else "polyline",
    }
