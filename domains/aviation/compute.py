"""
Aviation computations: great-circle distance and night-time split.

Night-time is defined as the period between civil twilight end (evening)
and civil twilight start (morning), using the departure airport position.

We handle flights crossing midnight by computing twilight for both dates
and taking the union of night windows that overlap with the flight.
"""

import math
from datetime import datetime, timedelta, timezone

try:
    from astral import LocationInfo
    from astral.sun import sun as astral_sun

    _ASTRAL_AVAILABLE = True
except ImportError:
    _ASTRAL_AVAILABLE = False


def great_circle_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance in nautical miles."""
    r_nm = 3440.065
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * r_nm * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _night_windows(lat: float, lon: float, date_utc) -> list[tuple[datetime, datetime]]:
    """
    Return a list of (night_start, night_end) UTC intervals for the given date
    at the given coordinates. Uses civil twilight (dusk→dawn).

    A date may produce two windows: pre-dawn (midnight→dawn) and post-dusk (dusk→midnight).
    """
    loc = LocationInfo(latitude=lat, longitude=lon)
    midnight = datetime(date_utc.year, date_utc.month, date_utc.day, tzinfo=timezone.utc)
    next_midnight = midnight + timedelta(days=1)

    try:
        s = astral_sun(loc.observer, date=date_utc, tzinfo=timezone.utc)
    except Exception:
        return []

    dawn = s.get("dawn")
    dusk = s.get("dusk")

    windows = []
    if dawn:
        windows.append((midnight, dawn))       # pre-dawn darkness
    if dusk:
        windows.append((dusk, next_midnight))  # post-dusk darkness

    return windows


def is_night_moment(lat: float, lon: float, dt_utc: datetime) -> bool:
    """Return True if the given UTC moment is during night at the given coordinates."""
    if not _ASTRAL_AVAILABLE or lat is None or lon is None or dt_utc is None:
        return False
    for win_start, win_end in _night_windows(lat, lon, dt_utc.date()):
        if win_start <= dt_utc <= win_end:
            return True
    return False


def night_seconds(
    dep_lat: float,
    dep_lon: float,
    takeoff_utc: datetime,
    landing_utc: datetime,
    arr_lat: float | None = None,
    arr_lon: float | None = None,
) -> int:
    """
    Return seconds of the flight (takeoff→landing) that occur during night
    (civil twilight dusk→dawn).

    Uses departure coords for windows around takeoff, arrival coords for windows
    around landing. Where only one set of coords is available, that set is used
    for the full flight. Handles flights crossing midnight UTC.
    """
    if not _ASTRAL_AVAILABLE:
        return 0
    if takeoff_utc is None or landing_utc is None:
        return 0

    total = (landing_utc - takeoff_utc).total_seconds()
    if total <= 0:
        return 0

    # Use arrival coords if available, otherwise fall back to departure coords
    eff_arr_lat = arr_lat if arr_lat is not None else dep_lat
    eff_arr_lon = arr_lon if arr_lon is not None else dep_lon

    # Collect all night windows: dep coords for dep-date(s), arr coords for arr-date(s)
    all_windows: list[tuple[datetime, datetime]] = []
    for d in {takeoff_utc.date(), landing_utc.date()}:
        all_windows.extend(_night_windows(dep_lat, dep_lon, d))
        if (eff_arr_lat, eff_arr_lon) != (dep_lat, dep_lon):
            all_windows.extend(_night_windows(eff_arr_lat, eff_arr_lon, d))

    # Merge overlapping windows to avoid double-counting
    all_windows.sort(key=lambda w: w[0])
    merged: list[tuple[datetime, datetime]] = []
    for ws, we in all_windows:
        if merged and ws <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], we))
        else:
            merged.append((ws, we))

    night = 0.0
    for win_start, win_end in merged:
        overlap_start = max(takeoff_utc, win_start)
        overlap_end = min(landing_utc, win_end)
        if overlap_end > overlap_start:
            night += (overlap_end - overlap_start).total_seconds()

    return int(min(night, total))


def hhmm_to_seconds(hhmm: str) -> int | None:
    """Convert 'H:MM' or 'HH:MM' string to total seconds. Returns None on error."""
    if not hhmm or ":" not in hhmm:
        return None
    try:
        h, m = hhmm.strip().split(":")
        return int(h) * 3600 + int(m) * 60
    except ValueError:
        return None
