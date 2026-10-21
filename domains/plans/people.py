"""
People — who you spend your days with, from day_companions (logged on Today).

  directory()  everyone, with days together this year / all time and last seen — for search
  profile()    one person: days per year, a year calendar, frequency, longest run,
               weekdays, birthday, and what you did together — only what was
               linked explicitly: trainings marked "with", tennis sessions,
               trips marked "with", restaurants with them as companions
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from datetime import date

from domains.plans.agenda import next_birthday, parse_birthday
from domains.plans.metrics import _has_column, _has_table, runs


def _dates(conn: sqlite3.Connection, contact_id: int) -> list[str]:
    return [r[0] for r in conn.execute(
        "SELECT DISTINCT date FROM day_companions WHERE contact_id=? ORDER BY date", (contact_id,))]


def _birthday(conn: sqlite3.Connection, raw: str | None, today: date) -> dict | None:
    if not raw or parse_birthday(raw) is None:
        return None
    nxt = next_birthday(raw, today)
    born = parse_birthday(raw)[0]
    return {"stored": raw, "next": nxt.isoformat(), "days_until": (nxt - today).days,
            "turning": nxt.year - born if born else None}


def directory(conn: sqlite3.Connection, today: date) -> list[dict]:
    y0 = date(today.year, 1, 1).isoformat()
    bday = "c.birthday" if _has_column(conn, "contacts", "birthday") else "NULL"
    rows = conn.execute(f"""
        SELECT c.id, c.name, c.emoji, c.group_, {bday} AS birthday,
               COUNT(DISTINCT dc.date)                                AS total,
               COUNT(DISTINCT CASE WHEN dc.date >= ? THEN dc.date END) AS this_year,
               MAX(dc.date)                                           AS last
        FROM contacts c LEFT JOIN day_companions dc ON dc.contact_id = c.id AND dc.date <= ?
        GROUP BY c.id
    """, (y0, today.isoformat())).fetchall()
    out = [{
        "id": r["id"], "name": r["name"], "emoji": r["emoji"], "group_": r["group_"],
        "total": r["total"], "this_year": r["this_year"], "last": r["last"],
        "days_since": (today - date.fromisoformat(r["last"])).days if r["last"] else None,
        "birthday": _birthday(conn, r["birthday"], today),
    } for r in rows]
    out.sort(key=lambda p: (-p["this_year"], -p["total"], p["name"]))
    return out


def profile(conn: sqlite3.Connection, contact_id: int, year: int, today: date) -> dict | None:
    bday = "birthday" if _has_column(conn, "contacts", "birthday") else "NULL AS birthday"
    c = conn.execute(f"SELECT id, name, emoji, group_, {bday} FROM contacts WHERE id=?", (contact_id,)).fetchone()
    if c is None:
        return None
    dates = [d for d in _dates(conn, contact_id) if d <= today.isoformat()]
    in_year = [d for d in dates if d.startswith(f"{year}-")]
    y0 = date(year, 1, 1)
    y_end = min(date(year, 12, 31), today)
    # Shares count from when you started logging companions — a mid-year start
    # shouldn't make every person look rarer.
    first_logged = conn.execute("SELECT MIN(date) FROM day_companions").fetchone()[0]
    tracking = date.fromisoformat(first_logged) if first_logged else y0
    window0 = max(y0, tracking)
    elapsed = max(0, (y_end - window0).days + 1)

    by_year = Counter(d[:4] for d in dates)
    by_month = [0] * 12
    by_weekday = [0] * 7
    for d in in_year:
        dd = date.fromisoformat(d)
        by_month[dd.month - 1] += 1
        by_weekday[dd.weekday()] += 1

    # Same window last year, for "vs last year" — only if you were logging back then.
    prev_end = date(year - 1, y_end.month, min(y_end.day, 28 if y_end.month == 2 else y_end.day))
    prev_same = (sum(1 for d in dates if d.startswith(f"{year - 1}-") and d <= prev_end.isoformat())
                 if tracking <= prev_end else None)
    gaps = [(date.fromisoformat(b) - date.fromisoformat(a)).days for a, b in zip(dates, dates[1:])]
    longest_run = runs(set(dates), date.fromisoformat(dates[0]), today, True)[0] if dates else 0

    return {
        "id": c["id"], "name": c["name"], "emoji": c["emoji"], "group_": c["group_"],
        "birthday": _birthday(conn, c["birthday"], today),
        "year": year,
        "years": sorted({int(y) for y in by_year} | {today.year}),
        "dates": in_year,
        "count": len(in_year),
        "prev_same_period": prev_same,
        "per_month": round(len(in_year) / (elapsed / 30.44), 1) if elapsed >= 28 else None,
        "share": round(len(in_year) / elapsed * 100) if elapsed else 0,
        "since": window0.isoformat() if window0 > y0 else None,          # shares measured from here
        "by_year": [{"year": int(y), "days": n} for y, n in sorted(by_year.items())],
        "by_month": by_month,
        "by_weekday": by_weekday,
        "total": len(dates),
        "first": dates[0] if dates else None,
        "last": dates[-1] if dates else None,
        "days_since": (today - date.fromisoformat(dates[-1])).days if dates else None,
        "longest_run": longest_run,
        "typical_gap": sorted(gaps)[len(gaps) // 2] if gaps else None,     # median days between
        "together": _together(conn, c["name"], contact_id, today),
        "recent": list(reversed(dates[-8:])),
    }


def _together(conn: sqlite3.Connection, name: str, contact_id: int, today: date) -> dict:
    """What you did together — explicit links only (a day together isn't 'did X together')."""
    out: dict = {"activities": [], "sports": [], "tennis": None, "restaurants": [], "trips": []}

    if _has_table(conn, "activity_companions") and _has_table(conn, "activities"):
        rows = conn.execute("""
            SELECT a.id, a.date, a.activity_type, a.name, a.distance_meters
            FROM activity_companions ac JOIN activities a ON a.id = ac.activity_id
            WHERE ac.contact_id = ? ORDER BY a.date DESC""", (contact_id,)).fetchall()
        out["activities"] = [{"id": r[0], "date": r[1], "type": r[2], "name": r[3], "distance_m": r[4]} for r in rows[:8]]
        out["sports"] = [{"type": t, "count": n} for t, n in Counter(r[2] for r in rows if r[2]).most_common(5)]

    if _has_table(conn, "tennis_session_player"):
        r = conn.execute("""
            SELECT COUNT(DISTINCT activity_id),
                   SUM(CASE WHEN role='partner' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN role='opponent' THEN 1 ELSE 0 END)
            FROM tennis_session_player WHERE contact_id=?""", (contact_id,)).fetchone()
        if r and r[0]:
            out["tennis"] = {"sessions": r[0], "as_partner": r[1] or 0, "as_opponent": r[2] or 0}

    if _has_table(conn, "restaurants"):
        first = name.split()[0]
        out["restaurants"] = [dict(r) for r in conn.execute("""
            SELECT id, name, date_visited, city FROM restaurants
            WHERE date_visited IS NOT NULL AND companions LIKE ?
            ORDER BY date_visited DESC LIMIT 6""", (f"%{first}%",))]

    trips = []
    if _has_table(conn, "planned_trips"):                     # coming up together
        for r in conn.execute("""
            SELECT p.id, p.name, p.destination, p.start_date, p.end_date FROM planned_trips p
            JOIN planned_trip_companions c ON c.planned_id = p.id
            WHERE c.contact_id = ? AND p.adopted_start IS NULL AND p.end_date >= ?
            ORDER BY p.start_date""", (contact_id, today.isoformat())):
            trips.append({"id": r[0], "name": r[1], "start": r[3], "end": r[4], "planned": True,
                          "countries": [r[2]] if r[2] else [], "cover": None,
                          "nights": (date.fromisoformat(r[4]) - date.fromisoformat(r[3])).days,
                          "days_until": (date.fromisoformat(r[3]) - today).days})
    if _has_table(conn, "trip_companions") and _has_table(conn, "trips"):
        for r in conn.execute("""
            SELECT t.id, COALESCE(t.user_name, t.auto_name), t.start_date, t.end_date, t.countries_json, t.cover_photo_path
            FROM trip_companions tc JOIN trips t ON t.start_date = tc.start_date AND t.end_date = tc.end_date
            WHERE tc.contact_id = ? ORDER BY t.start_date DESC LIMIT 8""", (contact_id,)):
            try:
                countries = json.loads(r[4]) if r[4] else []
            except ValueError:
                countries = []
            trips.append({"id": r[0], "name": r[1], "start": r[2], "end": r[3], "planned": False,
                          "countries": countries, "cover": r[5],
                          "nights": (date.fromisoformat(r[3]) - date.fromisoformat(r[2])).days + 1,
                          "days_until": None})
    out["trips"] = trips
    return out
