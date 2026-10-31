"""
Estimated power for outdoor rides — the road bike has no power meter, the trainer does.

Two estimates, used together:

  1. Physics (speed, gradient, wind, weight). The watts needed to move rider + bike:
       P = [m·g·v·(sin θ + Crr·cos θ) + ½·ρ·CdA·v_air²·v + m·a·v] / η
     Gravity dominates on climbs, so there it is good to ~5 %; on the flat the air
     term (position, real wind at rider height) makes it ±10–15 %. Wind is the
     ride's own Open-Meteo headwind profile (10 m wind scaled to rider height).

  2. Heart rate → power, learned on the trainer. Indoor rides record power and HR
     side by side; 60 s blocks (HR read 30 s later — it lags the effort) give a
     line watts = a + b·HR, refitted as new trainer rides arrive. It covers the
     flats, but heat, fatigue and long rides push HR up for the same watts.

  Per second: physics on climbs (≥ 3 %) and when coasting; elsewhere the mean of
  physics and the HR line. The HR line is first scaled so that it matches physics
  on this ride's own steady climbs — that soaks up the day's heat / fatigue drift
  and keeps both honest. The ride reports how well they agreed.
"""

from __future__ import annotations

import json
import math
import sqlite3
from datetime import date, timedelta

G = 9.81
BIKE_KG = 10.0              # bike + bottles + kit
CRR = 0.005                 # road tyres on Mallorcan tarmac
CDA = 0.32                  # on the hoods
ETA = 0.975                 # drivetrain
WIND_AT_RIDER = 0.7         # 10 m wind → ~1 m (log profile, open country)
CLIMB_GRADE = 3.0
HR_LAG_S = 30
MODEL_DAYS = 180           # trainer rides up to ~6 months before the ride…
MODEL_AHEAD_DAYS = 60       # …or 2 months after it (fitness moves slowly; older rides still benefit)
MIN_BLOCKS = 20


# ── HR → power, learned indoors ──────────────────────────────────────────────

def _indoor_rides(conn, on_date: str) -> list:
    since = (date.fromisoformat(on_date) - timedelta(days=MODEL_DAYS)).isoformat()
    until = (date.fromisoformat(on_date) + timedelta(days=MODEL_AHEAD_DAYS)).isoformat()
    try:
        return conn.execute(
            """SELECT a.id, a.date FROM activities a
               WHERE a.date BETWEEN ? AND ? AND (a.activity_type LIKE '%indoor%' OR a.activity_type LIKE '%virtual%'
                     OR a.activity_type LIKE '%trainer%')
                 AND EXISTS (SELECT 1 FROM activity_streams s WHERE s.activity_id = a.id
                             AND lower(s.stream_type) IN ('directpower', 'watts'))
                 AND EXISTS (SELECT 1 FROM activity_streams s WHERE s.activity_id = a.id
                             AND lower(s.stream_type) IN ('directheartrate', 'heartrate'))
               ORDER BY a.date""", (since, until)).fetchall()
    except sqlite3.OperationalError:
        return []


def model_signature(conn, on_date: str) -> str:
    rides = _indoor_rides(conn, on_date)
    return f"{len(rides)}:{rides[-1][0] if rides else '-'}"


def _blocks(conn, activity_id: str) -> list[tuple[float, float]]:
    """(avg HR 30 s later, avg watts) per steady 60 s block, past the first 8 minutes."""
    from domains.health.activity_analysis import _load, resample_1hz
    st = _load(conn, activity_id)
    if "t" not in st and st.get("ts"):
        t0 = next((x for x in st["ts"] if x is not None), None)
        st["t"] = [(x - t0) / 1000 if x is not None and t0 is not None else None for x in st["ts"]]
    if "t" not in st or not st.get("pw") or not st.get("hr"):
        return []
    _, s1, moving = resample_1hz(st["t"], {"pw": st["pw"], "hr": st["hr"]})
    pw, hr = s1["pw"], s1["hr"]
    out = []
    for a in range(480, len(pw) - 60 - HR_LAG_S, 60):
        p = [x for x, m in zip(pw[a:a + 60], moving[a:a + 60]) if m and x is not None]
        h = [x for x in hr[a + HR_LAG_S:a + 60 + HR_LAG_S] if x and x > 60]
        if len(p) < 50 or len(h) < 50:
            continue
        mp = sum(p) / len(p)
        if mp < 40:
            continue
        sd = math.sqrt(sum((x - mp) ** 2 for x in p) / len(p))
        if sd / mp > 0.25:                       # surges: HR can't follow them
            continue
        out.append((sum(h) / len(h), mp))
    return out


def fit(blocks: list[tuple[float, float]]) -> dict | None:
    if len(blocks) < MIN_BLOCKS:
        return None
    n = len(blocks)
    mx = sum(h for h, _ in blocks) / n
    my = sum(p for _, p in blocks) / n
    sxx = sum((h - mx) ** 2 for h, _ in blocks)
    if sxx < 1:
        return None
    b = sum((h - mx) * (p - my) for h, p in blocks) / sxx
    a = my - b * mx
    ss_res = sum((p - (a + b * h)) ** 2 for h, p in blocks)
    ss_tot = sum((p - my) ** 2 for _, p in blocks) or 1
    if b <= 0:
        return None
    return {"a": round(a, 2), "b": round(b, 3), "blocks": n, "r2": round(1 - ss_res / ss_tot, 2),
            "rmse_w": round(math.sqrt(ss_res / n)), "hr_range": [round(min(h for h, _ in blocks)),
                                                                 round(max(h for h, _ in blocks))]}


def hr_model(conn, on_date: str) -> dict | None:
    """The HR → watts line from the trainer rides of the last ~6 months up to `on_date`."""
    rides = _indoor_rides(conn, on_date)
    blocks = [b for r in rides for b in _blocks(conn, r[0])]
    m = fit(blocks)
    if m:
        m.update({"rides": len(rides), "latest": rides[-1][1]})
    return m


def recent_scale(conn, on_date: str, exclude_id: str) -> float | None:
    """Median HR-line scale of nearby rides that had enough climbing to calibrate it — the
    indoor→outdoor offset (same watts cost more heartbeats on a hot, still trainer)."""
    since = (date.fromisoformat(on_date) - timedelta(days=120)).isoformat()
    until = (date.fromisoformat(on_date) + timedelta(days=60)).isoformat()
    try:
        rows = conn.execute(
            """SELECT json_extract(x.result_json, '$.power.estimated.hr_scale') FROM activity_analysis x
               JOIN activities a ON a.id = x.activity_id
               WHERE a.date BETWEEN ? AND ? AND a.id != ?
                 AND json_extract(x.result_json, '$.power.estimated.climb_agreement_pct') IS NOT NULL""",
            (since, until, exclude_id)).fetchall()
    except sqlite3.OperationalError:
        return None
    vals = sorted(r[0] for r in rows if r[0])
    return vals[len(vals) // 2] if len(vals) >= 2 else None


# ── physics ──────────────────────────────────────────────────────────────────

def _rho(alt_m: float | None, temp_c: float | None) -> float:
    t = 273.15 + (temp_c if temp_c is not None else 18.0)
    return 1.225 * math.exp(-(alt_m or 0) / 8500) * 288.15 / t


def physics(spd, grade_pct, alt, temp, head_kmh, mass_kg) -> list[float | None]:
    """Watts per second. `head_kmh` is the 10 m headwind at each second (+ into it)."""
    n = len(spd)
    out: list[float | None] = [None] * n
    for i in range(n):
        v = spd[i]
        if v is None:
            continue
        g = grade_pct[i] if grade_pct[i] is not None else 0.0
        th = math.atan(g / 100)
        # acceleration over 5 s — second-to-second GPS speed is too noisy (it made 900 W "sprints")
        v0 = spd[i - 5] if i >= 5 else None
        acc = max(-0.5, min(0.5, (v - v0) / 5)) if v0 is not None else 0.0
        v_air = v + (head_kmh[i] or 0.0) * WIND_AT_RIDER / 3.6
        aero = 0.5 * _rho(alt[i] if alt else None, temp[i] if temp else None) * CDA * v_air * abs(v_air) * v
        p = (mass_kg * G * v * (math.sin(th) + CRR * math.cos(th)) + aero + mass_kg * acc * v) / ETA
        out[i] = max(0.0, p)
    return out


def climb_watts(gain_m: float, length_km: float, secs: float, mass_kg: float) -> float | None:
    """Average watts up a climb from its gain, length and time (VAM physics; no wind — on a climb
    gravity is most of the bill, so this is the trustworthy number)."""
    if not (gain_m and length_km and secs) or secs < 60:
        return None
    v = length_km * 1000 / secs
    grade = gain_m / (length_km * 1000)
    return (mass_kg * G * v * (grade + CRR) + 0.5 * 1.2 * CDA * v ** 3) / ETA


def _smooth(vals, w):
    out, acc, q = [], 0.0, []
    for v in vals:
        q.append(v)
        acc += v or 0.0
        if len(q) > w:
            acc -= q.pop(0) or 0.0
        k = sum(1 for x in q if x is not None)
        out.append(acc / k if k else None)
    return out


def estimate(conn, act, s1: dict, moving: list[bool], grade_1hz: list, weight_kg: float | None) -> dict | None:
    """Estimated watts at 1 Hz for an outdoor ride, plus how it was made. None without speed."""
    spd = s1.get("spd")
    if not spd or not any(spd):
        return None
    n = len(spd)
    mass = (weight_kg or 80.0) + BIKE_KG
    spd_s = _smooth([v if m else None for v, m in zip(spd, moving)], 5)

    # headwind per second from the ride's wind profile (per km), when the wind card has run
    head = [0.0] * n
    wind = None
    try:
        r = conn.execute("SELECT result_json FROM activity_wind WHERE activity_id=?", (act["id"],)).fetchone()
        wind = json.loads(r[0]) if r and r[0] else None
    except (sqlite3.OperationalError, ValueError):
        wind = None
    prof = (wind or {}).get("profile_km") or []
    if prof and s1.get("d"):
        for i, d in enumerate(s1["d"]):
            if d is not None:
                head[i] = prof[min(len(prof) - 1, int(d / 1000))]

    phys = physics(spd_s, grade_1hz, s1.get("alt"), s1.get("temp"), head, mass)
    phys = _smooth(phys, 5)

    model = hr_model(conn, act["date"])
    hr = s1.get("hr")
    hr_w: list[float | None] = [None] * n
    if model and hr:
        for i in range(n):
            j = i + HR_LAG_S
            h = hr[j] if j < n else None
            hr_w[i] = max(0.0, model["a"] + model["b"] * h) if h and h > 60 else None

    # calibrate the HR line on this ride's steady climbs, where physics is trustworthy
    climb = [i for i in range(n) if moving[i] and grade_1hz[i] is not None and grade_1hz[i] >= CLIMB_GRADE
             and phys[i] and hr_w[i] and (spd_s[i] or 0) > 2]
    scale, agree = (recent_scale(conn, act["date"], act["id"]) or 1.0) if model else 1.0, None
    if len(climb) >= 480:
        ph = sum(phys[i] for i in climb) / len(climb)
        hw = sum(hr_w[i] for i in climb) / len(climb)
        if hw > 0:
            agree = round((hw / ph - 1) * 100, 1)        # + = HR line read high on the climbs
            scale = max(0.8, min(1.25, ph / hw))

    est: list[float | None] = []
    for i in range(n):
        p, h = phys[i], hr_w[i]
        if not moving[i] or p is None:
            est.append(None)
            continue
        g = grade_1hz[i] if grade_1hz[i] is not None else 0.0
        if h is None or g >= CLIMB_GRADE or (g <= -2 and p < 30):
            est.append(p)                                  # climbing, or coasting downhill
        else:
            est.append((p + h * scale) / 2)
    if not any(est):
        return None
    return {
        "watts": [round(x) if x is not None else None for x in est],
        "meta": {
            "method": "physics + heart rate" if model else "physics",
            "mass_kg": round(mass, 1), "cda": CDA, "crr": CRR, "wind": bool(prof),
            "hr_model": model, "hr_scale": round(scale, 2), "climb_agreement_pct": agree,
            "climb_min": round(len(climb) / 60) if climb else 0,
        },
    }
