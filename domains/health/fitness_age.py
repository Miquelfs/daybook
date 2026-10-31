"""
Daybook fitness age — Garmin's idea, with more of what matters and every step shown.

  base        the age whose *average* VO2max equals yours (HUNT3 / NTNU norms, the
              same study behind Garmin's fitness age), men's norms
  adjusted    in years, each capped, from the last 28 days (bonuses overlap — the same
              strong heart shows in several of them — so they add with diminishing
              returns towards 8 years; penalties add in full):
                resting HR      lower is better (each 10 bpm ≈ notable mortality risk)
                HRV             vs what's typical for your age
                activity        WHO weekly minutes, vigorous counting double
                steps           daily average (8–10k+ linked to lower mortality)
                sleep           7–9 h is the sweet spot either side hurts
                BMI             light touch: it misreads muscular builds
  achievable  each component at its best, VO2max as it is now

Pure read side: takes the DB, returns a dict. History is the same model run at
the end of each of the last 12 months.
"""

from __future__ import annotations

import json
import math
import sqlite3
from datetime import date, timedelta

# HUNT3 mean VO2max (ml/kg/min) for men, by age-band midpoint (Aspenes et al. 2011)
NORMS = [(25, 54.4), (35, 49.2), (45, 47.2), (55, 42.6), (65, 39.0)]
VO2_REALISTIC_GAIN = 4.0      # ml/kg/min a year of structured endurance training can add at your level
WINDOW = 28
MIN_AGE, MAX_AGE = 20, 95          # the norms start at the 20–29 band (Garmin's scale stops at 20 too)


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def vo2_age(vo2: float) -> float:
    """Age at which the average man's VO2max equals `vo2` (linear inside the bands, extended outside)."""
    pts = NORMS
    for (a0, v0), (a1, v1) in zip(pts, pts[1:]):
        if v1 <= vo2 <= v0:
            return a0 + (v0 - vo2) / (v0 - v1) * (a1 - a0)
    if vo2 > pts[0][1]:                                   # fitter than the youngest band: extend the first slope
        (a0, v0), (a1, v1) = pts[0], pts[1]
    else:
        (a0, v0), (a1, v1) = pts[-2], pts[-1]
    slope = (a1 - a0) / (v0 - v1)
    return max(MIN_AGE, min(MAX_AGE, a0 + (v0 - vo2) * slope))


def hrv_norm(age: float) -> float:
    """Typical nightly rMSSD (ms) for an age — rough population midline, declines ~1 ms/yr."""
    return max(20.0, 80.0 - 1.0 * age)


# ── components: (years, note) ────────────────────────────────────────────────

def years_rhr(bpm: float) -> float:
    if bpm <= 60:
        return max(-3.0, -(60 - bpm) / 5 * 0.75)
    return min(4.0, (bpm - 60) / 5 * (0.5 if bpm <= 70 else 1.0))


def years_hrv(ms: float, age: float) -> float:
    return max(-2.0, min(2.0, -math.log(ms / hrv_norm(age)) / math.log(1.25) * 1.0))


def years_activity(eq_min_week: float) -> float:
    return (-2.5 if eq_min_week >= 600 else -2.0 if eq_min_week >= 300 else -1.0 if eq_min_week >= 150
            else 0.0 if eq_min_week >= 75 else 2.0)


def years_steps(steps: float) -> float:
    return (-1.5 if steps >= 12000 else -1.0 if steps >= 10000 else -0.5 if steps >= 7500
            else 0.5 if steps >= 5000 else 2.0)


def years_sleep(hours: float) -> float:
    if 7.5 <= hours <= 8.5:
        return -0.5
    if 7.0 <= hours <= 9.0:
        return 0.0
    if 6.0 <= hours < 7.0:
        return 1.0
    if hours < 6.0:
        return 2.5
    return 1.0


def years_bmi(bmi: float) -> float:
    return (1.0 if bmi < 18.5 else 0.0 if bmi < 25 else 0.5 if bmi < 27.5 else 1.5 if bmi < 30 else 3.0)


OVERLAP_YEARS = 8.0     # bonuses saturate towards this: a strong heart shows in VO2max, RHR, HRV and training at once


def final_age(base: float, years: list[float]) -> float:
    return max(MIN_AGE, min(MAX_AGE, base + combine(years)))


def combine(years: list[float]) -> float:
    """Penalties add up in full (separate risks); bonuses overlap, so they add with diminishing returns."""
    bonus = -sum(y for y in years if y < 0)
    penalty = sum(y for y in years if y > 0)
    return -OVERLAP_YEARS * (1 - math.exp(-bonus / OVERLAP_YEARS)) + min(10.0, penalty)


# what to do, and the value that earns the best score
ACTIONS = {
    "rhr": ("Bring resting HR down", "≤ 45 bpm", "comes with aerobic volume, good sleep and little alcohol"),
    "hrv": ("Raise overnight HRV", None, "regular sleep times, real recovery days, less alcohol and late eating"),
    "activity": ("Train more (or harder)", "600 min/wk equivalent",
                 "e.g. 6 h a week with ~1.5 h in Z3+ — vigorous minutes count double"),
    "steps": ("Walk more", "12,000 steps/day", "a walk after meals or a walking commute on rest days"),
    "sleep": ("Sleep 7.5–8.5 h", "7.5–8.5 h", "consistent bed time; it also lifts HRV"),
    "bmi": ("Bring BMI under 25", None, "slowly — keep the power, lose the excess"),
}


BEST = {"rhr": -3.0, "hrv": -2.0, "activity": -2.5, "steps": -1.5, "sleep": -0.5, "bmi": 0.0}


# ── inputs ───────────────────────────────────────────────────────────────────

def _avg(conn, sql: str, params: tuple) -> float | None:
    try:
        r = conn.execute(sql, params).fetchone()
        return float(r[0]) if r and r[0] is not None else None
    except sqlite3.OperationalError:
        return None


def _age(conn, t, on: date) -> int | None:
    if "user_profile" not in t:
        return None
    r = conn.execute("SELECT birthdate FROM user_profile WHERE id=1").fetchone()
    if not r or not r[0]:
        return None
    b = date.fromisoformat(r[0])
    return on.year - b.year - ((on.month, on.day) < (b.month, b.day))


def _vo2(conn, t, on: date) -> float | None:
    if "garmin_physio" not in t:
        return None
    r = conn.execute("""SELECT MAX(COALESCE(vo2max_run, 0), COALESCE(vo2max_bike, 0)) FROM garmin_physio
                        WHERE date <= ? AND date >= ? AND (vo2max_run IS NOT NULL OR vo2max_bike IS NOT NULL)
                        ORDER BY date DESC LIMIT 1""", (on.isoformat(), (on - timedelta(days=120)).isoformat())).fetchone()
    return float(r[0]) if r and r[0] else None


def _height_m(conn, t) -> float | None:
    """From Garmin's BMI and the weigh-in nearest to it (Daybook doesn't store height)."""
    if "garmin_fitness_age" not in t or "weight_log" not in t:
        return None
    for g in conn.execute("SELECT date, components_json FROM garmin_fitness_age ORDER BY date DESC LIMIT 10"):
        try:
            bmi = (json.loads(g["components_json"] or "{}").get("bmi") or {}).get("value")
        except ValueError:
            bmi = None
        if not bmi:
            continue
        w = conn.execute("SELECT weight_kg FROM weight_log ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 1",
                         (g["date"],)).fetchone()
        if w:
            return math.sqrt(w[0] / bmi)
    return None


def _activity_eq_minutes(conn, t, start: str, end: str) -> tuple[float, float, float] | None:
    """(moderate, vigorous, equivalent) minutes per week: training time, Z3+ counted as vigorous ×2."""
    if "activities" not in t:
        return None
    cols = {r[1] for r in conn.execute("PRAGMA table_info(activities)")}
    not_twin = ("""AND NOT (a.source='strava' AND EXISTS (SELECT 1 FROM activities g WHERE g.source='garmin'
                   AND g.date = a.date AND g.strava_id = CAST(SUBSTR(a.id, 8) AS TEXT)))"""
                if {"source", "strava_id"} <= cols else "")
    zones = "(SELECT zones_json FROM activity_detail d WHERE d.activity_id = a.id)" if "activity_detail" in t else "NULL"
    rows = conn.execute(
        f"""SELECT a.id, COALESCE(NULLIF(a.moving_time_seconds, 0), a.duration_seconds, 0) AS secs, {zones} AS zones
            FROM activities a WHERE a.date BETWEEN ? AND ? {not_twin}""", (start, end)).fetchall()
    mod = vig = 0.0
    for r in rows:
        secs = r["secs"] or 0
        hard = 0.0
        if r["zones"]:
            try:
                z = json.loads(r["zones"])
                hard = sum(float(z.get(k) or 0) for k in ("z3_s", "z4_s", "z5_s"))
            except (ValueError, TypeError):
                hard = 0.0
        hard = min(hard, secs)
        vig += hard / 60
        mod += (secs - hard) / 60
    weeks = WINDOW / 7
    return mod / weeks, vig / weeks, (mod + 2 * vig) / weeks


# ── the model ────────────────────────────────────────────────────────────────

def compute(conn, on: date | None = None) -> dict | None:
    on = on or date.today()
    t = _tables(conn)
    age = _age(conn, t, on)
    vo2 = _vo2(conn, t, on)
    if age is None or vo2 is None:
        return None
    start = (on - timedelta(days=WINDOW - 1)).isoformat()
    end = on.isoformat()
    base = vo2_age(vo2)
    comps: list[dict] = []

    rhr = _avg(conn, "SELECT AVG(resting_hr) FROM daily_stats WHERE date BETWEEN ? AND ? AND resting_hr > 0", (start, end)) \
        if "daily_stats" in t else None
    if rhr:
        comps.append({"key": "rhr", "label": "Resting HR", "value": round(rhr), "unit": "bpm",
                      "years": round(years_rhr(rhr), 1), "good": "≤ 45 bpm earns the most",
                      "why": "A low resting heart rate means a strong, efficient heart"})
    hrv = _avg(conn, "SELECT AVG(last_night_avg) FROM hrv WHERE date BETWEEN ? AND ? AND last_night_avg > 0",
               (start, end)) if "hrv" in t else None
    if hrv:
        comps.append({"key": "hrv", "label": "HRV", "value": round(hrv), "unit": "ms",
                      "years": round(years_hrv(hrv, age), 1), "good": f"typical at {age}: ~{round(hrv_norm(age))} ms",
                      "why": "Higher overnight HRV — a well-recovered, adaptable nervous system"})
    act = _activity_eq_minutes(conn, t, start, end)
    if act:
        mod, vig, eq = act
        comps.append({"key": "activity", "label": "Training", "value": round(eq), "unit": "min/wk",
                      "years": years_activity(eq), "good": "300+ (WHO upper), vigorous counts ×2",
                      "why": f"{round(mod)} moderate + {round(vig)} vigorous minutes a week"})
    steps = _avg(conn, "SELECT AVG(steps) FROM daily_stats WHERE date BETWEEN ? AND ? AND steps > 0", (start, end)) \
        if "daily_stats" in t else None
    if steps:
        comps.append({"key": "steps", "label": "Daily steps", "value": round(steps), "unit": "steps",
                      "years": years_steps(steps), "good": "10,000+",
                      "why": "Everyday movement outside training"})
    sleep_s = _avg(conn, "SELECT AVG(duration_seconds) FROM sleep WHERE date BETWEEN ? AND ? AND duration_seconds > 3600",
                   (start, end)) if "sleep" in t else None
    if sleep_s:
        h = sleep_s / 3600
        comps.append({"key": "sleep", "label": "Sleep", "value": round(h, 1), "unit": "h",
                      "years": years_sleep(h), "good": "7.5–8.5 h",
                      "why": "Both short and very long sleep track with worse health"})
    height = _height_m(conn, t)
    w = conn.execute("SELECT weight_kg FROM weight_log WHERE date <= ? ORDER BY date DESC LIMIT 1", (end,)).fetchone() \
        if "weight_log" in t else None
    if height and w:
        bmi = w[0] / height ** 2
        comps.append({"key": "bmi", "label": "BMI", "value": round(bmi, 1), "unit": "",
                      "years": years_bmi(bmi), "good": "under 25",
                      "why": f"{w[0]:.1f} kg at {height:.2f} m — counts lightly: muscle weighs too"})

    years = [c["years"] for c in comps]
    adj = combine(years)
    fa = final_age(base, years)
    best = final_age(base, [BEST[c["key"]] for c in comps])
    for c in comps:                    # what your fitness age would drop by if this factor alone were at its best
        others = [x["years"] for x in comps if x is not c]
        c["gain"] = round(fa - final_age(base, others + [BEST[c["key"]]]), 1)
    # how to bring it down: each factor at its best (overlap-aware), plus VO2max — the biggest lever of all
    plan = []
    for c in comps:
        if c["gain"] < 0.2:
            continue
        title, target, how = ACTIONS[c["key"]]
        if c["key"] == "hrv":
            target = f"≥ {round(hrv_norm(age) * 1.56)} ms"
        if c["key"] == "bmi" and height:
            target = f"≤ {24.9 * height ** 2:.0f} kg"
        plan.append({"key": c["key"], "title": title, "now": c["value"], "unit": c["unit"], "target": target,
                     "how": how, "years": c["gain"]})
    vo2_goal = round(vo2 + VO2_REALISTIC_GAIN, 1)
    vo2_years = round(fa - final_age(vo2_age(vo2_goal), years), 1)
    plan.append({"key": "vo2max", "title": "Raise VO₂max", "now": round(vo2, 1), "unit": "",
                 "target": f"{vo2_goal}", "how": "1–2 interval sessions a week (e.g. 4×4 min hard) on top of long Z2 — "
                                                  "the Mallorca 312 build does most of this", "years": vo2_years})
    plan.sort(key=lambda x: -x["years"])
    floor = final_age(vo2_age(vo2_goal), [BEST[c["key"]] for c in comps])

    # Weight: lightly through BMI, mostly through VO2max — it's per kg, so the same engine on less
    # body weight reads higher (Garmin uses the profile weight: keep it current)
    weight = None
    if w:
        goal_kg = None
        if "race_goals" in t and "target_weight_kg" in {r[1] for r in conn.execute("PRAGMA table_info(race_goals)")}:
            g = conn.execute("SELECT target_weight_kg FROM race_goals WHERE status='active' AND target_weight_kg IS NOT NULL "
                             "ORDER BY race_date LIMIT 1").fetchone()
            goal_kg = g[0] if g else None
        weight = {"kg": round(w[0], 1), "height_m": round(height, 2) if height else None,
                  "bmi": round(w[0] / height ** 2, 1) if height else None,
                  "bmi25_kg": round(25 * height ** 2, 1) if height else None, "goal_kg": goal_kg}
        if goal_kg and goal_kg < w[0]:
            vo2_g = vo2 * w[0] / goal_kg
            yrs_g = [years_bmi(goal_kg / height ** 2) if c["key"] == "bmi" and height else c["years"] for c in comps]
            weight.update({"vo2_at_goal": round(vo2_g, 1),
                           "fitness_age_at_goal": round(final_age(vo2_age(vo2_g), yrs_g), 1)})

    return {"date": end, "age": age, "fitness_age": round(fa), "precise": round(fa, 1),
            "delta": round(fa - age), "vo2max": round(vo2, 1),
            "vo2_age": round(base, 1), "adjust_years": round(adj, 1),
            "raw_adjust_years": round(sum(c["years"] for c in comps), 1),
            "achievable": round(best), "floor": round(floor), "vo2_goal": vo2_goal, "plan": plan, "components": comps,
            "weight": weight,
            "biggest_gain": max(comps, key=lambda c: c["gain"])["key"] if comps and max(c["gain"] for c in comps) >= 0.5
            else None}


def summary(conn) -> dict:
    now = compute(conn)
    hist = []
    today = date.today()
    for k in range(12, 0, -1):                       # month ends, oldest first; the current month ends today
        y, mth = today.year, today.month - k + 1
        while mth <= 0:
            mth += 12
            y -= 1
        first_next = date(y + (mth == 12), mth % 12 + 1, 1)
        m_end = min(today, first_next - timedelta(days=1))
        r = compute(conn, m_end)
        if r:
            hist.append({"date": r["date"], "fitness_age": r["precise"], "vo2max": r["vo2max"]})
    garmin = None
    if "garmin_fitness_age" in _tables(conn):
        g = conn.execute("SELECT date, fitness_age FROM garmin_fitness_age WHERE fitness_age IS NOT NULL "
                         "ORDER BY date DESC LIMIT 1").fetchone()
        garmin = {"date": g[0], "fitness_age": round(g[1])} if g else None
    return {"now": now, "history": hist, "garmin": garmin}
