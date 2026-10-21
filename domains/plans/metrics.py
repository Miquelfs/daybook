"""
Where a goal's progress comes from — every source the daybook already records.

Each metric has a `kind`, which decides how progress is judged:
  sum     adds up over the period, paced in a straight line   (km, hours, books, countries)
  ceiling adds up, fewer is better — a budget                 (candy days)
  avg     average over the period vs the target                (sleep h, steps, resting HR)
  level   latest value, moving from a start value to the target (net worth, weight, VO₂max)
  best    best single effort in the period                     (10 k time)
  streak  longest run of days in the period                    (days in a row with/without a tag)

A metric's value function gets (ctx, start, end, param) and only reads tables.
`ctx` carries the daybook connection plus lazy money.db / locations.db access,
so tests can hand in in-memory databases.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Callable

from domains.locations.country_names import to_english


@dataclass
class Ctx:
    conn: sqlite3.Connection
    money: Callable[[], sqlite3.Connection | None] = lambda: None
    locations: Callable[[], sqlite3.Connection | None] = lambda: None
    net_worth: Callable[[], float | None] = lambda: None
    _cache: dict = field(default_factory=dict)

    def once(self, key: str, fn: Callable):
        """Memoise per request — e.g. one money.db net-worth read for many goals."""
        if key not in self._cache:
            try:
                self._cache[key] = fn()
            except Exception:
                self._cache[key] = None
        return self._cache[key]


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    area: str
    unit: str
    kind: str                       # sum | ceiling | avg | level | best | streak
    hint: str
    param: str | None = None        # tag | contact | distance
    lower_is_better: bool = False


# ── Helpers ──────────────────────────────────────────────────────────────────

RUN = ("running", "trail_running", "treadmill_running", "indoor_running", "virtual_run")
RIDE = ("cycling", "road_biking", "mountain_biking", "gravel_cycling", "indoor_cycling", "virtual_ride")
SWIM = ("lap_swimming", "open_water_swimming", "swimming")

# Mirrors infrastructure/api/routers/training.py _DEDUP: a Strava copy of a Garmin activity counts once.
_DEDUP = """
    AND NOT (source='strava' AND EXISTS (
      SELECT 1 FROM activities g
      WHERE g.date = activities.date
        AND g.source = 'garmin'
        AND g.strava_id = CAST(SUBSTR(activities.id, 8) AS TEXT)
    ))
"""


def _iso(d: date) -> str:
    return d.isoformat()


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def _one(conn, sql: str, params: tuple) -> float | None:
    row = conn.execute(sql, params).fetchone()
    return None if row is None or row[0] is None else float(row[0])


def _activities(ctx: Ctx, expr: str, start: date, end: date, types: tuple | None) -> float:
    clause, params = "", [_iso(start), _iso(end)]
    if types:
        clause = f"AND activity_type IN ({','.join('?' * len(types))})"
        params += list(types)
    return _one(ctx.conn, f"SELECT {expr} FROM activities WHERE date BETWEEN ? AND ? {clause} {_DEDUP}",
                tuple(params)) or 0.0


def tag_info(conn: sqlite3.Connection, slug: str) -> tuple[int | None, bool]:
    """(tag id, is_negative) — negative tags are the 'fewer is better' ones."""
    neg = "is_negative" if _has_column(conn, "tags", "is_negative") else "0"
    row = conn.execute(f"SELECT id, {neg} FROM tags WHERE slug=?", (slug,)).fetchone()
    return (row[0], bool(row[1])) if row else (None, False)


def _tag_dates(conn, slug: str, start: date, end: date) -> tuple[set[str], bool] | None:
    tag_id, negative = tag_info(conn, slug)
    if tag_id is None:
        return None
    rows = conn.execute("SELECT DISTINCT date FROM day_tags WHERE tag_id=? AND date BETWEEN ? AND ?",
                        (tag_id, _iso(start), _iso(end))).fetchall()
    return {r[0] for r in rows}, negative


_DISTANCE_LABEL = {"5000": "5 k", "10000": "10 k", "21097": "Half marathon", "42195": "Marathon"}


def param_info(conn: sqlite3.Connection, kind: str | None, param) -> dict:
    """What a goal is tied to, for display: the tag's name + emoji, the person, the distance."""
    label = icon = None
    if kind == "tag" and param:
        row = conn.execute("SELECT name, icon FROM tags WHERE slug=?", (param,)).fetchone() \
            if _has_column(conn, "tags", "icon") else conn.execute("SELECT slug, NULL FROM tags WHERE slug=?", (param,)).fetchone()
        if row:
            label, icon = row[0], row[1]
    elif kind == "contact" and param:
        row = conn.execute("SELECT name, emoji FROM contacts WHERE id=?", (int(param),)).fetchone()
        if row:
            label, icon = row[0], row[1]
    elif kind == "distance" and param:
        label = _DISTANCE_LABEL.get(str(param), f"{int(param) / 1000:g} k")
    return {"param_label": label, "param_icon": icon}


def runs(days: set[str], start: date, end: date, want: bool) -> tuple[int, int]:
    """(longest, current) run of consecutive days in [start, end] whose membership == want."""
    longest = cur = 0
    d = start
    while d <= end:
        if (_iso(d) in days) == want:
            cur += 1
            longest = max(longest, cur)
        else:
            cur = 0
        d += timedelta(days=1)
    return longest, cur


def _avg_daily(ctx: Ctx, table: str, expr: str, start: date, end: date) -> float | None:
    if not _has_table(ctx.conn, table):
        return None
    v = _one(ctx.conn, f"SELECT AVG({expr}) FROM {table} WHERE date BETWEEN ? AND ? AND ({expr}) IS NOT NULL",
             (_iso(start), _iso(end)))
    return None if v is None else round(v, 2)


def _latest(ctx: Ctx, table: str, col: str, start: date, end: date) -> tuple[float | None, float | None]:
    """(latest value up to `end`, first value from `start`) — the latter is the default baseline."""
    if not _has_table(ctx.conn, table):
        return None, None
    last = _one(ctx.conn, f"SELECT {col} FROM {table} WHERE date <= ? AND {col} IS NOT NULL ORDER BY date DESC LIMIT 1",
                (_iso(end),))
    first = _one(ctx.conn, f"SELECT {col} FROM {table} WHERE date >= ? AND {col} IS NOT NULL ORDER BY date LIMIT 1",
                 (_iso(start),))
    if first is None:  # nothing logged since start yet → the last value before it
        first = _one(ctx.conn, f"SELECT {col} FROM {table} WHERE date < ? AND {col} IS NOT NULL ORDER BY date DESC LIMIT 1",
                     (_iso(start),))
    return last, first


# ── Money ────────────────────────────────────────────────────────────────────

def _month_flows(money: sqlite3.Connection, start: date, end: date) -> list[tuple[str, float, float]]:
    """(YYYY-MM, spent, income) per month in the window, expenses as positive numbers."""
    rows = money.execute(
        """SELECT strftime('%Y-%m', date) AS m,
                  COALESCE(-SUM(CASE WHEN transaction_type='Expense' THEN amount END), 0) AS spent,
                  COALESCE( SUM(CASE WHEN transaction_type='Income'  THEN amount END), 0) AS income
           FROM transactions
           WHERE date BETWEEN ? AND ? AND deleted_at IS NULL
           GROUP BY m ORDER BY m""",
        (_iso(start), _iso(end)),
    ).fetchall()
    return [(r[0], max(0.0, r[1] or 0.0), r[2] or 0.0) for r in rows]


def _saved(ctx: Ctx, start: date, end: date, _p) -> float | None:
    money = ctx.money()
    if money is None:
        return None
    return round(sum(inc - sp for _, sp, inc in _month_flows(money, start, end)), 2)


def _budget_months(ctx: Ctx, start: date, end: date, _p) -> float | None:
    """Completed months in the window that stayed within the total monthly budget."""
    from domains.money.money_config import get_budget_for_month
    money = ctx.money()
    if money is None:
        return None
    this_month = _iso(end)[:7]
    n = 0
    for m, spent, _ in _month_flows(money, start, end):
        if m == this_month and end.month == (end + timedelta(days=1)).month:
            continue                                        # month still running
        if spent <= sum(get_budget_for_month(m).values()):
            n += 1
    return n


# ── Travel ───────────────────────────────────────────────────────────────────

def _countries_between(ctx: Ctx, start: str, end: str) -> set[str]:
    out: set[str] = set()
    loc = ctx.locations()
    if loc is not None:
        if _has_table(loc, "tracks"):
            for (c,) in loc.execute("SELECT DISTINCT geocode_country FROM tracks "
                                    "WHERE geocode_country IS NOT NULL AND date BETWEEN ? AND ?", (start, end)):
                out.add(to_english(c))
        if _has_table(loc, "visits") and _has_table(loc, "place_names"):
            for (c,) in loc.execute("""SELECT DISTINCT p.country FROM visits v JOIN place_names p
                                       ON p.place_id = v.place_id
                                       WHERE p.country IS NOT NULL AND v.date BETWEEN ? AND ?""", (start, end)):
                out.add(to_english(c))
    if _has_table(ctx.conn, "trips"):
        for (cj,) in ctx.conn.execute("SELECT countries_json FROM trips WHERE hidden = 0 AND countries_json IS NOT NULL "
                                      "AND start_date <= ? AND end_date >= ?", (end, start)):
            try:
                out.update(to_english(c) for c in json.loads(cj) if c)
            except (ValueError, TypeError):
                pass
    out.discard(None)
    return out


def _countries(ctx: Ctx, start: date, end: date, _p) -> float:
    return len(_countries_between(ctx, _iso(start), _iso(end)))


def _new_countries(ctx: Ctx, start: date, end: date, _p) -> float:
    seen = _countries_between(ctx, "0000-01-01", _iso(start - timedelta(days=1)))
    if _has_table(ctx.conn, "manual_country_visits"):
        for c, first in ctx.conn.execute("SELECT country, first_visit FROM manual_country_visits"):
            if not first or first[:4] < str(start.year) or (len(first) == 10 and first < _iso(start)):
                seen.add(to_english(c))
    return len(_countries_between(ctx, _iso(start), _iso(end)) - seen)


# ── Registry ─────────────────────────────────────────────────────────────────

def _flights(expr: str) -> Callable:
    def f(ctx: Ctx, start: date, end: date, _p) -> float:
        if not _has_table(ctx.conn, "flights"):
            return 0.0
        return round(_one(ctx.conn, f"SELECT {expr} FROM flights WHERE is_sim = 0 AND date BETWEEN ? AND ?",
                          (_iso(start), _iso(end))) or 0.0, 1)
    return f


def _best_time(ctx: Ctx, start: date, end: date, param) -> float | None:
    if not param or not _has_table(ctx.conn, "best_effort"):
        return None
    bucket = int(param)
    v = _one(ctx.conn, "SELECT MIN(value) FROM best_effort WHERE sport='run' AND channel='pace' "
                       "AND bucket=? AND date BETWEEN ? AND ?", (bucket, _iso(start), _iso(end)))
    return None if v is None else round(v * bucket / 1000)          # s/km → seconds for the distance


def _tag_days(ctx: Ctx, start: date, end: date, slug) -> float | None:
    got = _tag_dates(ctx.conn, slug, start, end) if slug else None
    return None if got is None else len(got[0])


def _person_days(ctx: Ctx, start: date, end: date, contact_id) -> float | None:
    if not contact_id:
        return None
    return _one(ctx.conn, "SELECT COUNT(DISTINCT date) FROM day_companions WHERE contact_id=? AND date BETWEEN ? AND ?",
                (int(contact_id), _iso(start), _iso(end))) or 0.0


METRICS: dict[str, tuple[Metric, Callable]] = {}


def _reg(metric: Metric, fn: Callable) -> None:
    METRICS[metric.key] = (metric, fn)


# Training
_reg(Metric("run_km", "Running distance", "training", "km", "sum", "Your runs, Garmin + Strava."),
     lambda c, s, e, p: round(_activities(c, "SUM(distance_meters)/1000.0", s, e, RUN), 1))
_reg(Metric("ride_km", "Cycling distance", "training", "km", "sum", "Your rides, Garmin + Strava."),
     lambda c, s, e, p: round(_activities(c, "SUM(distance_meters)/1000.0", s, e, RIDE), 1))
_reg(Metric("swim_km", "Swimming distance", "training", "km", "sum", "Your swims."),
     lambda c, s, e, p: round(_activities(c, "SUM(distance_meters)/1000.0", s, e, SWIM), 1))
_reg(Metric("workouts", "Workouts", "training", "sessions", "sum", "Every recorded activity, any sport."),
     lambda c, s, e, p: _activities(c, "COUNT(*)", s, e, None))
_reg(Metric("training_hours", "Training time", "training", "h", "sum", "Moving time across all sports."),
     lambda c, s, e, p: round(_activities(c, "SUM(COALESCE(moving_time_seconds, duration_seconds, 0))/3600.0", s, e, None), 1))
_reg(Metric("elevation_m", "Elevation climbed", "training", "m", "sum", "Ascent across all activities."),
     lambda c, s, e, p: round(_activities(c, "SUM(elevation_gain_meters)", s, e, None)))
_reg(Metric("best_time", "Running time over a distance", "training", "time", "best",
            "Your fastest stretch of that distance inside any run — target as a time.", param="distance",
            lower_is_better=True), _best_time)
_reg(Metric("vo2max", "VO₂max (running)", "training", "", "level", "Garmin's latest running VO₂max."),
     lambda c, s, e, p: _latest(c, "garmin_physio", "vo2max_run", s, e))

# Health
_reg(Metric("sleep_hours", "Sleep per night", "health", "h", "avg", "Average Garmin sleep over the period."),
     lambda c, s, e, p: _avg_daily(c, "sleep", "duration_seconds/3600.0", s, e))
_reg(Metric("steps", "Steps per day", "health", "steps", "avg", "Average daily steps."),
     lambda c, s, e, p: _avg_daily(c, "daily_stats", "steps", s, e))
_reg(Metric("resting_hr", "Resting heart rate", "health", "bpm", "avg", "Average resting HR — lower is fitter.",
            lower_is_better=True),
     lambda c, s, e, p: _avg_daily(c, "daily_stats", "resting_hr", s, e))
_reg(Metric("weight", "Body weight", "health", "kg", "level", "Latest weigh-in; direction comes from start → target."),
     lambda c, s, e, p: _latest(c, "weight_log", "weight_kg", s, e))
_reg(Metric("screen_time", "Screen time per day", "health", "min", "avg", "Average daily phone screen time.",
            lower_is_better=True),
     lambda c, s, e, p: _avg_daily(c, "screen_time", "total_minutes", s, e))

# Habits
_reg(Metric("tag_days", "Days with a tag", "habits", "days", "sum",
            "Days tagged. Negative tags (candy, alcohol) become a ceiling — fewer is better.", param="tag"),
     _tag_days)
_reg(Metric("tag_streak", "Days in a row", "habits", "days", "streak",
            "Longest streak with the tag — for negative tags, the longest run without it.", param="tag"),
     None)
_reg(Metric("mood", "Average mood", "habits", "/10", "avg", "Your evening mood score."),
     lambda c, s, e, p: _avg_daily(c, "days", "mood", s, e))
_reg(Metric("energy", "Average energy", "habits", "/10", "avg", "Your evening energy score."),
     lambda c, s, e, p: _avg_daily(c, "days", "energy", s, e))

# People
_reg(Metric("person_days", "Days with someone", "people", "days", "sum",
            "Days you logged together with this person.", param="contact"), _person_days)

# Money
_reg(Metric("net_worth", "Net worth", "money", "€", "level",
            "Money → total net worth. Set the start value for a pace."),
     lambda c, s, e, p: (c.once("net_worth", c.net_worth), None))
_reg(Metric("saved", "Money saved", "money", "€", "sum", "Income minus expenses over the period."), _saved)
_reg(Metric("budget_months", "Months within budget", "money", "months", "sum",
            "Finished months where spending stayed under the total budget."), _budget_months)

# Aviation
_reg(Metric("block_hours", "Block hours", "aviation", "h", "sum", "Logbook block time, sims excluded."),
     _flights("SUM(block_seconds)/3600.0"))
_reg(Metric("pic_hours", "PIC hours", "aviation", "h", "sum", "Logbook time as pilot in command."),
     _flights("SUM(pic_seconds)/3600.0"))
_reg(Metric("sectors", "Sectors flown", "aviation", "flights", "sum", "Logbook flights, sims excluded."),
     _flights("COUNT(*)"))
_reg(Metric("landings", "Landings", "aviation", "landings", "sum", "Landings you flew, day + night."),
     _flights("SUM(landings_day + landings_night)"))

# Travel
_reg(Metric("countries", "Countries visited", "travel", "countries", "sum", "Countries you were in (GPS + trips)."),
     _countries)
_reg(Metric("new_countries", "New countries", "travel", "countries", "sum", "Countries you'd never been to before."),
     _new_countries)
_reg(Metric("trips", "Trips", "travel", "trips", "sum", "Detected trips away from home."),
     lambda c, s, e, p: _one(c.conn, "SELECT COUNT(*) FROM trips WHERE hidden = 0 AND start_date BETWEEN ? AND ?",
                             (_iso(s), _iso(e))) if _has_table(c.conn, "trips") else None)

# Culture
_reg(Metric("books", "Books finished", "culture", "books", "sum", "Books with a finished date in the period."),
     lambda c, s, e, p: _one(c.conn, "SELECT COUNT(*) FROM books WHERE date_finished BETWEEN ? AND ?",
                             (_iso(s), _iso(e))) or 0.0)
_reg(Metric("restaurants", "Restaurants", "culture", "visits", "sum", "Restaurant visits logged."),
     lambda c, s, e, p: _one(c.conn, "SELECT COUNT(*) FROM restaurants WHERE date_visited BETWEEN ? AND ?",
                             (_iso(s), _iso(e))) if _has_table(c.conn, "restaurants") else None)

# Manual
_reg(Metric("manual", "Manual", "personal", "", "manual", "Ticked off by hand — optionally type a number as you go."),
     lambda c, s, e, p: None)


def catalog() -> list[dict]:
    """What the web form offers, in registry order."""
    return [{"key": m.key, "label": m.label, "area": m.area, "unit": m.unit, "kind": m.kind,
             "hint": m.hint, "param": m.param, "lower_is_better": m.lower_is_better}
            for m, _ in METRICS.values()]
