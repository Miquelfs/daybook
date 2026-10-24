"""
Push upcoming TRAINER sessions to the Intervals.icu calendar, from where MyWhoosh
picks them up (MyWhoosh → connections → Intervals.icu; it pulls the next ~7
days) — the MyWhoosh side of what workout_push does for Garmin.

Each session becomes an Intervals "WORKOUT" event whose description is written
in Intervals' workout text, which it parses into steps:

    - Trainer warm up 10m 50%
    - Calibrate stop pedalling, run the spindown 2m 50%
    2x
    - Threshold 8m 100% 85-95rpm
    - Recovery 5m 50%
    - Test all out 20m freeride          ← ERG off: an FTP test must not be capped

Targets are % of FTP (MyWhoosh ignores absolute watts from Intervals), so they
follow the FTP set in MyWhoosh. Step prompts are stripped of numbers so a cue
like "2× 8min @ FTP" can't be read as workout syntax.

Idempotent like the Garmin push: intervals_workout_push remembers the event per
session + a hash of what was sent; changed sessions are updated, skipped /
moved-away / deleted ones removed. Completed and past sessions are left alone.

Needs INTERVALS_API_KEY in .env (Intervals.icu → Settings → Developer
Settings). INTERVALS_PUSH=0 disables it.

Usage:
  python -m domains.health.intervals_push              # next 9 days
  python -m domains.health.intervals_push --dry-run    # print the workouts, send nothing
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from datetime import date, timedelta

from domains.health.garmin.workout_push import FTP_PCT, is_indoor, trimmed_structure

WINDOW_DAYS = 9
API = "https://intervals.icu/api/v1/athlete/0/events"   # 0 = the athlete the API key belongs to
TIMEOUT = 20
# Intervals keywords a prompt must not contain
_RESERVED = {"ramp", "freeride", "rpm", "hr", "lthr", "pace", "press", "lap", "x"}
_CADENCE = re.compile(r"cadence\s*(\d{2,3})\s*[–-]\s*(\d{2,3})", re.I)


def enabled() -> bool:
    return bool(os.getenv("INTERVALS_API_KEY", "").strip()) and \
        os.getenv("INTERVALS_PUSH", "1").strip() not in ("0", "false", "no")


# ── workout text ─────────────────────────────────────────────────────────────

def pct(zone: str | None) -> int:
    lo, hi = FTP_PCT.get(zone or "Z2", FTP_PCT["Z2"])
    return round((lo + hi) / 2)


def prompt(*parts: str | None, fallback: str = "Ride") -> str:
    """Words only: no numbers, %, ×, @ or Intervals keywords."""
    words = []
    for w in " ".join(p for p in parts if p).replace("—", " ").replace("–", " ").split():
        w = w.strip(",.;:()[]")
        if not w or any(c.isdigit() for c in w) or any(c in w for c in "%×@/+=") or w.lower() in _RESERVED:
            continue
        words.append(w)
    return " ".join(words[:9]) or fallback


def _cadence(cue: str | None) -> str:
    m = _CADENCE.search(cue or "")
    return f" {m.group(1)}-{m.group(2)}rpm" if m else ""


def build_text(session: dict) -> tuple[str, int] | None:
    """(Intervals workout text, minutes) for a trainer session, or None if not one."""
    stype = session["session_type"] or ""
    if session["discipline"] != "cycling" or not is_indoor(stype):
        return None
    structure, eff = trimmed_structure(session)
    is_test = stype.lower().startswith("test")
    lines: list[str] = []
    for st in structure:
        kind, label, cue = st.get("kind"), st.get("label"), st.get("cue")
        if kind == "steady" and st.get("duration_min"):
            calib = "calibrat" in (label or "").lower()
            p = prompt(label, "stop pedalling, run the spindown" if calib else None, fallback="Steady")
            lines.append(f"- {p} {st['duration_min']}m {pct(st.get('zone'))}%{_cadence(cue)}")
        elif kind == "intervals" and st.get("work_min"):
            reps = int(st.get("reps") or 1)
            work = (f"- {prompt('Test all out' if is_test else label, fallback='Work')} {st['work_min']}m freeride"
                    if is_test else
                    f"- {prompt(label, fallback='Work')} {st['work_min']}m {pct(st.get('work_zone') or 'Z4')}%{_cadence(cue)}")
            rest = f"- Recovery {st['rest_min']}m {pct(st.get('rest_zone') or 'Z1')}%" if st.get("rest_min") else None
            if reps > 1:
                lines += ["", f"{reps}x", work] + ([rest] if rest else []) + [""]
            else:
                lines += [work] + ([rest] if rest else [])
    body = "\n".join(lines).strip()
    return (body, eff) if body else None


def build_event(session: dict, ftp_w: float | None) -> dict | None:
    built = build_text(session)
    if not built:
        return None
    text, eff = built
    name = (session["session_type"].replace("Cycling - ", "").replace("Test - ", "Test ")
            .replace(" (trainer)", ""))
    head = ("Daybook plan — targets are a share of the FTP set in MyWhoosh"
            + (f" (Daybook FTP {round(ftp_w)} W)" if ftp_w else "") + "\n\n")
    return {
        "category": "WORKOUT",
        "start_date_local": f"{session['session_date']}T00:00:00",
        "type": "Ride",
        "name": f"312 · {name} {eff}′"[:60],
        "description": head + text,
        "moving_time": int(eff * 60),
    }


def _hash(event: dict) -> str:
    return hashlib.sha1(json.dumps(event, sort_keys=True).encode()).hexdigest()


# ── Intervals.icu API ────────────────────────────────────────────────────────

class Client:
    def __init__(self, api_key: str):
        import requests
        self.s = requests.Session()
        self.s.auth = ("API_KEY", api_key)

    def create(self, event: dict) -> str:
        r = self.s.post(API, json=event, timeout=TIMEOUT)
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        eid = (r.json() or {}).get("id")
        if not eid:
            raise RuntimeError(f"no event id in response: {r.text[:200]}")
        return str(eid)

    def update(self, event_id: str, event: dict) -> bool:
        """False when the event is gone on Intervals (deleted by hand) — recreate it."""
        r = self.s.put(f"{API}/{event_id}", json=event, timeout=TIMEOUT)
        if r.status_code == 404:
            return False
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        return True

    def delete(self, event_id: str) -> None:
        r = self.s.delete(f"{API}/{event_id}", timeout=TIMEOUT)
        if r.status_code >= 400 and r.status_code != 404:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")


# ── sync ─────────────────────────────────────────────────────────────────────

def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS intervals_workout_push (
        session_id     INTEGER PRIMARY KEY,
        event_id       TEXT,
        scheduled_date TEXT,
        payload_hash   TEXT,
        pushed_at      TEXT,
        last_error     TEXT)""")
    conn.commit()


def _ftp(conn) -> float | None:
    try:
        z = conn.execute("SELECT ftp_w FROM athlete_zones WHERE sport='ride' AND ftp_w IS NOT NULL "
                         "ORDER BY valid_from DESC LIMIT 1").fetchone()
    except sqlite3.OperationalError:
        return None
    return z["ftp_w"] if z else None


def push_upcoming(conn: sqlite3.Connection, client: Client | None = None, days: int = WINDOW_DAYS,
                  dry_run: bool = False, verbose: bool = True) -> dict:
    ensure_table(conn)
    today = date.today()
    ftp = _ftp(conn)
    sessions = conn.execute(
        """SELECT ps.* FROM plan_sessions ps JOIN race_goals rg ON rg.id = ps.goal_id
           WHERE rg.status='active' AND ps.status='pending' AND ps.session_date BETWEEN ? AND ?
           ORDER BY ps.session_date""",
        (today.isoformat(), (today + timedelta(days=days)).isoformat()),
    ).fetchall()
    wanted: dict[int, tuple[dict, str]] = {}
    for s in sessions:
        ev = build_event(dict(s), ftp)
        if ev:
            wanted[s["id"]] = (ev, _hash(ev))

    summary = {"created": 0, "updated": 0, "removed": 0, "unchanged": 0, "errors": []}
    if dry_run:
        for sid, (ev, _) in wanted.items():
            print(f"--- session {sid} · {ev['start_date_local'][:10]} · {ev['name']}\n{ev['description']}\n")
        return {**summary, "would_push": len(wanted)}

    if client is None:
        key = os.getenv("INTERVALS_API_KEY", "").strip()
        if not key:
            raise RuntimeError("INTERVALS_API_KEY is not set")
        client = Client(key)

    pushed = {r["session_id"]: r for r in conn.execute("SELECT * FROM intervals_workout_push")}
    for sid, row in pushed.items():
        if sid in wanted:
            continue
        st = conn.execute("SELECT status, session_date FROM plan_sessions WHERE id=?", (sid,)).fetchone()
        if st and (st["status"] == "completed" or st["session_date"] < today.isoformat()):
            continue
        try:
            if row["event_id"]:
                client.delete(row["event_id"])
            conn.execute("DELETE FROM intervals_workout_push WHERE session_id=?", (sid,))
            summary["removed"] += 1
        except Exception as e:
            summary["errors"].append(f"remove session {sid}: {e}")

    for sid, (ev, h) in wanted.items():
        row = pushed.get(sid)
        day = ev["start_date_local"][:10]
        if row and row["payload_hash"] == h and row["event_id"] and not row["last_error"]:
            summary["unchanged"] += 1
            continue
        try:
            if row and row["event_id"] and client.update(row["event_id"], ev):
                eid = row["event_id"]
                summary["updated"] += 1
            else:
                eid = client.create(ev)
                summary["created"] += 1
            conn.execute(
                """INSERT OR REPLACE INTO intervals_workout_push
                   (session_id, event_id, scheduled_date, payload_hash, pushed_at, last_error)
                   VALUES (?,?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'),NULL)""",
                (sid, eid, day, h))
            if verbose:
                print(f"  ✓ {day} {ev['name']}", file=sys.stderr)
        except Exception as e:
            conn.execute(
                """INSERT OR REPLACE INTO intervals_workout_push
                   (session_id, event_id, scheduled_date, payload_hash, pushed_at, last_error)
                   VALUES (?,?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'),?)""",
                (sid, row["event_id"] if row else None, day, h, str(e)[:300]))
            summary["errors"].append(f"{day} {ev['name']}: {e}")
        conn.commit()
    conn.commit()
    return summary


def push_status(conn: sqlite3.Connection) -> dict[int, dict]:
    ensure_table(conn)
    return {r["session_id"]: {"event_id": r["event_id"], "date": r["scheduled_date"], "error": r["last_error"]}
            for r in conn.execute("SELECT * FROM intervals_workout_push")}


def main() -> None:
    from infrastructure.db.connection import get_connection

    p = argparse.ArgumentParser(description="Push upcoming trainer sessions to Intervals.icu (→ MyWhoosh)")
    p.add_argument("--days", type=int, default=WINDOW_DAYS)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    if not enabled() and not args.dry_run:
        print("INTERVALS_API_KEY not set (or INTERVALS_PUSH=0) — skipping", file=sys.stderr)
        return
    conn = get_connection()
    try:
        s = push_upcoming(conn, days=args.days, dry_run=args.dry_run)
    finally:
        conn.close()
    print(f"workouts → Intervals.icu / MyWhoosh: {s}", file=sys.stderr)


if __name__ == "__main__":
    main()
