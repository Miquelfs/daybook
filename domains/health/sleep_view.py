"""
The sleep page for a period: every night, what it adds up to, naps, and what moves it.

Garmin's sleep payload (sleep.raw_payload, `dailySleepDTO` + top level) carries far more
than the stage columns: when you went to bed and woke (device-local clock, so it's right on
a trip), breathing rate, sleep stress, awakenings, restless moments, the overnight resting
HR / HRV, how much Body Battery the night gave back, and naps. Read defensively — older
payloads lack some keys, manual nights have none (they keep start/end as HH:MM).

  nights      one row per night (date = the day you woke up): time in bed, asleep, stages as
              seconds AND as % of time in bed (they add up to 100 — awake is part of the
              night, not on top of it), bed/wake clock, overnight vitals, naps.
  summarise   averages over the nights; bedtime/wake averaged on the clock (23:30 and 00:30
              average to midnight, not noon); rhythm = how much bedtime wanders.
  by_weekday  · by_duty — the night before a day off / a duty / an early report.
"""

from __future__ import annotations

import json
import sqlite3
import statistics
from datetime import date, datetime, timedelta, timezone

NEED_H = 8.0               # what a night should give
SHORT_H = 7.0              # a short night
EARLY_REPORT = "07:30"     # a report before this is an early one
DEBT_WINDOW = 14           # sleep debt is what the last two weeks owe — older debt is gone


def _get(d: dict, *keys):
    for k in keys:
        v = d.get(k) if isinstance(d, dict) else None
        if v is not None:
            return v
    return None


def _clock_from_ms(ms) -> str | None:
    """Garmin's *Local timestamps are epoch ms of the local wall clock."""
    try:
        return datetime.fromtimestamp(float(ms) / 1000, tz=timezone.utc).strftime("%H:%M")
    except (TypeError, ValueError, OSError):
        return None


def _clock(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return _clock_from_ms(v)
    s = str(v)
    if "T" in s or " " in s:                          # "2026-11-18T23:41:00.0"
        s = s.replace("T", " ").split(" ")[1]
    return s[:5] if len(s) >= 5 and s[2] == ":" else None


def _naps(raw: dict, dto: dict) -> list[dict]:
    out = []
    for n in _get(raw, "dailyNapDTOS", "napList") or _get(dto, "dailyNapDTOS", "napList") or []:
        if not isinstance(n, dict):
            continue
        start = _clock(_get(n, "napStartTimestampLocal", "startTimestampLocal", "napStartTimestampGMT"))
        end = _clock(_get(n, "napEndTimestampLocal", "endTimestampLocal", "napEndTimestampGMT"))
        secs = _get(n, "napTimeSec", "napTimeSeconds", "durationInSeconds")
        if secs is None and start and end:
            a, b = _mins(start), _mins(end)
            secs = ((b - a) % 1440) * 60
        if secs:
            out.append({"start": start, "end": end, "seconds": int(secs)})
    if not out and _get(dto, "napTimeSeconds"):
        out.append({"start": None, "end": None, "seconds": int(dto["napTimeSeconds"])})
    return out


def _mins(hhmm: str) -> int:
    h, m = hhmm.split(":")[:2]
    return int(h) * 60 + int(m)


def night(row) -> dict:
    r = dict(row)
    try:
        raw = json.loads(r.get("raw_payload") or "{}") or {}
    except (ValueError, TypeError):
        raw = {}
    dto = raw.get("dailySleepDTO") or {}
    asleep = r.get("duration_seconds") or 0
    awake = r.get("awake_seconds") or 0
    deep, light, rem = r.get("deep_seconds") or 0, r.get("light_seconds") or 0, r.get("rem_seconds") or 0
    staged = deep + light + rem
    in_bed = asleep + awake
    manual = (r.get("source") or "garmin") == "manual"
    bed = r.get("start_time") if manual else _clock(_get(dto, "sleepStartTimestampLocal"))
    wake = r.get("end_time") if manual else _clock(_get(dto, "sleepEndTimestampLocal"))

    def pct(x):
        return round(x / in_bed * 100, 1) if in_bed and staged else None

    return {
        "date": r["date"], "source": "manual" if manual else "garmin",
        "in_bed_s": in_bed or None, "asleep_s": asleep or None,
        "deep_s": deep or None, "light_s": light or None, "rem_s": rem or None, "awake_s": awake or None,
        "deep_pct": pct(deep), "light_pct": pct(light), "rem_pct": pct(rem), "awake_pct": pct(awake),
        "score": r.get("score"),
        "bed": bed, "wake": wake,
        "resting_hr": _get(raw, "restingHeartRate") or r.get("rhr"),
        "hrv": _get(raw, "avgOvernightHrv") or r.get("hrv"),
        "respiration": _get(dto, "averageRespirationValue"),
        "stress": _get(dto, "avgSleepStress"),
        "awakenings": _get(dto, "awakeCount"),
        "restless": _get(raw, "restlessMomentsCount"),
        "body_battery": _get(raw, "bodyBatteryChange"),
        "spo2": r.get("avg_spo2") or _get(dto, "averageSpO2Value"),
        "naps": _naps(raw, dto),
    }


def nights(conn: sqlite3.Connection, start: str, end: str) -> list[dict]:
    cols = {c[1] for c in conn.execute("PRAGMA table_info(sleep)")}
    extra = ", ".join(c for c in ("source", "start_time", "end_time") if c in cols)
    has_hrv = bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name='hrv'").fetchone())
    has_ds = bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name='daily_stats'").fetchone())
    rows = conn.execute(
        f"""SELECT s.date, s.duration_seconds, s.deep_seconds, s.light_seconds, s.rem_seconds, s.awake_seconds,
                   s.score, s.avg_spo2, s.raw_payload {', ' + extra if extra else ''}
                   {', h.last_night_avg AS hrv' if has_hrv else ''} {', ds.resting_hr AS rhr' if has_ds else ''}
            FROM sleep s
            {'LEFT JOIN hrv h ON h.date = s.date' if has_hrv else ''}
            {'LEFT JOIN daily_stats ds ON ds.date = s.date' if has_ds else ''}
            WHERE s.date BETWEEN ? AND ? AND (s.duration_seconds > 0 OR s.raw_payload LIKE '%nap%')
            ORDER BY s.date""", (start, end)).fetchall()
    return [night(r) for r in rows]


# ── adding it up ─────────────────────────────────────────────────────────────

def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def clock_mean(times: list[str | None], pivot: int = 12 * 60) -> tuple[str | None, float | None]:
    """Mean and stdev (minutes) of clock times, unwrapped around `pivot` (noon for bedtimes:
    23:30 and 00:30 → 00:00)."""
    ms = [(_mins(t) - pivot) % 1440 for t in times if t]
    if not ms:
        return None, None
    m = sum(ms) / len(ms)
    sd = statistics.pstdev(ms) if len(ms) > 1 else None
    t = int(round(m + pivot)) % 1440
    return f"{t // 60:02d}:{t % 60:02d}", (round(sd) if sd is not None else None)


def summarise(ns: list[dict], today: str | None = None) -> dict:
    sl = [n for n in ns if n["asleep_s"]]
    if not sl:
        return {"nights": 0}
    bed, bed_sd = clock_mean([n["bed"] for n in sl])
    wake, wake_sd = clock_mean([n["wake"] for n in sl], pivot=18 * 60)   # wakes: unwrap around 18:00
    staged = [n for n in sl if n["deep_pct"] is not None]

    def avg(k, nd=1):
        v = _mean([n[k] for n in sl])
        return round(v, nd) if v is not None else None

    today = today or date.today().isoformat()
    since = (date.fromisoformat(today) - timedelta(days=DEBT_WINDOW)).isoformat()
    recent = [n for n in sl if n["date"] > since]
    debt = sum(max(0.0, NEED_H * 3600 - n["asleep_s"]) for n in recent)
    naps = [p for n in ns for p in n["naps"]]
    best = max(sl, key=lambda n: (n["score"] or 0, n["asleep_s"]))
    worst = min(sl, key=lambda n: (n["score"] if n["score"] is not None else 101, n["asleep_s"]))
    return {
        "nights": len(sl),
        "asleep_s": round(_mean([n["asleep_s"] for n in sl])),
        "in_bed_s": round(_mean([n["in_bed_s"] for n in sl])),
        "efficiency_pct": round(sum(n["asleep_s"] for n in sl) / sum(n["in_bed_s"] for n in sl) * 100),
        "score": avg("score"),
        "deep_pct": round(_mean([n["deep_pct"] for n in staged]), 1) if staged else None,
        "light_pct": round(_mean([n["light_pct"] for n in staged]), 1) if staged else None,
        "rem_pct": round(_mean([n["rem_pct"] for n in staged]), 1) if staged else None,
        "awake_pct": round(_mean([n["awake_pct"] for n in staged]), 1) if staged else None,
        "bed": bed, "bed_sd_min": bed_sd, "wake": wake, "wake_sd_min": wake_sd,
        "short_nights": sum(1 for n in sl if n["asleep_s"] < SHORT_H * 3600),
        "debt_s": round(debt), "debt_nights": len(recent),
        "resting_hr": avg("resting_hr"), "hrv": avg("hrv"), "respiration": avg("respiration"),
        "stress": avg("stress"), "awakenings": avg("awakenings"), "restless": avg("restless"),
        "body_battery": avg("body_battery", 0), "spo2": avg("spo2"),
        "naps": {"count": len(naps), "seconds": sum(p["seconds"] for p in naps),
                 "avg_s": round(sum(p["seconds"] for p in naps) / len(naps)) if naps else None,
                 "days": sum(1 for n in ns if n["naps"])},
        "best": {"date": best["date"], "score": best["score"], "asleep_s": best["asleep_s"]},
        "worst": {"date": worst["date"], "score": worst["score"], "asleep_s": worst["asleep_s"]},
    }


def by_weekday(ns: list[dict]) -> list[dict]:
    """The night that ends on each weekday (Monday = the night from Sunday into Monday)."""
    out = []
    for i, label in enumerate(("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")):
        g = [n for n in ns if n["asleep_s"] and date.fromisoformat(n["date"]).weekday() == i]
        sc = _mean([n["score"] for n in g])
        out.append({"label": label, "nights": len(g),
                    "asleep_s": round(_mean([n["asleep_s"] for n in g])) if g else None,
                    "score": round(sc) if sc is not None else None,
                    "bed": clock_mean([n["bed"] for n in g])[0]})
    return out


def by_duty(conn: sqlite3.Connection, ns: list[dict]) -> list[dict]:
    """The night before a day off, a duty and an early report (the roster day = the day you woke)."""
    try:
        roster = {r[0]: (r[1], r[2]) for r in conn.execute(
            "SELECT date, duty_type, report_time FROM roster WHERE date BETWEEN ? AND ?",
            (ns[0]["date"], ns[-1]["date"]))} if ns else {}
    except sqlite3.OperationalError:
        return []
    if not roster:
        return []
    groups: dict[str, list[dict]] = {"early": [], "duty": [], "off": []}
    for n in ns:
        if not n["asleep_s"]:
            continue
        duty, report = roster.get(n["date"], (None, None))
        if duty in ("flying_duty", "standby", "ground_duty"):
            groups["early" if report and report < EARLY_REPORT else "duty"].append(n)
        else:
            groups["off"].append(n)
    labels = {"early": f"Before an early report (< {EARLY_REPORT})", "duty": "Before a later duty",
              "off": "Before a day off"}
    out = []
    for k in ("off", "duty", "early"):
        g = groups[k]
        if not g:
            continue
        sc = _mean([n["score"] for n in g])
        out.append({"key": k, "label": labels[k], "nights": len(g),
                    "asleep_s": round(_mean([n["asleep_s"] for n in g])),
                    "score": round(sc) if sc is not None else None,
                    "bed": clock_mean([n["bed"] for n in g])[0], "wake": clock_mean([n["wake"] for n in g], 18 * 60)[0]})
    return out


def period(conn: sqlite3.Connection, days: int, today: date | None = None) -> dict:
    today = today or date.today()
    start = (today - timedelta(days=days - 1)).isoformat()
    ns = nights(conn, start, today.isoformat())
    prev_start = (today - timedelta(days=2 * days - 1)).isoformat()
    prev = nights(conn, prev_start, (today - timedelta(days=days)).isoformat())
    s = summarise(ns, today.isoformat())
    p = summarise(prev, (today - timedelta(days=days)).isoformat())
    naps = [{"date": n["date"], **x} for n in ns for x in n["naps"]]
    return {
        "days": days, "start": start, "end": today.isoformat(), "need_h": NEED_H,
        "summary": s,
        "previous": {k: p.get(k) for k in ("nights", "asleep_s", "score", "bed", "resting_hr", "hrv")},
        "nights": ns,
        "naps": sorted(naps, key=lambda x: (x["date"], x["start"] or ""), reverse=True),
        "by_weekday": by_weekday(ns),
        "by_duty": by_duty(conn, ns),
    }
