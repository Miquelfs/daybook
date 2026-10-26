"""
The one heart-rate zone table per sport. Writers store it in athlete_zones.zones_json;
the activity analysis, the zone metrics, the plan card and the Garmin targets all read
that stored table — so the watch's "Z2" and Daybook's "Z2" are the same beats.

With a threshold HR (from a test), zones are % of it (Friel; the run's Z2 starts at
81% as in 80/20 running, so it spans the whole easy range). Without one, % of max HR.
"""

from __future__ import annotations

import json

NAMES = ("Z1", "Z2", "Z3", "Z4", "Z5")
# upper bounds of Z1–Z4 (Z5 is everything above)
LTHR_BOUNDS = {"run": (0.81, 0.90, 0.95, 1.00), "ride": (0.81, 0.90, 0.94, 1.00)}
MAX_BOUNDS = (0.65, 0.75, 0.82, 0.88)
OPEN_TOP = 999


def bands(sport: str, threshold_hr: float | None, max_hr: float | None) -> list[dict]:
    if threshold_hr:
        cuts = [round(threshold_hr * b) for b in LTHR_BOUNDS.get(sport, LTHR_BOUNDS["ride"])]
    else:
        cuts = [round((max_hr or 195) * b) for b in MAX_BOUNDS]
    edges = [0, *cuts, OPEN_TOP]
    return [{"name": n, "min_hr": edges[i], "max_hr": edges[i + 1]} for i, n in enumerate(NAMES)]


def zones_json(sport: str, threshold_hr: float | None, max_hr: float | None) -> str:
    return json.dumps(bands(sport, threshold_hr, max_hr))


def stored(row, sport: str) -> list[dict]:
    """The row's stored table, or the built one when it has none."""
    try:
        z = json.loads(row["zones_json"] or "[]") if row is not None else []
        if z:
            return z
    except (ValueError, TypeError, KeyError, IndexError):
        pass
    return bands(sport, row["threshold_hr"] if row is not None else None, row["max_hr"] if row is not None else None)


def watch_targets(zones: list[dict], max_hr: float | None) -> dict[str, tuple[int, int]]:
    """{zone: (lo, hi)} bpm for a watch target: Z1 gets a floor, Z5 a ceiling."""
    out = {}
    for b in zones:
        lo, hi = b["min_hr"], b["max_hr"]
        if b["name"] == "Z1":
            lo = max(0, hi - 25)
        hi = min(hi, round(max_hr or 220)) if hi >= OPEN_TOP else hi - 1
        out[b["name"]] = (lo, hi)
    return out
