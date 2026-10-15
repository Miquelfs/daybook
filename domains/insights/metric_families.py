"""
Metric pairs that are the same thing measured twice (or one is computed from the
other). Correlating them is mechanical, not insight — they're excluded BEFORE
testing (so they don't eat the false-discovery budget) and hidden on display.
Shared by the batch job and the correlations API.
"""

REDUNDANT_FAMILIES: list[set[str]] = [
    {"total_dist_km", "moving_time_hours", "activity_cal", "activity_count",
     "elevation_gain_m", "training_stress", "activity_avg_hr"},        # exercise volume
    {"ctl", "atl", "tsb", "training_stress"},                          # load model from TSS
    {"hr_daytime_avg", "hr_duty_avg", "hr_daytime_peak", "resting_hr"},  # heart-rate windows
    {"stress_avg", "stress_high_min", "stress_peak"},                  # Garmin stress
    {"battery_low", "battery_high", "body_battery_low", "energy_drained"},  # Body Battery
    {"food_kcal", "food_protein", "food_carbs", "food_fat", "food_sugar",
     "biggest_meal_kcal", "meal_count"},                               # intake
    {"flight_block_hours", "flight_night_hours", "duty_day", "hr_duty_avg", "duty_load"},  # duty
    {"fatigue_score", "hrv_avg", "sleep_duration", "duty_load", "stress_avg"},  # fatigue composite inputs
    {"training_readiness", "hrv_avg", "sleep_duration"},               # Garmin readiness inputs
    {"screen_total", "screen_unlocks"},
    {"decoupling_pct", "efficiency_factor"},
    {"vo2max_run", "vo2max_bike"},
    {"temp_mean", "precipitation", "wind_speed_max"},                  # weather among itself
    {"distance_km", "unique_places"},
]


def redundant(a: str, b: str) -> bool:
    if a == b:
        return True
    return any(a in fam and b in fam for fam in REDUNDANT_FAMILIES)


# Outcomes people care about — used to orient a pair ("X → Energy") for display.
OUTCOMES = ["energy", "mood", "stress", "sleep_quality", "sleep_duration", "hrv_avg",
            "resting_hr", "stress_avg", "training_readiness", "body_battery_low", "weight"]
