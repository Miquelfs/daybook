"""
One night, in full — what the morning brief's Sleep and HRV open.

Garmin's sleep payload (sleep.raw_payload) holds the whole night, not just its totals:
  sleepLevels                        the stage timeline (activityLevel 0 deep · 1 light · 2 REM · 3 awake), GMT strings
  sleepHeartRate · hrvData · sleepStress · sleepBodyBattery     samples {value, startGMT epoch ms}
  wellnessEpochRespirationDataDTOList                           {respirationValue, startTimeGMT epoch ms}
  dailySleepDTO.sleepScores          each part of the score with Garmin's verdict and optimal range
  dailySleepDTO.sleepNeed            what Garmin thinks you needed (minutes)
Everything is placed on one axis: minutes since you fell asleep (bed_min = that clock time),
so the hypnogram and every curve line up, and on a trip the clock is the local one.

HRV comes from the hrv table (Garmin's HRV status): last night, the 7-day average its status
is about, your baseline range, and 6 weeks of history. `levers` is what moves *your* HRV:
the morning after a drink, a hard day, a rest day, a flying day, a long night, an early bed —
each against the other mornings, only when both sides have enough nights to say anything.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timedelta, timezone

from domains.health import sleep_view as sv

STAGES = {0: "deep", 1: "light", 2: "rem", 3: "awake"}
USUAL_NIGHTS = 30
HISTORY_DAYS = 42
LEVER_DAYS = 365
LEVER_MIN_N = 5
HARD_TSS = 80
LONG_NIGHT_S = 7.5 * 3600
EARLY_BED = "23:00"

SCORE_PARTS = [  # key in dailySleepDTO.sleepScores → label, unit of value
    ("totalDuration", "Duration"), ("deepPercentage", "Deep"), ("remPercentage", "REM"),
    ("lightPercentage", "Light"), ("stress", "Sleep stress"), ("awakeCount", "Awakenings"),
    ("restlessness", "Restlessness"),
]


def _ms(v) -> float | None:
    """Epoch ms from Garmin's ms numbers or GMT strings ("2026-11-19T22:41:00.0")."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "").split(".")[0])
    except ValueError:
        return None
    return d.replace(tzinfo=timezone.utc).timestamp() * 1000


def _series(items, t0: float, key_v="value", key_t="startGMT", every_min: int = 1) -> list[dict]:
    """[{m: minutes since sleep start, v}] — at most one point per `every_min`."""
    out, last = [], None
    for it in items or []:
        if not isinstance(it, dict):
            continue
        t, v = _ms(it.get(key_t)), it.get(key_v)
        if t is None or v is None or (isinstance(v, (int, float)) and v < 0):
            continue
        m = round((t - t0) / 60000)
        if last is not None and m - last < every_min:
            continue
        out.append({"m": m, "v": round(float(v), 1)})
        last = m
    return out


def _timeline(levels, t0: float) -> list[dict]:
    out = []
    for lv in levels or []:
        a, b = _ms(lv.get("startGMT")), _ms(lv.get("endGMT"))
        st = STAGES.get(int(lv.get("activityLevel", -1))) if lv.get("activityLevel") is not None else None
        if a is None or b is None or st is None or b <= a:
            continue
        out.append({"from": round((a - t0) / 60000), "to": round((b - t0) / 60000), "stage": st})
    return out


def _words(code) -> str | None:
    """POSITIVE_LONG_AND_DEEP → 'Long and deep'."""
    if not code or not isinstance(code, str):
        return None
    parts = code.lower().split("_")
    if parts and parts[0] in ("positive", "negative", "neutral"):
        parts = parts[1:]
    s = " ".join(parts).strip()
    return s[:1].upper() + s[1:] if s else None


def _score_parts(dto: dict) -> list[dict]:
    sc = dto.get("sleepScores") or {}
    if not isinstance(sc, dict):
        return []
    out = []
    for key, label in SCORE_PARTS:
        p = sc.get(key)
        if not isinstance(p, dict):
            continue
        q = (p.get("qualifierKey") or "").lower() or None
        out.append({"key": key, "label": label, "value": p.get("value"), "qualifier": q,
                    "optimal": [p.get("optimalStart"), p.get("optimalEnd")]
                    if p.get("optimalStart") is not None and p.get("optimalEnd") is not None else None})
    return out


def night_detail(conn: sqlite3.Connection, d: str) -> dict | None:
    rows = sv.nights(conn, d, d)
    if not rows:
        return None
    n = rows[0]
    raw_row = conn.execute("SELECT raw_payload FROM sleep WHERE date=?", (d,)).fetchone()
    try:
        raw = json.loads((raw_row[0] if raw_row else None) or "{}") or {}
    except (ValueError, TypeError):
        raw = {}
    dto = raw.get("dailySleepDTO") or {}
    t0 = _ms(dto.get("sleepStartTimestampGMT"))
    out = {**n, "bed_min": sv._mins(n["bed"]) if n.get("bed") else None,
           "timeline": [], "series": {}, "score_parts": _score_parts(dto),
           "feedback": _words(dto.get("sleepScoreFeedback")), "insight": _words(dto.get("sleepScoreInsight")),
           "need_s": None, "lowest_spo2": dto.get("lowestSpO2Value"),
           "respiration_range": [dto.get("lowestRespirationValue"), dto.get("highestRespirationValue")]
           if dto.get("lowestRespirationValue") is not None else None}
    need = dto.get("sleepNeed") or {}
    if isinstance(need, dict) and need.get("actual"):
        out["need_s"] = int(need["actual"]) * 60
    if t0 is not None:
        out["timeline"] = _timeline(raw.get("sleepLevels"), t0)
        out["series"] = {
            "hr": _series(raw.get("sleepHeartRate"), t0, every_min=2),
            "hrv": _series(raw.get("hrvData"), t0),
            "stress": _series(raw.get("sleepStress"), t0, every_min=3),
            "body_battery": _series(raw.get("sleepBodyBattery"), t0, every_min=3),
            "respiration": _series(raw.get("wellnessEpochRespirationDataDTOList"), t0,
                                   key_v="respirationValue", key_t="startTimeGMT", every_min=2),
        }
        out["end_m"] = round((_ms(dto.get("sleepEndTimestampGMT")) - t0) / 60000) \
            if _ms(dto.get("sleepEndTimestampGMT")) else None
    hrv = hrv_detail(conn, d)
    if not out["series"].get("hrv") and hrv and hrv["readings"] and t0 is not None:
        out["series"]["hrv"] = _series(hrv["readings"], t0, key_v="hrvValue", key_t="readingTimeGMT")
    if hrv:
        hrv.pop("readings", None)

    start = (date.fromisoformat(d) - timedelta(days=USUAL_NIGHTS)).isoformat()
    before = (date.fromisoformat(d) - timedelta(days=1)).isoformat()
    usual = sv.summarise(sv.nights(conn, start, before), before)
    prev = conn.execute("SELECT MAX(date) FROM sleep WHERE date < ? AND duration_seconds > 0", (d,)).fetchone()[0]
    nxt = conn.execute("SELECT MIN(date) FROM sleep WHERE date > ? AND duration_seconds > 0", (d,)).fetchone()[0]
    return {
        "date": d, "need_h": sv.NEED_H, "night": out,
        "usual": {k: usual.get(k) for k in ("nights", "asleep_s", "in_bed_s", "score", "bed", "wake", "deep_pct",
                                          "rem_pct", "light_pct", "awake_pct", "resting_hr", "hrv", "respiration",
                                          "stress", "body_battery", "awakenings", "restless")},
        "hrv": hrv, "prev": prev, "next": nxt,
    }


# ── HRV ──────────────────────────────────────────────────────────────────────

def _hrv_raw(payload) -> dict:
    try:
        r = json.loads(payload or "{}") or {}
    except (ValueError, TypeError):
        return {}
    return r if isinstance(r, dict) else {}


def _reading(direction: str | None, week: str | None) -> dict:
    """What last night's HRV says about recovery, in a headline and a line."""
    if direction == "low":
        return {"tone": "low", "headline": "Below your range: not recovered yet",
                "detail": "Your nervous system is still dealing with something: hard training, a short or late night, "
                          "alcohol, travel, or a cold starting. Keep today easy and sleep early. One low night is noise; "
                          "two or three in a row is the signal."}
    if direction == "high":
        return {"tone": "good", "headline": "Above your range: well rested",
                "detail": "Usually what easy days and good sleep look like. If your resting HR is up or you feel off "
                          "at the same time, read it as stress rather than freshness."}
    if direction == "normal" and week == "low":
        return {"tone": "ok", "headline": "Back in your range: the week is still catching up",
                "detail": "Last night recovered. Garmin's status looks at the 7-day average, which still carries the hard "
                          "days before, so it can say \"unbalanced\" for a few more mornings. Train as planned, but "
                          "don't stack hard days until the average is back too."}
    if direction == "normal":
        return {"tone": "good", "headline": "In your range: recovered",
                "detail": "Your body has absorbed recent training. A good morning for the session you planned."}
    return {"tone": None, "headline": "No HRV for this night", "detail": "Wear the watch to bed to get one."}


def hrv_detail(conn: sqlite3.Connection, d: str) -> dict | None:
    try:
        row = conn.execute("SELECT status, last_night_avg, weekly_avg, raw_payload FROM hrv WHERE date=?",
                           (d,)).fetchone()
    except sqlite3.OperationalError:
        return None
    if row is None or row["last_night_avg"] is None:
        return None
    from domains.health.recovery import hrv_direction
    raw = _hrv_raw(row["raw_payload"])
    summ = raw.get("hrvSummary") or {}
    base = summ.get("baseline") or {}
    direction, week = hrv_direction(conn, d, row), hrv_direction(conn, d, row, "week")
    start = (date.fromisoformat(d) - timedelta(days=HISTORY_DAYS - 1)).isoformat()
    history = []
    for r in conn.execute("SELECT date, last_night_avg, weekly_avg, raw_payload FROM hrv WHERE date BETWEEN ? AND ? "
                          "ORDER BY date", (start, d)):
        b = (_hrv_raw(r["raw_payload"]).get("hrvSummary") or {}).get("baseline") or {}
        history.append({"date": r["date"], "night": r["last_night_avg"], "week": r["weekly_avg"],
                        "lo": b.get("balancedLow"), "hi": b.get("balancedUpper")})
    return {
        "night": row["last_night_avg"], "week": row["weekly_avg"], "status": (row["status"] or "").lower() or None,
        "high_5min": summ.get("lastNight5MinHigh"),
        "range": [base.get("balancedLow"), base.get("balancedUpper")]
        if base.get("balancedLow") is not None and base.get("balancedUpper") is not None else None,
        "low_below": base.get("lowUpper"),
        "direction": direction, "week_direction": week,
        "reading": _reading(direction, week),
        "history": history,
        "levers": levers(conn, d),
        "readings": raw.get("hrvReadings") or [],
    }


def _tag_days(conn, slug: str, start: str, end: str) -> set[str]:
    try:
        return {r[0] for r in conn.execute(
            "SELECT dt.date FROM day_tags dt JOIN tags t ON t.id = dt.tag_id WHERE t.slug=? AND dt.date BETWEEN ? AND ?",
            (slug, start, end))}
    except sqlite3.OperationalError:
        return set()


def levers(conn: sqlite3.Connection, d: str, days: int = LEVER_DAYS) -> list[dict]:
    """What moves your HRV: the mean morning HRV with vs without each thing (on the day before, or
    that night), over the last year. Only levers where both sides have ≥ LEVER_MIN_N mornings."""
    end = d
    start = (date.fromisoformat(d) - timedelta(days=days)).isoformat()
    hrv = {r[0]: r[1] for r in conn.execute(
        "SELECT date, last_night_avg FROM hrv WHERE date BETWEEN ? AND ? AND last_night_avg IS NOT NULL", (start, end))}
    if len(hrv) < 2 * LEVER_MIN_N:
        return []
    eve = lambda x: (date.fromisoformat(x) - timedelta(days=1)).isoformat()   # noqa: E731
    p0 = (date.fromisoformat(start) - timedelta(days=1)).isoformat()
    alcohol = _tag_days(conn, "alcohol", p0, end)
    try:
        tss = {r[0]: r[1] or 0 for r in conn.execute(
            "SELECT date, daily_tss FROM training_load_daily WHERE sport='combined' AND date BETWEEN ? AND ?", (p0, end))}
    except sqlite3.OperationalError:
        tss = {}
    try:
        flying = {r[0] for r in conn.execute(
            "SELECT date FROM roster WHERE duty_type='flying_duty' AND date BETWEEN ? AND ?", (p0, end))}
        has_roster = bool(conn.execute("SELECT 1 FROM roster LIMIT 1").fetchone())
    except sqlite3.OperationalError:
        flying, has_roster = set(), False
    nights = {n["date"]: n for n in sv.nights(conn, start, end)}

    def bed_before(n) -> bool | None:
        if not n or not n.get("bed"):
            return None
        return (sv._mins(n["bed"]) - 12 * 60) % 1440 < (sv._mins(EARLY_BED) - 12 * 60) % 1440

    tests = [
        ("alcohol", "After a drink (alcohol tag the day before)", lambda x: eve(x) in alcohol),
        ("hard", f"After a hard training day (≥ {HARD_TSS} TSS)",
         lambda x: (tss.get(eve(x), 0) >= HARD_TSS) if tss else None),
        ("rest", "After a rest day (no training)", lambda x: (tss.get(eve(x), 0) == 0) if tss else None),
        ("flying", "After a flying day", lambda x: (eve(x) in flying) if has_roster else None),
        ("long", "After 7½ h or more asleep",
         lambda x: (nights[x]["asleep_s"] or 0) >= LONG_NIGHT_S if x in nights and nights[x]["asleep_s"] else None),
        ("early", f"In bed before {EARLY_BED}", lambda x: bed_before(nights.get(x))),
    ]
    out = []
    for key, label, test in tests:
        yes, no = [], []
        for x, v in hrv.items():
            t = test(x)
            if t is None:
                continue
            (yes if t else no).append(v)
        if len(yes) < LEVER_MIN_N or len(no) < LEVER_MIN_N:
            continue
        my, mn = sum(yes) / len(yes), sum(no) / len(no)
        out.append({"key": key, "label": label, "with": round(my, 1), "without": round(mn, 1),
                    "delta": round(my - mn, 1), "n_with": len(yes), "n_without": len(no),
                    "tonight": test(d)})
    return sorted(out, key=lambda l: -abs(l["delta"]))
