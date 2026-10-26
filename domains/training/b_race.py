"""
A B race inside an A-race plan — e.g. a half marathon on the way to Mallorca 312.

The A race stays the priority; the B race weaves its sport into the plan and
gets a short taper, not a plan of its own (two full plans would double the load).

  run weeks     until New Year: an easy run + a quality run (intervals / tempo,
                alternating) — the VO2max work running gives cheaply;
                from January: + a long run building 70 → 100 min, the last
                weeks finishing at race pace;
                recovery weeks: one short easy run;
                tours/camps and their recovery week: nothing added.
  on top        the runs are added on top of the bike plan (training volume and the
                running habit matter — an Ironman follows), up to a weekly extra of
                ~2.5 h while the week is under 12 h, ~1.5 h above; only what goes past
                that swaps a Zone 2 ride (shortest first). In build weeks (12 h+) there's
                no running quality session (the bike brings the intensity) and the long
                run always takes a Zone 2 ride's day. Recovery spins, long rides,
                back-to-backs, bike key sessions and gym are never swapped. Easy runs
                may share a day with an easy ride or gym (reflow role "run").
  race week     sharpener (3 × 1 km at race pace), easy + shake-out runs; bike
                key work set aside, long rides capped short and easy; the race
                pinned on its day.
  after         three easy days: hard work turned into easy Z2, long rides capped.

Paces come from the run threshold in athlete_zones. Everything changed is
recorded so deleting the B race restores the plan exactly; reflow then places
the new sessions around the roster like any other.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, timedelta

DISTANCES_KM = {"half_marathon": 21.0975, "10k": 10.0, "marathon": 42.195}
# The one run pace scale (× threshold pace, Z4 = threshold). The plan card's zones,
# the session cues and the Garmin pace targets all read it — tests hold them together.
PACE_MULT = {"Z1": 1.37, "Z2": 1.27, "Z3": 1.07, "Z4": 1.00, "Z5": 0.93}
RACE_PACE_FACTOR = {"half_marathon": 1.04, "10k": 0.99, "marathon": 1.10}   # × threshold pace
PHASE2 = "01-04"                       # month-day the long-run phase starts (first Monday of January-ish)
SWAP_TYPES = ("cycling - zone 2 ride",)
EXTRA_MIN_LIGHT, EXTRA_MIN_HEAVY, HEAVY_WEEK_MIN = 150, 90, 12 * 60   # extra running on top, per week
NOTE_SWAP = "Swapped for a run ({name} build)"


def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS b_races (
        id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id INTEGER NOT NULL, name TEXT NOT NULL,
        race_type TEXT NOT NULL, race_date TEXT NOT NULL, start_date TEXT NOT NULL,
        changes_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")
    conn.commit()


# ── paces ────────────────────────────────────────────────────────────────────

def threshold_pace(conn) -> float:
    try:
        r = conn.execute("SELECT threshold_pace_s_per_km FROM athlete_zones WHERE sport='run' "
                         "AND threshold_pace_s_per_km IS NOT NULL ORDER BY valid_from DESC LIMIT 1").fetchone()
        return float(r[0]) if r and r[0] else 300.0
    except sqlite3.OperationalError:
        return 300.0


def fmt_pace(s: float) -> str:
    return f"{int(s // 60)}:{int(round(s % 60)):02d}/km"


def fmt_time(s: float) -> str:
    h, m = int(s // 3600), int((s % 3600) // 60)
    return f"{h}:{m:02d}" if h else f"{m} min"


def paces(conn, race_type: str) -> dict:
    t = threshold_pace(conn)
    race = t * RACE_PACE_FACTOR.get(race_type, 1.04)
    return {"easy": t * PACE_MULT["Z2"], "tempo": t * PACE_MULT["Z3"], "threshold": t * PACE_MULT["Z4"],
            "vo2": t * PACE_MULT["Z5"], "race": race,
            "race_time_s": race * DISTANCES_KM.get(race_type, 21.0975)}


# ── live paces in cues ───────────────────────────────────────────────────────
# Cues never store a pace: zone paces show live beside the cue (card) or as the
# step target (watch), and race pace is a token rendered from today's threshold —
# so a new threshold reaches every session already in the plan.

RACE_TOKEN = re.compile(r"\{pace:race:(\w+)\}")
_STORED_PACE = re.compile(r"(?:~\s*)?\d{1,2}:\d{2}/km")


def race_token(race_type: str) -> str:
    return "{pace:race:%s}" % race_type


def race_pace_s(threshold_s: float, race_type: str) -> float:
    return threshold_s * RACE_PACE_FACTOR.get(race_type, 1.04)


def render_cue(cue: str | None, threshold_s: float) -> str | None:
    if not cue or "{pace:" not in cue:
        return cue
    return RACE_TOKEN.sub(lambda m: fmt_pace(race_pace_s(threshold_s, m.group(1))), cue)


def render_structure(structure, conn) -> list | None:
    """The stored structure with race-pace tokens filled in from today's threshold."""
    if not structure or "{pace:" not in json.dumps(structure):
        return structure
    t = threshold_pace(conn)
    return [{**st, "cue": render_cue(st.get("cue"), t)} if st.get("cue") else st for st in structure]


def strip_stored_pace(cue: str) -> str:
    """'conversational, ~5:48/km' → 'conversational' (for sessions written before cues went live)."""
    out = _STORED_PACE.sub("", cue)
    out = re.sub(r"\s*([,;—])\s*(?=[,;—]|$)", "", out)        # separators left dangling
    out = re.sub(r"^\s*[,;—]\s*", "", out)
    return re.sub(r"\s{2,}", " ", out).strip()


# ── run sessions (same structure format as the plan templates) ───────────────

def _steady(label, minutes, zone, cue=None):
    s = {"kind": "steady", "label": label, "duration_min": minutes, "zone": zone}
    if cue:
        s["cue"] = cue
    return s


def _intervals(label, reps, work_min, rest_min, work_zone, cue=None):
    s = {"kind": "intervals", "label": label, "reps": reps, "work_min": work_min, "rest_min": rest_min,
         "work_zone": work_zone, "rest_zone": "Z1"}
    if cue:
        s["cue"] = cue
    return s


def easy_run(p, mins, strides=False) -> dict:
    st = [_steady("Easy run", mins - (5 if strides else 0), "Z2", "conversational")]
    if strides:
        st.append(_steady("6 × 20 s strides", 5, "Z1", "relaxed and fast, full recovery between"))
    return {"type": "Running - Easy Run", "duration": mins, "zone": "Z2", "structure": st, "role": "run"}


def quality_run(p, week_i: int, late: bool) -> dict:
    wu, cd = _steady("Warm-up", 15, "Z2", "easy jog"), _steady("Cool-down", 10, "Z1")
    if late and week_i % 3 == 2:                      # race-pace blocks in the last phase
        main = _intervals("3 × 2 km at race pace", 3, 9, 2, "Z4", f"~{p['race_token']}, controlled")
        name, mins = "Running - Goal Pace", 15 + 33 + 10
    elif week_i % 2 == 0:
        main = _intervals("5 × 3 min hard", 5, 3, 2, "Z5", "the VO2max session")
        name, mins = "Running - Intervals", 15 + 25 + 10
    else:
        main = (_intervals("3 × 8 min threshold", 3, 8, 2, "Z4", "even effort") if late else
                _intervals("2 × 10 min tempo", 2, 10, 3, "Z3", "comfortably hard"))
        name, mins = "Running - Tempo", 15 + (30 if late else 26) + 10
    return {"type": name, "duration": mins, "zone": main["work_zone"], "structure": [wu, main, cd], "role": "key"}


def long_run(p, mins, race_finish: int = 0) -> dict:
    st = [_steady("Long run", mins - race_finish, "Z2", "easy; gel after 60 min")]
    if race_finish:
        st.append(_steady("Finish at race pace", race_finish, "Z4", f"~{p['race_token']}"))
    return {"type": "Running - Long Run", "duration": mins, "zone": "Z2", "structure": st, "role": "long"}


# ── helpers ──────────────────────────────────────────────────────────────────

def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _week_number(conn, goal_id: int, d: date) -> int:
    r = conn.execute("SELECT plan_start_date FROM race_goals WHERE id=?", (goal_id,)).fetchone()
    return max(1, (d - date.fromisoformat(r[0])).days // 7 + 1) if r and r[0] else 1


def _pending(conn, goal_id, a: date, b: date) -> list:
    return conn.execute("""SELECT * FROM plan_sessions WHERE goal_id=? AND status='pending'
                           AND session_date BETWEEN ? AND ? ORDER BY session_date""",
                        (goal_id, a.isoformat(), b.isoformat())).fetchall()


def _week_minutes(conn, goal_id, monday: date) -> int:
    r = conn.execute("""SELECT COALESCE(SUM(COALESCE(effective_duration_min, duration_min)), 0) FROM plan_sessions
                        WHERE goal_id=? AND session_date BETWEEN ? AND ? AND status != 'displaced'""",
                     (goal_id, monday.isoformat(), (monday + timedelta(days=6)).isoformat())).fetchone()
    return int(r[0] or 0)


def _blocked_weeks(conn) -> set[date]:
    """Mondays of weeks touched by a tour/camp or its recovery week."""
    out: set[date] = set()
    try:
        for b in conn.execute("SELECT start_date, end_date FROM training_blocks").fetchall():
            d, end = date.fromisoformat(b[0]), date.fromisoformat(b[1]) + timedelta(days=7)
            while d <= end:
                out.add(_monday(d))
                d += timedelta(days=7)
            out.add(_monday(end))
    except sqlite3.OperationalError:
        pass
    return out


def _insert(conn, goal_id: int, d: date, s: dict, note: str, pinned: bool = False) -> int:
    from domains.training.reflow import _ensure_columns
    _ensure_columns(conn)
    cur = conn.execute(
        """INSERT INTO plan_sessions (goal_id, session_date, original_date, week_number, session_type, discipline,
               duration_min, intensity_zone, is_optional, effective_duration_min, status, structure_json,
               is_displaced, role, schedule_note)
           VALUES (?,?,?,?,?, 'running', ?, ?, 0, ?, 'pending', ?, ?, ?, ?)""",
        (goal_id, d.isoformat(), d.isoformat(), _week_number(conn, goal_id, d), s["type"], s["duration"],
         s["zone"], s["duration"], json.dumps(s["structure"]), 1 if pinned else 0, s["role"], note))
    return cur.lastrowid


# ── create / delete ──────────────────────────────────────────────────────────

def create(conn, goal_id: int, name: str, race_date: str, race_type: str = "half_marathon",
           today: date | None = None) -> dict:
    ensure_table(conn)
    today = today or date.today()
    race = date.fromisoformat(race_date)
    goal = conn.execute("SELECT * FROM race_goals WHERE id=?", (goal_id,)).fetchone()
    if goal is None:
        raise ValueError("goal not found")
    if not (today < race < date.fromisoformat(goal["race_date"])):
        raise ValueError("the B race must be after today and before the main race")
    if conn.execute("SELECT 1 FROM b_races WHERE goal_id=? AND race_date=?", (goal_id, race_date)).fetchone():
        raise ValueError("there's already a race on that day")
    p = {**paces(conn, race_type), "race_token": race_token(race_type)}
    ch: dict = {"inserted": [], "swapped": [], "modified": []}
    blocked = _blocked_weeks(conn)
    race_monday = _monday(race)
    phase2 = date(race.year if race.month < 7 else race.year + 1, int(PHASE2[:2]), int(PHASE2[3:]))
    first = _monday(today) + timedelta(days=7)            # from next week: this week is already planned

    def swap_or_add(week_sessions: list, run: dict, d_default: date, room: list[int], prefer_swap=False) -> None:
        """On top while the week's extra allowance lasts; past it (or when asked), the run takes a Zone 2 ride's place."""
        if not prefer_swap and run["duration"] <= room[0]:
            room[0] -= run["duration"]
            ch["inserted"].append(_insert(conn, goal_id, d_default, run, f"{name} build — on top of the bike"))
            return
        cand = [s for s in week_sessions if (s["session_type"] or "").lower() in SWAP_TYPES
                and s["id"] not in {x["id"] for x in ch["swapped"]}]
        cand.sort(key=lambda s: s["effective_duration_min"] or s["duration_min"])
        if cand:
            old = cand[0]
            ch["swapped"].append({"id": old["id"], "note": old["schedule_note"]})
            conn.execute("UPDATE plan_sessions SET status='displaced', schedule_note=? WHERE id=?",
                         (NOTE_SWAP.format(name=name), old["id"]))
            ch["inserted"].append(_insert(conn, goal_id, date.fromisoformat(old["session_date"]), run,
                                          f"{name} build — instead of a Zone 2 ride"))
        else:
            ch["inserted"].append(_insert(conn, goal_id, d_default, run, f"{name} build — on top of the bike"))

    week_i = 0
    monday = first
    long_mins = 70
    while monday < race_monday:
        week = _pending(conn, goal_id, monday, monday + timedelta(days=6))
        if monday in blocked:
            monday += timedelta(days=7)
            continue
        mins = _week_minutes(conn, goal_id, monday)
        neighbours = [_week_minutes(conn, goal_id, monday + timedelta(days=k)) for k in (-7, 7)]
        recovery = mins < 0.7 * max(neighbours + [1])
        late = monday >= phase2
        room = [EXTRA_MIN_HEAVY if mins >= HEAVY_WEEK_MIN else EXTRA_MIN_LIGHT]
        fri = monday + timedelta(days=4)
        if recovery:
            swap_or_add(week, easy_run(p, 30), fri, room)
        else:
            heavy = mins >= HEAVY_WEEK_MIN                # build weeks: the bike already brings the intensity
            swap_or_add(week, easy_run(p, 40, strides=late), fri, room)
            if not heavy:
                swap_or_add(week, quality_run(p, week_i, late), monday + timedelta(days=1), room)
            if late:
                weeks_left = (race_monday - monday).days // 7
                finish = 15 if weeks_left <= 4 else 0
                swap_or_add(week, long_run(p, long_mins, finish), monday + timedelta(days=6), room, prefer_swap=heavy)
                long_mins = min(100, long_mins + 5)
            week_i += 1
        monday += timedelta(days=7)

    # race week: bike key work set aside, long rides short and easy; runs to sharpen; the race pinned
    from domains.training.reflow import _ensure_columns
    _ensure_columns(conn)
    for s in _pending(conn, goal_id, race_monday, race):
        if s["discipline"] == "running":
            continue
        t = (s["session_type"] or "").lower()
        eff = s["effective_duration_min"] or s["duration_min"]
        legs_too_close = t.startswith("strength") and date.fromisoformat(s["session_date"]) >= race - timedelta(days=3)
        if (s["intensity_zone"] in ("Z3", "Z4", "Z5") or t.startswith("test") or legs_too_close
                or s["session_date"] == race.isoformat()):
            ch["swapped"].append({"id": s["id"], "note": s["schedule_note"]})
            conn.execute("UPDATE plan_sessions SET status='displaced', schedule_note=? WHERE id=?",
                         (f"Set aside: {name} week", s["id"]))
        elif "long" in t or "back-to-back" in t or eff > 60:
            ch["modified"].append({"id": s["id"], "eff": eff, "zone": s["intensity_zone"], "note": s["schedule_note"]})
            conn.execute("UPDATE plan_sessions SET effective_duration_min=?, eff_override=?, intensity_zone='Z2', "
                         "schedule_note=? WHERE id=?", (60, 60, f"{name} week — short and easy", s["id"]))
    sharpener = {"type": "Running - Sharpener", "duration": 40, "zone": "Z4", "role": "key", "structure": [
        _steady("Warm-up", 15, "Z2"), _intervals("3 × 1 km at race pace", 3, 5, 2, "Z4", f"~{p['race_token']}"),
        _steady("Cool-down", 10, "Z1")]}
    ch["inserted"].append(_insert(conn, goal_id, race - timedelta(days=4), sharpener, f"{name} week", pinned=True))
    ch["inserted"].append(_insert(conn, goal_id, race - timedelta(days=2), easy_run(p, 30), f"{name} week",
                                  pinned=True))
    shake = {"type": "Running - Shake-out", "duration": 20, "zone": "Z1", "role": "easy",
             "structure": [_steady("Shake-out + 4 strides", 20, "Z1", "loosen the legs, nothing more")]}
    ch["inserted"].append(_insert(conn, goal_id, race - timedelta(days=1), shake, f"{name} tomorrow", pinned=True))
    race_min = round(p["race_time_s"] / 60)
    km = DISTANCES_KM.get(race_type, 21.0975)
    race_s = {"type": f"Race - {name}", "duration": race_min, "zone": "Z4", "role": "key", "structure": [
        _steady("First 5 km", round(race_min * 5 / km), "Z3", f"a touch slower than {p['race_token']} — settle"),
        _steady("Race", round(race_min * (km - 8) / km), "Z4", f"hold ~{p['race_token']}"),
        _steady("Last 3 km", race_min - round(race_min * 5 / km) - round(race_min * (km - 8) / km), "Z4",
                "whatever is left")]}
    ch["inserted"].append(_insert(conn, goal_id, race, race_s, f"{name} — target ~{fmt_time(p['race_time_s'])}",
                                  pinned=True))

    # after: three easy days
    for s in _pending(conn, goal_id, race + timedelta(days=1), race + timedelta(days=3)):
        t = (s["session_type"] or "").lower()
        eff = s["effective_duration_min"] or s["duration_min"]
        if s["intensity_zone"] in ("Z3", "Z4", "Z5") or "long" in t or "back-to-back" in t or t.startswith("test"):
            ch["modified"].append({"id": s["id"], "eff": eff, "zone": s["intensity_zone"], "note": s["schedule_note"]})
            short = min(eff, max(30, round(eff * 0.6)), 90)
            conn.execute("UPDATE plan_sessions SET effective_duration_min=?, eff_override=?, intensity_zone='Z2', "
                         "schedule_note=? WHERE id=?", (short, short, f"Easy after {name}", s["id"]))

    cur = conn.execute("INSERT INTO b_races (goal_id, name, race_type, race_date, start_date, changes_json) "
                       "VALUES (?,?,?,?,?,?)", (goal_id, name, race_type, race_date, first.isoformat(), json.dumps(ch)))
    conn.commit()
    try:
        from domains.training.reflow import reflow_goal
        reflow_goal(conn, goal_id)                    # place the runs around roster / long rides / key days
    except Exception:
        pass
    return get(conn, cur.lastrowid)


def delete(conn, b_id: int) -> None:
    ensure_table(conn)
    b = conn.execute("SELECT * FROM b_races WHERE id=?", (b_id,)).fetchone()
    if not b:
        raise ValueError("not found")
    ch = json.loads(b["changes_json"] or "{}")
    for sid in ch.get("inserted", []):
        conn.execute("DELETE FROM plan_sessions WHERE id=? AND status != 'completed'", (sid,))
    for s in ch.get("swapped", []):
        conn.execute("UPDATE plan_sessions SET status='pending', schedule_note=? WHERE id=? AND status='displaced'",
                     (s.get("note"), s["id"]))
    for s in ch.get("modified", []):
        conn.execute("UPDATE plan_sessions SET effective_duration_min=?, eff_override=NULL, intensity_zone=?, "
                     "schedule_note=? WHERE id=? AND status='pending'", (s["eff"], s["zone"], s.get("note"), s["id"]))
    conn.execute("DELETE FROM b_races WHERE id=?", (b_id,))
    conn.commit()


def get(conn, b_id: int) -> dict:
    b = conn.execute("SELECT * FROM b_races WHERE id=?", (b_id,)).fetchone()
    return _out(conn, b) if b else {}


def _out(conn, b) -> dict:
    ch = json.loads(b["changes_json"] or "{}")
    ids = ch.get("inserted", [])
    runs = conn.execute(f"SELECT status, effective_duration_min, session_type FROM plan_sessions WHERE id IN "
                        f"({','.join('?' * len(ids)) or 'NULL'})", ids).fetchall() if ids else []
    p = paces(conn, b["race_type"])
    return {"id": b["id"], "goal_id": b["goal_id"], "name": b["name"], "race_type": b["race_type"],
            "race_date": b["race_date"], "runs": sum(1 for r in runs if not r["session_type"].startswith("Race")),
            "runs_done": sum(1 for r in runs if r["status"] == "completed" and not r["session_type"].startswith("Race")),
            "run_hours": round(sum(r["effective_duration_min"] or 0 for r in runs
                                   if not r["session_type"].startswith("Race")) / 60, 1),
            "bike_swapped": len(ch.get("swapped", [])),
            "target_time": fmt_time(p["race_time_s"]), "race_pace": fmt_pace(p["race"]),
            "paces": {k: fmt_pace(v) for k, v in p.items() if k != "race_time_s"}}


def list_for(conn, goal_id: int) -> list[dict]:
    ensure_table(conn)
    return [_out(conn, b) for b in conn.execute("SELECT * FROM b_races WHERE goal_id=? ORDER BY race_date",
                                                (goal_id,)).fetchall()]
