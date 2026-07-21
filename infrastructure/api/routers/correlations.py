"""
Custom correlation engine.
GET /correlations/catalog      — all available metrics grouped by category
GET /correlations/compute      — scatter points + Pearson r for any two metrics
GET /correlations/top          — top N auto-discovered correlations
GET /correlations/weekly-stats — mood/energy by weekday + top tag impact
GET /correlations/journal      — searchable mood journal entries
GET /correlations/precomputed  — top correlations from the weekly batch snapshot
GET /correlations/compare      — period-over-period comparison for any metric
"""

import math
import sqlite3
from datetime import date, timedelta
from itertools import combinations
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from infrastructure.api.db import get_db
from infrastructure.api.utils.stats import pearson, p_value_approx, interpret_r, least_squares

_LOCATIONS_DB = Path(__file__).parents[3] / "infrastructure" / "db" / "locations.db"
_MONEY_DB     = Path(__file__).parents[3] / "infrastructure" / "db" / "money.db"


def _locations_conn() -> sqlite3.Connection:
    con = sqlite3.connect(_LOCATIONS_DB)
    con.row_factory = sqlite3.Row
    return con


def _money_conn() -> sqlite3.Connection:
    con = sqlite3.connect(_MONEY_DB)
    con.row_factory = sqlite3.Row
    return con

router = APIRouter(prefix="/correlations", tags=["correlations"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]

# ─── Metric catalog ───────────────────────────────────────────────────────────

# Each entry: key → {label, unit, category, _fetch_type, ...fetch-specific fields}
_STATIC_CATALOG: dict[str, dict] = {
    # Subjective (days table, simple column)
    "energy":        {"label": "Energy",           "unit": "1-10",   "category": "subjective", "_type": "simple", "table": "days", "col": "energy"},
    "mood":          {"label": "Mood",              "unit": "1-10",   "category": "subjective", "_type": "simple", "table": "days", "col": "mood"},
    "stress":        {"label": "Stress",            "unit": "1-10",   "category": "subjective", "_type": "simple", "table": "days", "col": "stress"},
    "sleep_quality": {"label": "Sleep quality",     "unit": "1-10",   "category": "subjective", "_type": "simple", "table": "days", "col": "sleep_quality"},
    "duty_day":      {"label": "Duty day (0/1)",    "unit": "bool",   "category": "subjective", "_type": "simple", "table": "days", "col": "duty_day"},
    # Health
    "hrv_avg":       {"label": "HRV last night",    "unit": "ms",     "category": "health",     "_type": "simple", "table": "hrv",         "col": "last_night_avg"},
    "sleep_duration":{"label": "Sleep duration",    "unit": "hours",  "category": "health",     "_type": "sleep_duration"},
    "sleep_deep_pct":{"label": "Deep sleep %",      "unit": "%",      "category": "health",     "_type": "sleep_pct", "col": "deep_seconds"},
    "sleep_rem_pct": {"label": "REM sleep %",       "unit": "%",      "category": "health",     "_type": "sleep_pct", "col": "rem_seconds"},
    "resting_hr":    {"label": "Resting HR",        "unit": "bpm",    "category": "health",     "_type": "simple", "table": "daily_stats", "col": "resting_hr"},
    "stress_avg":    {"label": "Garmin stress",     "unit": "score",  "category": "health",     "_type": "simple", "table": "daily_stats", "col": "stress_avg"},
    "battery_low":   {"label": "Body battery low",  "unit": "score",  "category": "health",     "_type": "simple", "table": "daily_stats", "col": "body_battery_low"},
    "battery_high":  {"label": "Body battery high", "unit": "score",  "category": "health",     "_type": "simple", "table": "daily_stats", "col": "body_battery_high"},
    "steps":         {"label": "Steps",             "unit": "steps",  "category": "health",     "_type": "simple", "table": "daily_stats", "col": "steps"},
    "weight":        {"label": "Weight",            "unit": "kg",     "category": "health",     "_type": "simple", "table": "weight_log",  "col": "weight_kg"},
    "active_cal":    {"label": "Active calories",   "unit": "kcal",   "category": "health",     "_type": "simple", "table": "daily_stats", "col": "active_calories"},
    # Activity
    "activity_count":    {"label": "Activity count",    "unit": "count",   "category": "activity", "_type": "activity_agg", "agg": "COUNT", "col": "*",                    "scale": 1.0},
    "total_dist_km":     {"label": "Total distance",    "unit": "km",      "category": "activity", "_type": "activity_agg", "agg": "SUM",   "col": "distance_meters",      "scale": 0.001},
    "run_pace":          {"label": "Run pace",          "unit": "sec/km",  "category": "activity", "_type": "run_pace"},
    "elevation_gain_m":  {"label": "Elevation gain",    "unit": "m",       "category": "activity", "_type": "activity_agg", "agg": "SUM",   "col": "elevation_gain_meters", "scale": 1.0},
    "activity_cal":      {"label": "Activity calories", "unit": "kcal",    "category": "activity", "_type": "activity_agg", "agg": "SUM",   "col": "calories",             "scale": 1.0},
    "training_stress":   {"label": "Training stress",   "unit": "TSS",     "category": "activity", "_type": "activity_agg", "agg": "SUM",   "col": "training_stress_score","scale": 1.0},
    "moving_time_hours": {"label": "Moving time",       "unit": "hours",   "category": "activity", "_type": "activity_agg", "agg": "SUM",   "col": "moving_time_seconds",  "scale": 1/3600},
    "activity_avg_hr":   {"label": "Activity avg HR",   "unit": "bpm",     "category": "activity", "_type": "activity_agg", "agg": "AVG",   "col": "avg_heart_rate",       "scale": 1.0},
    # Screen Time
    "screen_total":      {"label": "Screen time",       "unit": "min",     "category": "screen",   "_type": "simple", "table": "screen_time", "col": "total_minutes"},
    "screen_unlocks":    {"label": "Unlocks",           "unit": "count",   "category": "screen",   "_type": "simple", "table": "screen_time", "col": "unlocks"},
    # Location (reads from locations.db)
    "distance_km":       {"label": "Distance traveled", "unit": "km",      "category": "location", "_type": "location_col", "col": "distance_meters", "scale": 0.001},
    "unique_places":     {"label": "Places visited",    "unit": "count",   "category": "location", "_type": "location_col", "col": "unique_places",   "scale": 1.0},
    # Aviation (aggregated from flights table)
    "flight_block_hours":{"label": "Block hours flown", "unit": "hours",   "category": "aviation", "_type": "flight_agg", "agg": "SUM", "col": "block_seconds",  "scale": 1/3600},
    "flight_night_hours":{"label": "Night hours flown", "unit": "hours",   "category": "aviation", "_type": "flight_agg", "agg": "SUM", "col": "night_seconds",  "scale": 1/3600},
    # Money (reads from money.db)
    "daily_spend":       {"label": "Daily spend",       "unit": "€",       "category": "money",    "_type": "money_spend"},
    # Lifestyle (derived from dedicated database sections)
    "dining_out":        {"label": "Meals out",         "unit": "count",   "category": "lifestyle", "_type": "row_count", "table": "restaurants", "date_col": "date_visited"},
    # Load Index (Horizon 1)
    "fatigue_score":     {"label": "Fatigue load",      "unit": "0-100",   "category": "health",   "_type": "simple", "table": "load_index", "col": "fatigue_score"},
    # Weather
    "temp_mean":         {"label": "Temperature (mean)", "unit": "°C",     "category": "environment", "_type": "simple", "table": "weather", "col": "temp_mean"},
    "precipitation":     {"label": "Precipitation",      "unit": "mm",     "category": "environment", "_type": "simple", "table": "weather", "col": "precipitation"},
    "wind_speed_max":    {"label": "Wind speed",         "unit": "km/h",   "category": "environment", "_type": "simple", "table": "weather", "col": "wind_speed_max"},
    # Intraday HR
    "hr_daytime_avg":    {"label": "Daytime HR avg",     "unit": "bpm",    "category": "health",      "_type": "intraday_hr_agg", "agg": "AVG", "time_from": "07:00", "time_to": "22:00"},
    "hr_daytime_peak":   {"label": "Daytime HR peak",    "unit": "bpm",    "category": "health",      "_type": "intraday_hr_agg", "agg": "MAX", "time_from": "07:00", "time_to": "22:00"},
    "hr_duty_avg":       {"label": "Duty-window HR avg", "unit": "bpm",    "category": "aviation",    "_type": "intraday_hr_agg", "agg": "AVG", "time_from": "06:00", "time_to": "18:00"},
}

# Candidates for /correlations/top (avoids N² explosion with tags/people)
_TOP_CANDIDATES = [
    "energy", "mood", "stress", "sleep_quality",
    "hrv_avg", "sleep_duration", "resting_hr", "steps",
    "activity_count", "total_dist_km", "elevation_gain_m", "training_stress", "moving_time_hours",
    "duty_day", "flight_block_hours", "flight_night_hours",
    "screen_total", "screen_unlocks",
    "distance_km", "unique_places",
    "daily_spend", "dining_out",
    "fatigue_score",
    "temp_mean", "precipitation",
    "hr_daytime_avg", "hr_daytime_peak", "hr_duty_avg",
]

_WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


# ─── Metric fetching ──────────────────────────────────────────────────────────

def _fetch_metric(conn: sqlite3.Connection, key: str, start: str, end: str) -> dict[str, float]:
    """Returns {date: value} for a given metric key over [start, end]."""

    # Dynamic: tag presence
    if key.startswith("tag:"):
        slug = key[4:]
        tag_row = conn.execute("SELECT id FROM tags WHERE slug=?", (slug,)).fetchone()
        if tag_row is None:
            return {}
        tag_id = tag_row["id"]
        rows = conn.execute(
            """
            SELECT d.date,
                   CASE WHEN dt.tag_id IS NOT NULL THEN 1.0 ELSE 0.0 END AS val
            FROM days d
            LEFT JOIN day_tags dt ON dt.date = d.date AND dt.tag_id = ?
            WHERE d.date BETWEEN ? AND ?
            """,
            (tag_id, start, end),
        ).fetchall()
        return {r["date"]: r["val"] for r in rows}

    # Dynamic: tag numeric note
    if key.startswith("tagnote:"):
        slug = key[8:]
        rows = conn.execute(
            """
            SELECT dt.date, CAST(dt.note AS REAL) as val
            FROM day_tags dt JOIN tags t ON t.id = dt.tag_id
            WHERE t.slug = ? AND dt.note IS NOT NULL AND dt.note != ''
              AND CAST(dt.note AS REAL) > 0
            """,
            (slug,),
        ).fetchall()
        # Filter by date range
        return {r["date"]: r["val"] for r in rows if start <= r["date"] <= end}

    # Dynamic: per-app screen time minutes
    if key.startswith("screenapp:"):
        bundle_id = key[10:]
        rows = conn.execute(
            """
            SELECT date, minutes AS val
            FROM screen_app_usage
            WHERE bundle_id = ? AND date BETWEEN ? AND ?
            """,
            (bundle_id, start, end),
        ).fetchall()
        return {r["date"]: float(r["val"]) for r in rows}

    # Dynamic: per-category spend
    if key.startswith("money:"):
        category = key[6:]
        try:
            mc = _money_conn()
            rows = mc.execute(
                """
                SELECT date, SUM(ABS(amount)) AS val
                FROM transactions
                WHERE date BETWEEN ? AND ?
                  AND transaction_type = 'Expense'
                  AND category = ?
                GROUP BY date
                """,
                (start, end, category),
            ).fetchall()
            mc.close()
            return {r["date"]: float(r["val"]) for r in rows if r["val"]}
        except Exception:
            return {}

    # Dynamic: person presence
    if key.startswith("person:"):
        contact_id = int(key[7:])
        rows = conn.execute(
            """
            SELECT d.date,
                   CASE WHEN dc.contact_id IS NOT NULL THEN 1.0 ELSE 0.0 END AS val
            FROM days d
            LEFT JOIN day_companions dc ON dc.date = d.date AND dc.contact_id = ?
            WHERE d.date BETWEEN ? AND ?
            """,
            (contact_id, start, end),
        ).fetchall()
        return {r["date"]: r["val"] for r in rows}

    meta = _STATIC_CATALOG.get(key)
    if meta is None:
        return {}

    t = meta["_type"]

    if t == "simple":
        rows = conn.execute(
            f"SELECT date, {meta['col']} AS val FROM {meta['table']} "
            f"WHERE date BETWEEN ? AND ? AND {meta['col']} IS NOT NULL",
            (start, end),
        ).fetchall()
        return {r["date"]: float(r["val"]) for r in rows}

    if t == "sleep_duration":
        rows = conn.execute(
            "SELECT date, duration_seconds FROM sleep WHERE date BETWEEN ? AND ? AND duration_seconds > 0",
            (start, end),
        ).fetchall()
        return {r["date"]: r["duration_seconds"] / 3600.0 for r in rows}

    if t == "sleep_pct":
        col = meta["col"]
        rows = conn.execute(
            f"SELECT date, {col}, duration_seconds FROM sleep WHERE date BETWEEN ? AND ? AND duration_seconds > 0",
            (start, end),
        ).fetchall()
        return {
            r["date"]: r[col] / r["duration_seconds"] * 100.0
            for r in rows
            if r[col] is not None
        }

    if t == "activity_agg":
        agg, col, scale = meta["agg"], meta["col"], meta.get("scale", 1.0)
        # Skip rows where the aggregated column is NULL (e.g. missing avg_heart_rate)
        null_filter = f"AND {col} IS NOT NULL" if agg == "AVG" else ""
        rows = conn.execute(
            f"SELECT date, {agg}({col}) AS val FROM activities "
            f"WHERE date BETWEEN ? AND ? {null_filter} GROUP BY date",
            (start, end),
        ).fetchall()
        return {r["date"]: (r["val"] or 0) * scale for r in rows if r["val"] is not None}

    if t == "run_pace":
        rows = conn.execute(
            """
            SELECT date, AVG(avg_speed_mps) AS avg_mps
            FROM activities
            WHERE date BETWEEN ? AND ?
              AND activity_type IN ('running','trail_running','treadmill_running','track_running')
              AND avg_speed_mps > 0
            GROUP BY date
            """,
            (start, end),
        ).fetchall()
        return {r["date"]: 1000.0 / r["avg_mps"] for r in rows if r["avg_mps"]}

    if t == "location_col":
        col = meta["col"]
        scale = meta.get("scale", 1.0)
        loc_conn = _locations_conn()
        rows = loc_conn.execute(
            f"SELECT date, {col} AS val FROM location_days "
            f"WHERE date BETWEEN ? AND ? AND {col} IS NOT NULL AND {col} > 0",
            (start, end),
        ).fetchall()
        loc_conn.close()
        return {r["date"]: float(r["val"]) * scale for r in rows}

    if t == "flight_agg":
        agg, col, scale = meta["agg"], meta["col"], meta.get("scale", 1.0)
        rows = conn.execute(
            f"SELECT date, {agg}({col}) AS val FROM flights "
            f"WHERE date BETWEEN ? AND ? AND is_sim = 0 AND {col} IS NOT NULL GROUP BY date",
            (start, end),
        ).fetchall()
        return {r["date"]: (r["val"] or 0) * scale for r in rows if r["val"] is not None and r["val"] > 0}

    if t == "intraday_hr_agg":
        agg = meta["agg"]
        time_from = meta["time_from"]
        time_to   = meta["time_to"]
        rows = conn.execute(
            f"SELECT date, {agg}(heart_rate) AS val FROM intraday_hr "
            f"WHERE date BETWEEN ? AND ? AND time >= ? AND time <= ? "
            f"GROUP BY date",
            (start, end, time_from, time_to),
        ).fetchall()
        return {r["date"]: float(r["val"]) for r in rows if r["val"] is not None}

    if t == "row_count":
        # Count of rows in a dedicated table per day (e.g. restaurants visited).
        # Days with no rows are absent → treated as no-data, not zero, which keeps
        # the correlation on days where the activity actually happened.
        date_col = meta["date_col"]
        rows = conn.execute(
            f"SELECT {date_col} AS date, COUNT(*) AS val FROM {meta['table']} "
            f"WHERE {date_col} BETWEEN ? AND ? GROUP BY {date_col}",
            (start, end),
        ).fetchall()
        return {r["date"]: float(r["val"]) for r in rows if r["val"]}

    if t == "money_spend":
        try:
            mc = _money_conn()
            rows = mc.execute(
                """
                SELECT date, SUM(ABS(amount)) AS val
                FROM transactions
                WHERE date BETWEEN ? AND ?
                  AND transaction_type = 'Expense'
                GROUP BY date
                """,
                (start, end),
            ).fetchall()
            mc.close()
            return {r["date"]: float(r["val"]) for r in rows if r["val"]}
        except Exception:
            return {}

    if t == "money_category":
        category = meta["category_name"]
        try:
            mc = _money_conn()
            rows = mc.execute(
                """
                SELECT date, SUM(ABS(amount)) AS val
                FROM transactions
                WHERE date BETWEEN ? AND ?
                  AND transaction_type = 'Expense'
                  AND category = ?
                GROUP BY date
                """,
                (start, end, category),
            ).fetchall()
            mc.close()
            return {r["date"]: float(r["val"]) for r in rows if r["val"]}
        except Exception:
            return {}

    return {}


def _metric_meta(conn: sqlite3.Connection, key: str) -> dict:
    """Return {key, label, unit, category} for any metric key."""
    if key.startswith("tag:"):
        slug = key[4:]
        row = conn.execute("SELECT name, icon FROM tags WHERE slug=?", (slug,)).fetchone()
        label = f"Tag: {row['name']} {row['icon'] or ''}".strip() if row else f"Tag: {slug}"
        return {"key": key, "label": label, "unit": "0/1", "category": "tags"}
    if key.startswith("tagnote:"):
        slug = key[8:]
        row = conn.execute("SELECT name, icon FROM tags WHERE slug=?", (slug,)).fetchone()
        if row:
            label = f"{row['name']} {row['icon'] or ''} (count)".strip()
        else:
            label = f"{slug} (count)"
        return {"key": key, "label": label, "unit": "count", "category": "tag_values"}
    if key.startswith("person:"):
        cid = int(key[7:])
        row = conn.execute("SELECT name, emoji FROM contacts WHERE id=?", (cid,)).fetchone()
        label = f"With: {row['name']} {row['emoji'] or ''}".strip() if row else f"Person {cid}"
        return {"key": key, "label": label, "unit": "0/1", "category": "people"}
    if key.startswith("money:"):
        cat = key[6:]
        return {"key": key, "label": f"Spend: {cat}", "unit": "€", "category": "money"}
    meta = _STATIC_CATALOG.get(key, {})
    return {"key": key, "label": meta.get("label", key), "unit": meta.get("unit", ""), "category": meta.get("category", "")}


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/catalog")
def get_catalog(conn: DB):
    """All available metrics grouped by category."""
    catalog: dict[str, list] = {}
    for key, meta in _STATIC_CATALOG.items():
        cat = meta["category"]
        catalog.setdefault(cat, []).append({"key": key, "label": meta["label"], "unit": meta["unit"], "category": cat})

    # Dynamic: tags
    tag_rows = conn.execute("SELECT slug, name, icon FROM tags ORDER BY category, name").fetchall()
    catalog["tags"] = [
        {"key": f"tag:{r['slug']}", "label": f"Tag: {r['name']} {r['icon'] or ''}".strip(), "unit": "0/1", "category": "tags"}
        for r in tag_rows
    ]

    # Dynamic: tag_values (tags with numeric notes in the DB)
    tagnote_rows = conn.execute(
        """
        SELECT DISTINCT t.slug, t.name, t.icon
        FROM day_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.note IS NOT NULL AND dt.note != ''
          AND CAST(dt.note AS REAL) > 0
        ORDER BY t.name
        """
    ).fetchall()
    if tagnote_rows:
        catalog["tag_values"] = [
            {
                "key": f"tagnote:{r['slug']}",
                "label": f"{r['name']} {r['icon'] or ''} (count)".strip(),
                "unit": "count",
                "category": "tag_values",
            }
            for r in tagnote_rows
        ]

    # Dynamic: people
    contact_rows = conn.execute("SELECT id, name, emoji FROM contacts ORDER BY name").fetchall()
    catalog["people"] = [
        {"key": f"person:{r['id']}", "label": f"With: {r['name']} {r['emoji'] or ''}".strip(), "unit": "0/1", "category": "people"}
        for r in contact_rows
    ]

    # Dynamic: money categories (top categories by transaction count)
    try:
        mc = _money_conn()
        cat_rows = mc.execute(
            """
            SELECT category, COUNT(*) AS n
            FROM transactions
            WHERE transaction_type = 'Expense' AND category IS NOT NULL AND category != ''
            GROUP BY category
            ORDER BY n DESC
            LIMIT 20
            """
        ).fetchall()
        mc.close()
        if cat_rows:
            catalog.setdefault("money", [])
            for r in cat_rows:
                catalog["money"].append({
                    "key": f"money:{r['category']}",
                    "label": f"Spend: {r['category']}",
                    "unit": "€",
                    "category": "money",
                })
    except Exception:
        pass

    return catalog


@router.get("/compute")
def compute_correlation(
    conn: DB,
    metric_a: str = Query(...),
    metric_b: str = Query(...),
    days: int = Query(90, ge=7, le=365),
    min_samples: int = Query(10, ge=3),
):
    """Compute Pearson correlation between any two metrics."""
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    vals_a = _fetch_metric(conn, metric_a, start, end)
    vals_b = _fetch_metric(conn, metric_b, start, end)

    common = sorted(set(vals_a.keys()) & set(vals_b.keys()))
    xs = [vals_a[d] for d in common]
    ys = [vals_b[d] for d in common]
    n = len(xs)

    if n < min_samples:
        return {
            "metric_a": _metric_meta(conn, metric_a),
            "metric_b": _metric_meta(conn, metric_b),
            "points": [],
            "r": None,
            "p_value": None,
            "n": n,
            "interpretation": f"not enough data (need {min_samples}, have {n})",
            "trendline": None,
        }

    r = pearson(xs, ys)
    return {
        "metric_a": _metric_meta(conn, metric_a),
        "metric_b": _metric_meta(conn, metric_b),
        "points": [{"date": d, "x": xs[i], "y": ys[i]} for i, d in enumerate(common)],
        "r": r,
        "p_value": p_value_approx(r, n),
        "n": n,
        "interpretation": interpret_r(r),
        "trendline": least_squares(xs, ys) and {"slope": least_squares(xs, ys)[0], "intercept": least_squares(xs, ys)[1]},
    }


@router.get("/top")
def top_correlations(
    conn: DB,
    n: int = Query(5, ge=1, le=20),
    days: int = Query(90, ge=30, le=365),
):
    """Top N strongest correlations across the curated candidate list + frequent tags."""
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    # Build candidate list: static + dynamic tag slugs used on 3+ days
    candidates = list(_TOP_CANDIDATES)

    tag_rows = conn.execute(
        """
        SELECT t.slug
        FROM day_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.date BETWEEN ? AND ?
        GROUP BY t.slug
        HAVING COUNT(DISTINCT dt.date) >= 3
        ORDER BY COUNT(DISTINCT dt.date) DESC
        LIMIT 20
        """,
        (start, end),
    ).fetchall()
    tag_candidates = [f"tag:{r['slug']}" for r in tag_rows]
    candidates = candidates + tag_candidates

    # Dynamic: contacts seen on 3+ days in the window
    person_rows = conn.execute(
        """
        SELECT dc.contact_id
        FROM day_companions dc
        WHERE dc.date BETWEEN ? AND ?
        GROUP BY dc.contact_id
        HAVING COUNT(DISTINCT dc.date) >= 3
        ORDER BY COUNT(DISTINCT dc.date) DESC
        LIMIT 10
        """,
        (start, end),
    ).fetchall()
    candidates = candidates + [f"person:{r['contact_id']}" for r in person_rows]

    # Pre-fetch all candidate metrics
    data: dict[str, dict[str, float]] = {}
    for key in candidates:
        data[key] = _fetch_metric(conn, key, start, end)

    results = []
    for a, b in combinations(candidates, 2):
        common = sorted(set(data[a].keys()) & set(data[b].keys()))
        if len(common) < 10:
            continue
        xs = [data[a][d] for d in common]
        ys = [data[b][d] for d in common]
        r = pearson(xs, ys)
        if r is None:
            continue

        meta_a = _metric_meta(conn, a)
        meta_b = _metric_meta(conn, b)
        results.append({
            "metric_a": a,
            "metric_b": b,
            "label_a": meta_a["label"],
            "label_b": meta_b["label"],
            "r": r,
            "n": len(common),
            "interpretation": interpret_r(r),
        })

    results.sort(key=lambda x: abs(x["r"]), reverse=True)
    return {"top_correlations": results[:n]}


@router.get("/weekly-stats")
def weekly_stats(conn: DB):
    """
    Mood/energy/HRV averages by day of week, plus top tags by mood impact.
    Uses strftime('%w') where 0=Sunday, 1=Monday, ..., 6=Saturday.
    """
    # By weekday
    weekday_rows = conn.execute(
        """
        SELECT
            CAST(strftime('%w', d.date) AS INTEGER) AS wd_num,
            AVG(d.mood)   AS avg_mood,
            AVG(d.energy) AS avg_energy,
            COUNT(d.date) AS n
        FROM days d
        WHERE d.mood IS NOT NULL
        GROUP BY wd_num
        ORDER BY wd_num
        """
    ).fetchall()

    # HRV by weekday (separate join to avoid nulls skewing mood counts)
    hrv_rows = conn.execute(
        """
        SELECT
            CAST(strftime('%w', h.date) AS INTEGER) AS wd_num,
            AVG(h.last_night_avg) AS avg_hrv
        FROM hrv h
        WHERE h.last_night_avg IS NOT NULL
        GROUP BY wd_num
        """
    ).fetchall()
    hrv_by_wd: dict[int, float] = {r["wd_num"]: r["avg_hrv"] for r in hrv_rows}

    by_weekday = []
    for row in weekday_rows:
        wd = row["wd_num"]
        # Convert SQLite's 0=Sunday to Mon-first display: weekday_num 1=Mon...7=Sun
        display_num = wd if wd != 0 else 7  # Sun → 7
        by_weekday.append({
            "weekday": _WEEKDAY_NAMES[wd],
            "weekday_num": display_num,
            "avg_mood": round(row["avg_mood"], 2) if row["avg_mood"] is not None else None,
            "avg_energy": round(row["avg_energy"], 2) if row["avg_energy"] is not None else None,
            "avg_hrv": round(hrv_by_wd[wd], 1) if wd in hrv_by_wd else None,
            "n": row["n"],
        })

    # Sort Mon→Sun for display
    by_weekday.sort(key=lambda x: x["weekday_num"])

    # Best weekday for mood / energy
    mood_days = [d for d in by_weekday if d["avg_mood"] is not None and d["n"] >= 3]
    energy_days = [d for d in by_weekday if d["avg_energy"] is not None and d["n"] >= 3]
    best_weekday_mood = max(mood_days, key=lambda x: x["avg_mood"])["weekday"] if mood_days else None
    best_weekday_energy = max(energy_days, key=lambda x: x["avg_energy"])["weekday"] if energy_days else None

    # Top tags by mood delta
    # Get all days with mood
    all_days = conn.execute(
        "SELECT date, mood FROM days WHERE mood IS NOT NULL"
    ).fetchall()
    all_dates_mood: dict[str, float] = {r["date"]: float(r["mood"]) for r in all_days}
    total_mood_days = len(all_dates_mood)

    if total_mood_days == 0:
        overall_avg = 0.0
    else:
        overall_avg = sum(all_dates_mood.values()) / total_mood_days

    # For each tag: dates used, avg mood with vs without
    tag_rows = conn.execute(
        """
        SELECT t.slug, t.name, t.icon, COUNT(DISTINCT dt.date) AS usage
        FROM day_tags dt
        JOIN tags t ON t.id = dt.tag_id
        GROUP BY t.slug
        HAVING usage >= 3
        ORDER BY usage DESC
        """
    ).fetchall()

    top_tags = []
    for tag in tag_rows:
        slug = tag["slug"]
        # dates this tag was used that also have mood
        with_rows = conn.execute(
            """
            SELECT d.mood FROM day_tags dt
            JOIN days d ON d.date = dt.date
            JOIN tags t ON t.id = dt.tag_id
            WHERE t.slug = ? AND d.mood IS NOT NULL
            """,
            (slug,),
        ).fetchall()
        with_moods = [r["mood"] for r in with_rows]
        if len(with_moods) < 3:
            continue

        without_moods = [
            m for date_str, m in all_dates_mood.items()
            if date_str not in {r["date"] for r in conn.execute(
                "SELECT dt.date FROM day_tags dt JOIN tags t ON t.id=dt.tag_id WHERE t.slug=?", (slug,)
            ).fetchall()}
        ]

        avg_with = sum(with_moods) / len(with_moods)
        avg_without = sum(without_moods) / len(without_moods) if without_moods else overall_avg
        delta = round(avg_with - avg_without, 2)

        top_tags.append({
            "slug": slug,
            "name": tag["name"],
            "icon": tag["icon"],
            "usage": tag["usage"],
            "avg_mood_with": round(avg_with, 2),
            "avg_mood_without": round(avg_without, 2),
            "delta": delta,
        })

    top_tags.sort(key=lambda x: abs(x["delta"]), reverse=True)

    return {
        "by_weekday": by_weekday,
        "best_weekday_mood": best_weekday_mood,
        "best_weekday_energy": best_weekday_energy,
        "top_tags": top_tags[:8],
    }


@router.get("/journal")
def journal(
    conn: DB,
    q: str = Query(""),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Days with mood_note — searchable journal."""
    if q:
        rows = conn.execute(
            """
            SELECT date, mood, mood_note
            FROM days
            WHERE mood_note IS NOT NULL AND mood_note != ''
              AND mood_note LIKE ?
            ORDER BY date DESC
            LIMIT ? OFFSET ?
            """,
            (f"%{q}%", limit, offset),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT date, mood, mood_note
            FROM days
            WHERE mood_note IS NOT NULL AND mood_note != ''
            ORDER BY date DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()

    result = []
    for row in rows:
        tag_rows = conn.execute(
            """
            SELECT t.slug FROM day_tags dt
            JOIN tags t ON t.id = dt.tag_id
            WHERE dt.date = ?
            ORDER BY t.name
            """,
            (row["date"],),
        ).fetchall()
        tags = [r["slug"] for r in tag_rows]
        result.append({
            "date": row["date"],
            "mood": row["mood"],
            "mood_note": row["mood_note"],
            "tags": tags,
        })

    return result


@router.get("/precomputed")
def precomputed_correlations(
    conn: DB,
    window: int = Query(90, ge=30, le=365),
    lag: int = Query(-1, ge=-1, le=1),
    limit: int = Query(20, ge=1, le=100),
    domain: str = Query(""),
):
    """
    Top correlations from the most recent batch snapshot.
    lag=-1 means all lags. domain filters by metric category (health/activity/tags/people/screen).
    Returns [] if the batch job has never run.
    """
    # Find the most recent computed_at for this window
    latest = conn.execute(
        "SELECT MAX(computed_at) AS ts FROM correlation_snapshots WHERE window_days = ?",
        (window,),
    ).fetchone()
    if not latest or not latest["ts"]:
        return {"computed_at": None, "correlations": []}

    computed_at = latest["ts"]

    query = """
        SELECT metric_a, metric_b, r, p_value, n, lag, is_new, r_prev
        FROM correlation_snapshots
        WHERE window_days = ? AND computed_at = ?
    """
    params: list = [window, computed_at]

    if lag >= 0:
        query += " AND lag = ?"
        params.append(lag)

    query += " ORDER BY ABS(r) DESC LIMIT ?"
    params.append(limit * 3)  # over-fetch to allow domain filtering

    rows = conn.execute(query, params).fetchall()

    # Enrich with labels and domain filter
    results = []
    for row in rows:
        meta_a = _metric_meta(conn, row["metric_a"])
        meta_b = _metric_meta(conn, row["metric_b"])

        if domain:
            if meta_a["category"] != domain and meta_b["category"] != domain:
                continue

        # Direction relative to prior week
        r_prev = row["r_prev"]
        if row["is_new"] or r_prev is None:
            direction = "new"
        elif abs(row["r"]) > abs(r_prev) + 0.05:
            direction = "stronger"
        elif abs(row["r"]) < abs(r_prev) - 0.05:
            direction = "weaker"
        else:
            direction = "stable"

        results.append({
            "metric_a": row["metric_a"],
            "metric_b": row["metric_b"],
            "label_a": meta_a["label"],
            "label_b": meta_b["label"],
            "category_a": meta_a["category"],
            "category_b": meta_b["category"],
            "r": row["r"],
            "p_value": row["p_value"],
            "n": row["n"],
            "lag": row["lag"],
            "is_new": bool(row["is_new"]),
            "r_prev": row["r_prev"],
            "direction": direction,
            "interpretation": interpret_r(row["r"]),
        })

        if len(results) >= limit:
            break

    return {"computed_at": computed_at, "correlations": results}


@router.get("/compare")
def compare_periods(
    conn: DB,
    metric: str = Query(...),
    period: str = Query("month", pattern="^(month|week|year)$"),
):
    """
    Period-over-period comparison for any scalar metric.
    Returns current period avg, prior period avg, same period last year avg,
    and pct_change. All averages are rounded to 1 decimal.
    """
    today = date.today()

    def _date_range(period: str, offset: int) -> tuple[str, str]:
        """offset=0 → current period, 1 → prior, etc."""
        if period == "month":
            # Full calendar month
            year = today.year
            month = today.month - offset
            while month <= 0:
                month += 12
                year -= 1
            import calendar
            _, last_day = calendar.monthrange(year, month)
            start = date(year, month, 1).isoformat()
            end = date(year, month, last_day).isoformat()
            return start, end
        if period == "week":
            # ISO week: Monday–Sunday
            monday = today - timedelta(days=today.weekday())
            start = (monday - timedelta(weeks=offset)).isoformat()
            end = (monday - timedelta(weeks=offset) + timedelta(days=6)).isoformat()
            return start, end
        # year
        year = today.year - offset
        return f"{year}-01-01", f"{year}-12-31"

    def _avg(start: str, end: str) -> float | None:
        data = _fetch_metric(conn, metric, start, end)
        if not data:
            return None
        vals = list(data.values())
        return round(sum(vals) / len(vals), 1)

    def _stddev(start: str, end: str) -> float | None:
        data = _fetch_metric(conn, metric, start, end)
        if len(data) < 2:
            return None
        vals = list(data.values())
        mean = sum(vals) / len(vals)
        variance = sum((v - mean) ** 2 for v in vals) / len(vals)
        return round(math.sqrt(variance), 2)

    curr_start, curr_end = _date_range(period, 0)
    prev_start, prev_end = _date_range(period, 1)

    # Same period last year
    if period == "month":
        lyr_start, lyr_end = _date_range("month", 12)
    elif period == "week":
        lyr_start, lyr_end = _date_range("week", 52)
    else:
        lyr_start, lyr_end = _date_range("year", 1)  # same as prior for year

    curr_avg = _avg(curr_start, curr_end)
    prev_avg = _avg(prev_start, prev_end)
    lyr_avg = _avg(lyr_start, lyr_end)

    pct_change = None
    if curr_avg is not None and prev_avg is not None and prev_avg != 0:
        pct_change = round((curr_avg - prev_avg) / prev_avg * 100, 1)

    meta = _metric_meta(conn, metric)

    return {
        "metric": metric,
        "label": meta["label"],
        "unit": meta.get("unit", ""),
        "period": period,
        "current": {
            "start": curr_start,
            "end": curr_end,
            "avg": curr_avg,
            "stddev": _stddev(curr_start, curr_end),
        },
        "prior": {
            "start": prev_start,
            "end": prev_end,
            "avg": prev_avg,
            "stddev": _stddev(prev_start, prev_end),
        },
        "same_period_last_year": {
            "start": lyr_start,
            "end": lyr_end,
            "avg": lyr_avg,
        },
        "pct_change": pct_change,
    }
