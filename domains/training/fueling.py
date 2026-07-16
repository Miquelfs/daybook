"""
Deterministic fueling engine — the "fourth discipline".

Encodes the Jeukendrup / Challenge Family race-nutrition guidance as pure
functions: per-session carb/fluid/sodium targets, the gut-training ramp toward
race carb intake, sweat-rate maths, and hydration targets. No LLM — these are
evidence-based rules an athlete can trust and rehearse.
"""

from typing import Optional


# ── Gut training ─────────────────────────────────────────────────────────────

def gut_training_target(weeks_to_race: Optional[int]) -> int:
    """
    Carb-intake target (g/h) for the week's key long session. Ramps 60→90 g/h
    over the final 10 weeks so the gut adapts to race-day intake.
    """
    if weeks_to_race is None:
        return 60
    return int(min(90, 60 + 3 * max(0, 10 - weeks_to_race)))


def _is_gut_training_session(duration_min: int, discipline: str) -> bool:
    d = duration_min or 0
    if discipline == "brick" and d >= 120:
        return True
    if discipline == "cycling" and d >= 120:
        return True
    if discipline == "running" and d >= 80:
        return True
    return d > 150


# ── Hydration ────────────────────────────────────────────────────────────────

def _round50(x: float) -> int:
    return int(round(x / 50.0) * 50)


def hydration_ml_h(sweat_rate_l_h: Optional[float], temp_hint: Optional[str]) -> int:
    """Target fluid intake per hour. Uses a measured sweat rate when available
    (drink ~80% of losses, capped 1000ml/h), else a temperature-based default."""
    if sweat_rate_l_h and sweat_rate_l_h > 0:
        return min(1000, _round50(sweat_rate_l_h * 1000 * 0.8))
    return {"hot": 800, "humid": 850, "warm": 650, "cool": 500, "indoor": 750}.get(temp_hint or "", 600)


def sweat_rate(weight_pre_kg: float, weight_post_kg: float, fluid_ml: float,
               urine_ml: float, duration_min: float) -> Optional[float]:
    """Sweat rate in L/h. sweat = weight lost + fluid drunk − urine."""
    if not duration_min or duration_min <= 0:
        return None
    weight_loss_l = (weight_pre_kg or 0) - (weight_post_kg or 0)   # kg ≈ L
    sweat_l = weight_loss_l + (fluid_ml or 0) / 1000.0 - (urine_ml or 0) / 1000.0
    rate = sweat_l / (duration_min / 60.0)
    return round(max(0.0, rate), 2)


def hydration_target(sweat_rate_l_h: Optional[float], weight_kg: float = 85.0,
                     half_distance: bool = True) -> dict:
    """
    Race hydration target (ml/h) that keeps body-weight loss under ~2–3%.
    Adds a fuel-loss correction (0.5 kg half / 1.0 kg full) since some weight
    loss on course is burned fuel, not dehydration.
    """
    accept_loss_kg = 0.02 * weight_kg + (0.5 if half_distance else 1.0)
    if not sweat_rate_l_h or sweat_rate_l_h <= 0:
        return {"ml_per_h": 600, "acceptable_loss_kg": round(accept_loss_kg, 1),
                "note": "Estimate — do a sweat test to personalise."}
    # Drink ~80% of sweat losses (rarely feasible to fully replace at high rates)
    ml = min(1000, _round50(sweat_rate_l_h * 1000 * 0.8))
    return {"ml_per_h": ml, "sweat_rate_l_h": sweat_rate_l_h,
            "acceptable_loss_kg": round(accept_loss_kg, 1),
            "note": "Drink to thirst around this rate; don't over-drink."}


# ── Per-session targets ──────────────────────────────────────────────────────

def session_fuel_targets(duration_min: int, zone: str, discipline: str,
                         weeks_to_race: Optional[int] = None,
                         sweat_rate_l_h: Optional[float] = None,
                         temp_hint: Optional[str] = None,
                         weight_kg: float = 85.0) -> dict:
    """
    Fueling prescription for a single session: during / pre / post + a
    gut-training flag for qualifying long sessions.
    """
    dur = duration_min or 0
    gut = None

    # Base during-carbs by duration (Jeukendrup)
    if dur < 60:
        carbs_h = 0
    elif dur < 90:
        carbs_h = 30
    elif dur <= 150:
        carbs_h = 60
    else:
        carbs_h = 60  # provisional; overwritten by gut-training below

    if _is_gut_training_session(dur, discipline):
        target = gut_training_target(weeks_to_race)
        carbs_h = target
        gut = {"is_target_session": True, "target_carbs_g_h": target,
               "note": f"Gut-training session — practise {target} g/h with race products."}

    fluid_h = hydration_ml_h(sweat_rate_l_h, temp_hint)
    sodium_h = 0
    if dur >= 90:
        sodium_h = 500 if temp_hint in ("hot", "humid") else 300

    during = {
        "carbs_g_h": carbs_h,
        "fluid_ml_h": fluid_h,
        "sodium_mg_h": sodium_h,
        "note": ("Water only — no fuel needed." if carbs_h == 0
                 else f"{carbs_h} g carbs/h from ~{max(1, round(carbs_h / 25))} gel(s) or drink; sip {fluid_h} ml/h."),
    }

    pre = None
    if dur >= 75 or zone in ("Z4", "Z5"):
        pre_carbs = round((1.0 if dur >= 120 else 0.5) * weight_kg)
        pre = {"carbs_g": pre_carbs, "timing": "1–3 h before",
               "note": "Low fibre/fat; +25 g gel 10 min before if it's a long/hard one."}

    post = None
    if dur >= 60 or zone in ("Z3", "Z4", "Z5"):
        post = {"carbs_g": round(1.0 * weight_kg), "protein_g": 25, "window": "within 1 h",
                "note": "Then ~1 g/kg/h carbs for 4 h and 20–25 g protein every 3 h."}

    return {"during": during, "pre": pre, "post": post, "gut_training": gut, "duration_min": dur}
