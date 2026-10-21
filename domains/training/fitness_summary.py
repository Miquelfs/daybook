"""
Fitness / fatigue / form put in context: where fitness (CTL) is now, where it
should be on race day for the active goal, and whether the current build rate
gets there. Plus fitness age from VO2max.

  CTL  fitness  — 42-day weighted average of daily training load (TSS)
  ATL  fatigue  — 7-day weighted average of daily training load
  TSB  form     — fitness − fatigue: positive = fresh, negative = carrying fatigue

Race-day targets are typical amateur CTLs for finishing strong, not hard limits.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

# Race-day fitness (CTL) to aim for, by race type.
TARGET_CTL = {
    "mallorca_312": 70, "ironman": 85, "half_ironman": 70, "marathon": 55,
    "half_marathon": 45, "olympic_triathlon": 55, "sprint_triathlon": 40,
}
DEFAULT_TARGET_CTL = 60
SAFE_RAMP = 7          # CTL/week above this is an injury/illness risk
TAPER_WEEKS = 2        # fitness stops growing in the taper

# Average VO2max (ml/kg/min) by age, HUNT fitness study — sexes pooled, since sex isn't stored.
# fitness age = the age at which your VO2max is the population average.
_NORM_A, _NORM_B = 56.6, 0.36


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def _find_key(obj, key):
    if isinstance(obj, dict):
        if obj.get(key) is not None:
            return obj[key]
        for v in obj.values():
            found = _find_key(v, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = _find_key(v, key)
            if found is not None:
                return found
    return None


def fitness_age(conn, t: set[str], today: date) -> dict | None:
    if "garmin_physio" not in t:
        return None
    row = conn.execute(
        """SELECT date, vo2max_run, vo2max_bike, raw_payload FROM garmin_physio
           WHERE vo2max_run IS NOT NULL OR vo2max_bike IS NOT NULL ORDER BY date DESC LIMIT 1""").fetchone()
    if not row:
        return None
    vo2 = row["vo2max_run"] or row["vo2max_bike"]
    age = None
    if "user_profile" in t:
        p = conn.execute("SELECT birthdate FROM user_profile WHERE id=1").fetchone()
        if p and p[0]:
            b = date.fromisoformat(p[0])
            age = today.year - b.year - ((today.month, today.day) < (b.month, b.day))
    garmin_age = None
    try:
        garmin_age = _find_key(json.loads(row["raw_payload"] or "{}"), "fitnessAge")
    except (ValueError, TypeError):
        pass
    if isinstance(garmin_age, (int, float)) and garmin_age > 0:
        value, source = round(garmin_age), "garmin"
    else:
        value, source = round(max(18, min(90, (_NORM_A - vo2) / _NORM_B))), "estimate"
    return {"value": value, "source": source, "vo2max": round(vo2, 1), "age": age,
            "delta": value - age if age is not None else None, "as_of": row["date"]}


def summary(conn: sqlite3.Connection, today: date | None = None) -> dict:
    today = today or date.today()
    t = _tables(conn)
    out: dict = {"load": None, "goal": None, "fitness_age": fitness_age(conn, t, today)}
    if "training_load_daily" not in t:
        return out
    rows = conn.execute(
        """SELECT date, ctl, atl FROM training_load_daily
           WHERE sport='combined' AND date <= ? AND ctl IS NOT NULL ORDER BY date DESC LIMIT 29""",
        (today.isoformat(),)).fetchall()
    if not rows:
        return out
    now, back = rows[0], rows[-1]
    weeks_back = max(1.0, (date.fromisoformat(now["date"]) - date.fromisoformat(back["date"])).days / 7)
    ramp = (now["ctl"] - back["ctl"]) / weeks_back
    out["load"] = {"fitness": round(now["ctl"], 1), "fatigue": round(now["atl"], 1),
                   "form": round(now["ctl"] - now["atl"], 1), "ramp_per_week": round(ramp, 1)}

    if "race_goals" in t:
        g = conn.execute("SELECT name, race_type, race_date FROM race_goals WHERE status='active' AND race_date >= ? "
                         "ORDER BY race_date LIMIT 1", (today.isoformat(),)).fetchone()
        if g:
            target = TARGET_CTL.get(g["race_type"], DEFAULT_TARGET_CTL)
            weeks = max(0, (date.fromisoformat(g["race_date"]) - today).days // 7)
            build = max(1, weeks - TAPER_WEEKS)
            gap = target - now["ctl"]
            needed = gap / build
            projected = now["ctl"] + ramp * build
            status = ("there" if gap <= 0 else
                      "on track" if ramp >= needed * 0.9 else
                      "too steep" if needed > SAFE_RAMP else "behind")
            out["goal"] = {"name": g["name"], "race_date": g["race_date"], "weeks_to_race": weeks,
                           "target_fitness": target, "pct": round(min(100, now["ctl"] / target * 100)),
                           "needed_ramp_per_week": round(needed, 1), "projected_fitness": round(projected),
                           "safe_ramp": SAFE_RAMP, "status": status}
    return out
