"""
Pilot fatigue: what the roster does to sleep, HRV and stress — and what's coming.

Joins every rostered day with
  - the sleep that ended that morning (sleep.date = the morning you woke: the night *before* duty),
  - that morning's overnight HRV, the day's average stress,
  - the next night's sleep (recovery after the duty),
grouped by report time (early starts are the pilot's main fatigue lever), against days off.

Also: short turnarounds (rest between a duty's end and the next report < 12 h), and a look
ahead at the roster for early-after-late and runs of early starts.
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from statistics import mean

WORKING = ("flying_duty", "ground_duty")
BUCKETS = [("Before 06:00", 0, 6 * 60), ("06:00–07:59", 6 * 60, 8 * 60), ("08:00–11:59", 8 * 60, 12 * 60),
           ("From 12:00", 12 * 60, 24 * 60)]
EARLY = 8 * 60
MIN_REST_H = 12.0


def _m(hhmm: str | None) -> int | None:
    try:
        h, m = (hhmm or "")[:5].split(":")
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return round(mean(xs), 1) if xs else None


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _rest_h(prev_end: str | None, report: str | None) -> float | None:
    """Hours between yesterday's duty end and today's report (an end after midnight counts as late)."""
    e, r = _m(prev_end), _m(report)
    if e is None or r is None:
        return None
    if e < 6 * 60:          # finished after midnight: that's early this calendar day
        return round((r - e) / 60, 1)
    return round((24 * 60 - e + r) / 60, 1)


def summary(conn: sqlite3.Connection, today: str | None = None) -> dict:
    t = _tables(conn)
    if "roster" not in t:
        return {"days": 0}
    today = today or date.today().isoformat()
    roster = {r[0]: (r[1], r[2], r[3]) for r in conn.execute(
        "SELECT date, duty_type, report_time, end_time FROM roster ORDER BY date")}
    sleep = {r[0]: (r[1] / 3600 if r[1] else None, r[2]) for r in conn.execute(
        "SELECT date, duration_seconds, score FROM sleep")} if "sleep" in t else {}
    hrv = {r[0]: r[1] for r in conn.execute("SELECT date, last_night_avg FROM hrv")} if "hrv" in t else {}
    stress = {r[0]: r[1] for r in conn.execute("SELECT date, stress_avg FROM daily_stats WHERE stress_avg > 0")} \
        if "daily_stats" in t else {}

    def nxt(d: str, k: int = 1) -> str:
        return (date.fromisoformat(d) + timedelta(days=k)).isoformat()

    rows = []
    for d, (duty, rep, end) in roster.items():
        if d > today:
            continue
        prev = roster.get(nxt(d, -1))
        rows.append({
            "date": d, "duty": duty, "report": rep, "end": end,
            "sleep_before": (sleep.get(d) or (None, None))[0], "score_before": (sleep.get(d) or (None, None))[1],
            "hrv": hrv.get(d), "stress": stress.get(d),
            "sleep_after": (sleep.get(nxt(d)) or (None, None))[0], "hrv_after": hrv.get(nxt(d)),
            "rest_h": _rest_h(prev[2], rep) if prev and prev[0] in WORKING + ("standby",) and duty in WORKING else None,
        })

    def group(sel) -> dict:
        g = [r for r in rows if sel(r)]
        return {"n": len(g), "sleep_before": _avg(r["sleep_before"] for r in g), "score_before": _avg(r["score_before"] for r in g),
                "hrv": _avg(r["hrv"] for r in g), "stress": _avg(r["stress"] for r in g),
                "sleep_after": _avg(r["sleep_after"] for r in g), "hrv_after": _avg(r["hrv_after"] for r in g)}

    off = group(lambda r: r["duty"] == "day_off")
    buckets = []
    for label, lo, hi in BUCKETS:
        g = group(lambda r, lo=lo, hi=hi: r["duty"] in WORKING and _m(r["report"]) is not None and lo <= _m(r["report"]) < hi)
        if g["n"]:
            buckets.append({"label": label, **g})
    sby = group(lambda r: r["duty"] == "standby")
    if sby["n"]:
        buckets.append({"label": "Standby", **sby})

    # the plain-language findings
    findings = []
    early = group(lambda r: r["duty"] in WORKING and (_m(r["report"]) or 24 * 60) < EARLY)
    if early["n"] >= 3 and early["sleep_before"] and off["sleep_before"]:
        diff = round(off["sleep_before"] - early["sleep_before"], 1)
        if diff >= 0.3:
            findings.append(f"Before an early report (before 08:00) you sleep {early['sleep_before']} h — "
                            f"{diff} h less than before a day off.")
    if early["n"] >= 3 and early["hrv"] and off["hrv"]:
        pct = round((early["hrv"] / off["hrv"] - 1) * 100)
        if pct <= -5:
            findings.append(f"Your HRV on early-start mornings is {abs(pct)}% lower than on days off.")
    late = group(lambda r: r["duty"] in WORKING and (_m(r["report"]) or 0) >= 12 * 60)
    if late["n"] >= 3 and late["sleep_after"] and off["sleep_before"] and late["sleep_after"] < off["sleep_before"] - 0.5:
        findings.append(f"After a late duty you sleep {late['sleep_after']} h the night after — the late finish costs "
                        f"{round(off['sleep_before'] - late['sleep_after'], 1)} h.")
    flown = group(lambda r: r["duty"] in WORKING)
    if flown["n"] >= 5 and flown["stress"] and off["stress"]:
        findings.append(f"Average stress {flown['stress']} on duty days vs {off['stress']} on days off.")

    short = sorted((r for r in rows if r["rest_h"] is not None and r["rest_h"] < MIN_REST_H),
                   key=lambda r: r["date"], reverse=True)[:8]

    # ahead: the next three weeks of roster
    ahead = []
    days = sorted(d for d in roster if today < d <= nxt(today, 21))
    run = 0
    for d in days:
        duty, rep, _ = roster[d]
        prev = roster.get(nxt(d, -1))
        rest = _rest_h(prev[2], rep) if prev and prev[0] in WORKING + ("standby",) and duty in WORKING else None
        is_early = duty in WORKING + ("standby",) and (_m(rep) or 24 * 60) < EARLY
        run = run + 1 if is_early else 0
        if rest is not None and rest < MIN_REST_H:
            ahead.append({"date": d, "text": f"Only {rest} h between yesterday's finish {prev[2]} and report {rep}"})
        elif run == 3:
            ahead.append({"date": d, "text": "Third early start in a row — protect the evenings"})
    return {"days": len(rows), "off": off, "buckets": buckets, "findings": findings,
            "short_rest": [{"date": r["date"], "rest_h": r["rest_h"], "report": r["report"],
                            "sleep_before": round(r["sleep_before"], 1) if r["sleep_before"] else None} for r in short],
            "ahead": ahead}
