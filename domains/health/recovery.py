"""
Recovery / illness flag — combines the signals the CIRQA (and existing sync)
provide into a single "you might be getting sick / overreached" cue:
elevated resting HR vs baseline + unbalanced HRV + a bottomed-out Body Battery
(+ skin-temperature spike when available).
"""

from typing import Optional


def recovery_flag(conn, date: str) -> dict:
    reasons: list[str] = []
    score = 0

    rhr_row = conn.execute("SELECT resting_hr FROM daily_stats WHERE date=?", (date,)).fetchone()
    base = conn.execute(
        "SELECT AVG(resting_hr) AS a FROM (SELECT resting_hr FROM daily_stats "
        "WHERE date < ? AND resting_hr IS NOT NULL ORDER BY date DESC LIMIT 14)",
        (date,),
    ).fetchone()
    rhr_delta: Optional[float] = None
    if rhr_row and rhr_row["resting_hr"] and base and base["a"]:
        rhr_delta = round(rhr_row["resting_hr"] - base["a"], 1)
        if rhr_delta >= 5:
            reasons.append(f"resting HR +{rhr_delta} vs 14-day avg")
            score += 1

    hrv = conn.execute("SELECT status FROM hrv WHERE date=?", (date,)).fetchone()
    hrv_status = hrv["status"] if hrv else None
    if hrv_status and hrv_status.lower() in ("unbalanced", "low", "poor"):
        reasons.append(f"HRV {hrv_status.lower()}")
        score += 1

    w = conn.execute("SELECT bb_min, skin_temp_dev FROM wellness_daily WHERE date=?", (date,)).fetchone()
    bb_low = w["bb_min"] if w else None
    if bb_low is not None and bb_low <= 20:
        reasons.append(f"Body Battery bottomed at {bb_low}")
        score += 1
    skin_dev = w["skin_temp_dev"] if w else None
    if skin_dev is not None and skin_dev >= 1.0:
        reasons.append(f"skin temp +{skin_dev}°C")
        score += 1

    status = "flag" if score >= 2 else ("watch" if score == 1 else "ok")
    return {
        "date": date,
        "status": status,               # ok | watch | flag
        "reasons": reasons,
        "rhr_delta": rhr_delta,
        "hrv_status": hrv_status,
        "body_battery_low": bb_low,
        "skin_temp_dev": skin_dev,
    }
