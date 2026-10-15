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
    "battery_low", "battery_high", "stress_avg", "weight",
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
    # Food (dietary intake)
    "food_kcal", "food_protein", "food_carbs", "food_fat", "food_sugar",
    "meal_count", "biggest_meal_kcal", "water_ml",
    # All-day wellness (CIRQA)
    "stress_peak", "stress_high_min", "energy_drained", "body_battery_low",
    "respiration_avg", "spo2_avg",
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
        "weight":        ("weight_log",   "weight_kg"),
        "water_ml":      ("water_log",    "ml"),
        "stress_peak":       ("wellness_daily", "stress_max"),
        "stress_high_min":   ("wellness_daily", "stress_high_min"),
        "energy_drained":    ("wellness_daily", "bb_drained"),
        "body_battery_low":  ("wellness_daily", "bb_min"),
        "respiration_avg":   ("wellness_daily", "respiration_avg"),
        "spo2_avg":          ("wellness_daily", "spo2_avg"),
    }
    if key in _SIMPLE:
        table, col = _SIMPLE[key]
        rows = conn.execute(
            f"SELECT date, {col} AS val FROM {table} "
            f"WHERE date BETWEEN ? AND ? AND {col} IS NOT NULL",
            (start, end),
        ).fetchall()
        return {r["date"]: float(r["val"]) for r in rows}

    # Food (dietary intake, aggregated from food_entries)
    _FOOD_AGG = {
        "food_kcal":         ("SUM",   "kcal"),
        "food_protein":      ("SUM",   "protein_g"),
        "food_carbs":        ("SUM",   "carbs_g"),
        "food_fat":          ("SUM",   "fat_g"),
        "food_sugar":        ("SUM",   "sugar_g"),
        "meal_count":        ("COUNT", "*"),
        "biggest_meal_kcal": ("MAX",   "kcal"),
    }
    if key in _FOOD_AGG:
        agg, col = _FOOD_AGG[key]
        try:
            rows = conn.execute(
                f"SELECT date, {agg}({col}) AS val FROM food_entries "
                f"WHERE date BETWEEN ? AND ? GROUP BY date",
                (start, end),
            ).fetchall()
            return {r["date"]: float(r["val"]) for r in rows if r["val"] is not None}
        except Exception:
            return {}

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

KEEP_SNAPSHOTS = 6      # per window — the job used to keep every hourly run forever
_FDR_Q = 0.10           # Benjamini–Hochberg false-discovery rate


def _ensure_columns(conn) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(correlation_snapshots)")}
    for name, ddl in (("q_value", "REAL"), ("effect", "REAL"), ("effect_kind", "TEXT")):
        if name not in cols:
            conn.execute(f"ALTER TABLE correlation_snapshots ADD COLUMN {name} {ddl}")
    conn.commit()


def bh_qvalues(pvals: list[float]) -> list[float]:
    """Benjamini–Hochberg adjusted p-values (q), same order as input."""
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i])
    q = [1.0] * m
    prev = 1.0
    for rank in range(m, 0, -1):
        i = order[rank - 1]
        prev = min(prev, pvals[i] * m / rank)
        q[i] = prev
    return q


def _effect(xs: list[float], ys: list[float]) -> tuple[float | None, str | None]:
    """Binary driver → difference in means of y (with − without); else OLS slope (y per unit x)."""
    if set(xs) <= {0.0, 1.0}:
        on = [y for x, y in zip(xs, ys) if x == 1.0]
        off = [y for x, y in zip(xs, ys) if x == 0.0]
        if len(on) >= 3 and len(off) >= 3:
            return sum(on) / len(on) - sum(off) / len(off), "diff"
        return None, None
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    vx = sum((x - mx) ** 2 for x in xs)
    if not vx:
        return None, None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / vx, "slope"


def _pairs(data_a: dict, data_b: dict, lag: int) -> tuple[list[float], list[float]]:
    """lag 0: same day. lag 1: a on day t vs b on day t+1."""
    if lag == 0:
        common = sorted(set(data_a) & set(data_b))
        return [data_a[d] for d in common], [data_b[d] for d in common]
    xs, ys = [], []
    for d, v in data_a.items():
        nd = (date.fromisoformat(d) + timedelta(days=1)).isoformat()
        if nd in data_b:
            xs.append(v)
            ys.append(data_b[nd])
    return xs, ys


def run(window_days: int = 90, dry_run: bool = False) -> int:
    from domains.insights.metric_families import redundant

    conn = get_connection()
    _ensure_columns(conn)
    today = date.today()
    end = today.isoformat()
    start = (today - timedelta(days=window_days)).isoformat()
    computed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    metrics = list(dict.fromkeys(list(_STATIC_METRICS) + _dynamic_candidates(conn, start, end)))
    data: dict[str, dict[str, float]] = {k: _fetch(conn, k, start, end) for k in metrics}

    # Every test: same day once per pair, next-day in BOTH directions
    # (the old loop only tested a[t]→b[t+1] in combinations() order, so
    # "tag today → energy tomorrow" was never tested for tags appended last).
    tests = []
    for a, b in combinations(metrics, 2):
        if redundant(a, b):
            continue
        tests.append((a, b, 0))
        tests.append((a, b, 1))
        tests.append((b, a, 1))

    candidates = []
    for a, b, lag in tests:
        xs, ys = _pairs(data[a], data[b], lag)
        if len(xs) < _MIN_N:
            continue
        r = pearson(xs, ys)
        if r is None:
            continue
        p = p_value_approx(r, len(xs))
        if p is None:
            continue
        candidates.append((a, b, lag, r, p, len(xs), xs, ys))

    qs = bh_qvalues([c[4] for c in candidates]) if candidates else []
    results = []
    for (a, b, lag, r, p, n, xs, ys), q in zip(candidates, qs):
        if q > _FDR_Q or abs(r) < _MIN_R:
            continue
        eff, kind = _effect(xs, ys)
        r_prev = _prior_snapshot_r(conn, a, b, lag, window_days)
        results.append({
            "computed_at": computed_at, "window_days": window_days, "metric_a": a, "metric_b": b,
            "r": r, "p_value": p, "q_value": q, "n": n, "lag": lag,
            "is_new": 1 if r_prev is None else 0, "r_prev": r_prev,
            "effect": round(eff, 4) if eff is not None else None, "effect_kind": kind,
        })

    results.sort(key=lambda x: abs(x["r"]), reverse=True)
    print(f"[correlations] window={window_days}d metrics={len(metrics)} tests={len(candidates)} "
          f"kept={len(results)} (BH q≤{_FDR_Q})")

    if dry_run:
        for row in results[:25]:
            arrow = "→next day" if row["lag"] else "same day"
            print(f"  {row['metric_a']:24s} {arrow:9s} {row['metric_b']:24s} r={row['r']:+.2f} "
                  f"q={row['q_value']:.3f} n={row['n']} effect={row['effect']} ({row['effect_kind']})")
        conn.close()
        return len(results)

    conn.executemany(
        """INSERT OR REPLACE INTO correlation_snapshots
               (computed_at, window_days, metric_a, metric_b, r, p_value, q_value, n, lag, is_new, r_prev,
                effect, effect_kind)
           VALUES (:computed_at, :window_days, :metric_a, :metric_b, :r, :p_value, :q_value, :n, :lag,
                   :is_new, :r_prev, :effect, :effect_kind)""",
        results,
    )
    # Keep only the latest few snapshots per window (the hourly cron used to grow this forever).
    conn.execute(
        """DELETE FROM correlation_snapshots WHERE window_days = ? AND computed_at NOT IN (
               SELECT computed_at FROM correlation_snapshots WHERE window_days = ?
               GROUP BY computed_at ORDER BY computed_at DESC LIMIT ?)""",
        (window_days, window_days, KEEP_SNAPSHOTS),
    )
    conn.execute(
        "INSERT INTO sync_log (source, data_type, run_at, status, records_synced) VALUES ('insights','correlations',?,'ok',?)",
        (computed_at, len(results)),
    )
    conn.commit()
    conn.close()
    print(f"[correlations] wrote {len(results)} rows")
    return len(results)


def _stale(window_days: int, hours: float) -> bool:
    conn = get_connection()
    try:
        row = conn.execute("SELECT MAX(computed_at) FROM correlation_snapshots WHERE window_days=?",
                           (window_days,)).fetchone()
    except Exception:
        return True
    finally:
        conn.close()
    if not row or not row[0]:
        return True
    last = datetime.fromisoformat(row[0].replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - last).total_seconds() > hours * 3600


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compute weekly correlations")
    parser.add_argument("--window", type=int, default=90, help="Look-back window in days (default 90)")
    parser.add_argument("--both", action="store_true", help="Also run 180-day window")
    parser.add_argument("--dry-run", action="store_true", help="Print without writing")
    parser.add_argument("--if-stale", type=float, default=None,
                        help="Only run if the last snapshot is older than this many hours (hourly cron)")
    args = parser.parse_args()

    if args.if_stale is not None and not args.dry_run and not _stale(args.window, args.if_stale):
        print("[correlations] fresh enough — skipping")
    else:
        run(window_days=args.window, dry_run=args.dry_run)
        if args.both and not args.dry_run:
            run(window_days=180, dry_run=False)
