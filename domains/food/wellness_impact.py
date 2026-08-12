"""
Food → wellness impact — "how does eating this way change my energy, mood, stress?"

Grounded entirely in data you already generate: per-day food descriptors (sugar,
saturated fat, fibre, meal size/timing, how clean the day was) joined to your
subjective wellness (days.energy / mood / stress) same-day AND next morning.

For each food "lever" we split your logged days at the median into a high group
and a low group, then report the average difference in each wellness outcome —
with day counts, so it reads as plain English ("on high-sugar days, next-morning
energy is 1.3 lower, 22 vs 19 days") instead of a correlation coefficient.

Deliberately simple + defensive: a lever/outcome pair is only reported when both
groups clear a minimum sample size, so sparse columns (saturated fat, fibre, meal
times) quietly drop out until there's enough history to say anything.
"""

from datetime import date as _date, timedelta
from statistics import mean, median
from typing import Optional

# Both groups need at least this many days before we'll report an effect.
_MIN_GROUP = 5
# An outcome delta smaller than this (on the 1-10 subjective scale) is noise.
_MIN_ABS_DELTA = 0.25

# Outcomes we score every lever against. energy_next = next-morning carry-over.
_OUTCOMES = [
    ("energy_next", "next-morning energy", "higher"),
    ("energy", "same-day energy", "higher"),
    ("mood", "mood", "higher"),
    ("stress", "stress", "lower"),
]


def _day_food_rows(conn, start: str, end: str) -> dict[str, dict]:
    """Per-day food descriptors over [start, end]. Only days with ≥1 entry."""
    rows = conn.execute(
        """SELECT date,
                  COUNT(*)                         AS n_items,
                  COALESCE(SUM(kcal), 0)           AS kcal,
                  COALESCE(SUM(sugar_g), 0)        AS sugar_g,
                  COALESCE(MAX(kcal), 0)           AS biggest_meal_kcal,
                  SUM(saturated_fat_g)             AS sat_fat_g,
                  COUNT(saturated_fat_g)           AS sat_known,
                  SUM(fiber_g)                     AS fiber_g,
                  COUNT(fiber_g)                   AS fiber_known,
                  SUM(CASE WHEN heart_rating IN ('limit','avoid') THEN 1 ELSE 0 END) AS flagged,
                  COUNT(heart_rating)              AS rating_known,
                  MAX(CASE WHEN eaten_at IS NOT NULL AND length(eaten_at) >= 16
                           THEN CAST(substr(eaten_at, 12, 2) AS INTEGER) END) AS last_meal_hour
           FROM food_entries
           WHERE date BETWEEN ? AND ?
           GROUP BY date""",
        (start, end),
    ).fetchall()
    return {r["date"]: dict(r) for r in rows}


def _wellness(conn, start: str, end: str) -> dict[str, dict]:
    """days.energy / mood / stress keyed by date (only non-empty rows)."""
    rows = conn.execute(
        """SELECT date, energy, mood, stress FROM days
           WHERE date BETWEEN ? AND ?
             AND (energy IS NOT NULL OR mood IS NOT NULL OR stress IS NOT NULL)""",
        (start, end),
    ).fetchall()
    return {r["date"]: dict(r) for r in rows}


# Each lever: key, label, how to pull its value from a food-day row (None = skip
# that day for this lever), and a unit for display.
def _levers():
    def sugar(f):
        return f["sugar_g"]

    def sat_fat(f):
        return f["sat_fat_g"] if f["sat_known"] else None

    def fibre(f):
        return f["fiber_g"] if f["fiber_known"] else None

    def big_meal(f):
        return f["biggest_meal_kcal"] or None

    def late(f):
        return f["last_meal_hour"]  # None when no eaten_at that day

    def indulgent(f):
        # Share of the day's foods flagged limit/avoid (needs ratings).
        return (f["flagged"] / f["rating_known"]) if f["rating_known"] else None

    return [
        ("sugar",     "sugar",              "g",    sugar),
        ("sat_fat",   "saturated fat",      "g",    sat_fat),
        ("fibre",     "fibre",              "g",    fibre),
        ("big_meal",  "biggest meal",       "kcal", big_meal),
        ("late",      "late-night eating",  "h",    late),
        ("indulgent", "less-healthy foods", "%",    indulgent),
    ]


def _split_effects(pairs: list[tuple[float, dict]]) -> tuple[Optional[float], list[dict]]:
    """pairs = [(lever_value, wellness_row)]. Split at the median of the lever
    value, return (threshold, [effect per outcome that clears the guards])."""
    vals = [v for v, _ in pairs]
    thr = median(vals)
    # Strict split; if the median ties a wall of equal values, fall back to > mean.
    high = [w for v, w in pairs if v > thr]
    low = [w for v, w in pairs if v <= thr]
    if len(high) < _MIN_GROUP or len(low) < _MIN_GROUP:
        high = [w for v, w in pairs if v >= thr]
        low = [w for v, w in pairs if v < thr]
    if len(high) < _MIN_GROUP or len(low) < _MIN_GROUP:
        return thr, []

    effects = []
    for key, label, direction in _OUTCOMES:
        hi = [w[key] for w in high if w.get(key) is not None]
        lo = [w[key] for w in low if w.get(key) is not None]
        if len(hi) < _MIN_GROUP or len(lo) < _MIN_GROUP:
            continue
        delta = mean(hi) - mean(lo)
        if abs(delta) < _MIN_ABS_DELTA:
            continue
        # "good" = the change moves the outcome in its healthy direction.
        good = (delta > 0) if direction == "higher" else (delta < 0)
        effects.append({
            "outcome": key,
            "label": label,
            "direction": direction,
            "high_avg": round(mean(hi), 1),
            "low_avg": round(mean(lo), 1),
            "delta": round(delta, 2),
            "n_high": len(hi),
            "n_low": len(lo),
            "good": good,
        })
    effects.sort(key=lambda e: abs(e["delta"]), reverse=True)
    return thr, effects


def compute(conn, on_date: str, window_days: int = 120) -> dict:
    """Return the food-lever → wellness impact report ending at on_date."""
    end = _date.fromisoformat(on_date)
    start = end - timedelta(days=window_days)
    food = _day_food_rows(conn, start.isoformat(), end.isoformat())
    well = _wellness(conn, start.isoformat(), (end + timedelta(days=1)).isoformat())

    # Attach next-morning energy to each wellness row.
    for ds, w in well.items():
        nxt = well.get((_date.fromisoformat(ds) + timedelta(days=1)).isoformat())
        w["energy_next"] = nxt["energy"] if nxt else None

    levers_out = []
    for key, label, unit, pull in _levers():
        pairs = []
        for ds, f in food.items():
            v = pull(f)
            w = well.get(ds)
            if v is None or w is None:
                continue
            pairs.append((float(v), w))
        if len(pairs) < _MIN_GROUP * 2:
            continue
        thr, effects = _split_effects(pairs)
        if not effects:
            continue
        levers_out.append({
            "key": key,
            "label": label,
            "unit": unit,
            "threshold": round(thr, 1),
            "days": len(pairs),
            "effects": effects,
        })

    # Rank levers by their single strongest effect.
    levers_out.sort(key=lambda l: abs(l["effects"][0]["delta"]), reverse=True)

    headline = None
    if levers_out:
        top = levers_out[0]
        e = top["effects"][0]
        verb = "raises" if e["delta"] > 0 else "lowers"
        headline = {
            "lever": top["label"],
            "outcome": e["label"],
            "verb": verb,
            "delta": abs(e["delta"]),
            "good": e["good"],
        }

    return {
        "date": on_date,
        "window_days": window_days,
        "days_analyzed": len(food),
        "levers": levers_out,
        "headline": headline,
        "enough": bool(levers_out),
    }
