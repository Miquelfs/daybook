"""
Race-day nutrition plan builder — turns the athlete's weight, sweat rate, trained
carb intake and target splits into a concrete, rehearsable fuelling plan:
carb-load days, race breakfast, pre-start, per-leg hourly feeds, caffeine, and
hydration. Pure functions; the result is stored as JSON and editable by the user.

Science base: Jeukendrup / Challenge Family guide.
"""

from typing import Optional

# 70.3 cut-offs (minutes) at Challenge Barcelona: swim+T1, bike, T2+run
CUTOFF_SWIM_T1 = 70
CUTOFF_BIKE = 230
CUTOFF_T2_RUN = 160

# Default leg splits for a 5:30 finish (sum 330 min); scaled to the athlete's target
DEFAULT_SPLITS_530 = {"swim_min": 38, "t1_min": 5, "bike_min": 168, "t2_min": 4, "run_min": 115}


def _parse_hms_min(t: Optional[str]) -> Optional[int]:
    if not t:
        return None
    parts = t.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 60 + int(parts[1]) + round(int(parts[2]) / 60)
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return None
    return None


def _fmt_min(m: int) -> str:
    return f"{m // 60}:{m % 60:02d}"


def _splits(target_time: Optional[str], override: Optional[dict]) -> dict:
    if override:
        return override
    total = _parse_hms_min(target_time) or 330
    scale = total / 330.0
    return {k: max(1, round(v * scale)) for k, v in DEFAULT_SPLITS_530.items()}


def _leg_schedule(duration_min: int, carbs_g_h: int, every_min: int, start_min: int = 20) -> list:
    """Evenly spaced feeds hitting the hourly carb target."""
    if duration_min <= 0 or carbs_g_h <= 0:
        return []
    feeds = []
    per_feed = round(carbs_g_h * every_min / 60.0)
    t = start_min
    while t < duration_min - 5:
        feeds.append({"at": _fmt_min(t), "carbs_g": per_feed, "item": "gel + water"})
        t += every_min
    return feeds


def build_race_plan(goal_row, weight_kg: float = 85.0,
                    race_sweat_rate_l_h: Optional[float] = None,
                    trained_carbs_g_h: Optional[int] = None,
                    target_splits: Optional[dict] = None) -> dict:
    """Assemble the full race-day plan JSON."""
    target_time = goal_row["target_time"] if "target_time" in goal_row.keys() else None
    splits = _splits(target_time, target_splits)

    # Carb intake target on the bike: what the gut has been trained to take (cap 90)
    bike_carbs_h = min(90, trained_carbs_g_h or 80)
    run_carbs_h = min(70, max(50, bike_carbs_h - 15))  # a touch lower running

    # Hydration from the hottest measured sweat rate (fallback estimate)
    from domains.training import fueling
    hyd = fueling.hydration_target(race_sweat_rate_l_h, weight_kg=weight_kg, half_distance=True)
    fluid_ml_h = hyd["ml_per_h"]

    # ── Carb loading (2–3 days out) ──
    load_g = round(8 * weight_kg)
    carb_load = {
        "target_g_per_day": load_g,
        "g_per_kg": 8,
        "days": [
            {"day": "D-3", "note": f"~{load_g} g carbs. Normal training food, just carb-forward."},
            {"day": "D-2", "note": f"~{load_g} g carbs. Rice, pasta, potatoes, fruit; keep fat/protein moderate."},
            {"day": "D-1", "note": f"~{load_g} g carbs, LOW fibre. White rice/bread, ripe banana, honey, juice. Avoid milk & high-fibre veg."},
        ],
        "warning": "Carb-load is not overeating — same calories, shifted to carbs.",
    }

    # ── Race breakfast (T-3h30) ──
    bfast_g = round(2 * weight_kg)
    breakfast = {
        "timing": "3–4 h before start",
        "carbs_g": bfast_g,
        "examples": ["2 bagels + honey", "large ripe banana", "500 ml pulp-free juice", "white rice + jam"],
        "note": "Low fibre/fat/protein. Practise this exact breakfast in training.",
    }

    pre_start = {
        "timing": "10 min before start",
        "items": ["1 gel (25 g carbs)", "150–200 ml water"],
        "note": "This becomes fuel for the swim — most is absorbed during the leg.",
    }

    # ── Legs ──
    bike_min, run_min = splits["bike_min"], splits["run_min"]
    bike_feeds = _leg_schedule(bike_min, bike_carbs_h, every_min=30)
    run_feeds = _leg_schedule(run_min, run_carbs_h, every_min=20)
    bike_total = sum(f["carbs_g"] for f in bike_feeds)
    run_total = sum(f["carbs_g"] for f in run_feeds)

    legs = {
        "swim": {"duration_min": splits["swim_min"],
                 "plan": "No intake in the water — the pre-start gel covers it. Settle, sight, draft."},
        "bike": {"duration_min": bike_min, "carbs_g_h": bike_carbs_h, "fluid_ml_h": fluid_ml_h,
                 "total_carbs_g": bike_total,
                 "note": f"Take the bulk of your carbs here — gut can absorb most at {bike_carbs_h} g/h. Alternate gel + bottle.",
                 "schedule": bike_feeds},
        "run": {"duration_min": run_min, "carbs_g_h": run_carbs_h, "fluid_ml_h": max(400, fluid_ml_h - 150),
                "total_carbs_g": run_total,
                "note": "Harder to absorb running — smaller, more frequent. Cola/aid-station carbs are fair game late.",
                "schedule": run_feeds},
    }

    # ── Caffeine (3 mg/kg total) ──
    caff_total = round(3 * weight_kg)
    caffeine = {
        "total_mg": caff_total,
        "plan": [
            {"when": "Pre-start", "mg": round(caff_total * 0.4), "source": "caffeinated gel"},
            {"when": "Bike hour 2", "mg": round(caff_total * 0.4), "source": "caffeinated gel"},
            {"when": "Run start", "mg": caff_total - 2 * round(caff_total * 0.4), "source": "cola / gel"},
        ],
        "note": "Practise the dose in training — too much causes GI upset and jitters.",
    }

    # ── Cut-off sanity checks ──
    warnings = []
    if splits["swim_min"] + splits["t1_min"] > CUTOFF_SWIM_T1:
        warnings.append(f"Swim+T1 ({splits['swim_min'] + splits['t1_min']}min) exceeds the {CUTOFF_SWIM_T1}min cut-off.")
    if splits["bike_min"] > CUTOFF_BIKE:
        warnings.append(f"Bike ({splits['bike_min']}min) exceeds the {CUTOFF_BIKE}min cut-off.")
    if splits["t2_min"] + splits["run_min"] > CUTOFF_T2_RUN:
        warnings.append(f"T2+run ({splits['t2_min'] + splits['run_min']}min) exceeds the {CUTOFF_T2_RUN}min cut-off.")

    total_min = sum(splits.values())
    total_carbs = bike_total + run_total + bfast_g + 25
    return {
        "weight_kg": weight_kg,
        "target_time": target_time,
        "projected_finish": _fmt_min(total_min),
        "splits": {
            "swim": _fmt_min(splits["swim_min"]), "t1": _fmt_min(splits["t1_min"]),
            "bike": _fmt_min(splits["bike_min"]), "t2": _fmt_min(splits["t2_min"]),
            "run": _fmt_min(splits["run_min"]),
        },
        "carb_load": carb_load,
        "breakfast": breakfast,
        "pre_start": pre_start,
        "legs": legs,
        "caffeine": caffeine,
        "hydration": {"bike_ml_h": fluid_ml_h, "run_ml_h": max(400, fluid_ml_h - 150),
                      "sweat_rate_l_h": race_sweat_rate_l_h, "acceptable_loss_kg": hyd["acceptable_loss_kg"],
                      "note": hyd["note"]},
        "totals": {"race_carbs_g": total_carbs, "bike_carbs_g_h": bike_carbs_h, "run_carbs_g_h": run_carbs_h},
        "recovery": {
            "title": "Post-race & recovery week",
            "immediate": "Rehydrate; ~1 g/kg/h carbs for 4 h + 20–25 g protein within the hour, then every 3 h.",
            "week": "1–2 weeks very easy. Sleep, eat well, let the adaptations bank. Then rebuild.",
        },
        "warnings": warnings,
        "contingency": [
            "GI trouble: back off intensity briefly, sip water, let the stomach empty before more carbs.",
            "Dropped bottle: aid stations carry water/cola — don't panic, adjust the plan on the fly.",
            "Hot day: prioritise fluid + sodium; carbs can dip slightly if the stomach protests.",
        ],
    }
