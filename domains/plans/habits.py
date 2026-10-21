"""
Habits — the tags you chose to work on, and an explorer for all the others.

A tag is *tracked* when you pinned it (tracked_habits), a goal measures it, or
an active experiment uses it — so "late night" never shows up as a habit unless
you ask. Any tag can still be explored: its calendar, months, weekdays, days.

Positive habits (gym, outdoors) count days *with* the tag; negative ones
(candy, alcohol — tags.is_negative) count clean days *without* it, starting
from the first time the tag was ever logged.
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

from domains.plans.metrics import _has_column, _has_table, runs


def _negative_col(conn: sqlite3.Connection) -> str:
    return "t.is_negative" if _has_column(conn, "tags", "is_negative") else "0"


def _dates(conn: sqlite3.Connection, tag_id: int) -> list[str]:
    return [r[0] for r in conn.execute(
        "SELECT DISTINCT date FROM day_tags WHERE tag_id=? ORDER BY date", (tag_id,))]


def streaks(dates: list[str], negative: bool, today: date) -> dict:
    """Current and best run. Positive: days in a row with it (today may still be open).
    Negative: days in a row without it, counted from its first use."""
    if not dates:
        return {"current": 0, "best": 0, "best_end": None}
    days, want = set(dates), not negative
    start = date.fromisoformat(dates[0])
    best = cur = 0
    best_end = None
    d = start
    while d <= today:
        if (d.isoformat() in days) == want:
            cur += 1
            if cur > best:
                best, best_end = cur, d
        else:
            cur = 0
        d += timedelta(days=1)
    if want and today.isoformat() not in days:
        # Today isn't logged yet — a run that ended yesterday is still alive.
        _, cur = runs(days, start, today - timedelta(days=1), want)
    return {"current": cur, "best": best, "best_end": best_end.isoformat() if best_end else None}


def tracked(conn: sqlite3.Connection) -> dict[int, list[str]]:
    """tag id → why it's tracked: 'pinned' · 'goal' · 'experiment'."""
    why: dict[int, list[str]] = {}
    if _has_table(conn, "tracked_habits"):
        for (tid,) in conn.execute("SELECT tag_id FROM tracked_habits"):
            why.setdefault(tid, []).append("pinned")
    if _has_table(conn, "goals"):
        for (tid,) in conn.execute("""
            SELECT DISTINCT t.id FROM goals g JOIN tags t ON t.slug = g.metric_param
            WHERE g.status = 'active' AND g.metric IN ('tag_days', 'tag_streak')"""):
            why.setdefault(tid, []).append("goal")
    if _has_table(conn, "experiments"):
        for (tid,) in conn.execute("""
            SELECT DISTINCT t.id FROM experiments e JOIN tags t ON t.slug = e.tag
            WHERE e.status = 'active'"""):
            why.setdefault(tid, []).append("experiment")
    return why


def set_tracked(conn: sqlite3.Connection, slug: str, on: bool) -> bool:
    row = conn.execute("SELECT id FROM tags WHERE slug=?", (slug,)).fetchone()
    if row is None:
        return False
    if on:
        conn.execute("INSERT OR IGNORE INTO tracked_habits (tag_id) VALUES (?)", (row[0],))
    else:
        conn.execute("DELETE FROM tracked_habits WHERE tag_id=?", (row[0],))
    conn.commit()
    return True


def overview(conn: sqlite3.Connection, today: date) -> list[dict]:
    """Tracked habits, each with its last 7 days, streaks and 30-day rate."""
    why = tracked(conn)
    if not why:
        return []
    ph = ",".join("?" * len(why))
    rows = conn.execute(f"""
        SELECT t.id, t.slug, t.name, t.icon, t.category, {_negative_col(conn)} AS neg
        FROM tags t WHERE t.id IN ({ph})""", list(why)).fetchall()
    week = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    d30 = (today - timedelta(days=29)).isoformat()
    year0 = date(today.year, 1, 1).isoformat()
    out = []
    for r in rows:
        dates = _dates(conn, r["id"])
        have = set(dates)
        last30 = sum(1 for x in dates if x >= d30)
        negative = bool(r["neg"])
        out.append({
            "id": r["id"], "slug": r["slug"], "name": r["name"], "icon": r["icon"],
            "category": r["category"], "is_negative": negative, "why": why[r["id"]],
            "week": [{"date": d, "done": d in have} for d in week],
            "rate_30": round((30 - last30 if negative else last30) / 30 * 100),
            "count_30": last30,
            "this_year": sum(1 for x in dates if x >= year0),
            "total": len(dates),
            "last": dates[-1] if dates else None,
            **{f"streak_{k}": v for k, v in streaks(dates, negative, today).items()},
        })
    out.sort(key=lambda h: (h["is_negative"], -h["count_30"], h["name"]))   # doing-habits first, then clean streaks
    return out


def explore(conn: sqlite3.Connection, today: date) -> list[dict]:
    """Every tag you've ever logged — to look back at any of them (all the days you cooked)."""
    why = tracked(conn)
    year0 = date(today.year, 1, 1).isoformat()
    rows = conn.execute(f"""
        SELECT t.id, t.slug, t.name, t.icon, t.category, {_negative_col(conn)} AS neg,
               COUNT(DISTINCT d.date) AS total,
               COUNT(DISTINCT CASE WHEN d.date >= ? THEN d.date END) AS this_year,
               MAX(d.date) AS last
        FROM tags t JOIN day_tags d ON d.tag_id = t.id
        GROUP BY t.id""", (year0,)).fetchall()
    out = [{"id": r["id"], "slug": r["slug"], "name": r["name"], "icon": r["icon"], "category": r["category"],
            "is_negative": bool(r["neg"]), "total": r["total"], "this_year": r["this_year"], "last": r["last"],
            "tracked": r["id"] in why} for r in rows]
    out.sort(key=lambda t: (-t["this_year"], -t["total"], t["name"]))
    return out


def detail(conn: sqlite3.Connection, slug: str, year: int, today: date) -> dict | None:
    row = conn.execute(
        f"SELECT t.id, t.slug, t.name, t.icon, t.category, {_negative_col(conn)} AS neg FROM tags t WHERE slug=?",
        (slug,)).fetchone()
    if row is None:
        return None
    dates = _dates(conn, row["id"])
    negative = bool(row["neg"])
    in_year = [d for d in dates if d.startswith(f"{year}-")]
    y0 = date(year, 1, 1)
    y_end = min(date(year, 12, 31), today)
    elapsed = max(0, (y_end - y0).days + 1)
    by_month = [0] * 12
    by_weekday = [0] * 7          # Mon … Sun
    for d in in_year:
        dd = date.fromisoformat(d)
        by_month[dd.month - 1] += 1
        by_weekday[dd.weekday()] += 1
    years = sorted({int(d[:4]) for d in dates} | {today.year})
    best_in_year, _ = runs(set(in_year), y0, y_end, not negative) if elapsed else (0, 0)
    return {
        "id": row["id"], "slug": row["slug"], "name": row["name"], "icon": row["icon"],
        "category": row["category"], "is_negative": negative,
        "why": tracked(conn).get(row["id"], []),
        "year": year, "years": years,
        "dates": in_year,
        "count": len(in_year),
        "days_elapsed": elapsed,
        "rate": round(((elapsed - len(in_year)) if negative else len(in_year)) / elapsed * 100) if elapsed else 0,
        "per_week": round(len(in_year) / (elapsed / 7), 1) if elapsed >= 7 else None,
        "by_month": by_month,
        "by_weekday": by_weekday,
        "best_in_year": best_in_year,
        "total": len(dates),
        "first": dates[0] if dates else None,
        **{f"streak_{k}": v for k, v in streaks(dates, negative, today).items()},
    }
