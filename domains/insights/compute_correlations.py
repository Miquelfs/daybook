"""
Weekly correlation batch job.

Computes Pearson r for all metric pairs (same-day and lag-1) and writes
results to the correlation_snapshots table. Run every Sunday morning:

    python -m domains.insights.compute_correlations
    python -m domains.insights.compute_correlations --window 180

Flags:
    --window   Look-back window in days (default 90; also runs 180)
    --dry-run  Print results without writing to DB
"""

import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from itertools import combinations
from pathlib import Path

# Allow running from repo root without installing the package
_REPO = Path(__file__).parents[2]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from infrastructure.db.connection import get_connection
from infrastructure.api.utils.stats import pearson, p_value_approx

# ─── Candidate metrics ────────────────────────────────────────────────────────

# Static metrics to always include (mirrors _TOP_CANDIDATES in correlations.py)
_STATIC_METRICS = [
    # Subjective
    "energy", "mood", "stress", "sleep_quality",
    # Health
    "hrv_avg", "sleep_duration", "resting_hr", "steps",
    "battery_low", "battery_high", "stress_avg",
    # Activity
    "activity_count", "total_dist_km", "elevation_gain_m",
    "activity_cal", "training_stress", "moving_time_hours", "activity_avg_hr",
    # Aviation
    "flight_block_hours", "flight_night_hours", "duty_day",
    # Screen
    "screen_total", "screen_unlocks",
    # Location
    "distance_km", "unique_places",
    # Money
    "daily_spend",
    # Environment
    "temp_mean", "precipitation", "wind_speed_max",
    # Health extras
    "fatigue_score", "hr_daytime_avg", "hr_daytime_peak",
    # Aviation extras
    "hr_duty_avg",
    # Training load (CTL/ATL/TSB)
    "ctl", "atl", "tsb",
    # Aerobic efficiency
    "decoupling_pct", "efficiency_factor",
    # Garmin physio
    "vo2max_run", "vo2max_bike", "training_readiness",
    # Fused fatigue
    "duty_load",
]

# Min usage days for tags / contacts to be included
_MIN_TAG_DAYS = 5
_MIN_CONTACT_DAYS = 3

# Correlation filter thresholds
_MIN_R = 0.15
_MAX_P = 0.10
_MIN_N = 21   # ~3 weeks minimum (Exist.io policy)


# ─── Metric fetching (duplicates _fetch_metric from correlations.py) ──────────
# Kept separate so this script has no FastAPI dependency.

_LOCATIONS_DB = _REPO / "infrastructure" / "db" / "locations.db"
_MONEY_DB     = _REPO / "infrastructure" / "db" / "money.db"


def _fetch(conn, key: str, start: str, end: str) -> dict[str, float]:
    """Returns {date: value} for a metric key over [start, end]."""
    import sqlite3

    if key.startswith("tag:"):
        slug = key[4:]
        row = conn.execute("SELECT id FROM tags WHERE slug=?", (slug,)).fetchone()
        if row is None:
            return {}
        tag_id = row["id"]
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
        return {r["date"]: r["val"] for r in rows if start <= r["date"] <= end}

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

    if key.startswith("money:"):
        category = key[6:]
        try:
            import sqlite3 as _sq
            mc = _sq.connect(_MONEY_DB)
            mc.row_factory = _sq.Row
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

    # Static metrics
    _SIMPLE = {
        "energy":        ("days",         "energy"),
        "mood":          ("days",         "mood"),
        "stress":        ("days",         "stress"),
        "sleep_quality": ("days",         "sleep_quality"),
        "duty_day":      ("days",         "duty_day"),
        "hrv_avg":       ("hrv",          "last_night_avg"),
        "resting_hr":    ("daily_stats",  "resting_hr"),
        "stress_avg":    ("daily_stats",  "stress_avg"),
        "battery_low":   ("daily_stats",  "body_battery_low"),
        "battery_high":  ("daily_stats",  "body_battery_high"),
        "steps":         ("daily_stats",  "steps"),
        "active_cal":    ("daily_stats",  "active_calories"),
        "screen_total":  ("screen_time",  "total_minutes"),
        "screen_unlocks":("screen_time",  "unlocks"),
    }
    if key in _SIMPLE:
        table, col = _SIMPLE[key]
        rows = conn.execute(
            f"SELECT date, {col} AS val FROM {table} "
            f"WHERE date BETWEEN ? AND ? AND {col} IS NOT NULL",
            (start, end),
        ).fetchall()
        return {r["date"]: float(r["val"]) for r in rows}

    if key == "sleep_duration":
        rows = conn.execute(
            "SELECT date, duration_seconds FROM sleep WHERE date BETWEEN ? AND ? AND duration_seconds > 0",
            (start, end),
        ).fetchall()
        return {r["date"]: r["duration_seconds"] / 3600.0 for r in rows}

    # Activity aggregations
    _ACTIVITY_AGG = {
        "activity_count":    ("COUNT", "*",                     1.0,      False),
        "total_dist_km":     ("SUM",   "distance_meters",       0.001,    False),
        "elevation_gain_m":  ("SUM",   "elevation_gain_meters", 1.0,      False),
        "activity_cal":      ("SUM",   "calories",              1.0,      True),
        "training_stress":   ("SUM",   "training_stress_score", 1.0,      True),
        "moving_time_hours": ("SUM",   "moving_time_seconds",   1/3600,   False),
        "activity_avg_hr":   ("AVG",   "avg_heart_rate",        1.0,      True),
    }
    if key in _ACTIVITY_AGG:
        agg, col, scale, null_filter = _ACTIVITY_AGG[key]
        where_null = f"AND {col} IS NOT NULL" if null_filter else ""
        rows = conn.execute(
            f"SELECT date, {agg}({col}) AS val FROM activities "
            f"WHERE date BETWEEN ? AND ? {where_null} GROUP BY date",
            (start, end),
        ).fetchall()
        return {r["date"]: (r["val"] or 0) * scale for r in rows if r["val"] is not None}

    # Aviation aggregations (real flights only, not sim)
    _FLIGHT_AGG = {
        "flight_block_hours": ("SUM", "block_seconds",  1/3600),
        "flight_night_hours": ("SUM", "night_seconds",  1/3600),
    }
    if key in _FLIGHT_AGG:
        agg, col, scale = _FLIGHT_AGG[key]
        rows = conn.execute(
            f"SELECT date, {agg}({col}) AS val FROM flights "
            f"WHERE date BETWEEN ? AND ? AND is_sim = 0 AND {col} IS NOT NULL GROUP BY date",
            (start, end),
        ).fetchall()
        return {r["date"]: (r["val"] or 0) * scale for r in rows if r["val"] is not None and r["val"] > 0}

    if key == "daily_spend":
        try:
            import sqlite3 as _sq
            mc = _sq.connect(_MONEY_DB)
            mc.row_factory = _sq.Row
            rows = mc.execute(
                """
                SELECT date, SUM(ABS(amount)) AS val
                FROM transactions
                WHERE date BETWEEN ? AND ? AND transaction_type = 'Expense'
                GROUP BY date
                """,
                (start, end),
            ).fetchall()
            mc.close()
            return {r["date"]: float(r["val"]) for r in rows if r["val"]}
        except Exception:
            return {}

    # Environment / weather metrics
    _WEATHER = {
        "temp_mean":      "temp_mean",
        "precipitation":  "precipitation",
        "wind_speed_max": "wind_speed_max",
    }
    if key in _WEATHER:
        col = _WEATHER[key]
        rows = conn.execute(
            f"SELECT date, {col} AS val FROM weather "
            f"WHERE date BETWEEN ? AND ? AND {col} IS NOT NULL",
            (start, end),
        ).fetchall()
        return {r["date"]: float(r["val"]) for r in rows}

    # Fatigue / load index
    if key == "fatigue_score":
        rows = conn.execute(
            "SELECT date, fatigue_score AS val FROM load_index "
            "WHERE date BETWEEN ? AND ? AND fatigue_score IS NOT NULL",
            (start, end),
        ).fetchall()
        return {r["date"]: float(r["val"]) for r in rows}

    # Intraday HR aggregations
    _INTRADAY_HR = {
        "hr_daytime_avg":  ("AVG", "07:00", "22:00"),
        "hr_daytime_peak": ("MAX", "07:00", "22:00"),
        "hr_duty_avg":     ("AVG", "06:00", "18:00"),
    }
    if key in _INTRADAY_HR:
        agg, t_from, t_to = _INTRADAY_HR[key]
        rows = conn.execute(
            f"SELECT date, {agg}(heart_rate) AS val FROM intraday_hr "
            f"WHERE date BETWEEN ? AND ? AND time >= ? AND time <= ? "
            f"GROUP BY date HAVING val IS NOT NULL",
            (start, end, t_from, t_to),
        ).fetchall()
        return {r["date"]: float(r["val"]) for r in rows}

    if key in ("distance_km", "unique_places"):
        import sqlite3 as _sq
        col = "distance_meters" if key == "distance_km" else "unique_places"
        scale = 0.001 if key == "distance_km" else 1.0
        try:
            loc_conn = _sq.connect(_LOCATIONS_DB)
            loc_conn.row_factory = _sq.Row
            rows = loc_conn.execute(
                f"SELECT date, {col} AS val FROM location_days "
                f"WHERE date BETWEEN ? AND ? AND {col} IS NOT NULL AND {col} > 0",
                (start, end),
            ).fetchall()
            loc_conn.close()
            return {r["date"]: float(r["val"]) * scale for r in rows}
        except Exception:
            return {}

    # Training load (CTL / ATL / TSB) — combined sport series
    _TRAINING_LOAD = {"ctl": "ctl", "atl": "atl", "tsb": "tsb"}
    if key in _TRAINING_LOAD:
        col = _TRAINING_LOAD[key]
        try:
            rows = conn.execute(
                f"SELECT date, {col} AS val FROM training_load_daily "
                f"WHERE sport = 'combined' AND date BETWEEN ? AND ? AND {col} IS NOT NULL",
                (start, end),
            ).fetchall()
            return {r["date"]: float(r["val"]) for r in rows}
        except Exception:
            return {}

    # Aerobic efficiency metrics — average of recent long aerobic efforts
    if key == "decoupling_pct":
        try:
            rows = conn.execute(
                """
                SELECT a.date, AVG(ad.decoupling_pct) AS val
                FROM activity_detail ad
                JOIN activities a ON a.id = ad.activity_id
                WHERE a.date BETWEEN ? AND ?
                  AND ad.decoupling_pct IS NOT NULL
                GROUP BY a.date
                """,
                (start, end),
            ).fetchall()
            return {r["date"]: float(r["val"]) for r in rows}
        except Exception:
            return {}

    if key == "efficiency_factor":
        try:
            rows = conn.execute(
                """
                SELECT a.date, AVG(ad.efficiency_factor) AS val
                FROM activity_detail ad
                JOIN activities a ON a.id = ad.activity_id
                WHERE a.date BETWEEN ? AND ?
                  AND ad.efficiency_factor IS NOT NULL
                GROUP BY a.date
                """,
                (start, end),
            ).fetchall()
            return {r["date"]: float(r["val"]) for r in rows}
        except Exception:
            return {}

    # Garmin physiological metrics
    _GARMIN_PHYSIO = {
        "vo2max_run":        "vo2max_run",
        "vo2max_bike":       "vo2max_bike",
        "training_readiness": "training_readiness_score",
    }
    if key in _GARMIN_PHYSIO:
        col = _GARMIN_PHYSIO[key]
        try:
            rows = conn.execute(
                f"SELECT date, {col} AS val FROM garmin_physio "
                f"WHERE date BETWEEN ? AND ? AND {col} IS NOT NULL",
                (start, end),
            ).fetchall()
            return {r["date"]: float(r["val"]) for r in rows}
        except Exception:
            return {}

    # Fused duty load from load_index
    if key == "duty_load":
        try:
            rows = conn.execute(
                "SELECT date, duty_load AS val FROM load_index "
                "WHERE date BETWEEN ? AND ? AND duty_load IS NOT NULL",
                (start, end),
            ).fetchall()
            return {r["date"]: float(r["val"]) for r in rows}
        except Exception:
            return {}

    return {}


# ─── Dynamic candidate discovery ─────────────────────────────────────────────

def _dynamic_candidates(conn, start: str, end: str) -> list[str]:
    """Return tag: and person: keys that have enough days of data."""
    candidates = []

    tag_rows = conn.execute(
        """
        SELECT t.slug, COUNT(*) AS n
        FROM day_tags dt JOIN tags t ON t.id = dt.tag_id
        WHERE dt.date BETWEEN ? AND ?
        GROUP BY t.slug
        HAVING n >= ?
        ORDER BY n DESC
        LIMIT 40
        """,
        (start, end, _MIN_TAG_DAYS),
    ).fetchall()
    candidates += [f"tag:{r['slug']}" for r in tag_rows]

    # Numeric tag values (tagnote:)
    tagnote_rows = conn.execute(
        """
        SELECT t.slug, COUNT(*) AS n
        FROM day_tags dt JOIN tags t ON t.id = dt.tag_id
        WHERE dt.note IS NOT NULL AND dt.note != ''
          AND CAST(dt.note AS REAL) > 0
          AND dt.date BETWEEN ? AND ?
        GROUP BY t.slug
        HAVING n >= ?
        LIMIT 10
        """,
        (start, end, _MIN_TAG_DAYS),
    ).fetchall()
    candidates += [f"tagnote:{r['slug']}" for r in tagnote_rows]

    # People
    person_rows = conn.execute(
        """
        SELECT contact_id, COUNT(*) AS n
        FROM day_companions
        WHERE date BETWEEN ? AND ?
        GROUP BY contact_id
        HAVING n >= ?
        ORDER BY n DESC
        LIMIT 15
        """,
        (start, end, _MIN_CONTACT_DAYS),
    ).fetchall()
    candidates += [f"person:{r['contact_id']}" for r in person_rows]

    # Top money categories (by transaction count in window)
    try:
        import sqlite3 as _sq
        mc = _sq.connect(_MONEY_DB)
        mc.row_factory = _sq.Row
        cat_rows = mc.execute(
            """
            SELECT category, COUNT(*) AS n
            FROM transactions
            WHERE date BETWEEN ? AND ?
              AND transaction_type = 'Expense'
              AND category IS NOT NULL AND category != ''
            GROUP BY category
            HAVING n >= ?
            ORDER BY n DESC
            LIMIT 15
            """,
            (start, end, _MIN_TAG_DAYS),
        ).fetchall()
        mc.close()
        candidates += [f"money:{r['category']}" for r in cat_rows]
    except Exception:
        pass

    return candidates


# ─── Snapshot lookup ──────────────────────────────────────────────────────────

def _prior_snapshot_r(conn, metric_a: str, metric_b: str, lag: int, window_days: int) -> float | None:
    """Return r from the most recent prior snapshot for this pair, or None."""
    row = conn.execute(
        """
        SELECT r FROM correlation_snapshots
        WHERE metric_a = ? AND metric_b = ? AND lag = ? AND window_days = ?
        ORDER BY computed_at DESC
        LIMIT 1
        """,
        (metric_a, metric_b, lag, window_days),
    ).fetchone()
    return row["r"] if row else None


# ─── Main computation ─────────────────────────────────────────────────────────

def run(window_days: int = 90, dry_run: bool = False) -> int:
    conn = get_connection()
    today = date.today()
    end = today.isoformat()
    start = (today - timedelta(days=window_days)).isoformat()
    computed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    all_metrics = list(_STATIC_METRICS) + _dynamic_candidates(conn, start, end)
    # Deduplicate while preserving order
    seen = set()
    metrics = []
    for m in all_metrics:
        if m not in seen:
            seen.add(m)
            metrics.append(m)

    print(f"[correlations] window={window_days}d  metrics={len(metrics)}  pairs={len(metrics)*(len(metrics)-1)//2 * 2}")

    # Pre-fetch all metric data to avoid repeated DB round-trips
    data: dict[str, dict[str, float]] = {}
    for key in metrics:
        data[key] = _fetch(conn, key, start, end)

    results = []
    skipped = 0

    for a, b in combinations(metrics, 2):
        for lag in (0, 1):
            data_a = data[a]
            data_b = data[b]

            if lag == 0:
                common_dates = sorted(set(data_a) & set(data_b))
                xs = [data_a[d] for d in common_dates]
                ys = [data_b[d] for d in common_dates]
            else:
                # lag-1: a[t] correlated with b[t+1]
                all_dates_a = sorted(data_a)
                xs, ys = [], []
                for d in all_dates_a:
                    next_d = (date.fromisoformat(d) + timedelta(days=1)).isoformat()
                    if next_d in data_b:
                        xs.append(data_a[d])
                        ys.append(data_b[next_d])

            n = len(xs)
            if n < _MIN_N:
                skipped += 1
                continue

            r = pearson(xs, ys)
            if r is None or abs(r) < _MIN_R:
                skipped += 1
                continue

            p = p_value_approx(r, n)
            if p is None or p > _MAX_P:
                skipped += 1
                continue

            r_prev = _prior_snapshot_r(conn, a, b, lag, window_days)
            is_new = 1 if r_prev is None else 0

            results.append({
                "computed_at": computed_at,
                "window_days": window_days,
                "metric_a": a,
                "metric_b": b,
                "r": r,
                "p_value": p,
                "n": n,
                "lag": lag,
                "is_new": is_new,
                "r_prev": r_prev,
            })

    results.sort(key=lambda x: abs(x["r"]), reverse=True)
    print(f"[correlations] found={len(results)}  skipped={skipped}")

    if dry_run:
        for row in results[:20]:
            direction = "→next" if row["lag"] else "same"
            new_marker = " NEW" if row["is_new"] else ""
            print(f"  {row['metric_a']:25s} × {row['metric_b']:25s}  r={row['r']:+.3f}  p={row['p_value']:.4f}  n={row['n']}  [{direction}]{new_marker}")
        return len(results)

    conn.executemany(
        """
        INSERT OR REPLACE INTO correlation_snapshots
            (computed_at, window_days, metric_a, metric_b, r, p_value, n, lag, is_new, r_prev)
        VALUES
            (:computed_at, :window_days, :metric_a, :metric_b, :r, :p_value, :n, :lag, :is_new, :r_prev)
        """,
        results,
    )

    conn.execute(
        """
        INSERT INTO sync_log (source, data_type, run_at, status, records_synced)
        VALUES ('insights', 'correlations', ?, 'ok', ?)
        """,
        (computed_at, len(results)),
    )
    conn.commit()
    conn.close()

    print(f"[correlations] wrote {len(results)} rows to correlation_snapshots")
    return len(results)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compute weekly correlations")
    parser.add_argument("--window", type=int, default=90, help="Look-back window in days (default 90)")
    parser.add_argument("--both", action="store_true", help="Also run 180-day window")
    parser.add_argument("--dry-run", action="store_true", help="Print without writing")
    args = parser.parse_args()

    run(window_days=args.window, dry_run=args.dry_run)
    if args.both and not args.dry_run:
        run(window_days=180, dry_run=False)
