"""
Activity analysis: turns the raw streams of one activity into readable cards —
heart rate, pace/speed, power, elevation and cadence — each with a short verdict,
a few derived numbers and a downsampled series for charting.

Works with both stream vocabularies stored in activity_streams:
  Garmin  (activity detail sync, lower-cased): sumduration, sumdistance, directheartrate,
          directspeed, directelevation, directpower, directbikecadence, directdoublecadence …
  Strava: time, distance, heartrate, velocity_smooth, altitude, watts, cadence

Garmin samples at irregular intervals (often every 2–5 s), so everything is first
resampled onto a 1 Hz timeline: time-in-zone, rolling bests (5 s … 60 min power),
normalized power and the like are then simple and correctly time-weighted.
Gaps > 30 s (auto-pause) count as stopped.

Zones come from athlete_zones (the row valid on the activity date for that sport):
HR bands from zones_json, FTP for power. Result is cached per activity in
activity_analysis, keyed by a signature of version + zones + plan link.
"""

from __future__ import annotations

import json
import math
import sqlite3
from bisect import bisect_right

VERSION = 6   # 4: HR zones from threshold HR (hr_zones) · 5: interval reps · 6: estimated ride power
MAX_GAP_S = 30
MAX_SERIES = 600

# Coggan power levels as fractions of FTP (upper bounds)
POWER_ZONES = [("Z1", "Recovery", 0.55), ("Z2", "Endurance", 0.75), ("Z3", "Tempo", 0.90),
               ("Z4", "Threshold", 1.05), ("Z5", "VO2max", 1.20), ("Z6", "Anaerobic", 1.50),
               ("Z7", "Sprint", 99.0)]
HR_FALLBACK = [("Z1", 0.0, 0.65), ("Z2", 0.65, 0.75), ("Z3", 0.75, 0.82), ("Z4", 0.82, 0.88), ("Z5", 0.88, 9.9)]
HR_ZONE_NAMES = {"Z1": "Recovery", "Z2": "Aerobic", "Z3": "Tempo", "Z4": "Threshold", "Z5": "Max"}
POWER_BESTS = [(5, "5 s"), (60, "1 min"), (300, "5 min"), (1200, "20 min"), (3600, "60 min")]

ALIASES = {
    "t": ("sumduration", "sumelapsedduration", "time"),
    "ts": ("directtimestamp",),          # epoch ms — timeline fallback
    "d": ("sumdistance", "distance"),
    "hr": ("directheartrate", "heartrate", "heart_rate"),
    "spd": ("directspeed", "velocity_smooth", "velocity"),
    "alt": ("directelevation", "altitude", "elevation"),
    "pw": ("directpower", "watts", "power"),
    "bcad": ("directbikecadence",),
    "rcad2": ("directdoublecadence",),
    "rcad": ("directruncadence", "cadence"),
    "gap": ("directgradeadjustedspeed",),
    "temp": ("directairtemperature", "temp"),
}


# ── helpers ──────────────────────────────────────────────────────────────────

def sport_of(activity_type: str | None) -> str:
    t = (activity_type or "").lower()
    if any(k in t for k in ("cycl", "bik", "ride")):
        return "ride"
    if any(k in t for k in ("run", "jog", "treadmill")):
        return "run"
    if "swim" in t:
        return "swim"
    if any(k in t for k in ("hik", "walk", "trek")):
        return "hike"
    return "other"


def is_indoor(activity_type: str | None) -> bool:
    t = (activity_type or "").lower()
    return any(k in t for k in ("indoor", "virtual", "trainer", "treadmill"))


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _load(conn, activity_id: str) -> dict[str, list]:
    raw = {}
    for r in conn.execute("SELECT stream_type, data_json FROM activity_streams WHERE activity_id=?", (activity_id,)):
        try:
            raw[r[0].lower()] = json.loads(r[1])
        except (ValueError, TypeError, AttributeError):
            pass
    out = {}
    for key, names in ALIASES.items():
        for n in names:
            if raw.get(n) and any(_num(v) is not None for v in raw[n]):
                out[key] = [_num(v) for v in raw[n]]
                break
    return out


def resample_1hz(t: list, series: dict[str, list]) -> tuple[list[int], dict[str, list], list[bool]]:
    """Forward-fill each series onto whole seconds 0..T. Returns (secs, series@1Hz, moving mask)."""
    pts = [(tt, i) for i, tt in enumerate(t) if tt is not None]
    if len(pts) < 2:
        return [], {}, []
    t0 = pts[0][0]
    times = [tt - t0 for tt, _ in pts]
    idx = [i for _, i in pts]
    total = int(times[-1])
    out = {k: [] for k in series}
    moving = []
    for s in range(total + 1):
        j = bisect_right(times, s) - 1
        jn = min(j + 1, len(times) - 1)
        gap = times[jn] - times[j] > MAX_GAP_S
        moving.append(not gap)
        for k, arr in series.items():
            v = arr[idx[j]] if idx[j] < len(arr) else None
            out[k].append(v)
    return list(range(total + 1)), out, moving


def _rolling_best(vals: list, window: int) -> float | None:
    """Best mean over any `window` consecutive seconds (None counted as 0)."""
    if len(vals) < window:
        return None
    cs = [0.0]
    for v in vals:
        cs.append(cs[-1] + (v or 0))
    return max((cs[i + window] - cs[i]) / window for i in range(len(vals) - window + 1))


def _smooth(vals: list, w: int) -> list:
    out, acc, q = [], 0.0, []
    for v in vals:
        q.append(v or 0)
        acc += v or 0
        if len(q) > w:
            acc -= q.pop(0)
        out.append(acc / len(q))
    return out


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _zone_row(conn, sport: str, on_date: str):
    try:
        r = conn.execute("SELECT * FROM athlete_zones WHERE sport=? AND valid_from<=? ORDER BY valid_from DESC LIMIT 1",
                         (sport, on_date)).fetchone()
        return r or conn.execute("SELECT * FROM athlete_zones WHERE sport=? ORDER BY valid_from LIMIT 1",
                                 (sport,)).fetchone()
    except sqlite3.OperationalError:
        return None


def _hr_bands(zrow, max_hr_seen: float | None) -> tuple[list[tuple[str, float, float]], float | None]:
    if zrow is not None and zrow["zones_json"]:
        try:
            z = json.loads(zrow["zones_json"])
            bands = [(b["name"], float(b["min_hr"]), float(b["max_hr"])) for b in z if b.get("name")]
            if bands:
                return bands, zrow["max_hr"]
        except (ValueError, TypeError, KeyError):
            pass
    mx = (zrow["max_hr"] if zrow is not None and zrow["max_hr"] else None) or max(195, int(max_hr_seen or 0))
    return [(n, lo * mx, hi * mx) for n, lo, hi in HR_FALLBACK], mx


def _plan_zone(conn, activity_id: str) -> str | None:
    try:
        r = conn.execute("SELECT intensity_zone FROM plan_sessions WHERE completed_activity_id=? LIMIT 1",
                         (activity_id,)).fetchone()
        return r[0] if r and r[0] else None
    except sqlite3.OperationalError:
        return None


def _weight(conn, on_date: str) -> float | None:
    try:
        r = conn.execute("SELECT weight_kg FROM weight_log WHERE date<=? AND weight_kg IS NOT NULL "
                         "ORDER BY date DESC LIMIT 1", (on_date,)).fetchone()
        return r[0] if r else None
    except sqlite3.OperationalError:
        return None


# ── intervals ────────────────────────────────────────────────────────────────

def _intervals(sport, s1, moving, bands) -> dict | None:
    """Work reps found in the stream: ≥3 bouts of 30 s–20 min clearly above the recoveries between them.

    Runs read power when the watch records it (it reacts instantly) and pace otherwise; rides need
    power (outdoor speed follows the terrain, not the effort). A rep is ≥ 85% of the session's p95."""
    key = "pw" if s1.get("pw") and any(s1["pw"]) else "spd" if sport == "run" else None
    if sport not in ("run", "ride") or not key or not s1.get(key):
        return None
    raw = [v if m and v else 0 for v, m in zip(s1[key], moving)]
    sm = _smooth(raw, 10)
    sig = sm[5:] + [sm[-1]] * 5                      # centre the 10 s window so reps don't start late
    vals = sorted(v for v, m in zip(sig, moving) if m and v > 0)
    if len(vals) < 600:
        return None
    thr = 0.85 * vals[int(len(vals) * 0.95)]
    bouts, start = [], None
    for i, v in enumerate(sig):
        if v >= thr and moving[i]:
            if start is None:
                start = i
        elif start is not None:
            bouts.append([start, i])
            start = None
    if start is not None:
        bouts.append([start, len(sig)])
    merged = []
    for b in bouts:                                  # a 10 s stumble doesn't split a rep
        if merged and b[0] - merged[-1][1] < 15:
            merged[-1][1] = b[1]
        else:
            merged.append(b)
    bouts = [b for b in merged if 30 <= b[1] - b[0] <= 1200]

    def even(xs, tol):
        m = sorted(xs)[len(xs) // 2]
        return all(abs(x - m) <= tol * m for x in xs)

    # the set: the longest run of consecutive bouts with like-for-like reps and recoveries — hills,
    # traffic lights and surges on an easy run make bouts too, but never a regular pattern
    reps = []
    for i in range(len(bouts)):
        for j in range(len(bouts), i + 2, -1):
            seq = bouts[i:j]
            if j - i <= len(reps):
                break
            gaps = [seq[k + 1][0] - seq[k][1] for k in range(len(seq) - 1)]
            if even([b - a for a, b in seq], 0.3) and even(gaps, 0.5) and 30 <= min(gaps) and max(gaps) <= 600:
                reps = seq
                break
    if len(reps) < 3:
        return None
    work_s = sum(b - a for a, b in reps)
    if work_s > 0.7 * sum(1 for m in moving if m):
        return None
    on = _mean(raw[i] for a, b in reps for i in range(a, b))
    off = _mean(raw[i] for k in range(len(reps) - 1) for i in range(reps[k][1], reps[k + 1][0]))
    if not on or off is None or off > 0.8 * on:
        return None

    hr, d, pw = s1.get("hr"), s1.get("d"), s1.get("pw")

    def zone_of(h):
        return next((n for n, lo, _ in reversed(bands) if h >= lo), bands[0][0]) if h else None

    out = []
    for k, (a, b) in enumerate(reps):
        dist = (d[b - 1] - d[a]) if d and d[a] is not None and d[b - 1] is not None else None
        hrs = [h for h in (hr or [])[a:b] if h]
        rec = (reps[k + 1][0] - b) if k + 1 < len(reps) else None
        out.append({
            "start_km": round(d[a] / 1000, 2) if d and d[a] is not None else None,
            "secs": b - a, "dist_m": round(dist) if dist else None,
            "pace_s_km": round((b - a) / dist * 1000) if dist and dist > 50 else None,
            "avg_hr": round(sum(hrs) / len(hrs)) if hrs else None,
            "max_hr": round(max(hrs)) if hrs else None, "zone_reached": zone_of(max(hrs) if hrs else None),
            "avg_w": round(_mean(pw[a:b])) if pw and _mean(pw[a:b]) else None,
            "recovery_s": rec,
        })
    paced = [r for r in out if r["pace_s_km"]]
    dist_sum = sum(r["dist_m"] for r in paced)
    pace = round(sum(r["secs"] for r in paced) / dist_sum * 1000) if paced and dist_sum else None
    fade = round((paced[-1]["pace_s_km"] / paced[0]["pace_s_km"] - 1) * 100, 1) if len(paced) >= 2 else None
    recs = [r["recovery_s"] for r in out if r["recovery_s"]]
    return {
        "source": "power" if key == "pw" else "pace", "reps": out, "count": len(out), "work_s": work_s,
        "avg_rep_s": round(work_s / len(out)), "avg_pace_s_km": pace,
        "avg_hr": round(_mean(r["avg_hr"] for r in out)) if any(r["avg_hr"] for r in out) else None,
        "max_hr": max((r["max_hr"] for r in out if r["max_hr"]), default=None),
        "avg_w": round(_mean(r["avg_w"] for r in out)) if any(r["avg_w"] for r in out) else None,
        "fade_pct": fade, "avg_recovery_s": round(sum(recs) / len(recs)) if recs else None,
    }


def _clock(s: float) -> str:
    return f"{int(s) // 60}:{int(round(s)) % 60:02d}"


# ── cards ────────────────────────────────────────────────────────────────────

def _hr_card(hr, moving, bands, max_hr, threshold_hr, plan_zone, spd, computed, iv=None) -> dict | None:
    secs = [h for h, m in zip(hr, moving) if m and h and h > 40]
    if len(secs) < 120:
        return None
    zones = []
    for i, (name, lo, hi) in enumerate(bands):
        last = i == len(bands) - 1
        n = sum(1 for h in secs if h >= lo and (h < hi or last))
        if i == 0:
            n += sum(1 for h in secs if h < lo)
        zones.append({"zone": name, "label": HR_ZONE_NAMES.get(name, name), "lo": round(lo),
                      "hi": None if last else round(hi), "secs": n, "pct": round(n / len(secs) * 100)})
    pct = {z["zone"]: z["pct"] for z in zones}
    easy = pct.get("Z1", 0) + pct.get("Z2", 0)
    hard = pct.get("Z4", 0) + pct.get("Z5", 0)

    # drift: HR in the last third vs the first third of moving time (and, when speed exists, HR per speed)
    mov_idx = [i for i, m in enumerate(moving) if m and hr[i] and hr[i] > 40]
    third = len(mov_idx) // 3
    first, last = mov_idx[:third], mov_idx[-third:]
    hr1, hr2 = _mean(hr[i] for i in first), _mean(hr[i] for i in last)
    drift_bpm = round(hr2 - hr1) if hr1 and hr2 else None

    if iv:
        top = max((r["max_hr"] for r in iv["reps"] if r["max_hr"]), default=None)
        verdict = f"Intervals — {iv['count']} reps" + (f", HR peaking at {top} bpm" if top else "")
    elif hard >= 25:
        verdict = f"Hard session — {hard}% in Z4–Z5"
    elif pct.get("Z3", 0) >= 30:
        verdict = f"Lots of tempo ({pct['Z3']}% Z3) — harder than easy, easier than hard"
    elif easy >= 75:
        verdict = f"Aerobic — {easy}% in Z1–Z2, the base-building kind"
    else:
        verdict = "Mixed intensity"
    plan = None
    if plan_zone and plan_zone.upper().startswith("Z") and plan_zone[1:2].isdigit():
        pz = int(plan_zone[1])
        at_or_below = sum(z["pct"] for z in zones if z["zone"][1:].isdigit() and int(z["zone"][1:]) <= pz)
        plan = {"zone": plan_zone, "pct_at_or_below": at_or_below,
                "ok": at_or_below >= 75 if pz <= 2 else sum(z["pct"] for z in zones if z["zone"] == f"Z{pz}") >= 20}
        if iv and pz >= 3:
            # HR lags a short rep, so judge each rep by the zone its HR reached, not the whole-session spread
            n = sum(1 for r in iv["reps"] if r["zone_reached"] and r["zone_reached"][1:].isdigit()
                    and int(r["zone_reached"][1:]) >= pz)
            plan.update({"reps": iv["count"], "reps_reaching": n, "ok": n * 2 >= iv["count"]})
    dec = computed.get("decoupling_pct") if computed else None
    if iv:                                           # drift and decoupling assume a steady effort
        drift_bpm = dec = None
    return {
        "avg": round(sum(secs) / len(secs)), "max": round(max(secs)), "zones": zones,
        "max_hr": round(max_hr) if max_hr else None, "threshold_hr": threshold_hr,
        "above_threshold_min": round(sum(1 for h in secs if threshold_hr and h >= threshold_hr) / 60)
        if threshold_hr else None,
        "peak_5min": round(_rolling_best([h if m else 0 for h, m in zip(hr, moving)], 300) or 0) or None,
        "peak_20min": round(_rolling_best([h if m else 0 for h, m in zip(hr, moving)], 1200) or 0) or None,
        "drift_bpm": drift_bpm, "decoupling_pct": dec,
        "durability": None if dec is None else ("durable" if dec < 5 else "borderline" if dec < 8 else "fading"),
        "verdict": verdict, "plan": plan,
    }


def _pace_card(sport, spd, dist, alt_grade, moving, gap_spd, iv=None) -> dict | None:
    mv = [(s, g) for s, g, m in zip(spd, alt_grade, moving) if m and s is not None]
    thr = 1.0 if sport == "ride" else 0.5
    rolling = [(s, g) for s, g in mv if s > thr]
    if len(rolling) < 120:
        return None
    moving_s = len(rolling)
    elapsed_s = len(moving)
    avg = sum(s for s, _ in rolling) / moving_s

    def avg_where(pred):
        xs = [s for s, g in rolling if g is not None and pred(g)]
        return (sum(xs) / len(xs), len(xs)) if len(xs) >= 60 else (None, len(xs))

    flat, nf = avg_where(lambda g: -2 <= g <= 2)
    up, nu = avg_where(lambda g: g > 3)
    down, nd = avg_where(lambda g: g < -3)

    # halves by distance
    half_idx = None
    if dist and dist[-1]:
        half = dist[-1] / 2
        half_idx = next((i for i, d in enumerate(dist) if d is not None and d >= half), None)
    split = None
    if half_idx:
        # rides: compare flat stretches only, so a climb in one half doesn't read as a pacing fade
        terrain_ok = (lambda g: g is not None and -2 <= g <= 2) if sport == "ride" and any(
            g is not None for g in alt_grade) else (lambda g: True)
        a = [s for s, m, g in zip(spd[:half_idx], moving[:half_idx], alt_grade[:half_idx])
             if m and s and s > thr and terrain_ok(g)]
        b = [s for s, m, g in zip(spd[half_idx:], moving[half_idx:], alt_grade[half_idx:])
             if m and s and s > thr and terrain_ok(g)]
        if len(a) < 300 or len(b) < 300:
            a = b = []
        if a and b:
            sa, sb = sum(a) / len(a), sum(b) / len(b)
            split = {"first": sa, "second": sb, "pct": round((sb / sa - 1) * 100, 1)}

    flat_s = [s for s, g in rolling if g is not None and -2 <= g <= 2]
    cv = None
    if len(flat_s) > 120:
        m = sum(flat_s) / len(flat_s)
        cv = round(math.sqrt(sum((x - m) ** 2 for x in flat_s) / len(flat_s)) / m * 100)

    best = {}
    if sport == "run" and dist:
        for label, meters in (("1 km", 1000), ("5 km", 5000), ("10 km", 10000)):
            t = _fastest_distance(dist, moving, meters)
            if t:
                best[label] = t
    elif sport == "ride":
        for w, label in ((300, "5 min"), (1200, "20 min"), (3600, "60 min")):
            b = _rolling_best([s if m else 0 for s, m in zip(spd, moving)], w)
            if b and len(spd) >= w:
                best[label] = round(b * 3.6, 1)

    stopped = elapsed_s - moving_s
    if iv:
        # halves and steadiness read an interval session as a fade / choppy pacing — the reps are the story
        split = cv = None
        verdict = f"Intervals — {iv['count']} × {_clock(iv['avg_rep_s'])}"
        if iv["avg_pace_s_km"] and sport == "run":
            verdict += f" at {_clock(iv['avg_pace_s_km'])} /km"
        if iv["fade_pct"] is not None and abs(iv["fade_pct"]) > 3:
            verdict += f" · last rep {abs(iv['fade_pct'])}% {'slower' if iv['fade_pct'] > 0 else 'faster'} than the first"
        elif iv["fade_pct"] is not None:
            verdict += " · even reps"
    elif split and abs(split["pct"]) <= 2:
        verdict = ("Even pacing — first and second half within 2%" if sport != "ride"
                   else "Even on the flats — both halves within 2%")
    elif split and split["pct"] > 2:
        verdict = f"Negative split — second half {split['pct']}% faster"
    elif split:
        verdict = f"Faded — second half {abs(split['pct'])}% slower"
    else:
        verdict = "Steady"
    if sport == "ride" and up and flat and (nu / max(1, moving_s)) > 0.15:
        verdict += " · climbs took " + f"{round(nu / moving_s * 100)}% of the time"

    gap = None
    if sport == "run" and gap_spd:
        g = [s for s, m in zip(gap_spd, moving) if m and s and s > thr]
        gap = sum(g) / len(g) if g else None
    return {
        "avg_mps": round(avg, 3), "max_mps": round(max(s for s, _ in rolling), 2),
        "moving_s": moving_s, "stopped_s": stopped,
        "flat_mps": round(flat, 3) if flat else None, "climb_mps": round(up, 3) if up else None,
        "descent_mps": round(down, 3) if down else None,
        "terrain_pct": {"climb": round(nu / moving_s * 100), "flat": round(nf / moving_s * 100),
                        "descent": round(nd / moving_s * 100)},
        "split": {"first_mps": round(split["first"], 3), "second_mps": round(split["second"], 3),
                  "pct": split["pct"]} if split else None,
        "consistency_cv": cv, "best": best, "gap_mps": round(gap, 3) if gap else None,
        "verdict": verdict,
    }


def _fastest_distance(dist, moving, meters) -> int | None:
    """Fastest time (s) to cover `meters` on the 1 Hz distance track (two pointers)."""
    if not dist or dist[-1] is None or dist[-1] < meters:
        return None
    best, j = None, 0
    for i in range(len(dist)):
        if dist[i] is None:
            continue
        while j < len(dist) and (dist[j] is None or dist[j] - dist[i] < meters):
            j += 1
        if j >= len(dist):
            break
        t = j - i
        best = t if best is None or t < best else best
    return best


def _power_card(pw, moving, ftp, weight, indoor, sport="ride") -> dict | None:
    vals = [p if (m and p is not None and p >= 0) else 0 for p, m in zip(pw, moving)]
    mv = [p for p, m in zip(pw, moving) if m and p is not None]
    if len(mv) < 120 or not any(p > 0 for p in mv):
        return None
    avg = sum(p or 0 for p in mv) / len(mv)
    roll = _smooth(vals, 30)
    np_ = (sum(x ** 4 for x in roll[29:]) / max(1, len(roll) - 29)) ** 0.25 if len(roll) > 30 else None
    if_ = np_ / ftp if np_ and ftp else None
    tss = len(mv) * np_ * if_ / (ftp * 3600) * 100 if if_ else None
    zones = None
    if ftp:
        zones, lo = [], 0.0
        for name, label, hi in POWER_ZONES:
            n = sum(1 for p in mv if p is not None and lo * ftp <= p < hi * ftp)
            zones.append({"zone": name, "label": label, "lo": round(lo * ftp), "hi": None if hi > 9 else round(hi * ftp),
                          "secs": n, "pct": round(n / len(mv) * 100)})
            lo = hi
    bests = []
    for w, label in POWER_BESTS:
        b = _rolling_best(vals, w)
        if b is not None:
            bests.append({"secs": w, "label": label, "watts": round(b),
                          "wkg": round(b / weight, 2) if weight else None,
                          "pct_ftp": round(b / ftp * 100) if ftp else None})
    vi = np_ / avg if np_ and avg else None
    if if_ is None:
        verdict = ("Running power — steadier than pace on hills" if sport == "run"
                   else "Set your FTP to see intensity")
    elif if_ < 0.65:
        verdict = f"Recovery-level (IF {if_:.2f})"
    elif if_ < 0.76:
        verdict = f"Endurance (IF {if_:.2f})"
    elif if_ < 0.86:
        verdict = f"Tempo (IF {if_:.2f})"
    elif if_ < 0.96:
        verdict = f"Threshold work (IF {if_:.2f})"
    else:
        verdict = f"Race-hard (IF {if_:.2f})"
    if vi and vi > 1.15:
        verdict += " · surgy — lots of on/off"
    elif vi and vi < 1.05 and len(mv) > 1200:
        verdict += " · smooth, steady power"
    return {
        "avg": round(avg), "np": round(np_) if np_ else None, "max": round(max(mv)),
        "ftp": round(ftp) if ftp else None, "if": round(if_, 2) if if_ else None,
        "vi": round(vi, 2) if vi else None, "tss": round(tss) if tss else None,
        "kj": round(sum(vals) / 1000), "wkg": round((np_ or avg) / weight, 2) if weight else None,
        "zones": zones, "bests": bests, "indoor": indoor, "verdict": verdict,
    }


def _climbs(sport, dist_km, alt, secs, hr, pw) -> list[dict]:
    """Climbs on a 100 m grid: rise ≥ 30 m (ride) / 15 m (run, hike) at ≥ 3 %, small dips tolerated."""
    min_gain = 30 if sport == "ride" else 15
    tol = 10.0
    out = []
    n = len(alt)
    i = 0
    while i < n - 1:
        start, top, j = i, i, i
        while j < n - 1:
            j += 1
            if alt[j] > alt[top]:
                top = j
            elif alt[top] - alt[j] > tol:
                break
        # the climb starts where the road last left its low point, not where the scan began…
        low = min(alt[start:top + 1])
        start = max((k for k in range(start, top + 1) if alt[k] <= low + 2), default=start)
        # …and where it actually gets steep: trim a gentle lead-in (< 2 % over the next 300 m)
        while start + 3 <= top and (alt[start + 3] - alt[start]) / max(
                1e-6, (dist_km[start + 3] - dist_km[start]) * 1000) < 0.02:
            start += 1
        gain = alt[top] - alt[start]
        length = dist_km[top] - dist_km[start]
        if gain >= min_gain and length > 0 and gain / (length * 1000) >= 0.03:
            g = gain / (length * 1000) * 100
            dur = (secs[top] - secs[start]) if secs[top] is not None and secs[start] is not None else None
            steep = max(((alt[k + 1] - alt[k]) / max(1e-6, (dist_km[k + 1] - dist_km[k]) * 1000) * 100
                         for k in range(start, top)), default=g)
            score = length * 1000 * g
            cat = ("HC" if score > 80000 else "1" if score > 64000 else "2" if score > 32000 else
                   "3" if score > 16000 else "4" if score > 8000 else None)
            out.append({
                "from_km": round(dist_km[start], 1), "to_km": round(dist_km[top], 1), "length_km": round(length, 1),
                "gain_m": round(gain), "avg_grade": round(g, 1), "max_grade": round(min(steep, 35), 1),
                "duration_s": round(dur) if dur else None,
                "vam": round(gain / (dur / 3600)) if dur and dur > 60 else None,
                "avg_hr": round(_mean(hr[start:top + 1])) if hr and _mean(hr[start:top + 1]) else None,
                "avg_w": round(_mean(pw[start:top + 1])) if pw and _mean(pw[start:top + 1]) else None,
                "category": cat,
            })
            i = top + 1
        else:
            i = max(i + 1, start + 1)
    return out


def _elev_card(sport, d1, alt1, t1, hr1, pw1) -> tuple[dict | None, list]:
    """Elevation on a 100 m distance grid. Returns (card, grade_per_point_on_grid)."""
    pairs = [(d, a, t, h, p) for d, a, t, h, p in zip(d1, alt1, t1, hr1 or [None] * len(d1), pw1 or [None] * len(d1))
             if d is not None and a is not None]
    if len(pairs) < 30 or pairs[-1][0] - pairs[0][0] < 500:
        return None, []
    grid_d, grid_a, grid_t, grid_h, grid_p = [], [], [], [], []
    nxt = pairs[0][0]
    for d, a, t, h, p in pairs:
        if d >= nxt:
            grid_d.append(d / 1000)
            grid_a.append(a)
            grid_t.append(t)
            grid_h.append(h)
            grid_p.append(p)
            nxt = d + 100
    if len(grid_a) < 5:
        return None, []
    sm = [_mean(grid_a[max(0, k - 1):k + 2]) for k in range(len(grid_a))]   # 300 m smoothing
    gain = loss = 0.0
    ref = sm[0]
    for a in sm[1:]:                                                        # 2 m hysteresis
        if a - ref >= 2:
            gain += a - ref
            ref = a
        elif ref - a >= 2:
            loss += ref - a
            ref = a
    grades = [0.0] + [(sm[k] - sm[k - 1]) / max(1e-6, (grid_d[k] - grid_d[k - 1]) * 1000) * 100
                      for k in range(1, len(sm))]
    total_km = grid_d[-1] - grid_d[0]
    climbing = sum(1 for g in grades if g > 2) / len(grades) * 100
    descending = sum(1 for g in grades if g < -2) / len(grades) * 100
    max_grade = max((_mean(grades[k:k + 2]) for k in range(len(grades) - 1)), default=0)   # 200 m sustained
    per_km = gain / total_km if total_km else 0
    climbs = _climbs(sport, grid_d, sm, grid_t, grid_h, grid_p)
    if per_km < 5:
        verdict = "Flat"
    elif per_km < 10:
        verdict = "Rolling"
    elif per_km < 20:
        verdict = "Hilly"
    else:
        verdict = "Mountainous"
    verdict += f" — {round(per_km)} m of climbing per km"
    if climbs:
        big = max(climbs, key=lambda c: c["gain_m"])
        verdict += f" · biggest climb {big['gain_m']} m at {big['avg_grade']}%"
    return {
        "gain_m": round(gain), "loss_m": round(loss), "min_m": round(min(sm)), "max_m": round(max(sm)),
        "m_per_km": round(per_km, 1), "max_grade": round(max_grade or 0, 1),
        "terrain_pct": {"climb": round(climbing), "descent": round(descending),
                        "flat": max(0, 100 - round(climbing) - round(descending))},
        "climbs": climbs, "verdict": verdict,
    }, list(zip(grid_d, grades))


def _cad_card(sport, cad, moving) -> dict | None:
    vals = [c for c, m in zip(cad, moving) if m and c and c > (20 if sport == "ride" else 100)]
    if len(vals) < 120:
        return None
    avg = sum(vals) / len(vals)
    if sport == "ride":
        bands = [("< 70", 0, 70), ("70–80", 70, 80), ("80–90", 80, 90), ("90–100", 90, 100), ("100+", 100, 999)]
        sweet = sum(1 for c in vals if 80 <= c < 100) / len(vals) * 100
        verdict = (f"Spinning well — {round(sweet)}% at 80–100 rpm" if sweet >= 60 else
                   "Grinding — low cadence most of the time" if avg < 75 else "Mixed cadence")
        unit = "rpm"
    else:
        bands = [("< 160", 0, 160), ("160–170", 160, 170), ("170–180", 170, 180), ("180+", 180, 999)]
        sweet = sum(1 for c in vals if 170 <= c < 190) / len(vals) * 100
        verdict = (f"Quick feet — {round(sweet)}% at 170+ spm" if sweet >= 50 else
                   "Long, slow strides — a few more steps per minute is easier on the legs" if avg < 165
                   else "Moderate cadence")
        unit = "spm"
    dist = [{"band": b, "pct": round(sum(1 for c in vals if lo <= c < hi) / len(vals) * 100)} for b, lo, hi in bands]
    return {"avg": round(avg), "max": round(max(vals)), "unit": unit, "bands": dist, "verdict": verdict}


# ── series for the charts ────────────────────────────────────────────────────

def _series(sport, secs, s1, moving, grade_grid, use_distance) -> dict:
    n = len(secs)
    step = max(1, n // MAX_SERIES)
    spd_s = _smooth(s1.get("spd") or [], 15) if s1.get("spd") else None
    pw_s = _smooth(s1.get("pw") or [], 10) if s1.get("pw") else None
    grid_d = [g[0] for g in grade_grid]
    pts = []
    for i in range(0, n, step):
        d = s1["d"][i] if s1.get("d") else None
        x = round(d / 1000, 3) if use_distance and d is not None else round(secs[i] / 60, 2)
        p = {"x": x}
        if s1.get("hr") and s1["hr"][i]:
            p["hr"] = round(s1["hr"][i])
        if spd_s and moving[i]:
            p["spd"] = round(spd_s[i] * 3.6, 1)
        if s1.get("alt") and s1["alt"][i] is not None:
            p["alt"] = round(s1["alt"][i], 1)
        if pw_s and moving[i]:
            p["pw"] = round(pw_s[i])
        cad = s1.get("cad")
        if cad and cad[i]:
            p["cad"] = round(cad[i])
        if grid_d and d is not None:
            k = bisect_right(grid_d, d / 1000) - 1
            if k >= 0:
                p["grade"] = round(grade_grid[k][1], 1)
        pts.append(p)
    return {"x_unit": "km" if use_distance else "min", "points": pts}


# ── entry point ──────────────────────────────────────────────────────────────

def _signature(conn, act, sport) -> str:
    z = _zone_row(conn, sport if sport in ("ride", "run", "swim") else "run", act["date"])
    zsig = f"{z['valid_from']}:{z['max_hr']}:{z['threshold_hr']}:{z['ftp_w']}" if z is not None else "-"
    nstreams = conn.execute("SELECT COUNT(*) FROM activity_streams WHERE activity_id=?", (act["id"],)).fetchone()[0]
    extra = ""
    if sport == "ride" and not is_indoor(act["activity_type"]):
        try:
            from domains.training.est_power import model_signature
            wind = conn.execute("SELECT 1 FROM activity_wind WHERE activity_id=? AND result_json IS NOT NULL",
                                (act["id"],)).fetchone()
            extra = f"|w{1 if wind else 0}|{model_signature(conn, act['date'])}"
        except sqlite3.OperationalError:
            pass
    return f"v{VERSION}|{zsig}|{_plan_zone(conn, act['id'])}|{nstreams}{extra}"


def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS activity_analysis (
        activity_id TEXT PRIMARY KEY, signature TEXT, result_json TEXT,
        computed_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")
    conn.commit()


def analyze(conn: sqlite3.Connection, activity_id: str, use_cache: bool = True) -> dict | None:
    act = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
    if act is None:
        return None
    try:
        conn.execute("SELECT 1 FROM activity_streams LIMIT 1")
    except sqlite3.OperationalError:
        return None
    sport = sport_of(act["activity_type"])
    ensure_table(conn)
    sig = _signature(conn, act, sport)
    if use_cache:
        c = conn.execute("SELECT signature, result_json FROM activity_analysis WHERE activity_id=?",
                         (activity_id,)).fetchone()
        if c and c[0] == sig:
            return json.loads(c[1]) if c[1] else None
    result = _analyze(conn, act, sport)
    conn.execute("INSERT OR REPLACE INTO activity_analysis (activity_id, signature, result_json) VALUES (?,?,?)",
                 (activity_id, sig, json.dumps(result) if result else None))
    conn.commit()
    return result


def _analyze(conn, act, sport) -> dict | None:
    st = _load(conn, act["id"])
    if "t" not in st and st.get("ts"):
        t0 = next((x for x in st["ts"] if x is not None), None)
        st["t"] = [(x - t0) / 1000 if x is not None and t0 is not None else None for x in st["ts"]]
    if "t" not in st:
        return None
    cad = None
    if sport == "ride":
        cad = st.get("bcad")
    elif sport in ("run", "hike"):
        if st.get("rcad2"):
            cad = st["rcad2"]
        elif st.get("rcad"):
            med = sorted(c for c in st["rcad"] if c)[len([c for c in st["rcad"] if c]) // 2] if any(st["rcad"]) else 0
            cad = [c * 2 if c is not None else None for c in st["rcad"]] if med and med < 120 else st["rcad"]
    series = {k: st[k] for k in ("d", "hr", "spd", "alt", "pw", "gap", "temp") if k in st}
    if cad:
        series["cad"] = cad
    secs, s1, moving = resample_1hz(st["t"], series)
    if len(secs) < 120:
        return None
    # speed from distance when the device didn't record it
    if not s1.get("spd") and s1.get("d"):
        d = s1["d"]
        s1["spd"] = [None] + [(d[i] - d[i - 1]) if d[i] is not None and d[i - 1] is not None else None
                              for i in range(1, len(d))]
        s1["spd"] = _smooth(s1["spd"], 5)
    # motion: auto-pause gaps already excluded; also stop when barely moving (only with speed data)
    if s1.get("spd"):
        thr = 0.8 if sport == "ride" else 0.3
        moving = [m and (s is None or s > thr or bool(s1.get("pw") and (s1["pw"][i] or 0) > 0))
                  for i, (m, s) in enumerate(zip(moving, s1["spd"]))]

    zsport = sport if sport in ("ride", "run", "swim") else "run"
    zrow = _zone_row(conn, zsport, act["date"])
    hr_seen = max((h for h in (s1.get("hr") or []) if h), default=None)
    bands, max_hr = _hr_bands(zrow, act["max_heart_rate"] or hr_seen)
    computed = None
    try:
        r = conn.execute("SELECT decoupling_pct, efficiency_factor FROM activity_detail WHERE activity_id=?",
                         (act["id"],)).fetchone()
        computed = dict(r) if r else None
    except sqlite3.OperationalError:
        pass
    indoor = is_indoor(act["activity_type"])
    has_dist = bool(s1.get("d")) and (s1["d"][-1] or 0) > 500 and not (indoor and sport == "ride")

    elev, grade_grid = (None, [])
    if has_dist and s1.get("alt") and not indoor:
        elev, grade_grid = _elev_card(sport, s1["d"], s1["alt"], secs, s1.get("hr"), s1.get("pw"))
    grade_1hz = [None] * len(secs)
    if grade_grid and s1.get("d"):
        gd = [g[0] for g in grade_grid]
        for i, d in enumerate(s1["d"]):
            if d is not None:
                k = bisect_right(gd, d / 1000) - 1
                grade_1hz[i] = grade_grid[k][1] if k >= 0 else None

    iv = _intervals(sport, s1, moving, bands)
    hr = _hr_card(s1["hr"], moving, bands, max_hr, zrow["threshold_hr"] if zrow is not None else None,
                  _plan_zone(conn, act["id"]), s1.get("spd"), computed, iv) if s1.get("hr") else None
    pace = (_pace_card(sport, s1["spd"], s1.get("d"), grade_1hz, moving, s1.get("gap"), iv)
            if s1.get("spd") and has_dist and sport != "swim" else None)
    ftp = zrow["ftp_w"] if zrow is not None and sport == "ride" else None
    weight = _weight(conn, act["date"])
    est = None
    if sport == "ride" and not indoor and not s1.get("pw") and s1.get("spd") and grade_grid:
        # no power meter on the road bike: estimate it (physics + the HR line learned on the trainer)
        try:
            from domains.training import est_power
            est = est_power.estimate(conn, act, s1, moving, grade_1hz, weight)
        except Exception:
            est = None
        if est:
            s1["pw"] = est["watts"]
            elev, grade_grid = _elev_card(sport, s1["d"], s1["alt"], secs, s1.get("hr"), s1["pw"])   # climbs get watts
    power = _power_card(s1["pw"], moving, ftp, weight, indoor, sport) if s1.get("pw") else None
    if power and est:
        power["estimated"] = est["meta"]
        power["verdict"] = "Estimated · " + power["verdict"]
    cadence = _cad_card(sport, s1["cad"], moving) if s1.get("cad") else None
    temp = [t for t, m in zip(s1.get("temp") or [], moving) if m and t is not None]

    try:
        from domains.training import efforts as eff
        found = eff.compute(sport if not indoor else "indoor", s1.get("d") if has_dist else None,
                            (power or {}).get("bests") if sport == "ride" and not est else None)
        if indoor and sport == "ride" and power:          # trainer rides still count for power bests
            found = eff.compute("ride", None, power.get("bests"))
        eff.store(conn, act["id"], act["date"], sport, found)
    except Exception:
        pass

    if not any((hr, pace, power, elev, cadence)):
        return None
    return {
        "sport": sport, "indoor": indoor,
        "moving_s": sum(1 for m in moving if m), "elapsed_s": len(secs),
        "temp_c": {"avg": round(sum(temp) / len(temp)), "min": round(min(temp)), "max": round(max(temp))}
        if len(temp) > 60 else None,
        "hr": hr, "pace": pace, "power": power, "elevation": elev, "cadence": cadence, "intervals": iv,
        "series": _series(sport, secs, s1, moving, grade_grid, has_dist),
    }


def main() -> None:
    """Precompute analyses (and ride wind) for recent activities so the Pi never computes on view."""
    import argparse
    from datetime import date, timedelta

    from infrastructure.db.connection import get_connection

    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--no-wind", action="store_true", help="skip the wind fetch (history backfills)")
    args = ap.parse_args()
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    since = (date.today() - timedelta(days=args.days)).isoformat()
    ids = [r[0] for r in conn.execute("SELECT id FROM activities WHERE date >= ? ORDER BY date", (since,))]
    try:                                                     # wind first: the ride power estimate reads it
        from domains.health.ride_wind import compute as wind
        for aid in ([] if args.no_wind else ids):
            wind(conn, aid)
    except Exception as e:                                   # wind is best-effort (network)
        print(f"[activity_analysis] wind skipped: {e}")
    done = 0
    for aid in ids:
        if analyze(conn, aid):
            done += 1
    try:                                                     # new roads / villages per ride (cached)
        from domains.locations.ride_explore import get as explore
        for aid in ids:
            explore(conn, aid)
    except Exception as e:
        print(f"[activity_analysis] explore skipped: {e}")
    print(f"[activity_analysis] {done}/{len(ids)} activities analysed since {since}")


if __name__ == "__main__":
    main()
