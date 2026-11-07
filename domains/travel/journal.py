"""
The travel journal: moments (and their photos) between two dates, woven together with what
Daybook already knows about those days — the route, cities, km, activities, restaurants, what
you spent, mood, the plan's line for the day, the photo of the day.

Photos dropped in a batch place themselves: each one's EXIF time finds where you were (its own
GPS or the Overland track), and it joins a moment from the same hour and neighbourhood, or starts
a new one. So the laziest journal — just photos — still reads as a story on a map.
"""

from __future__ import annotations

import json
import math
import sqlite3
from datetime import date, datetime, timedelta, timezone

from domains.travel import place

GROUP_MIN = 60          # photos within an hour …
GROUP_KM = 1.5          # … and 1.5 km of each other are one moment
ROUTE_PTS_PER_DAY = 400

MOMENT_FIELDS = ("date", "taken_at", "title", "story", "lat", "lng", "place", "city", "country", "place_source")


def _now_z() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _has(conn: sqlite3.Connection | None, table: str) -> bool:
    return conn is not None and conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def _dates(start: str, end: str) -> list[str]:
    d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
    return [(d0 + timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]


# ── Moments ────────────────────────────────────────────────────────────────────

def photos_of(conn: sqlite3.Connection, moment_ids: list[int]) -> dict[int, list[dict]]:
    if not moment_ids:
        return {}
    q = ",".join("?" * len(moment_ids))
    out: dict[int, list[dict]] = {}
    for r in conn.execute(
            f"SELECT * FROM moment_photos WHERE moment_id IN ({q}) ORDER BY sort, taken_at IS NULL, taken_at, id",
            moment_ids):
        out.setdefault(r["moment_id"], []).append(dict(r))
    return out


def get_moment(conn: sqlite3.Connection, moment_id: int) -> dict | None:
    r = conn.execute("SELECT * FROM moments WHERE id = ?", (moment_id,)).fetchone()
    if r is None:
        return None
    return {**dict(r), "photos": photos_of(conn, [moment_id]).get(moment_id, [])}


def create_moment(conn: sqlite3.Connection, fields: dict) -> int:
    data = {k: fields.get(k) for k in MOMENT_FIELDS if fields.get(k) is not None}
    if "date" not in data:
        raise ValueError("date is required")
    date.fromisoformat(data["date"])
    if data.get("place") and not data.get("place_source"):
        data["place_source"] = "manual"
    cols = ", ".join(data)
    cur = conn.execute(f"INSERT INTO moments ({cols}) VALUES ({', '.join('?' * len(data))})", tuple(data.values()))
    conn.commit()
    return cur.lastrowid


def update_moment(conn: sqlite3.Connection, moment_id: int, fields: dict) -> None:
    data = {k: v for k, v in fields.items() if k in MOMENT_FIELDS}
    if "date" in data and data["date"]:
        date.fromisoformat(data["date"])
    if "place" in data:
        data["place_source"] = "manual" if data["place"] else None
    if "taken_at" in data:          # a new time may mean a new place — re-place unless typed by hand
        cur = conn.execute("SELECT place_source FROM moments WHERE id=?", (moment_id,)).fetchone()
        if cur and cur["place_source"] == "track" and "place" not in data:
            data.update(lat=None, lng=None, city=None, country=None, place_source=None)
            data["place"] = None
    if not data:
        return
    sets = ", ".join(f"{k} = ?" for k in data) + ", updated_at = ?"
    conn.execute(f"UPDATE moments SET {sets} WHERE id = ?", (*data.values(), _now_z(), moment_id))
    conn.commit()


def delete_moment(conn: sqlite3.Connection, moment_id: int) -> list[str]:
    """Deletes the moment and its photo rows; returns the files to remove."""
    files = [p for r in conn.execute("SELECT path, thumb_path FROM moment_photos WHERE moment_id=?", (moment_id,))
             for p in (r["path"], r["thumb_path"])]
    conn.execute("DELETE FROM moment_photos WHERE moment_id = ?", (moment_id,))
    conn.execute("DELETE FROM moments WHERE id = ?", (moment_id,))
    conn.commit()
    return files


def add_photo(conn: sqlite3.Connection, moment_id: int, stored: dict) -> int:
    sort = conn.execute("SELECT COALESCE(MAX(sort), -1) + 1 FROM moment_photos WHERE moment_id=?",
                        (moment_id,)).fetchone()[0]
    cur = conn.execute(
        """INSERT INTO moment_photos (moment_id, path, thumb_path, taken_at, lat, lng, width, height, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (moment_id, stored["path"], stored.get("thumb_path"), stored.get("taken_at"), stored.get("lat"),
         stored.get("lng"), stored.get("width"), stored.get("height"), sort))
    # The moment takes its time / position from its first photo when it had none.
    m = conn.execute("SELECT taken_at, lat FROM moments WHERE id=?", (moment_id,)).fetchone()
    if m and not m["taken_at"] and stored.get("taken_at"):
        conn.execute("UPDATE moments SET taken_at=? WHERE id=?", (stored["taken_at"], moment_id))
    if m and m["lat"] is None and stored.get("lat") is not None:
        conn.execute("UPDATE moments SET lat=?, lng=?, place_source=COALESCE(place_source,'exif') WHERE id=?",
                     (stored["lat"], stored["lng"], moment_id))
    conn.commit()
    return cur.lastrowid


def update_photo(conn: sqlite3.Connection, photo_id: int, fields: dict) -> None:
    data = {k: fields[k] for k in ("caption", "moment_id", "sort") if k in fields}
    if not data:
        return
    sets = ", ".join(f"{k} = ?" for k in data)
    conn.execute(f"UPDATE moment_photos SET {sets} WHERE id = ?", (*data.values(), photo_id))
    conn.commit()


def delete_photo(conn: sqlite3.Connection, photo_id: int) -> list[str]:
    r = conn.execute("SELECT path, thumb_path FROM moment_photos WHERE id=?", (photo_id,)).fetchone()
    if r is None:
        return []
    conn.execute("DELETE FROM moment_photos WHERE id = ?", (photo_id,))
    conn.execute("UPDATE trip_stories SET cover_photo_id = NULL WHERE cover_photo_id = ?", (photo_id,))
    conn.commit()
    return [r["path"], r["thumb_path"]]


def _local_date(taken_at: str, lat: float | None, lng: float | None, fallback_tz: str | None) -> str:
    return place.local(taken_at, place.tz_at(lat, lng, fallback_tz)).date().isoformat()


def place_photo(conn: sqlite3.Connection, loc: sqlite3.Connection | None, stored: dict,
                fallback_date: str, fallback_tz: str | None = None, allow_network: bool = True) -> int:
    """Put a dropped photo into the right moment (or a new one). Returns the moment id."""
    t = stored.get("taken_at")
    lat, lng = stored.get("lat"), stored.get("lng")
    if t and lat is None:
        pos = place.position_at(loc, t)
        if pos:
            lat, lng = pos
    day = _local_date(t, lat, lng, fallback_tz) if t else fallback_date

    target = None
    if t:
        t0 = datetime.fromisoformat(t.replace("Z", "+00:00"))
        best = None
        for m in conn.execute("SELECT id, taken_at, lat, lng FROM moments WHERE date = ? AND taken_at IS NOT NULL",
                              (day,)):
            gap = abs((datetime.fromisoformat(m["taken_at"].replace("Z", "+00:00")) - t0).total_seconds()) / 60
            if gap > GROUP_MIN:
                continue
            if None not in (lat, m["lat"]) and place.haversine_km(lat, lng, m["lat"], m["lng"]) > GROUP_KM:
                continue
            if best is None or gap < best[0]:
                best = (gap, m["id"])
        target = best[1] if best else None
    else:
        # No clock in the file: photos of one batch (same day, last 15 min) share an untimed moment.
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).strftime("%Y-%m-%dT%H:%M:%SZ")
        r = conn.execute("""SELECT id FROM moments WHERE date=? AND taken_at IS NULL AND title IS NULL
                            AND created_at >= ? ORDER BY id DESC LIMIT 1""", (day, cutoff)).fetchone()
        target = r["id"] if r else None

    if target is None:
        fields = {"date": day, "taken_at": t, "lat": lat, "lng": lng}
        if lat is not None:
            fields["place_source"] = "exif" if stored.get("lat") is not None else "track"
        target = create_moment(conn, fields)
        place.resolve(conn, loc, target, allow_network=allow_network)
    add_photo(conn, target, {**stored, "lat": stored.get("lat")})
    return target


# ── The trip story ─────────────────────────────────────────────────────────────

def _trip_meta(conn: sqlite3.Connection, start: str, end: str) -> dict:
    """Name, the detected trip and the plan overlapping these dates (either may be missing)."""
    out: dict = {"name": None, "planned_id": None, "detected": None, "plan_days": {}}
    if _has(conn, "trips"):
        r = conn.execute("""SELECT start_date, end_date, return_date, user_name, auto_name, cover_photo_path,
                                   primary_country
                            FROM trips WHERE start_date <= ? AND COALESCE(return_date, end_date) >= ?
                              AND COALESCE(hidden, 0) = 0
                            ORDER BY start_date DESC LIMIT 1""", (end, start)).fetchone()
        if r:
            out["detected"] = dict(r)
            out["name"] = r["user_name"] or r["auto_name"]
    if _has(conn, "planned_trips"):
        p = conn.execute("""SELECT id, name, destination FROM planned_trips WHERE start_date <= ? AND end_date >= ?
                            ORDER BY start_date DESC LIMIT 1""", (end, start)).fetchone()
        if p:
            out["planned_id"] = p["id"]
            out["destination"] = p["destination"]
            if not out["detected"] or not out["detected"]["user_name"]:
                out["name"] = p["name"]
            out["plan_days"] = {d: n for d, n in conn.execute(
                "SELECT date, note FROM planned_trip_days WHERE planned_id=?", (p["id"],))}
    return out


def story_row(conn: sqlite3.Connection, start: str, end: str) -> dict | None:
    """The trip_stories row for these dates — keyed by first day, found by overlap (±1 day)."""
    lo = (date.fromisoformat(start) - timedelta(days=1)).isoformat()
    r = conn.execute("SELECT * FROM trip_stories WHERE start_date BETWEEN ? AND ? ORDER BY start_date LIMIT 1",
                     (lo, end)).fetchone()
    return dict(r) if r else None


def save_story(conn: sqlite3.Connection, start: str, end: str, fields: dict) -> None:
    row = story_row(conn, start, end)
    key = row["start_date"] if row else start
    conn.execute("INSERT OR IGNORE INTO trip_stories (start_date) VALUES (?)", (key,))
    data = {k: fields[k] for k in ("cover_photo_id", "summary") if k in fields}
    if data:
        sets = ", ".join(f"{k} = ?" for k in data) + ", updated_at = ?"
        conn.execute(f"UPDATE trip_stories SET {sets} WHERE start_date = ?", (*data.values(), _now_z(), key))
    conn.commit()


def _route(loc: sqlite3.Connection | None, day: str) -> tuple[list[list[float]], float, list[str], list[str]]:
    """The day's path ([[lat, lng], …] thinned to ROUTE_PTS_PER_DAY), its km, cities and countries."""
    if loc is None or not _has(loc, "tracks"):
        return [], 0.0, [], []
    pts: list[tuple[float, float]] = []
    cities: list[str] = []
    countries: list[str] = []
    for r in loc.execute("""SELECT points_json, geocode_city, geocode_country FROM tracks
                            WHERE date = ? ORDER BY segment_start""", (day,)):
        try:
            pts += [(p["lat"], p["lng"]) for p in json.loads(r[0]) if "lat" in p and "lng" in p]
        except (TypeError, ValueError):
            pass
        if r[1] and r[1] not in cities:
            cities.append(r[1])
        if r[2] and r[2] not in countries:
            countries.append(r[2])
    km = sum(place.haversine_km(*pts[i - 1], *pts[i]) for i in range(1, len(pts)))
    step = max(1, math.ceil(len(pts) / ROUTE_PTS_PER_DAY))
    thin = pts[::step]
    if pts and thin[-1] != pts[-1]:
        thin.append(pts[-1])
    return [[round(a, 5), round(b, 5)] for a, b in thin], km, cities, countries


def _activities(conn: sqlite3.Connection, day: str) -> list[dict]:
    if not _has(conn, "activities"):
        return []
    return [dict(r) for r in conn.execute(
        """SELECT id, name, activity_type, distance_meters, duration_seconds, start_time FROM activities a
           WHERE date = ? AND NOT (source = 'strava' AND EXISTS (
               SELECT 1 FROM activities g WHERE g.date = a.date AND g.source = 'garmin'
                 AND g.strava_id = CAST(SUBSTR(a.id, 8) AS TEXT)))
           ORDER BY start_time""", (day,))]


def _restaurants(conn: sqlite3.Connection, day: str) -> list[dict]:
    if not _has(conn, "restaurants"):
        return []
    return [dict(r) for r in conn.execute(
        "SELECT id, name, cuisine, city, rating_mf FROM restaurants WHERE date_visited = ? ORDER BY id", (day,))]


def story(conn: sqlite3.Connection, loc: sqlite3.Connection | None, money: sqlite3.Connection | None,
          start: str, end: str, fallback_tz: str | None = None) -> dict:
    """Everything the trip page (and the exported book) shows, day by day."""
    days_list = _dates(start, end)
    meta = _trip_meta(conn, start, end)

    # Place moments Overland has caught up on since they were logged (no network on a read).
    for r in conn.execute("""SELECT id FROM moments WHERE date BETWEEN ? AND ? AND lat IS NULL
                             AND taken_at IS NOT NULL LIMIT 30""", (start, end)).fetchall():
        place.resolve(conn, loc, r["id"])

    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM moments WHERE date BETWEEN ? AND ? ORDER BY date, taken_at IS NULL, taken_at, id",
        (start, end))]
    pics = photos_of(conn, [m["id"] for m in rows])
    for n, m in enumerate(rows, 1):
        m["n"] = n
        m["photos"] = pics.get(m["id"], [])
        if m["taken_at"]:
            lt = place.local(m["taken_at"], place.tz_at(m["lat"], m["lng"], fallback_tz))
            m["local_time"] = lt.strftime("%H:%M")
        else:
            m["local_time"] = None

    from domains.plans.trip_board import _spend
    spend = _spend(money, start, end)
    by_day: dict[str, list[dict]] = {}
    for m in rows:
        by_day.setdefault(m["date"], []).append(m)

    day_rows = {r["date"]: dict(r) for r in conn.execute(
        "SELECT date, mood, energy, notes, photo_path, photo_caption FROM days WHERE date BETWEEN ? AND ?",
        (start, end))} if _has(conn, "days") else {}
    steps = {r[0]: r[1] for r in conn.execute(
        "SELECT date, steps FROM daily_stats WHERE date BETWEEN ? AND ?", (start, end))} if _has(conn, "daily_stats") else {}

    out_days = []
    all_cities: list[str] = []
    all_countries: list[str] = []
    total_km = 0.0
    for i, d in enumerate(days_list):
        route, km, cities, countries = _route(loc, d)
        for m in by_day.get(d, []):
            if m["city"] and m["city"] not in cities:
                cities.append(m["city"])
            if m["country"] and m["country"] not in countries:
                countries.append(m["country"])
        total_km += km
        all_cities += [c for c in cities if c not in all_cities]
        all_countries += [c for c in countries if c not in all_countries]
        dr = day_rows.get(d, {})
        out_days.append({
            "date": d,
            "index": i + 1,
            "plan": meta["plan_days"].get(d),
            "moments": by_day.get(d, []),
            "route": route,
            "km": round(km, 1),
            "cities": cities,
            "countries": countries,
            "steps": steps.get(d),
            "mood": dr.get("mood"),
            "energy": dr.get("energy"),
            "notes": dr.get("notes"),
            "day_photo": dr.get("photo_path"),
            "day_photo_caption": dr.get("photo_caption"),
            "activities": _activities(conn, d),
            "restaurants": _restaurants(conn, d),
            "spent_eur": round(sum(t["eur"] for t in spend.get(d, [])), 2) or None,
        })

    srow = story_row(conn, start, end) or {}
    cover = None
    if srow.get("cover_photo_id"):
        c = conn.execute("SELECT path, thumb_path FROM moment_photos WHERE id=?", (srow["cover_photo_id"],)).fetchone()
        cover = dict(c) if c else None
    if cover is None:
        first = next((p for m in rows for p in m["photos"]), None)
        if first:
            cover = {"path": first["path"], "thumb_path": first["thumb_path"]}
    if cover is None and meta["detected"] and meta["detected"]["cover_photo_path"]:
        cover = {"path": meta["detected"]["cover_photo_path"], "thumb_path": None}

    return {
        "start": start,
        "end": end,
        "name": meta["name"],
        "planned_id": meta["planned_id"],
        "detected": ({"start_date": meta["detected"]["start_date"], "end_date": meta["detected"]["end_date"]}
                     if meta["detected"] else None),
        "summary": srow.get("summary"),
        "cover_photo_id": srow.get("cover_photo_id"),
        "cover": cover,
        "days": out_days,
        "totals": {
            "days": len(days_list),
            "moments": len(rows),
            "photos": sum(len(m["photos"]) for m in rows),
            "km": round(total_km),
            "cities": all_cities,
            "countries": all_countries,
            "activities": sum(len(d["activities"]) for d in out_days),
            "spent_eur": round(sum(d["spent_eur"] or 0 for d in out_days), 2),
        },
    }
