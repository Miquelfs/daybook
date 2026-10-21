"""
Goal progress, computed from what the daybook already records (see metrics.py).

Every goal counts over [start_date, min(today, deadline)]. `state` is what the UI shows:
  done · dropped           set by hand
  achieved · missed        target reached / deadline passed without it
  on_track · behind        against a straight-line pace (or, for averages, the target itself)
  in_progress · overdue    nothing honest to judge yet (manual goals, bests, streaks)
  not_started              start_date still ahead
"""

from __future__ import annotations

import sqlite3
from datetime import date

from domains.plans.metrics import METRICS, Ctx, _tag_dates, param_info, runs, tag_info

# Within 5% of the straight-line pace still counts as on track.
_PACE_SLACK = 0.95


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def _shift_year(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:          # 29 Feb → 28 Feb
        return d.replace(year=d.year + years, day=28)


def _clamp_pct(x: float) -> int:
    return max(0, min(100, round(x * 100)))


def progress(ctx: Ctx | sqlite3.Connection, goal: dict, today: date) -> dict:
    """The goal plus its computed progress fields."""
    if isinstance(ctx, sqlite3.Connection):
        ctx = Ctx(ctx)
    g = dict(goal)
    key = g.get("metric") or "manual"
    metric, fn = METRICS.get(key, METRICS["manual"])
    kind = metric.kind
    start = _d(g["start_date"]) or today
    deadline = _d(g.get("deadline"))
    target = g.get("target")
    end = min(today, deadline) if deadline else today
    past = deadline is not None and deadline < today
    param = g.get("metric_param")

    out = {
        **g,
        "area": g.get("area") or metric.area,
        "kind": kind,
        "unit": metric.unit,
        "actual": None, "pct": None, "expected": None,
        "compare": None, "lower_is_better": metric.lower_is_better,
        "needed_per_week": None,
        "days_left": (deadline - today).days if deadline and not past else None,
        **param_info(ctx.conn, metric.param, param),
        "state": "in_progress",
    }
    closed = g.get("status") in ("done", "dropped")
    if closed:
        out["state"] = g["status"]
    elif start > today:
        out["state"] = "not_started"
        return out

    frac = None                 # share of the period already elapsed
    if deadline and deadline >= start:
        frac = min(1.0, max(0.0, ((end - start).days + 1) / ((deadline - start).days + 1)))

    # ── Read the value ───────────────────────────────────────────────────────
    actual = baseline = None
    if kind == "manual":
        actual = g.get("current")
    elif key == "tag_days" and param:
        actual = fn(ctx, start, end, param)
        _, negative = tag_info(ctx.conn, param)
        if actual is not None and negative:
            kind = out["kind"] = "ceiling"
            out["lower_is_better"] = True
            out["compare"] = fn(ctx, _shift_year(start, -1), _shift_year(end, -1), param)
    elif kind == "streak":
        got = _tag_dates(ctx.conn, param, start, end) if param else None
        if got is not None:
            dates, negative = got
            longest, current = runs(dates, start, end, want=not negative)
            actual, out["compare"] = longest, current       # compare = the streak running now
    elif kind == "level":
        actual, auto_base = fn(ctx, start, end, param)
        baseline = g.get("baseline") if g.get("baseline") is not None else auto_base
    else:
        actual = fn(ctx, start, end, param)
    if actual is not None:
        actual = round(float(actual), 2)
    out["actual"] = actual

    if closed:
        if actual is not None and target and kind in ("sum", "level"):
            out["pct"] = _clamp_pct(actual / target) if kind == "sum" else None
        return out

    # ── Judge it ─────────────────────────────────────────────────────────────
    if actual is None:
        if past and kind == "manual":
            out["state"] = "overdue"
        return out

    if kind == "manual":
        if target:
            out["pct"] = _clamp_pct(actual / target)
            if actual >= target:
                out["state"] = "achieved"
        if past and out["state"] != "achieved":
            out["state"] = "overdue"
        return out

    if kind == "ceiling":
        limit = target if target is not None else out["compare"]
        if target is not None and frac is not None:
            out["expected"] = round(target * frac, 1)       # allowance used so far
            out["pct"] = _clamp_pct(actual / target) if target else None
        bar = out["expected"] if out["expected"] is not None else out["compare"]
        if past:
            out["state"] = "achieved" if limit is None or actual <= limit else "missed"
        elif bar is not None:
            out["state"] = "on_track" if actual <= bar else "behind"
        return out

    if target is None:
        return out

    if kind == "sum":
        out["pct"] = _clamp_pct(actual / target) if target else None
        if actual >= target:
            out["state"] = "achieved"
        elif past:
            out["state"] = "missed"
        elif frac is not None:
            out["expected"] = round(target * frac, 1)
            out["state"] = "on_track" if actual >= out["expected"] * _PACE_SLACK else "behind"
            weeks_left = max(1.0, ((deadline - today).days + 1) / 7)
            out["needed_per_week"] = round((target - actual) / weeks_left, 1)
        return out

    lower = metric.lower_is_better
    if kind in ("avg", "best"):
        meets = actual <= target if lower else actual >= target
        out["pct"] = _clamp_pct(target / actual if lower and actual else actual / target if target else 0)
        if kind == "best":
            out["state"] = "achieved" if meets else ("missed" if past else "in_progress")
        else:
            out["state"] = ("achieved" if meets else "missed") if past else ("on_track" if meets else "behind")
        return out

    if kind == "streak":
        out["pct"] = _clamp_pct(actual / target) if target else None
        out["state"] = "achieved" if actual >= target else ("missed" if past else "in_progress")
        return out

    # level: from baseline toward target, either direction
    out["compare"] = baseline
    up = target >= (baseline if baseline is not None else actual)
    out["lower_is_better"] = not up
    if (actual >= target) if up else (actual <= target):
        out["state"] = "achieved"
        out["pct"] = 100
        return out
    if past:
        out["state"] = "missed"
    if baseline is None or baseline == target:
        return out
    share = (actual - baseline) / (target - baseline)
    out["pct"] = _clamp_pct(share)
    if not past and frac is not None:
        out["expected"] = round(baseline + (target - baseline) * frac, 2)
        out["state"] = "on_track" if share >= frac * _PACE_SLACK else "behind"
        weeks_left = max(1.0, ((deadline - today).days + 1) / 7)
        out["needed_per_week"] = round((target - actual) / weeks_left, 2)
    return out


_ORDER = {"behind": 0, "overdue": 1, "on_track": 2, "in_progress": 3, "not_started": 4,
          "achieved": 5, "done": 6, "missed": 7, "dropped": 8}


def list_with_progress(ctx: Ctx | sqlite3.Connection, today: date, year: int | None = None) -> list[dict]:
    """All goals (optionally those overlapping `year`), with progress — what needs attention first."""
    if isinstance(ctx, sqlite3.Connection):
        ctx = Ctx(ctx)
    rows = [dict(r) for r in ctx.conn.execute("SELECT * FROM goals").fetchall()]
    if year is not None:
        y0, y1 = f"{year}-01-01", f"{year}-12-31"
        rows = [r for r in rows if r["start_date"] <= y1 and (r["deadline"] or "9999") >= y0]
    out = [progress(ctx, r, today) for r in rows]
    out.sort(key=lambda g: (_ORDER.get(g["state"], 9), -(g.get("priority") or 0), g["deadline"] or "9999"))
    return out


def years(conn: sqlite3.Connection, first_year: int, today: date) -> list[int]:
    """Years the goals view offers: from the daybook's first year to next year, plus any with goals."""
    have = {int(r[0][:4]) for r in conn.execute("SELECT start_date FROM goals")}
    return sorted(set(range(first_year, today.year + 2)) | have)


def period_end(start: date) -> date:
    """Default deadline for a yearly goal: 31 Dec of its start year."""
    return date(start.year, 12, 31)
