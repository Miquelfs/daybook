"""
Goal progress, computed from what the daybook already records.

Each goal counts over [start_date, min(today, deadline)]:
  run_km / ride_km / swim_km   activities distance (Garmin wins over its Strava twin)
  books                        books finished
  tag_days                     days carrying a tag. Negative tags (candy, alcohol)
                               are a ceiling — fewer is better; with no target the
                               bar is the same window one year earlier.
  net_worth                    current net worth (money.db), paced from `baseline`
  manual                       `current` / `target` typed by hand, else just a status

`state` is what the UI shows:
  done · dropped                 set by hand
  achieved · missed              target hit / deadline passed without it
  on_track · behind              against a straight-line pace to the deadline
  in_progress · overdue          no pace to judge (manual, net worth without baseline)
  not_started                    start_date still ahead
"""

from __future__ import annotations

import sqlite3
from datetime import date
from typing import Callable

METRICS = ("manual", "run_km", "ride_km", "swim_km", "books", "net_worth", "tag_days")

# Mirrors infrastructure/api/routers/training.py (_RUN_TYPES etc. and _DEDUP).
SPORT_TYPES = {
    "run_km": ("running", "trail_running", "treadmill_running", "indoor_running", "virtual_run"),
    "ride_km": ("cycling", "road_biking", "mountain_biking", "gravel_cycling", "indoor_cycling", "virtual_ride"),
    "swim_km": ("lap_swimming", "open_water_swimming", "swimming"),
}
_DEDUP = """
    AND NOT (source='strava' AND EXISTS (
      SELECT 1 FROM activities g
      WHERE g.date = activities.date
        AND g.source = 'garmin'
        AND g.strava_id = CAST(SUBSTR(activities.id, 8) AS TEXT)
    ))
"""

UNITS = {"run_km": "km", "ride_km": "km", "swim_km": "km", "books": "books",
         "net_worth": "€", "tag_days": "days", "manual": ""}

# Within 5% of the straight-line pace still counts as on track.
_PACE_SLACK = 0.95


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def _shift_year(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:          # 29 Feb → 28 Feb
        return d.replace(year=d.year + years, day=28)


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def distance_km(conn: sqlite3.Connection, metric: str, start: date, end: date) -> float:
    types = SPORT_TYPES[metric]
    ph = ",".join("?" * len(types))
    row = conn.execute(
        f"""SELECT COALESCE(SUM(distance_meters), 0) / 1000.0 FROM activities
            WHERE date BETWEEN ? AND ? AND activity_type IN ({ph}) {_DEDUP}""",
        (start.isoformat(), end.isoformat(), *types),
    ).fetchone()
    return round(float(row[0] or 0), 1)


def books_finished(conn: sqlite3.Connection, start: date, end: date) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM books WHERE date_finished BETWEEN ? AND ?",
        (start.isoformat(), end.isoformat()),
    ).fetchone()[0]


def tag_info(conn: sqlite3.Connection, slug: str) -> tuple[int | None, bool]:
    """(tag id, is_negative) — negative tags are the 'fewer is better' ones."""
    neg = "is_negative" if _has_column(conn, "tags", "is_negative") else "0"
    row = conn.execute(f"SELECT id, {neg} FROM tags WHERE slug=?", (slug,)).fetchone()
    return (row[0], bool(row[1])) if row else (None, False)


def tag_days(conn: sqlite3.Connection, tag_id: int, start: date, end: date) -> int:
    return conn.execute(
        "SELECT COUNT(DISTINCT date) FROM day_tags WHERE tag_id=? AND date BETWEEN ? AND ?",
        (tag_id, start.isoformat(), end.isoformat()),
    ).fetchone()[0]


def progress(
    conn: sqlite3.Connection,
    goal: dict,
    today: date,
    net_worth: Callable[[], float | None] | None = None,
) -> dict:
    """The goal plus its computed progress fields."""
    g = dict(goal)
    metric = g.get("metric") or "manual"
    start = _d(g["start_date"]) or today
    deadline = _d(g.get("deadline"))
    target = g.get("target")
    end = min(today, deadline) if deadline else today
    past = deadline is not None and deadline < today

    out = {
        **g,
        "unit": UNITS.get(metric, ""),
        "actual": None, "pct": None, "expected": None,
        "compare": None, "lower_is_better": False,
        "needed_per_week": None, "days_left": (deadline - today).days if deadline and not past else None,
        "state": "in_progress",
    }

    if g.get("status") in ("done", "dropped"):
        out["state"] = g["status"]
    elif start > today:
        out["state"] = "not_started"
        return out

    # Share of the period already elapsed (straight-line pace).
    frac = None
    if deadline and deadline >= start:
        total = (deadline - start).days + 1
        frac = min(1.0, max(0.0, ((end - start).days + 1) / total))

    actual: float | None = None
    if metric in SPORT_TYPES:
        actual = distance_km(conn, metric, start, end)
    elif metric == "books":
        actual = books_finished(conn, start, end)
    elif metric == "tag_days" and g.get("metric_param"):
        tag_id, negative = tag_info(conn, g["metric_param"])
        if tag_id is not None:
            actual = tag_days(conn, tag_id, start, end)
            out["lower_is_better"] = negative
            if negative:
                out["compare"] = tag_days(conn, tag_id, _shift_year(start, -1), _shift_year(end, -1))
    elif metric == "net_worth":
        actual = net_worth() if net_worth else None
        if actual is not None:
            actual = round(actual, 2)
    elif metric == "manual":
        actual = g.get("current")
    out["actual"] = actual

    if out["state"] in ("done", "dropped"):
        if actual is not None and target:
            out["pct"] = min(100, round(actual / target * 100))
        return out

    # ── Fewer is better (candy, alcohol) ─────────────────────────────────────
    if out["lower_is_better"]:
        limit = target if target is not None else out["compare"]
        if target is not None and frac is not None:
            out["expected"] = round(target * frac, 1)          # budget used so far
            out["pct"] = min(100, round(actual / target * 100)) if target else None
        bar = out["expected"] if out["expected"] is not None else out["compare"]
        if past:
            out["state"] = "achieved" if limit is None or actual <= limit else "missed"
        elif bar is not None:
            out["state"] = "on_track" if actual <= bar else "behind"
        return out

    if actual is None or not target:
        if metric == "manual" and past:
            out["state"] = "overdue"
        return out

    out["pct"] = min(100, round(actual / target * 100))
    if actual >= target:
        out["state"] = "achieved"
        return out
    if past:
        out["state"] = "missed"
        return out

    remaining = target - actual
    if deadline:
        weeks_left = max(1.0, ((deadline - today).days + 1) / 7)
        out["needed_per_week"] = round(remaining / weeks_left, 1)

    if metric == "net_worth":
        base = g.get("baseline")
        if base is None or frac is None:
            return out
        expected = base + (target - base) * frac
    elif metric == "manual":
        return out                                  # no honest pace for hand-typed numbers
    else:
        if frac is None:
            return out
        expected = target * frac

    out["expected"] = round(expected, 1)
    out["state"] = "on_track" if actual >= expected * _PACE_SLACK else "behind"
    return out


def list_with_progress(
    conn: sqlite3.Connection,
    today: date,
    net_worth: Callable[[], float | None] | None = None,
    year: int | None = None,
) -> list[dict]:
    """All goals (optionally those overlapping `year`), with progress, best first."""
    rows = [dict(r) for r in conn.execute("SELECT * FROM goals").fetchall()]
    if year is not None:
        y0, y1 = f"{year}-01-01", f"{year}-12-31"
        rows = [r for r in rows if r["start_date"] <= y1 and (r["deadline"] or "9999") >= y0]

    cache: dict[str, float | None] = {}

    def nw() -> float | None:          # one money.db read, however many goals use it
        if "v" not in cache:
            try:
                cache["v"] = net_worth() if net_worth else None
            except Exception:
                cache["v"] = None
        return cache["v"]

    out = [progress(conn, r, today, nw) for r in rows]
    order = {"behind": 0, "overdue": 1, "on_track": 2, "in_progress": 3, "not_started": 4,
             "achieved": 5, "done": 6, "missed": 7, "dropped": 8}
    out.sort(key=lambda g: (order.get(g["state"], 9), -(g.get("priority") or 0), g["deadline"] or "9999"))
    return out


def period_end(start: date) -> date:
    """Default deadline for a yearly goal: 31 Dec of its start year."""
    return date(start.year, 12, 31)
