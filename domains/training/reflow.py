"""
Re-place a goal's pending sessions inside each Mon–Sun week around the real
calendar: roster duties, layovers, trips (see domains.training.day_context).

Per week, sessions are placed by role, most constrained first:
  1. long (+ long2 back-to-back: the long goes on day d, long2 on d+1)
     → the days with the most room; ties go to the weekend
  2. key (intervals/tests) → a day with a real window, not the day before the
     long ride, not right after it, and not next to another key day
  3. easy → whatever is left; shortened to fit, optional ones dropped first
  4. gym → a free day, else doubled with an easy ride (if the window holds
     both); never on a key/long day or the day before a long ride; gym days
     spread ≥ 2 days apart
  5. run (easy runs added on top of the bike plan) → a free day, else doubled
     with an easy ride or gym if the window holds both; never on a key/long
     day, never a third session; the day before a long ride only alone
Another sport's hard day (a tennis match, blocked with load='hard') takes the day,
counts as a key day for the spacing rules, keeps the long ride off the day after,
and covers that week's VO2 (Z5) session — the 312 work stays.
The weekly VO2 boost ("Z2 + VO2") is a Zone 2 ride that may carry a short VO2 set:
it is placed like any easy ride (so it never costs a day or 312 work), steered to a
well-spaced day, and carries the set only there — not beside a bike key day or a
match, not the day before the long ride, not in a week that already has VO2 work
(run intervals, the match). Otherwise it is ridden as plain Z2 (intensity Z2).
A session with eff_override (a recovery week, a taper) keeps that length.
A session that fits nowhere is marked 'displaced' with a note; one that only
fits shortened gets a shorter effective duration + a note. Each placement
writes `schedule_note` so the UI can say why a ride sits where it does.

Never touched: completed/skipped sessions, sessions moved by hand
(is_displaced=1 — they also block their day), the race session, and anything
dated before today (missed stays missed — that's the accountability part).
Idempotent: safe to run nightly and after every roster import.

Usage:
  python -m domains.training.reflow            # all active goals, from today
  python -m domains.training.reflow --goal 3
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import date, timedelta

from domains.training.day_context import DayContextReader
from domains.training.plan_templates.mallorca_312 import BOOST_TYPE   # the weekly VO2 boost

ROLE_ORDER = {"long": 0, "long2": 1, "key": 2, "easy": 3, "gym": 4, "run": 5}


def _ensure_columns(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(plan_sessions)")}
    if "schedule_note" not in cols:
        conn.execute("ALTER TABLE plan_sessions ADD COLUMN schedule_note TEXT")
    if "role" not in cols:
        conn.execute("ALTER TABLE plan_sessions ADD COLUMN role TEXT")
    if "eff_override" not in cols:          # a deliberate length (recovery week, taper) reflow must keep
        conn.execute("ALTER TABLE plan_sessions ADD COLUMN eff_override INTEGER")
    conn.execute("""CREATE TABLE IF NOT EXISTS training_day_blocks (
                        date TEXT PRIMARY KEY, note TEXT,
                        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")
    if "load" not in {r[1] for r in conn.execute("PRAGMA table_info(training_day_blocks)")}:
        # 'hard': another sport's hard session that day (a tennis match) — counts as a key day
        conn.execute("ALTER TABLE training_day_blocks ADD COLUMN load TEXT")
    conn.execute("""CREATE TABLE IF NOT EXISTS training_week_plans (
                        goal_id INTEGER NOT NULL, week_start TEXT NOT NULL, confirmed_at TEXT NOT NULL,
                        PRIMARY KEY (goal_id, week_start))""")
    conn.commit()


def infer_role(session_type: str, duration: int, zone: str) -> str:
    t = (session_type or "").lower()
    if t.startswith("strength"):
        return "gym"
    if "back-to-back day 2" in t:
        return "long2"
    if "long" in t or "back-to-back day 1" in t or duration >= 150:
        return "long"
    if t.startswith("test") or zone in ("Z3", "Z4", "Z5"):
        return "key"
    return "easy"


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def reflow_goal(conn: sqlite3.Connection, goal_id: int, verbose: bool = False,
                reset_week: str | None = None) -> list[dict]:
    """reset_week (a Monday): first release hand-moved sessions of that week so
    'Auto-arrange' really starts from scratch."""
    _ensure_columns(conn)
    if reset_week:
        end = (date.fromisoformat(reset_week) + timedelta(days=6)).isoformat()
        conn.execute(
            """UPDATE plan_sessions SET is_displaced=0
               WHERE goal_id=? AND status='pending' AND session_date BETWEEN ? AND ?""",
            (goal_id, reset_week, end),
        )
    goal = conn.execute("SELECT * FROM race_goals WHERE id=?", (goal_id,)).fetchone()
    if goal is None or goal["status"] != "active":
        return []
    race = date.fromisoformat(goal["race_date"])
    today = date.today()
    vf = goal["volume_factor"] or 1.0
    reader = DayContextReader(conn, (goal["available_days"] or "").split(","))

    rows = conn.execute(
        """SELECT * FROM plan_sessions
           WHERE goal_id=? AND session_date >= ? AND session_date < ?
           ORDER BY session_date""",
        (goal_id, _monday(today).isoformat(), race.isoformat()),
    ).fetchall()

    weeks: dict[date, list] = {}
    for r in rows:
        weeks.setdefault(_monday(date.fromisoformat(r["session_date"])), []).append(r)

    changes: list[dict] = []
    for monday, sess in sorted(weeks.items()):
        changes += _reflow_week(conn, monday, sess, reader, today, race, vf)
    conn.commit()
    if verbose:
        for c in changes:
            print(f"  {c['id']}: {c['from']} → {c['to']}  {c['type']}  ({c['note']})", file=sys.stderr)
    return changes


def _reflow_week(conn, monday, sessions, reader, today, race, vf) -> list[dict]:
    days = [monday + timedelta(days=i) for i in range(7)]
    days = [d for d in days if d >= today and d < race]
    if not days:
        return []

    movable, fixed = [], []
    for s in sessions:
        is_race = "race" in (s["session_type"] or "").lower() and "simulation" not in (s["session_type"] or "").lower()
        if (s["status"] == "pending" and not s["is_displaced"] and not is_race
                and date.fromisoformat(s["session_date"]) >= today) or (
                s["status"] == "displaced" and (s["schedule_note"] or "").startswith(("No free", "Covered by"))):
            movable.append(s)
        elif s["status"] in ("pending", "completed"):
            fixed.append(s)
    if not movable:
        return []

    ctx = {d: reader.context(d.isoformat()) for d in days}
    cap = {d: ctx[d]["window_min"] for d in days}
    taken = {d: False for d in days}
    key_days: set[date] = set()
    long_days: set[date] = set()
    for f in fixed:
        fd = date.fromisoformat(f["session_date"])
        if fd in taken:
            taken[fd] = True

    def base_eff(s) -> int:
        if "eff_override" in s.keys() and s["eff_override"]:
            return s["eff_override"]
        return max(10, round(s["duration_min"] * vf))

    def role(s) -> str:
        return s["role"] or infer_role(s["session_type"], s["duration_min"], s["intensity_zone"])

    # another sport's hard day this week (whole Mon–Sun): its VO2 stimulus replaces ours
    hard = {d: n for d in (monday + timedelta(days=i) for i in range(7))
            if (n := reader.hard_sport(d.isoformat()))}
    covered: dict[int, str] = {}
    if hard:
        d0, name = min(hard.items())
        covered = {s["id"]: f"Covered by {name} ({d0:%a}) — this week's VO2 work happens there"
                   for s in movable if s["intensity_zone"] == "Z5" and role(s) == "key"}
    to_place = [s for s in movable if s["id"] not in covered]
    # VO2 work the week already has (run intervals, a VO2 ride) — the boost then stays plain Z2
    week_vo2 = next((s for s in sessions if s["intensity_zone"] == "Z5" and s["session_type"] != BOOST_TYPE
                     and s["status"] in ("pending", "completed") and s["id"] not in covered), None)

    to_place.sort(key=lambda s: (ROLE_ORDER[role(s)], s["is_optional"], -s["duration_min"]))
    placed: dict[int, tuple[date, int, str]] = {}   # id → (day, eff_minutes, note)
    unplaced: list = []

    def free(d) -> bool:
        return d in cap and not taken[d] and cap[d] > 0

    def weekend_bonus(d: date) -> int:
        return {5: 2, 6: 1}.get(d.weekday(), 0)

    on_day: dict[date, list[str]] = {d: [] for d in days}
    on_day_sessions: dict[date, list] = {}
    for f in fixed:
        on_day_sessions.setdefault(date.fromisoformat(f["session_date"]), []).append(f)
    # the days either side of the week (last Sunday, next Monday) count for the VO2 spacing
    for edge in (monday - timedelta(days=1), monday + timedelta(days=7)):
        on_day_sessions[edge] = conn.execute(
            "SELECT * FROM plan_sessions WHERE session_date=? AND status IN ('pending','completed')",
            (edge.isoformat(),)).fetchall()
    used: dict[date, int] = {d: 0 for d in days}

    def put(s, d, eff, note):
        taken[d] = True
        on_day[d].append(role(s))
        on_day_sessions.setdefault(d, []).append(s)
        used[d] += eff
        placed[s["id"]] = (d, eff, note)

    # ── race week: taper order relative to race day ──────────────────────────
    if race - timedelta(days=6) <= days[0] <= race:
        for s in to_place:
            r = role(s)
            if r == "key":
                prefs = [race - timedelta(days=k) for k in (2, 3, 4)]
            elif s["duration_min"] <= 40:
                prefs = [race - timedelta(days=1), race - timedelta(days=2)]
            else:
                prefs = [race - timedelta(days=k) for k in (4, 5, 3, 6)]
            spot = next((d for d in prefs if free(d)), None) or next((d for d in days if free(d)), None)
            if spot is None:
                unplaced.append(s)
            else:
                put(s, spot, min(base_eff(s), cap[spot]), ctx[spot]["label"])
        return _write(conn, movable, placed, unplaced, ctx, covered, {})

    longs = [s for s in to_place if role(s) == "long"]
    long2s = [s for s in to_place if role(s) == "long2"]
    keys = [s for s in to_place if role(s) == "key"]
    easies = [s for s in to_place if role(s) == "easy"]
    gyms = [s for s in to_place if role(s) == "gym"]
    runs = [s for s in to_place if role(s) == "run"]
    key_days.update(hard)                         # a match is a hard day for the spacing rules

    # ── long rides (with back-to-back pairing) ───────────────────────────────
    for i, lg in enumerate(longs):
        need = base_eff(lg)
        partner = long2s.pop(0) if (i == 0 and long2s) else None
        best = None
        for d in days:
            if not free(d):
                continue
            score = min(cap[d], need) / need * 10 + weekend_bonus(d) * 0.5
            if d - timedelta(days=1) in hard:
                score -= 3                    # legs still in the match
            if d + timedelta(days=1) in hard:
                score -= 1.5
            if partner:
                nxt = d + timedelta(days=1)
                if free(nxt):
                    score += min(cap[nxt], base_eff(partner)) / base_eff(partner) * 10
                else:
                    score -= 5
            if best is None or score > best[0]:
                best = (score, d)
        if best is None:
            unplaced.append(lg)
            if partner:
                unplaced.append(partner)
            continue
        d = best[1]
        eff = min(need, cap[d])
        note = ctx[d]["label"] if eff >= need * 0.9 else (
            f"Only ~{cap[d] // 60}h{cap[d] % 60:02d} free on the best day this week — shortened")
        put(lg, d, eff, note)
        long_days.add(d)
        if partner:
            nxt = d + timedelta(days=1)
            if free(nxt):
                put(partner, nxt, min(base_eff(partner), cap[nxt]), "Back-to-back after the long ride")
                long_days.add(nxt)
            else:
                easies.insert(0, partner)   # no consecutive day: ride it as a standalone endurance day
    for extra in long2s:
        easies.insert(0, extra)

    # ── key sessions ─────────────────────────────────────────────────────────
    for k in keys:
        need = base_eff(k)
        best = None
        for d in days:
            if not free(d) or not ctx[d]["intense_ok"]:
                continue
            pen = 0.0
            if d + timedelta(days=1) in long_days:
                pen += 3          # fresh legs for the long ride
            if d - timedelta(days=1) in long_days:
                pen += 2
            if (d - timedelta(days=1)) in key_days or (d + timedelta(days=1)) in key_days:
                pen += 4
            if ctx[d]["prev_end_late"]:
                pen += 2
            if ctx[d]["duty"] not in (None, "day_off", "unknown"):
                pen += 1.5        # a full day off beats a squeezed pre-duty / standby slot
            if cap[d] < need:
                pen += 3 + (need - cap[d]) / 15
            if best is None or pen < best[0]:
                best = (pen, d)
        if best is None:
            unplaced.append(k)
            continue
        d = best[1]
        eff = min(need, cap[d])
        put(k, d, eff, ctx[d]["label"] if eff == need else f"{ctx[d]['label']} — trimmed to fit")
        key_days.add(d)

    # ── easy sessions ────────────────────────────────────────────────────────
    def vo2_spacing(d: date) -> str | None:
        """Why a VO2 set can't go on day d (None: it can)."""
        bike_keys = [x for x in on_day_sessions.get(d - timedelta(days=1), []) + on_day_sessions.get(d + timedelta(days=1), [])
                     if role(x) == "key" and (x["discipline"] or "") != "running"]
        if bike_keys:
            return f"next to {bike_keys[0]['session_type'].split(' - ')[-1]}"
        near = next((h for h in (d - timedelta(days=1), d + timedelta(days=1)) if h in hard), None)
        if near:
            return f"next to {hard[near]} ({near:%a})"
        if d + timedelta(days=1) in long_days:
            return "the day before the long ride"
        if not ctx[d]["intense_ok"]:
            return "no window for hard work that day"
        return None

    for e in easies:
        need = base_eff(e)
        cands = [d for d in days if free(d) and cap[d] >= min(need, 30)]
        if not cands:
            unplaced.append(e)
            continue
        boost = e["session_type"] == BOOST_TYPE and not week_vo2 and not hard
        # prefer a day that fits fully (a VO2 boost: a well-spaced one), then away from key days (recovery spacing)
        d = max(cands, key=lambda d: (boost and vo2_spacing(d) is None, cap[d] >= need, d not in key_days and
                                      (d - timedelta(days=1)) in key_days | long_days, cap[d]))
        put(e, d, min(need, cap[d]), ctx[d]["label"])

    # ── gym ──────────────────────────────────────────────────────────────────
    gym_days: set[date] = set()
    for g in gyms:
        need = base_eff(g)
        best = None
        for d in days:
            if cap[d] - used[d] < need or ctx[d]["window_min"] == 0:
                continue
            roles_here = on_day[d]
            if any(r in ("key", "long", "long2", "gym") for r in roles_here):
                continue
            if d + timedelta(days=1) in long_days:
                continue
            pen = 0.0 if not roles_here else 2.0          # alone beats doubling
            if any(abs((d - gd).days) < 2 for gd in gym_days):
                pen += 4
            if (d + timedelta(days=1)) in key_days:
                pen += 1                                   # legs a bit flat for intervals / the match
            if best is None or pen < best[0]:
                best = (pen, d)
        if best is None:
            unplaced.append(g)
            continue
        d = best[1]
        note = "Gym — after the easy ride" if on_day[d] else ctx[d]["label"]
        put(g, d, need, note)
        gym_days.add(d)

    # ── easy runs on top: a free day, else doubled with an easy ride / gym ───
    for rn in runs:
        need = base_eff(rn)
        best = None
        for d in days:
            if cap[d] - used[d] < need or ctx[d]["window_min"] == 0:
                continue
            roles_here = on_day[d]
            if any(r in ("key", "long", "long2", "run") for r in roles_here) or len(roles_here) >= 2:
                continue
            before_long = d + timedelta(days=1) in long_days
            if before_long and roles_here:
                continue                       # an easy jog alone the day before a long ride is fine, not doubled
            pen = (0.0 if not roles_here else 2.0 + len(roles_here)) + (3.0 if before_long else 0.0)
            if best is None or pen < best[0]:
                best = (pen, d)
        if best is None:
            unplaced.append(rn)
            continue
        d = best[1]
        put(rn, d, need, "Run off the bike — same day as the easy ride" if "easy" in on_day[d]
            else "Run — after the gym" if on_day[d] else ctx[d]["label"])

    # ── the VO2 boost: carries its set only where it's well spaced, else plain Z2 ──
    zones: dict[int, str] = {}
    for s in to_place:
        if s["session_type"] != BOOST_TYPE or s["id"] not in placed:
            continue
        d, eff, note = placed[s["id"]]
        if hard:
            hd = min(hard)
            why = f"{hard[hd]} ({hd:%a}) is this week's hard work"
        elif week_vo2:
            why = (f"{week_vo2['session_type'].split(' - ')[-1]} "
                   f"({date.fromisoformat(week_vo2['session_date']):%a}) already does VO2 this week")
        else:
            why = vo2_spacing(d)
        zones[s["id"]] = "Z2" if why else "Z5"
        placed[s["id"]] = (d, eff, f"VO2 set off — {why}: ride it all Z2" if why else f"{note} · VO2 set on")

    return _write(conn, movable, placed, unplaced, ctx, covered, zones)


def _write(conn, movable, placed, unplaced, ctx, covered: dict[int, str] | None = None,
           zones: dict[int, str] | None = None) -> list[dict]:
    changes = []
    unplaced_ids = {u["id"] for u in unplaced}
    for s in movable:
        if covered and s["id"] in covered:
            note = covered[s["id"]]
            if s["status"] != "displaced" or s["schedule_note"] != note:
                conn.execute(
                    """UPDATE plan_sessions SET status='displaced', schedule_note=?,
                              updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?""",
                    (note, s["id"]),
                )
                changes.append({"id": s["id"], "type": s["session_type"], "from": s["session_date"],
                                "to": None, "note": note})
        elif s["id"] in placed:
            d, eff, note = placed[s["id"]]
            new_date = d.isoformat()
            zone = (zones or {}).get(s["id"], s["intensity_zone"])
            if (new_date != s["session_date"] or eff != s["effective_duration_min"]
                    or note != s["schedule_note"] or s["status"] != "pending" or zone != s["intensity_zone"]):
                conn.execute(
                    """UPDATE plan_sessions SET session_date=?, effective_duration_min=?, schedule_note=?,
                              intensity_zone=?, status='pending', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
                       WHERE id=?""",
                    (new_date, eff, note, zone, s["id"]),
                )
                changes.append({"id": s["id"], "type": s["session_type"], "from": s["session_date"],
                                "to": new_date, "note": note})
        elif s["id"] in unplaced_ids:
            note = "No free slot this week (roster / travel) — dropped" if s["is_optional"] else \
                   "No free slot this week (roster / travel) — key work missed, the next weeks adapt"
            if s["status"] != "displaced" or s["schedule_note"] != note:
                conn.execute(
                    """UPDATE plan_sessions SET status='displaced', schedule_note=?,
                              updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?""",
                    (note, s["id"]),
                )
                changes.append({"id": s["id"], "type": s["session_type"], "from": s["session_date"],
                                "to": None, "note": note})
    return changes


def reflow_all(conn: sqlite3.Connection, verbose: bool = False) -> int:
    n = 0
    for g in conn.execute("SELECT id FROM race_goals WHERE status='active'").fetchall():
        n += len(reflow_goal(conn, g["id"], verbose=verbose))
    return n


def _materialize_due_goals(conn: sqlite3.Connection) -> None:
    """Active goals whose plan start has arrived but have no sessions yet (they
    were created ahead of time) get their sessions now — then reflow places them."""
    due = conn.execute(
        """SELECT * FROM race_goals g
           WHERE status='active' AND plan_start_date <= ?
             AND NOT EXISTS (SELECT 1 FROM plan_sessions p WHERE p.goal_id = g.id)""",
        (date.today().isoformat(),),
    ).fetchall()
    if not due:
        return
    from infrastructure.api.routers.race_plans import _materialize_sessions  # API venv only
    for g in due:
        n = _materialize_sessions(conn, g["id"], g)
        print(f"  goal {g['id']} ({g['name']}): materialized {n} sessions", file=sys.stderr)


def main() -> None:
    from infrastructure.db.connection import get_connection

    p = argparse.ArgumentParser(description="Re-place pending plan sessions around roster/travel")
    p.add_argument("--goal", type=int)
    args = p.parse_args()
    conn = get_connection()
    try:
        _materialize_due_goals(conn)
        if args.goal:
            n = len(reflow_goal(conn, args.goal, verbose=True))
        else:
            n = reflow_all(conn, verbose=True)
    finally:
        conn.close()
    print(f"{n} session(s) re-placed.", file=sys.stderr)


if __name__ == "__main__":
    main()
