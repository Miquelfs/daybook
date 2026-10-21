"""
Habits — every tag is a habit; this is the tracker view of them.

Positive habits (gym, outdoors) count days *with* the tag; negative ones
(candy, alcohol — tags.is_negative) count clean days *without* it, starting
from the first time the tag was ever logged.
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

from domains.plans.metrics import _has_column, runs


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


def overview(conn: sqlite3.Connection, today: date, recent_days: int = 90) -> list[dict]:
    """Habits used in the last `recent_days`, most-used first, each with its last 7 days."""
    since = (today - timedelta(days=recent_days)).isoformat()
    rows = conn.execute(f"""
        SELECT t.id, t.slug, t.name, t.icon, t.category, {_negative_col(conn)} AS neg
        FROM tags t
        WHERE EXISTS (SELECT 1 FROM day_tags d WHERE d.tag_id = t.id AND d.date >= ?)
    """, (since,)).fetchall()
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
            "category": r["category"], "is_negative": negative,
            "week": [{"date": d, "done": d in have} for d in week],
            "rate_30": round((30 - last30 if negative else last30) / 30 * 100),
            "count_30": last30,
            "this_year": sum(1 for x in dates if x >= year0),
            "total": len(dates),
            "last": dates[-1],
            **{f"streak_{k}": v for k, v in streaks(dates, negative, today).items()},
        })
    out.sort(key=lambda h: (h["is_negative"], -h["count_30"], h["name"]))   # doing-habits first, then clean streaks
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
