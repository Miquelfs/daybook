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


def food_library(conn, q: str = "", limit: int = 60) -> list[dict]:
    """Searchable food library: your logged foods (aggregated by name) + crew
    presets, each with per-item macros for tap-to-add."""
    like = f"%{q.lower()}%"
    logged = conn.execute(
        """SELECT TRIM(description) AS name,
                  COUNT(*)              AS times_logged,
                  ROUND(AVG(kcal))      AS kcal,
                  ROUND(AVG(protein_g)) AS protein_g,
                  ROUND(AVG(carbs_g))   AS carbs_g,
                  ROUND(AVG(fat_g))     AS fat_g,
                  ROUND(AVG(sugar_g))   AS sugar_g,
                  MAX(meal_type)        AS meal_type
           FROM food_entries
           WHERE description IS NOT NULL AND TRIM(description) <> ''
             AND (? = '' OR LOWER(description) LIKE ?)
           GROUP BY LOWER(TRIM(description))
           ORDER BY times_logged DESC, MAX(date) DESC
           LIMIT ?""",
        (q, like, limit),
    ).fetchall()

    items = [{
        "name": r["name"], "kcal": r["kcal"] or 0, "protein_g": r["protein_g"] or 0,
        "carbs_g": r["carbs_g"] or 0, "fat_g": r["fat_g"] or 0, "sugar_g": r["sugar_g"] or 0,
        "meal_type": r["meal_type"], "times_logged": r["times_logged"], "source": "logged",
    } for r in logged]

    seen = {i["name"].lower() for i in items}
    if len(items) < limit:
        try:
            presets = conn.execute(
                """SELECT name, kcal, protein_g, carbs_g, fat_g, meal_type, category
                   FROM crew_meal_presets
                   WHERE (? = '' OR LOWER(name) LIKE ?)
                   ORDER BY protein_g DESC LIMIT ?""",
                (q, like, limit - len(items)),
            ).fetchall()
            for r in presets:
                if r["name"].lower() in seen:
                    continue
                items.append({
                    "name": r["name"], "kcal": round(r["kcal"] or 0), "protein_g": round(r["protein_g"] or 0),
                    "carbs_g": round(r["carbs_g"] or 0), "fat_g": round(r["fat_g"] or 0),
                    "sugar_g": 0, "meal_type": r["meal_type"],
                    "times_logged": 0, "source": "preset", "category": r["category"],
                })
        except Exception:
            pass
    return items[:limit]


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

    # Actual scale change needs TWO distinct weigh-ins spanning the window — the
    # first at/near the start, the last at/near the end. Without a real span the
    # comparison is meaningless (a single weigh-in reads as "0 kg change" and
    # produces a bogus maintenance adjustment), so we report it as un-calibrated.
    w_start = (conn.execute("SELECT date, weight_kg FROM weight_log WHERE date<=? ORDER BY date DESC LIMIT 1", (start.isoformat(),)).fetchone()
               or conn.execute("SELECT date, weight_kg FROM weight_log WHERE date>=? ORDER BY date ASC LIMIT 1", (start.isoformat(),)).fetchone())
    w_end = conn.execute("SELECT date, weight_kg FROM weight_log WHERE date<=? ORDER BY date DESC LIMIT 1", (end.isoformat(),)).fetchone()

    actual_kg = None
    span_days = None
    maintenance_adjust = None
    if w_start and w_end and w_start["date"] != w_end["date"]:
        span_days = (_date.fromisoformat(w_end["date"]) - _date.fromisoformat(w_start["date"])).days
        if span_days >= 5:  # need a real trend, not two adjacent weigh-ins
            actual_kg = round(w_end["weight_kg"] - w_start["weight_kg"], 2)
            # If actual loss > predicted, real expenditure is higher than modeled → +adj.
            # Divide by the measured span so the daily adjustment is proportionate,
            # then clamp to a sane range (data noise shouldn't demand ±1000 kcal).
            raw = (predicted_kg - actual_kg) * KCAL_PER_KG / span_days
            maintenance_adjust = int(max(-500, min(500, round(raw))))

    return {
        "enough": True,
        "days_counted": n,
        "window_days": days,
        "avg_daily_net_kcal": round(cum / n),
        "predicted_kg": predicted_kg,
        "actual_kg": actual_kg,
        "weigh_in_span_days": span_days,
        "maintenance_adjust_kcal": maintenance_adjust,
        "calibrated": actual_kg is not None,
    }
