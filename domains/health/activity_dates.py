"""
Which day an activity belongs to — the day where you were, not the day in UTC.

Garmin and Strava report the start both in GMT and in the device's local time. The
day used to come from the GMT one, so on a trip east of Spain (Taiwan, UTC+8) every
morning ride landed on the day before: two or three rides on one day, none on the
next, and the plan's sessions on the empty days read as missed. Now:

  local_date()     the day from the local start (startTimeLocal / start_date_local);
                   without it, the GMT start placed in the timezone at the start point.
  fix_dates()      re-dates stored rows from their raw payload (and every table that
                   keeps an activity's date next to its id).
  device_twins()   the same workout recorded on two Garmin devices (watch + bike
                   computer) counts once: the device you usually record that sport
                   with keeps it; the other is merged into it (notes, fuel, companions
                   and the plan link move; its computed data goes) and remembered in
                   activity_duplicates so a resync doesn't bring it back.
  relink()         plan sessions on the affected days are re-matched with the right
                   days' activities.
  repair()         all of it, plus fitness/fatigue recomputed from the earliest day
                   that changed. Idempotent — runs at API startup and after each sync.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone

TWIN_START_S = 10 * 60      # twins start within 10 min of each other…
TWIN_OVERLAP = 0.7          # …and share ≥ 70 % of the shorter one's time


def local_date(start_gmt: str | None, start_local: str | None = None,
               lat: float | None = None, lng: float | None = None) -> str:
    if start_local and len(start_local) >= 10:
        return start_local[:10]
    if not start_gmt:
        return ""
    if lat is not None and lng is not None:
        try:
            dt = datetime.fromisoformat(start_gmt.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            from domains.locations.tz_lookup import local_date_for_point
            return local_date_for_point(dt.isoformat(), lat, lng)
        except Exception:                                   # noqa: BLE001 — no tz data: GMT day
            pass
    return start_gmt[:10]


def ensure_tables(conn: sqlite3.Connection) -> None:
    # columns deliberately not called activity_id: merging sweeps every table that has one
    conn.execute("""CREATE TABLE IF NOT EXISTS activity_duplicates (
        dropped_id TEXT PRIMARY KEY, kept_id TEXT NOT NULL, raw_payload TEXT,
        merged_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")


def is_duplicate(conn: sqlite3.Connection, activity_id: str) -> bool:
    """Merged into another device's copy, or removed by hand (activity_remove) — either way a sync skips it."""
    try:
        if conn.execute("SELECT 1 FROM activity_duplicates WHERE dropped_id=?", (activity_id,)).fetchone():
            return True
    except sqlite3.OperationalError:
        pass
    from domains.health.activity_remove import is_removed
    return is_removed(conn, activity_id)


def _tables_with_date(conn) -> list[str]:
    out = []
    for (t,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table'"):
        cols = {c[1] for c in conn.execute(f'PRAGMA table_info("{t}")')}
        if t != "activities" and {"activity_id", "date"} <= cols:
            out.append(t)
    return out


def fix_dates(conn: sqlite3.Connection) -> dict[str, tuple[str, str]]:
    """{activity_id: (old_date, new_date)} for every stored row whose day was the GMT one."""
    try:
        rows = conn.execute(
            """SELECT id, date, substr(COALESCE(json_extract(raw_payload, '$.startTimeLocal'),
                                               json_extract(raw_payload, '$.start_date_local')), 1, 10) AS loc
               FROM activities
               WHERE source IN ('garmin', 'strava') AND json_valid(raw_payload)""").fetchall()
    except sqlite3.OperationalError:
        return {}
    moved = {r[0]: (r[1], r[2]) for r in rows if r[2] and len(r[2]) == 10 and r[2] != r[1]}
    if not moved:
        return moved
    others = _tables_with_date(conn)
    for aid, (_, new) in moved.items():
        conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (new,))
        conn.execute("UPDATE activities SET date=? WHERE id=?", (new, aid))
        for t in others:
            conn.execute(f'UPDATE "{t}" SET date=? WHERE activity_id=?', (new, aid))
    return moved


# ── one workout, two devices ─────────────────────────────────────────────────

def _gmt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d.astimezone(timezone.utc).replace(tzinfo=None) if d.tzinfo else d


def device_twins(conn: sqlite3.Connection, since: str | None = None) -> list[tuple[str, str, str]]:
    """Merge Garmin activities recorded twice (two devices). [(dropped_id, kept_id, date)]"""
    from domains.coll.rides import absorb
    from domains.health.activity_analysis import sport_of

    ensure_tables(conn)
    q = """SELECT id, date, activity_type, start_time, duration_seconds, moving_time_seconds,
                  json_extract(raw_payload, '$.deviceId') AS dev
           FROM activities WHERE source='garmin' AND json_valid(raw_payload)"""
    try:
        rows = conn.execute(q + (" AND date >= ?" if since else "") + " ORDER BY start_time",
                            (since,) if since else ()).fetchall()
    except sqlite3.OperationalError:
        return []
    acts = [(r, _gmt(r["start_time"])) for r in rows if r["dev"] is not None and r["duration_seconds"]]
    acts = [(r, s) for r, s in acts if s is not None]
    usage: dict[tuple, int] = {}
    for r in conn.execute("""SELECT json_extract(raw_payload, '$.deviceId') AS dev, activity_type, COUNT(*) AS n
                             FROM activities WHERE source='garmin' AND json_valid(raw_payload)
                             GROUP BY dev, activity_type"""):
        usage[(r["dev"], r["activity_type"])] = r["n"]

    done: list[tuple[str, str, str]] = []
    gone: set[str] = set()
    for i, (a, sa) in enumerate(acts):
        if a["id"] in gone:
            continue
        for b, sb in acts[i + 1:]:
            if (sb - sa).total_seconds() > TWIN_START_S:
                break
            if b["id"] in gone or b["dev"] == a["dev"] or sport_of(a["activity_type"]) != sport_of(b["activity_type"]):
                continue
            ea, eb = sa + timedelta(seconds=a["duration_seconds"]), sb + timedelta(seconds=b["duration_seconds"])
            overlap = (min(ea, eb) - max(sa, sb)).total_seconds()
            if overlap < TWIN_OVERLAP * min(a["duration_seconds"], b["duration_seconds"]):
                continue
            rank = lambda r: (usage.get((r["dev"], r["activity_type"]), 0), r["moving_time_seconds"] or 0,  # noqa: E731
                              r["duration_seconds"])
            keep, drop = (a, b) if rank(a) >= rank(b) else (b, a)
            raw = conn.execute("SELECT raw_payload FROM activities WHERE id=?", (drop["id"],)).fetchone()
            conn.execute("INSERT OR REPLACE INTO activity_duplicates (dropped_id, kept_id, raw_payload) VALUES (?,?,?)",
                         (drop["id"], keep["id"], raw[0] if raw else None))
            absorb(conn, drop["id"], keep["id"])
            gone.add(drop["id"])
            done.append((drop["id"], keep["id"], keep["date"]))
            if drop is a:
                break
    return done


# ── plan sessions on the days that changed ───────────────────────────────────

def relink(conn: sqlite3.Connection, moved: dict[str, tuple[str, str]], dates: set[str]) -> int:
    """Re-match plan sessions on `dates`. A link is undone when it was made by the wrong day (the session
    sits on the activity's old day) or was automatic — a longer ride may now be on that day. Sessions
    ticked off by hand keep their status and get that day's activity attached when one is free."""
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(plan_sessions)")}
    except sqlite3.OperationalError:
        return 0
    if not cols or not dates:
        return 0
    from domains.training.autolink import _ACT_DEDUP, _DISCIPLINE_ACT_FAMILY, autolink_sessions

    auto = "auto_matched" in cols
    q = ",".join("?" * len(dates))
    # only active goals: auto-linking leaves finished ones alone, so an unlinked session there would stay pending
    active = "goal_id IN (SELECT id FROM race_goals WHERE status='active')"
    sessions = conn.execute(f"""SELECT id, session_date, completed_activity_id {', auto_matched' if auto else ''}
                                FROM plan_sessions WHERE status='completed' AND completed_activity_id IS NOT NULL
                                  AND session_date IN ({q}) AND {active}""", tuple(dates)).fetchall()
    for s in sessions:
        m = moved.get(s["completed_activity_id"])
        wrong_day = m is not None and s["session_date"] == m[0]
        if wrong_day or (auto and s["auto_matched"]):
            conn.execute(f"""UPDATE plan_sessions SET completed_activity_id=NULL, status='pending'
                             {', auto_matched=0' if auto else ''},
                             updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?""", (s["id"],))
    n = sum(autolink_sessions(conn, on_date=d) for d in sorted(dates))

    consumed = {r[0] for r in conn.execute(
        "SELECT completed_activity_id FROM plan_sessions WHERE completed_activity_id IS NOT NULL")}
    for s in conn.execute(f"""SELECT id, session_date, discipline FROM plan_sessions
                              WHERE status='completed' AND completed_activity_id IS NULL
                                AND session_date IN ({q}) AND {active} ORDER BY session_date""", tuple(dates)).fetchall():
        family = _DISCIPLINE_ACT_FAMILY.get(s["discipline"])
        if not family:
            continue
        cand = conn.execute(f"""SELECT id FROM activities WHERE date=? AND lower(activity_type) IN
                                ({','.join('?' * len(family))}) {_ACT_DEDUP}
                                ORDER BY COALESCE(moving_time_seconds, duration_seconds, 0) DESC""",
                            (s["session_date"], *family)).fetchall()
        pick = next((c[0] for c in cand if c[0] not in consumed), None)
        if pick:
            consumed.add(pick)
            conn.execute("UPDATE plan_sessions SET completed_activity_id=? WHERE id=?", (pick, s["id"]))
            n += 1
    return n


def repair(conn: sqlite3.Connection, since: str | None = None, log=None) -> dict:
    """Local days, one copy per workout, sessions re-matched, load recomputed. Commits."""
    moved = fix_dates(conn)
    twins = device_twins(conn, since)
    dates = {d for old, new in moved.values() for d in (old, new)} | {d for _, _, d in twins}
    relinked = relink(conn, moved, dates) if dates else 0
    if dates:
        try:
            from domains.health.compute_training_load import recompute
            recompute(conn, date.fromisoformat(min(dates)) - timedelta(days=1))
        except sqlite3.OperationalError as e:
            if log:
                log(f"training load not recomputed: {e}")
    conn.commit()
    out = {"redated": len(moved), "twins_merged": len(twins), "sessions_relinked": relinked}
    if log and (moved or twins):
        log(f"activity days: {out}")
    return out
