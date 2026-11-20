"""
Naps — logged with the `nap` tag on the day (TagPicker: a duration and the time you woke,
packed into the tag note as "45min @16:30"), and the ones Garmin detects. One list for the
sleep page; the stress/energy timeline places the same nap from the same note.
"""

from __future__ import annotations

import re
import sqlite3
from typing import Optional


def duration_to_min(s: str) -> Optional[int]:
    """Tolerant free-text duration → minutes. Handles '45min', '45m', '45',
    '1h', '1h30', '1h30m', '1.5h', '90'. Bare numbers are read as minutes."""
    if not s:
        return None
    s = s.lower().strip()
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m?)?\s*$", s)
    if m:
        return int(round(float(m.group(1)) * 60 + (float(m.group(2)) if m.group(2) else 0)))
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(?:min|mins|m)?\s*$", s)
    if m:
        return int(round(float(m.group(1))))
    num = re.search(r"(\d+(?:\.\d+)?)", s)
    return int(round(float(num.group(1)))) if num else None


def parse_nap_note(note: str) -> tuple[Optional[str], Optional[int]]:
    """Nap tag note is '<duration> @<HH:MM end>' (end optional, back-compatible
    with plain '<duration>'). Returns (end_hhmm | None, duration_min | None)."""
    if not note:
        return None, None
    end = None
    m = re.search(r"@\s*(\d{1,2}):(\d{2})", note)
    if m:
        h, mm = int(m.group(1)), int(m.group(2))
        if 0 <= h < 24 and 0 <= mm < 60:
            end = f"{h:02d}:{mm:02d}"
    dur_text = re.sub(r"@\s*\d{1,2}:\d{2}", "", note).strip()
    return end, duration_to_min(dur_text)


def _hhmm(m: int) -> str:
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def tagged(conn: sqlite3.Connection, start: str, end: str) -> list[dict]:
    """Naps from the `nap` tag between two dates: {date, start, end, seconds, source}. A tag without
    a duration still counts as a nap (seconds None)."""
    try:
        rows = conn.execute(
            """SELECT dt.date, dt.note FROM day_tags dt JOIN tags t ON t.id = dt.tag_id
               WHERE t.slug = 'nap' AND dt.date BETWEEN ? AND ? ORDER BY dt.date""", (start, end)).fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for d, note in rows:
        woke, mins = parse_nap_note(note or "")
        began = _hhmm(int(woke[:2]) * 60 + int(woke[3:5]) - mins) if woke and mins else None
        out.append({"date": d, "start": began, "end": woke, "seconds": mins * 60 if mins else None, "source": "tag"})
    return out


def merged(tag_naps: list[dict], garmin_naps: list[dict]) -> list[dict]:
    """Your tags first; a Garmin nap on a day you already tagged is the same nap."""
    tagged_days = {n["date"] for n in tag_naps}
    return tag_naps + [{**n, "source": "garmin"} for n in garmin_naps if n["date"] not in tagged_days]
