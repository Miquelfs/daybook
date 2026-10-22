"""
A planned route (GPX course, e.g. exported from Garmin Connect) → what the day asks of you.

  distance      summed from the track points
  climbing      Garmin-style (0.5 m hysteresis) on the raw elevation, then on a
                tunnel-corrected profile: map-based elevation follows the hill
                *above* a tunnel, so a coastal road "climbs" hundreds of metres at
                20 %+ and drops straight back. Spikes that rise ≥ 120 m at ≥ 12 %
                and fall back within a few km are bridged with a straight line.
  climbs        the day's real climbs (≥ 80 m gained, ≥ 2 % average, max 200 m grade)
  time          speed-by-gradient model for a loaded touring bike (~21 km/h flat,
                9 km/h at 5–8 %), riding time only, no stops
  load          estimated TSS: steady Z2 touring, a little harder the hillier it is

Nothing here touches the database: `parse()` takes GPX text and returns a dict.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET

from domains.health.geo import dist_m, encode

STEP_M = 100                    # resampling for grades / climbs / time
CLIMB_TH_M = 0.5                # Garmin-like ascent hysteresis
TUNNEL_RISE_M, TUNNEL_GRADE, TUNNEL_SPAN_M, TUNNEL_FOOT = 120, 0.12, 3000, 0.08
# km/h by gradient band (upper bound %, speed) — loaded flat-bar touring bike
SPEED = [(-3, 30.0), (-1, 25.5), (1, 21.5), (3, 17.5), (5, 12.5), (8, 9.0), (10, 7.0), (99, 5.5)]


def _points(gpx: str) -> tuple[str | None, list[tuple[float, float, float | None]]]:
    root = ET.fromstring(gpx)
    ns = {"g": root.tag.split("}")[0].strip("{")} if root.tag.startswith("{") else {}
    q = (lambda t: f"g:{t}") if ns else (lambda t: t)
    name = None
    for path in (f"{q('metadata')}/{q('name')}", f"{q('trk')}/{q('name')}", f"{q('rte')}/{q('name')}"):
        el = root.find(path, ns)
        if el is not None and el.text:
            name = el.text.strip()
            break
    pts = []
    for tag in ("trkpt", "rtept"):
        for p in root.iter(f"{{{ns['g']}}}{tag}" if ns else tag):
            ele = p.find(q("ele"), ns)
            pts.append((float(p.get("lat")), float(p.get("lon")),
                        float(ele.text) if ele is not None and ele.text else None))
        if pts:
            break
    return name, pts


def _ascent(eles: list[float]) -> float:
    gain, ref = 0.0, eles[0]
    for e in eles[1:]:
        if e > ref + CLIMB_TH_M:
            gain += e - ref
            ref = e
        elif e < ref - CLIMB_TH_M:
            ref = e
    return gain


def _resample(cum: list[float], eles: list[float], step: float) -> list[float]:
    """Elevation every `step` metres along the track (linear between points)."""
    out, j = [], 0
    d = 0.0
    while d <= cum[-1]:
        while j < len(cum) - 2 and cum[j + 1] < d:
            j += 1
        span = cum[j + 1] - cum[j] or 1
        t = min(1.0, max(0.0, (d - cum[j]) / span))
        out.append(eles[j] + (eles[j + 1] - eles[j]) * t)
        d += step
    return out


def _detunnel(cum: list[float], eles: list[float]) -> tuple[list[float], list[dict]]:
    """Bridge spikes that are tunnels (or bridges over valleys mapped as the ground below)."""
    e = list(eles)
    tunnels = []
    n = len(e)
    i = 1
    while i < n - 1:
        if not (e[i] >= e[i - 1] and e[i] >= e[i + 1]):
            i += 1
            continue
        # walk out to the foot of the spike on each side: while the slope stays steep (≥ 8 % over ~100 m),
        # so a real road climb leading up to a tunnel mouth isn't flattened with it
        lo_l = i
        while lo_l > 0 and cum[i] - cum[lo_l] <= TUNNEL_SPAN_M:
            j = lo_l - 1
            while j > 0 and cum[lo_l] - cum[j] < 100:
                j -= 1
            if (e[lo_l] - e[j]) / max(1.0, cum[lo_l] - cum[j]) < TUNNEL_FOOT and e[i] - e[lo_l] >= 30:
                break                                    # (a rounded crest doesn't count as the foot)
            lo_l = j
        lo_r = i
        while lo_r < n - 1 and cum[lo_r] - cum[i] <= TUNNEL_SPAN_M:
            j = lo_r + 1
            while j < n - 1 and cum[j] - cum[lo_r] < 100:
                j += 1
            if (e[lo_r] - e[j]) / max(1.0, cum[j] - cum[lo_r]) < TUNNEL_FOOT and e[i] - e[lo_r] >= 30:
                break
            lo_r = j
        rise_l, rise_r = e[i] - e[lo_l], e[i] - e[lo_r]
        run_l, run_r = max(1.0, cum[i] - cum[lo_l]), max(1.0, cum[lo_r] - cum[i])
        if (min(rise_l, rise_r) >= TUNNEL_RISE_M and rise_l / run_l >= TUNNEL_GRADE
                and rise_r / run_r >= TUNNEL_GRADE):
            a, b = lo_l, lo_r
            for j in range(a + 1, b):
                t = (cum[j] - cum[a]) / max(1.0, cum[b] - cum[a])
                e[j] = e[a] + (e[b] - e[a]) * t
            tunnels.append({"from_km": round(cum[a] / 1000, 1), "to_km": round(cum[b] / 1000, 1),
                            "length_km": round((cum[b] - cum[a]) / 1000, 1), "peak_m": round(eles[i])})
            i = b
        else:
            i += 1
    return e, tunnels


def _climbs(prof: list[float]) -> list[dict]:
    """Climbs on a 100 m profile: from a low point to the top, tolerating dips < 40 m."""
    out, i, n = [], 0, len(prof)
    while i < n - 1:
        start, top = i, i
        j = i
        while j < n - 1:
            j += 1
            if prof[j] > prof[top]:
                top = j
            elif prof[top] - prof[j] > 40:
                break
        # the climb starts at the last low point before the top, not at the end of the flat before it
        low = min(prof[start:top + 1])
        start = max(k for k in range(start, top + 1) if prof[k] <= low + 3)
        gain = prof[top] - prof[start]
        length = (top - start) * STEP_M
        if gain >= 80 and length > 0 and gain / length >= 0.02:
            g200 = max(((prof[k + 2] - prof[k]) / 200 for k in range(start, top - 1)), default=gain / length)
            out.append({"km": round(start * STEP_M / 1000), "length_km": round(length / 1000, 1),
                        "gain_m": round(gain), "avg_pct": round(gain / length * 100, 1),
                        "max_200m_pct": round(g200 * 100)})
            i = top
        else:
            i = max(i + 1, top if top > i else i + 1)
    return out


def _speed(grade_pct: float) -> float:
    return next(v for lim, v in SPEED if grade_pct < lim)


def estimate_tss(minutes: float, climb_m: float, km: float) -> int:
    """Steady Z2 touring (~IF 0.60), a little more the hillier the day (~IF 0.66 at 15 m/km)."""
    per_km = climb_m / km if km else 0
    if_ = 0.60 + 0.06 * min(1.0, per_km / 15)
    return round(minutes / 60 * 100 * if_ ** 2)


def parse(gpx: str, fallback_name: str | None = None) -> dict:
    name, pts = _points(gpx)
    if len(pts) < 2:
        raise ValueError("no track points in the GPX")
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + dist_m(a[:2], b[:2]))
    km = cum[-1] / 1000
    has_ele = all(p[2] is not None for p in pts)
    eles = [p[2] or 0.0 for p in pts]
    raw_ascent = _ascent(eles) if has_ele else 0.0
    fixed, tunnels = _detunnel(cum, eles) if has_ele else (eles, [])
    ascent = _ascent(fixed) if has_ele else 0.0
    prof = _resample(cum, fixed, STEP_M) if has_ele else [0.0] * (int(cum[-1] // STEP_M) + 1)

    secs = 0.0
    at = [0.0]                                   # riding seconds at each 100 m mark
    for a, b in zip(prof, prof[1:]):
        secs += STEP_M / (_speed((b - a) / STEP_M * 100) / 3.6)
        at.append(secs)
    tail = cum[-1] - (len(prof) - 1) * STEP_M
    secs += max(0.0, tail) / (_speed(0) / 3.6)
    minutes = round(secs / 60)

    # polyline thinned to ~25 m for maps; profile every 500 m for charts
    thin, last = [pts[0][:2]], 0.0
    for p, c in zip(pts[1:], cum[1:]):
        if c - last >= 25:
            thin.append(p[:2])
            last = c
    thin.append(pts[-1][:2])
    return {
        "name": name or fallback_name or "Course",
        "km": round(km, 1), "climb_m": round(ascent), "climb_raw_m": round(raw_ascent),
        "high_m": round(max(fixed)) if has_ele else None, "has_elevation": has_ele,
        "minutes": minutes, "avg_kmh": round(km / (secs / 3600), 1) if secs else None,
        "tss": estimate_tss(minutes, ascent, km),
        "climbs": [dict(c, start_min=round(at[min(len(at) - 1, int(c["km"] * 1000 / STEP_M))] / 60),
                        minutes=max(1, round((at[min(len(at) - 1, int((c["km"] + c["length_km"]) * 1000 / STEP_M))]
                                              - at[min(len(at) - 1, int(c["km"] * 1000 / STEP_M))]) / 60)))
                   for c in _climbs(prof)] if has_ele else [],
        "tunnels": tunnels,
        "start": [round(pts[0][0], 5), round(pts[0][1], 5)], "end": [round(pts[-1][0], 5), round(pts[-1][1], 5)],
        "polyline": encode(thin),
        "profile": [[round(i * 0.5, 1), round(prof[min(len(prof) - 1, i * 5)])] for i in range(int(len(prof) / 5) + 1)],
    }


def structure(course: dict, label: str) -> list[dict]:
    """The day as workout steps: settle in, steady Z2 between climbs, each named climb capped at low Z3."""
    total = course["minutes"]
    steps, t = [], 0
    for c in course["climbs"]:
        start = max(t, c["start_min"])
        if start - t >= 5:
            steps.append({"kind": "steady", "label": "Settle in, then steady touring" if t == 0 else "Steady touring",
                          "duration_min": start - t, "zone": "Z2",
                          "cue": "Conversational; eat from minute 20, then every 45 min" if t == 0 else "Conversational, keep eating"})
        gentle = c["avg_pct"] < 3
        steps.append({"kind": "steady", "label": f"Climb at km {c['km']}: {c['length_km']} km, +{c['gain_m']} m",
                      "duration_min": c["minutes"], "zone": "Z2" if gentle else "Z3",
                      "cue": (f"avg {c['avg_pct']}% — long and gentle: stay Z2, don't chase it" if gentle else
                              f"avg {c['avg_pct']}%, max {c['max_200m_pct']}% — low Z3 at most, spin a small gear")})
        t = start + c["minutes"]
    if total - t > 0:
        steps.append({"kind": "steady", "label": "Steady touring to the finish" if steps else label,
                      "duration_min": total - t, "zone": "Z2",
                      "cue": f"{course['km']:.0f} km · +{course['climb_m']} m — conversational Z2, keep eating"})
    return steps
