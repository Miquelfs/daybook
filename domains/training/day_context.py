"""
How much training a calendar day can actually hold, for a pilot.

day_context(conn, date) combines:
  - roster (duty_type, report/end times) and roster_legs (layovers: the day's
    last leg lands away from base → you sleep away),
  - auto-detected trips (nights away from home, from GPS),
  - last night's sleep (sleep.date = the morning you woke up),
  - the user's own available weekdays,
into a ride *window* (minutes) and whether a hard session fits.

Rules of thumb (all local times):
  - Day off: whole day (capped 10h). If the previous duty ended late (≥ 23:00
    or after midnight) the day starts at 10:30 instead of 07:30.
  - Flying / ground duty with a report time: ride before it, ending 90 min
    before report (commute + prep). An early duty (ends ≤ 15:00) also opens an
    evening window until 20:00. The larger window wins.
  - Standby: 90 min, stay close (trainer or a short local loop).
  - Woke up away (layover / trip) → 0. Leaving on a layover is fine before report.
Days without roster data fall back to the available-weekday default.

Used by domains.training.reflow (weekly placement) and by the day prescription
(today's advice: shorten / downgrade / swap).
"""

from __future__ import annotations

import sqlite3
from collections import Counter
from datetime import date, datetime, timedelta
from functools import lru_cache

FULL_DAY_MIN = 600
DAY_START = "07:30"
LATE_DAY_START = "10:30"
EVENING_END = "20:00"
PRE_REPORT_BUFFER_MIN = 90
POST_DUTY_BUFFER_MIN = 60
STANDBY_WINDOW_MIN = 90
HARD_MIN_WINDOW = 75     # a key session needs at least this much room
DEFAULT_BASE = "PMI"


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def _mins(hhmm: str | None) -> int | None:
    if not hhmm or ":" not in hhmm:
        return None
    try:
        h, m = hhmm.split(":")[:2]
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def _fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _is_late_end(end_hhmm: str | None) -> bool:
    m = _mins(end_hhmm)
    # ≥ 23:00, or a small hour (duty ran past midnight; roster shows e.g. 00:45)
    return m is not None and (m >= 23 * 60 or m <= 5 * 60)


class DayContextReader:
    """Batches lookups for one connection (reflow asks for many dates)."""

    def __init__(self, conn: sqlite3.Connection, available_days: list[str] | None = None):
        self.conn = conn
        self.tables = _tables(conn)
        self.available = {d.strip()[:3].lower() for d in (available_days or []) if d.strip()}
        self.base = self._home_base()

    # ── raw lookups ──────────────────────────────────────────────────────────
    def _home_base(self) -> str:
        if "roster_legs" not in self.tables:
            return DEFAULT_BASE
        rows = self.conn.execute(
            """SELECT dep_iata FROM roster_legs l
               WHERE leg_order = (SELECT MIN(leg_order) FROM roster_legs WHERE date = l.date)
               ORDER BY date DESC LIMIT 60"""
        ).fetchall()
        c = Counter(r[0] for r in rows if r[0])
        return c.most_common(1)[0][0] if c else DEFAULT_BASE

    @lru_cache(maxsize=512)
    def roster(self, d: str) -> dict | None:
        if "roster" not in self.tables:
            return None
        r = self.conn.execute(
            "SELECT duty_type, report_time, end_time, raw_code FROM roster WHERE date=?", (d,)
        ).fetchone()
        return dict(zip(("duty_type", "report_time", "end_time", "raw_code"), r)) if r else None

    @lru_cache(maxsize=512)
    def legs(self, d: str) -> tuple:
        if "roster_legs" not in self.tables:
            return ()
        return tuple(self.conn.execute(
            "SELECT dep_iata, arr_iata, dep_time, arr_time FROM roster_legs WHERE date=? ORDER BY leg_order",
            (d,),
        ).fetchall())

    @lru_cache(maxsize=512)
    def on_trip(self, d: str) -> bool:
        if "trips" not in self.tables:
            return False
        cols = {r[1] for r in self.conn.execute("PRAGMA table_info(trips)")}
        hide = " AND hidden = 0" if "hidden" in cols else ""
        return bool(self.conn.execute(
            f"SELECT 1 FROM trips WHERE start_date <= ? AND end_date >= ?{hide} LIMIT 1", (d, d)
        ).fetchone())

    def night_away(self, d: str) -> bool:
        legs = self.legs(d)
        if legs and legs[-1][1] and legs[-1][1] != self.base:
            return True
        return self.on_trip(d)

    @lru_cache(maxsize=512)
    def block(self, d: str) -> str | None:
        """A day you blocked by hand in the week planner (note, or '' if none given)."""
        if "training_day_blocks" not in self.tables:
            return None
        r = self.conn.execute("SELECT note FROM training_day_blocks WHERE date=?", (d,)).fetchone()
        return (r[0] or "") if r else None

    @lru_cache(maxsize=512)
    def sleep_hours(self, d: str) -> float | None:
        if "sleep" not in self.tables:
            return None
        r = self.conn.execute("SELECT duration_seconds FROM sleep WHERE date=?", (d,)).fetchone()
        return round(r[0] / 3600, 1) if r and r[0] else None

    # ── the context ──────────────────────────────────────────────────────────
    def context(self, d: str) -> dict:
        day = date.fromisoformat(d)
        prev = (day - timedelta(days=1)).isoformat()
        weekday_ok = not self.available or day.strftime("%a").lower() in self.available
        roster = self.roster(d)
        prev_roster = self.roster(prev)
        prev_late = bool(prev_roster and _is_late_end(prev_roster.get("end_time")))
        woke_away = self.night_away(prev)
        start = _mins(LATE_DAY_START if prev_late else DAY_START)

        ctx = {
            "date": d,
            "duty": roster["duty_type"] if roster else None,
            "report_time": roster["report_time"] if roster else None,
            "end_time": roster["end_time"] if roster else None,
            "prev_end_time": prev_roster["end_time"] if prev_roster else None,
            "prev_end_late": prev_late,
            "woke_away": woke_away,
            "night_away": self.night_away(d),
            "sleep_h": self.sleep_hours(d),
            "window_min": 0,
            "intense_ok": False,
            "label": "",
            "blocked": False,
        }

        # Camp / tour block: the day belongs to the block's own "Tour day" session
        tb = None
        if "training_blocks" in self.tables:
            tb = self.conn.execute(
                "SELECT name, kind FROM training_blocks WHERE start_date <= ? AND end_date >= ? LIMIT 1", (d, d)).fetchone()
        if tb is not None:
            ctx["tour_block"] = tb[0]
            ctx["label"] = f"{(tb[1] or 'tour').title()}: {tb[0]}"
            return ctx                                   # window 0 → re-plan places nothing else here
        blk = self.block(d)
        if blk is not None:
            ctx["blocked"] = True
            ctx["label"] = f"Blocked by you{': ' + blk if blk else ''}"
            return ctx
        if not weekday_ok:
            ctx["label"] = "Not a training day (your settings)"
            return ctx
        if woke_away:
            ctx["label"] = "Away (layover / trip)"
            return ctx

        duty = ctx["duty"]
        report = _mins(ctx["report_time"])
        end = _mins(ctx["end_time"])

        if duty in (None, "day_off", "unknown") and not (duty == "unknown" and report):
            window = FULL_DAY_MIN - (start - _mins(DAY_START))
            ctx["label"] = "Day off" if duty == "day_off" else "No roster — assumed free"
        elif duty == "standby":
            window = STANDBY_WINDOW_MIN
            ctx["label"] = "Standby — trainer or a short loop near base"
        else:
            before = max(0, (report - PRE_REPORT_BUFFER_MIN) - start) if report is not None else 0
            after = 0
            # Evening window only if the duty ends back at base (not on a layover).
            if (end is not None and not _is_late_end(ctx["end_time"]) and end <= 15 * 60
                    and not ctx["night_away"]):
                after = max(0, _mins(EVENING_END) - (end + POST_DUTY_BUFFER_MIN))
            window = max(before, after)
            if report is None and end is None:
                window = 60
            parts = ["Flying" if duty == "flying_duty" else "Ground duty"]
            if ctx["report_time"]:
                parts.append(f"report {ctx['report_time']}")
            if before >= after and report is not None and before > 0:
                parts.append(f"ride {_fmt(start)}–{_fmt(report - PRE_REPORT_BUFFER_MIN)}")
            elif after > 0:
                parts.append(f"ride after {_fmt(end + POST_DUTY_BUFFER_MIN)}")
            ctx["label"] = " · ".join(parts)

        ctx["window_min"] = int(min(window, FULL_DAY_MIN))
        ctx["intense_ok"] = ctx["window_min"] >= HARD_MIN_WINDOW
        if prev_late:
            ctx["label"] += f" · late finish last night ({ctx['prev_end_time']})"
        return ctx


def day_context(conn: sqlite3.Connection, d: str, available_days: list[str] | None = None) -> dict:
    return DayContextReader(conn, available_days).context(d)


def today_advice(ctx: dict, session: dict) -> dict:
    """
    Advice for doing `session` on ctx's day. Returns
    {"notes": [...], "duration_min": int|None, "zone": str|None}
    where duration/zone are set only when a change is recommended.
    """
    notes: list[str] = []
    dur = session.get("effective_duration_min") or session.get("duration_min") or 0
    zone = session.get("intensity_zone") or "Z2"
    hard = zone in ("Z3", "Z4", "Z5")
    is_long = dur >= 150
    new_dur, new_zone = None, None

    if ctx.get("tour_block"):
        return {"notes": [f"{ctx['label']} — ride by feel, Z2, eat early; split the day if the legs say so."],
                "duration_min": None, "zone": None}

    if ctx.get("woke_away"):
        notes.append("You're away today — rest, or a short hotel-gym spin. The week re-plans around it.")
        return {"notes": notes, "duration_min": None, "zone": None}

    if ctx.get("label") and ctx.get("duty") not in (None, "day_off"):
        notes.append(ctx["label"])

    window = ctx.get("window_min") or 0
    if ctx.get("duty") not in (None, "day_off") and window and dur > window:
        new_dur = max(30, window)
        notes.append(f"Only ~{window} min before duty — shorten to {new_dur} min.")
    elif ctx.get("duty") not in (None, "day_off") and window == 0:
        notes.append("No ride window around today's duty — skip; keep tomorrow's session.")

    if ctx.get("prev_end_late"):
        if hard:
            new_zone = "Z2"
            notes.append(f"Duty ended {ctx.get('prev_end_time')} last night — start after 10:30 and keep it "
                         "aerobic, or swap with the next easy day.")
        else:
            notes.append(f"Duty ended {ctx.get('prev_end_time')} last night — start after 10:30.")

    sleep = ctx.get("sleep_h")
    if sleep is not None:
        if sleep < 5:
            new_dur = min(new_dur or dur, 45)
            new_zone = "Z1"
            notes.append(f"Slept {sleep}h — make it a 45-min Z1 spin or rest. Fatigue now costs weeks later.")
        elif sleep < 6:
            if hard:
                new_zone = "Z2"
                notes.append(f"Slept {sleep}h — swap the intervals for Z2 at the same duration, "
                             "or move them to a better-rested day this week.")
            elif is_long:
                new_dur = min(new_dur or dur, round(dur * 0.75))
                notes.append(f"Slept {sleep}h — trim the long ride ~25% and fuel early.")

    return {"notes": notes, "duration_min": new_dur, "zone": new_zone}
