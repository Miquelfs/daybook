"""
Recovery / illness flag — combines the signals the CIRQA (and existing sync)
provide into a single "you might be getting sick / overreached" cue:
elevated resting HR vs baseline + unbalanced HRV + a poor overnight Body Battery
recharge + a short night's sleep (+ skin-temperature spike when available).
"""

import json
from typing import Optional

# Nights shorter than this leave you under-recovered regardless of the rest.
SHORT_SLEEP_SECONDS = 5 * 3600 + 30 * 60   # 5h30m


def hrv_direction(conn, date: str, row, which: str = "night") -> Optional[str]:
    """'low' / 'high' / 'normal' — where last night's HRV (`which="week"`: the 7-day average) sits
    against your normal range.

    Garmin calls HRV "unbalanced" when it leaves your baseline in EITHER direction; above it
    (after a rest week, a deload, a trip's easy days) is the opposite of a warning. The range is
    Garmin's own baseline (hrvSummary.baseline.balancedLow/Upper), else your 30-night mean ± 1 SD."""
    if row is None:
        return None
    first, second = ("last_night_avg", "weekly_avg") if which == "night" else ("weekly_avg", "last_night_avg")
    hrv = row[first] if row[first] is not None else row[second]
    if hrv is None:
        return None
    lo = hi = None
    try:
        raw = json.loads(row["raw_payload"] or "{}") or {}
        base = (raw.get("hrvSummary") or raw).get("baseline") or {}
        lo, hi = base.get("balancedLow"), base.get("balancedUpper")
    except (ValueError, TypeError, AttributeError, IndexError, KeyError):
        pass
    if lo is None or hi is None:
        vals = [r[0] for r in conn.execute(
            "SELECT last_night_avg FROM hrv WHERE date < ? AND last_night_avg IS NOT NULL ORDER BY date DESC LIMIT 30",
            (date,))]
        if len(vals) < 7:
            return None
        m = sum(vals) / len(vals)
        sd = (sum((v - m) ** 2 for v in vals) / len(vals)) ** 0.5
        lo, hi = m - sd, m + sd
    return "low" if hrv < lo else "high" if hrv > hi else "normal"


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

    try:
        hrv = conn.execute("SELECT status, last_night_avg, weekly_avg, raw_payload FROM hrv WHERE date=?",
                           (date,)).fetchone()
    except Exception:                                   # noqa: BLE001 — older hrv table without raw_payload
        hrv = None
    hrv_status = hrv["status"] if hrv else None
    direction = hrv_direction(conn, date, hrv)
    week = hrv_direction(conn, date, hrv, "week")
    st = (hrv_status or "").lower()
    # Garmin's status judges the 7-DAY average: "unbalanced" is also *above* your range, and after a hard
    # week it stays "unbalanced" for days while last night is already back. Warn only when last night is down.
    night_ok = direction in ("normal", "high")
    if direction == "low" or (st in ("low", "poor", "unbalanced") and not night_ok and week != "high"):
        reasons.append("HRV below your normal range" if direction == "low" else f"HRV {st}")
        score += 1

    w = conn.execute("SELECT bb_min, bb_max, skin_temp_dev FROM wellness_daily WHERE date=?", (date,)).fetchone()
    bb_low = w["bb_min"] if w else None
    bb_high = w["bb_max"] if w else None
    # A bottomed-out Body Battery (bb_min) is normal daily drain — it happens
    # almost every day and is not a recovery signal on its own. What matters for
    # recovery is a poor overnight *recharge*: the Battery never climbed back up,
    # i.e. a low daily peak (bb_max).
    if bb_high is not None and bb_high <= 50:
        reasons.append(f"Body Battery only recharged to {bb_high}")
        score += 1
    skin_dev = w["skin_temp_dev"] if w else None
    if skin_dev is not None and skin_dev >= 1.0:
        reasons.append(f"skin temp +{skin_dev}°C")
        score += 1

    sleep_row = conn.execute("SELECT duration_seconds FROM sleep WHERE date=?", (date,)).fetchone()
    sleep_secs = sleep_row["duration_seconds"] if sleep_row else None
    if sleep_secs is not None and sleep_secs < SHORT_SLEEP_SECONDS:
        h, m = divmod(round(sleep_secs / 60), 60)
        reasons.append(f"only slept {h}h {m:02d}m")
        score += 1

    status = "flag" if score >= 2 else ("watch" if score == 1 else "ok")
    return {
        "date": date,
        "status": status,               # ok | watch | flag
        "reasons": reasons,
        "rhr_delta": rhr_delta,
        "hrv_status": hrv_status,
        "hrv_direction": direction,     # last night: low | high | normal | None
        "hrv_week_direction": week,     # the 7-day average Garmin's status is about
        "body_battery_low": bb_low,
        "body_battery_high": bb_high,
        "skin_temp_dev": skin_dev,
    }
