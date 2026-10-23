"""
Weight, read properly: the scale bounces ±1 kg day to day (water, glycogen,
salt), so the useful signal is the trend underneath it.

  trend     time-aware exponential average of the weigh-ins (τ = 10 days —
            gaps between weigh-ins are fine, the weight of a reading decays
            with the days since the previous one)
  rate      kg/week, least-squares slope of the weigh-ins in the last 6 weeks
  goal      the active race goal's target weight + date, as a straight glide
            path from the weigh-in at the start of the plan
  verdict   trend vs where the glide path says you should be today
  W/kg      current FTP over the trend weight, and at the target weight
"""

from __future__ import annotations

import math
from datetime import date

TAU_DAYS = 10.0
RATE_WINDOW_DAYS = 42
ON_TRACK_KG = 0.5


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def trend(entries: list[dict]) -> list[float]:
    out: list[float] = []
    for i, e in enumerate(entries):
        if i == 0:
            out.append(e["weight_kg"])
            continue
        gap = max(1, (_d(e["date"]) - _d(entries[i - 1]["date"])).days)
        a = 1 - math.exp(-gap / TAU_DAYS)
        out.append(out[-1] + a * (e["weight_kg"] - out[-1]))
    return [round(v, 2) for v in out]


def rate_kg_week(entries: list[dict], today: date) -> float | None:
    """Slope of the last 6 weeks of weigh-ins; needs 3+ readings over 10+ days."""
    pts = [((_d(e["date"]) - today).days, e["weight_kg"]) for e in entries
           if (today - _d(e["date"])).days <= RATE_WINDOW_DAYS]
    if len(pts) < 3 or pts[-1][0] - pts[0][0] < 10:
        return None
    mx = sum(x for x, _ in pts) / len(pts)
    my = sum(y for _, y in pts) / len(pts)
    sxx = sum((x - mx) ** 2 for x, _ in pts)
    if sxx == 0:
        return None
    return round(sum((x - mx) * (y - my) for x, y in pts) / sxx * 7, 2)


def glide(start: tuple[str, float], target: tuple[str, float], on: str) -> float:
    (d0, w0), (d1, w1) = start, target
    span = (_d(d1) - _d(d0)).days
    if span <= 0:
        return w1
    f = min(1.0, max(0.0, (_d(on) - _d(d0)).days / span))
    return round(w0 + (w1 - w0) * f, 2)


def analyse(entries: list[dict], goal: dict | None, ftp_w: float | None, today: date | None = None) -> dict:
    """entries sorted by date: [{"date", "weight_kg"}]. goal: {"start_date","start_kg","target_kg","target_date"}."""
    today = today or date.today()
    if not entries:
        return {"trend": [], "rate_kg_week": None, "goal": None, "wkg": None, "days_since": None}
    tr = trend(entries)
    now = tr[-1]
    rate = rate_kg_week(entries, today)
    out: dict = {
        "trend": tr,
        "trend_now": now,
        "rate_kg_week": rate,
        "days_since": (today - _d(entries[-1]["date"])).days,
        "goal": None,
        "wkg": None,
    }
    if goal and goal.get("target_kg") and goal.get("target_date"):
        start = (goal["start_date"], goal["start_kg"])
        tgt = (goal["target_date"], goal["target_kg"])
        # judged at the last weigh-in — a gap in weighing isn't falling behind
        should = glide(start, tgt, entries[-1]["date"])
        weeks_left = max(0.0, (_d(goal["target_date"]) - today).days / 7)
        diff = round(now - should, 2)
        out["goal"] = {
            **goal,
            "should_be_kg": should,
            "vs_plan_kg": diff,
            "status": "ahead" if diff < -ON_TRACK_KG else "behind" if diff > ON_TRACK_KG else "on_track",
            "weeks_left": round(weeks_left, 1),
            "to_go_kg": round(now - goal["target_kg"], 1),
            "needed_kg_week": round((goal["target_kg"] - now) / weeks_left, 2) if weeks_left >= 1 else None,
            "projected_kg": round(now + rate * weeks_left, 1) if rate is not None else None,
        }
    if ftp_w:
        tgt_ftp = (goal or {}).get("target_ftp_w")
        tgt_kg = (goal or {}).get("target_kg")
        out["wkg"] = {
            "ftp_w": ftp_w,
            "now": round(ftp_w / now, 2),
            "at_target_weight": round(ftp_w / tgt_kg, 2) if tgt_kg else None,
            "target": round(tgt_ftp / tgt_kg, 2) if tgt_ftp and tgt_kg else None,
        }
    return out
