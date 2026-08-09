"""
Food analytics — Caltrack-style motivators grounded in Daybook data.

- deficit_streak: consecutive logged days you hit your calorie target (+ best run)
- expenditure_calibration: predicted weight change (from logged intake vs Garmin
  burn) vs actual scale change — validates whether the Garmin/target estimate
  fits you (MacroFactor-style).
"""

from datetime import date as _date, timedelta
from typing import Callable, Optional

KCAL_PER_KG = 7700.0  # approx kcal per kg of body mass


def _day_totals(conn, ds: str) -> tuple[int, float]:
    row = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(kcal),0) AS k FROM food_entries WHERE date=?",
        (ds,),
    ).fetchone()
    return row["n"], row["k"]


def deficit_streak(conn, date: str, active_target_fn: Callable) -> dict:
    """Current + best run of consecutive logged days at/under the calorie target."""
    cur, deficits = 0, []
    d = _date.fromisoformat(date)
    skipped_today = False
    while True:
        ds = d.isoformat()
        n, k = _day_totals(conn, ds)
        if n == 0:
            # Don't break the streak for an unfinished today with nothing logged yet.
            if not skipped_today and ds == date:
                skipped_today = True
                d -= timedelta(days=1)
                continue
            break
        tgt = active_target_fn(conn, ds)
        if not tgt or tgt.get("target_kcal") is None:
            break
        if k <= tgt["target_kcal"]:
            cur += 1
            deficits.append(tgt["target_kcal"] - k)
            d -= timedelta(days=1)
        else:
            break

    # Best run across all logged days (calendar-consecutive).
    rows = conn.execute(
        "SELECT date, COALESCE(SUM(kcal),0) AS k FROM food_entries GROUP BY date ORDER BY date"
    ).fetchall()
    best = run = 0
    prev = None
    for r in rows:
        tgt = active_target_fn(conn, r["date"])
        ok = tgt and tgt.get("target_kcal") is not None and r["k"] <= tgt["target_kcal"]
        cur_d = _date.fromisoformat(r["date"])
        if ok:
            run = run + 1 if (prev is not None and (cur_d - prev).days == 1) else 1
            best = max(best, run)
            prev = cur_d
        else:
            run = 0
            prev = None

    return {
        "current": cur,
        "best": best,
        "avg_deficit_kcal": round(sum(deficits) / len(deficits)) if deficits else None,
    }


def expenditure_calibration(conn, date: str, days: int = 14) -> dict:
    """Predicted vs actual weight change over a window, to calibrate the estimate."""
    end = _date.fromisoformat(date)
    start = end - timedelta(days=days - 1)
    rows = conn.execute(
        """SELECT f.date AS date, f.k AS eaten, ds.total_calories AS burned
           FROM (SELECT date, SUM(kcal) AS k FROM food_entries
                 WHERE date BETWEEN ? AND ? GROUP BY date) f
           JOIN daily_stats ds ON ds.date = f.date
           WHERE ds.total_calories IS NOT NULL AND ds.total_calories > 0""",
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    n = len(rows)
    if n < 3:
        return {"enough": False, "days_counted": n}

    nets = [r["eaten"] - r["burned"] for r in rows]  # <0 = deficit
    cum = sum(nets)
    predicted_kg = round(cum / KCAL_PER_KG, 2)

    w_start = (conn.execute("SELECT weight_kg FROM weight_log WHERE date<=? ORDER BY date DESC LIMIT 1", (start.isoformat(),)).fetchone()
               or conn.execute("SELECT weight_kg FROM weight_log WHERE date>=? ORDER BY date ASC LIMIT 1", (start.isoformat(),)).fetchone())
    w_end = conn.execute("SELECT weight_kg FROM weight_log WHERE date<=? ORDER BY date DESC LIMIT 1", (end.isoformat(),)).fetchone()
    actual_kg = round(w_end["weight_kg"] - w_start["weight_kg"], 2) if (w_start and w_end) else None

    # If actual loss > predicted, real expenditure is higher than modeled → +adj.
    maintenance_adjust = None
    if actual_kg is not None:
        maintenance_adjust = round((predicted_kg - actual_kg) * KCAL_PER_KG / n)

    return {
        "enough": True,
        "days_counted": n,
        "window_days": days,
        "avg_daily_net_kcal": round(cum / n),
        "predicted_kg": predicted_kg,
        "actual_kg": actual_kg,
        "maintenance_adjust_kcal": maintenance_adjust,
    }
