"""
People — who you spend your days with, from day_companions (logged on Today).

  directory()  everyone, with days together this year / all time and last seen — for search
  profile()    one person: days per year, a year calendar, frequency, longest run,
               weekdays, birthday, and what you do together (tags on those days,
               sports, tennis, restaurants, trips)
"""

from __future__ import annotations

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
    elapsed = max(0, (y_end - y0).days + 1)

    by_year = Counter(d[:4] for d in dates)
    by_month = [0] * 12
    by_weekday = [0] * 7
    for d in in_year:
        dd = date.fromisoformat(d)
        by_month[dd.month - 1] += 1
        by_weekday[dd.weekday()] += 1

    # Same window last year, for "vs last year".
    prev_same = sum(1 for d in dates if d.startswith(f"{year - 1}-") and d[5:] <= y_end.isoformat()[5:])
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
        "by_year": [{"year": int(y), "days": n} for y, n in sorted(by_year.items())],
        "by_month": by_month,
        "by_weekday": by_weekday,
        "total": len(dates),
        "first": dates[0] if dates else None,
        "last": dates[-1] if dates else None,
        "days_since": (today - date.fromisoformat(dates[-1])).days if dates else None,
        "longest_run": longest_run,
        "typical_gap": sorted(gaps)[len(gaps) // 2] if gaps else None,     # median days between
        "together": _together(conn, c["name"], contact_id, dates),
        "recent": list(reversed(dates[-8:])),
    }


def _together(conn: sqlite3.Connection, name: str, contact_id: int, dates: list[str]) -> dict:
    """What you do on the days you're together."""
    out: dict = {"tags": [], "sports": [], "tennis": None, "restaurants": [], "trips": []}
    if not dates:
        return out
    ph = ",".join("?" * len(dates))

    if _has_table(conn, "day_tags"):
        icon = "t.icon" if _has_column(conn, "tags", "icon") else "NULL"
        out["tags"] = [dict(r) for r in conn.execute(f"""
            SELECT t.slug, t.name, {icon} AS icon, COUNT(DISTINCT d.date) AS days
            FROM day_tags d JOIN tags t ON t.id = d.tag_id
            WHERE d.date IN ({ph}) GROUP BY t.id ORDER BY days DESC LIMIT 8""", dates)]

    if _has_table(conn, "activities"):
        out["sports"] = [{"type": r[0], "days": r[1]} for r in conn.execute(f"""
            SELECT activity_type, COUNT(DISTINCT date) FROM activities
            WHERE date IN ({ph}) AND activity_type IS NOT NULL
            GROUP BY activity_type ORDER BY 2 DESC LIMIT 5""", dates)]

    if _has_table(conn, "tennis_session_player"):
        r = conn.execute("""
            SELECT COUNT(DISTINCT p.activity_id),
                   SUM(CASE WHEN p.role='partner' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN p.role='opponent' THEN 1 ELSE 0 END)
            FROM tennis_session_player p WHERE p.contact_id=?""", (contact_id,)).fetchone()
        if r and r[0]:
            out["tennis"] = {"sessions": r[0], "as_partner": r[1] or 0, "as_opponent": r[2] or 0}

    if _has_table(conn, "restaurants"):
        first = name.split()[0]
        out["restaurants"] = [dict(r) for r in conn.execute("""
            SELECT id, name, date_visited, city FROM restaurants
            WHERE date_visited IS NOT NULL AND companions LIKE ?
            ORDER BY date_visited DESC LIMIT 6""", (f"%{first}%",))]

    if _has_table(conn, "trips"):
        trips = []
        for t in conn.execute("""
            SELECT id, start_date, end_date, user_name, auto_name, primary_country FROM trips
            WHERE hidden = 0 ORDER BY start_date DESC"""):
            if any(t["start_date"] <= d <= t["end_date"] for d in dates):
                trips.append({"id": t["id"], "name": t["user_name"] or t["auto_name"],
                              "start": t["start_date"], "end": t["end_date"]})
            if len(trips) >= 6:
                break
        out["trips"] = trips
    return out
