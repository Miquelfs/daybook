"""
Push upcoming plan sessions to Garmin Connect as structured workouts, scheduled
on their calendar day — so the watch/Edge shows today's session and, on the
smart trainer, ERG holds the watts by itself.

  - Trainer sessions (type "(trainer)" / tests): POWER targets from FTP
    (athlete_zones.ftp_w) — the road bike has no power meter.
  - Outdoor rides: HEART-RATE targets from the ride HR zones.
  - Runs: easy/long (Z1–Z2) by HEART RATE from the run threshold HR, tempo /
    threshold / intervals / race pace (Z3+) by PACE from the run threshold pace.
  - Gym sessions, tour days and race days are not pushed.

Idempotent and self-healing: garmin_workout_push remembers what was sent per
session (workout id, schedule id, payload hash, date). A session that moved
(reflow / planner / coach), got shortened or downgraded is deleted on Garmin
and re-sent; one that was skipped, displaced or moved out of the window is
removed from the Garmin calendar. Completed ones are left alone.

Usage:
  python -m domains.health.garmin.workout_push              # next 9 days
  python -m domains.health.garmin.workout_push --dry-run    # print payloads, send nothing
Disable entirely with GARMIN_WORKOUT_PUSH=0 in .env.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import date, timedelta

from domains.training.b_race import RACE_TOKEN, race_pace_s, render_cue

WINDOW_DAYS = 9            # today … next Sunday after the weekend planning

CYCLING = {"sportTypeId": 2, "sportTypeKey": "cycling"}
RUNNING = {"sportTypeId": 1, "sportTypeKey": "running"}
# running: %LTHR (Friel run zones) for the easy work, pace bands as × threshold pace (s/km) for the quality work
RUN_LTHR_PCT = {"Z1": (70, 84), "Z2": (85, 89), "Z3": (90, 94), "Z4": (95, 99), "Z5": (100, 106)}
RUN_PACE_X = {"Z3": (1.10, 1.04), "Z4": (1.03, 0.97), "Z5": (0.95, 0.88)}     # (slow end, fast end)
RACE_PACE_BAND = (1.02, 0.98)          # race-pace steps: ±2% around the race's own pace
STEP = {"warmup": (1, "warmup"), "cooldown": (2, "cooldown"), "interval": (3, "interval"),
        "recovery": (4, "recovery"), "repeat": (6, "repeat")}
FTP_PCT = {"Z1": (40, 55), "Z2": (56, 75), "Z3": (88, 94), "Z4": (95, 105), "Z5": (106, 120)}
# %LTHR when the zone table is missing (Friel cycling zones)
LTHR_PCT = {"Z1": (60, 80), "Z2": (81, 89), "Z3": (90, 93), "Z4": (94, 99), "Z5": (100, 106)}


# ── payload ──────────────────────────────────────────────────────────────────

def _targets(conn: sqlite3.Connection) -> dict:
    """{'ftp': W|None, 'hr': {Z: (lo, hi)}} from the latest ride zones."""
    out: dict = {"ftp": None, "hr": {}, "run_hr": {}, "run_pace": {}}
    try:
        z = conn.execute("SELECT ftp_w, threshold_hr, zones_json FROM athlete_zones WHERE sport='ride' "
                         "ORDER BY valid_from DESC LIMIT 1").fetchone()
    except sqlite3.OperationalError:
        return out
    if z:
        out["ftp"] = z["ftp_w"]
    try:
        r = conn.execute("SELECT threshold_hr, threshold_pace_s_per_km FROM athlete_zones WHERE sport='run' "
                         "ORDER BY valid_from DESC LIMIT 1").fetchone()
    except sqlite3.OperationalError:
        r = None
    if r and r["threshold_hr"]:
        out["run_hr"] = {k: (round(r["threshold_hr"] * lo / 100), round(r["threshold_hr"] * hi / 100))
                         for k, (lo, hi) in RUN_LTHR_PCT.items()}
    if r and r["threshold_pace_s_per_km"]:
        t = r["threshold_pace_s_per_km"]
        # Garmin pace targets are speeds in m/s: slower bound first
        out["run_pace"] = {k: (round(1000 / (t * slow), 3), round(1000 / (t * fast), 3))
                           for k, (slow, fast) in RUN_PACE_X.items()}
        out["run_threshold_pace"] = t
    if z and z["threshold_hr"]:
        for k, (lo, hi) in LTHR_PCT.items():
            out["hr"][k] = (round(z["threshold_hr"] * lo / 100), round(z["threshold_hr"] * hi / 100))
    elif z:
        try:
            for b in json.loads(z["zones_json"] or "[]"):
                if b.get("name") in FTP_PCT and b.get("min_hr"):
                    out["hr"][b["name"]] = (b["min_hr"], min(b.get("max_hr") or 220, 220))
        except ValueError:
            pass
    return out


def is_indoor(session_type: str) -> bool:
    t = (session_type or "").lower()
    return "(trainer)" in t or t.startswith("test - bike")


def _run_target(zone: str, tg: dict) -> dict:
    if zone in tg.get("run_pace", {}):
        lo, hi = tg["run_pace"][zone]
        return {"targetType": {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone"},
                "targetValueOne": lo, "targetValueTwo": hi}
    if zone in tg.get("run_hr", {}):
        lo, hi = tg["run_hr"][zone]
        return {"targetType": {"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone"},
                "targetValueOne": lo, "targetValueTwo": hi}
    return {"targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}}


def _target(zone: str, indoor: bool, tg: dict) -> dict:
    if indoor and tg["ftp"]:
        lo, hi = FTP_PCT.get(zone, FTP_PCT["Z2"])
        return {"targetType": {"workoutTargetTypeId": 2, "workoutTargetTypeKey": "power.zone"},
                "targetValueOne": round(tg["ftp"] * lo / 100), "targetValueTwo": round(tg["ftp"] * hi / 100)}
    if zone in tg["hr"]:
        lo, hi = tg["hr"][zone]
        return {"targetType": {"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone"},
                "targetValueOne": lo, "targetValueTwo": hi}
    return {"targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}}


def trimmed_structure(session: dict) -> tuple[list[dict], int]:
    """(steps, effective minutes): the session's structure, with a shortened session
    (coach / roster / volume factor) trimming its main steady block. Shared with
    the Intervals.icu → MyWhoosh push."""
    structure = json.loads(session["structure_json"]) if session.get("structure_json") else None
    if not structure:
        structure = [{"kind": "steady", "label": session["session_type"], "duration_min": session["effective_duration_min"]
                      or session["duration_min"], "zone": session["intensity_zone"]}]
    def rep_min(s: dict) -> int:
        return (s.get("work_min") or 0) + (s.get("rest_min") or 0)

    planned = sum(s.get("duration_min") or (s.get("reps", 1) * rep_min(s))
                  for s in structure if s.get("kind") in ("steady", "intervals"))
    eff = session["effective_duration_min"] or session["duration_min"] or planned
    cut = max(0, planned - eff)
    if cut:
        structure = list(structure)
        steady_idx = [i for i, s in enumerate(structure) if s.get("kind") == "steady"]
        if steady_idx:
            i = max(steady_idx, key=lambda i: structure[i].get("duration_min") or 0)
            before = structure[i].get("duration_min") or 0
            structure[i] = dict(structure[i], duration_min=max(5, before - cut))
            cut -= before - structure[i]["duration_min"]
        # Still too long (warm-up already at its floor): drop whole repeats of the main set
        reps_idx = [i for i, s in enumerate(structure) if s.get("kind") == "intervals" and (s.get("reps") or 1) > 1]
        if cut > 0 and reps_idx:
            i = max(reps_idx, key=lambda i: structure[i]["reps"] * rep_min(structure[i]))
            # nearest whole number of repeats; a tie keeps the extra repeat
            drop = min(structure[i]["reps"] - 1, round(cut / max(1, rep_min(structure[i])) - 0.01))
            structure[i] = dict(structure[i], reps=structure[i]["reps"] - drop)
    return structure, eff


def build_workout(session: dict, tg: dict) -> dict | None:
    """Garmin workout JSON for one plan session, or None if it shouldn't be pushed."""
    stype = session["session_type"] or ""
    run = session["discipline"] == "running"
    if (stype.lower().startswith(("strength", "race")) or session["discipline"] not in ("cycling", "running")
            or stype.lower() in ("cycling - tour day", "cycling - camp day")):   # tours: just ride, no workout
        return None
    indoor = not run and is_indoor(stype)
    structure, eff = trimmed_structure(session)
    is_test = stype.lower().startswith("test")
    tp = tg.get("run_threshold_pace")

    def race_pace(st: dict) -> float | None:
        """Race-pace steps carry a {pace:race:<type>} token: their target is race pace, not the Z4 band."""
        m = RACE_TOKEN.search(st.get("cue") or "") if run and tp else None
        return race_pace_s(tp, m.group(1)) if m else None

    def text(st: dict) -> str:
        return " — ".join(x for x in (st.get("label"), render_cue(st.get("cue"), tp or 300.0)) if x)

    order = 0
    steps = []

    def exe(kind: str, secs: int, zone: str, desc: str | None, free: bool = False, pace_s: float | None = None):
        nonlocal order
        order += 1
        sid, skey = STEP[kind]
        # free=True: no target — the FTP test effort must not be ERG-capped
        target = {"targetType": {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}} if free \
            else {"targetType": {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone"},
                  "targetValueOne": round(1000 / (pace_s * RACE_PACE_BAND[0]), 3),
                  "targetValueTwo": round(1000 / (pace_s * RACE_PACE_BAND[1]), 3)} if pace_s \
            else _run_target(zone, tg) if run else _target(zone, indoor, tg)
        d = {"type": "ExecutableStepDTO", "stepOrder": order,
             "stepType": {"stepTypeId": sid, "stepTypeKey": skey},
             "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time"},
             "endConditionValue": int(secs), **target}
        if desc:
            d["description"] = desc[:250]
        return d

    n = len(structure)
    for i, st in enumerate(structure):
        kind = st.get("kind")
        label = (st.get("label") or "").lower()
        if kind == "steady" and st.get("duration_min"):
            role = "warmup" if (i == 0 and "warm" in label) else "cooldown" if (i == n - 1 and "cool" in label) \
                else "recovery" if st.get("zone") == "Z1" and "spin" not in label else "interval"
            steps.append(exe(role, st["duration_min"] * 60, st.get("zone") or "Z2", text(st), pace_s=race_pace(st)))
        elif kind == "intervals" and st.get("reps") == 1 and st.get("work_min"):
            # A single effort (FTP test, climb benchmark) is one plain step, not a repeat ×1.
            steps.append(exe("interval", st["work_min"] * 60, st.get("work_zone") or "Z4", text(st), free=is_test,
                             pace_s=race_pace(st)))
            if st.get("rest_min"):
                steps.append(exe("recovery", st["rest_min"] * 60, st.get("rest_zone") or "Z1", None))
        elif kind == "intervals" and st.get("reps") and st.get("work_min"):
            order += 1
            group = {"type": "RepeatGroupDTO", "stepOrder": order,
                     "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat"},
                     "numberOfIterations": int(st["reps"]), "smartRepeat": False,
                     "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations"},
                     "endConditionValue": int(st["reps"]), "workoutSteps": []}
            group["workoutSteps"].append(exe("interval", st["work_min"] * 60, st.get("work_zone") or "Z4", text(st),
                                             free=is_test, pace_s=race_pace(st)))
            if st.get("rest_min"):
                group["workoutSteps"].append(exe("recovery", st["rest_min"] * 60, st.get("rest_zone") or "Z1", None))
            steps.append(group)
    if not steps:
        return None

    if run:
        name = f"Run · {stype.replace('Running - ', '')} {eff}′"[:60]
        tp = tg.get("run_threshold_pace")
        how = ("Run — easy by heart rate, quality by pace" +
               (f" (threshold {int(tp // 60)}:{int(tp % 60):02d}/km)" if tp else ""))
        return {"workoutName": name, "description": f"{how} · Daybook plan session #{session['id']}",
                "sportType": RUNNING, "estimatedDurationInSecs": int(eff * 60),
                "workoutSegments": [{"segmentOrder": 1, "sportType": RUNNING, "workoutSteps": steps}]}
    name = stype.replace("Cycling - ", "").replace("Test - ", "Test ").replace(" (trainer)", "")
    name = f"312 · {name} {eff}′"[:60]
    if indoor and tg["ftp"]:
        how = f"Trainer — ERG watts from FTP {round(tg['ftp'])} W"
    elif indoor:
        how = "Trainer — no FTP yet, so heart-rate targets (do the FTP test first)"
    else:
        how = "Outdoor — heart-rate targets"
    desc = f"{how} · Daybook plan session #{session['id']}"
    return {"workoutName": name, "description": desc, "sportType": CYCLING,
            "estimatedDurationInSecs": int(eff * 60),
            "workoutSegments": [{"segmentOrder": 1, "sportType": CYCLING, "workoutSteps": steps}]}


def _hash(payload: dict, day: str) -> str:
    return hashlib.sha1((day + json.dumps(payload, sort_keys=True)).encode()).hexdigest()


# ── Garmin API (generic connectapi calls — independent of library helpers) ───

def _api(client, method: str, path: str, payload: dict | None = None):
    """
    POST/DELETE against connectapi across garminconnect versions:
      - newer (own HTTP client, no garth): Garmin.connectapi() is GET-only, so go
        through its client's _run_request(method, path, json=...) → Response
      - older (garth-based): garth.connectapi(path, method=..., json=...)
    """
    kw = {"json": payload} if payload is not None else {}
    inner = getattr(client, "client", None)
    if inner is not None and hasattr(inner, "_run_request"):
        resp = inner._run_request(method, path, **kw)
        status = getattr(resp, "status_code", 200)
        if status >= 400:
            raise RuntimeError(f"HTTP {status}: {getattr(resp, 'text', '')[:200]}")
        if status == 204 or not getattr(resp, "content", b"x"):
            return None
        try:
            return resp.json()
        except ValueError:
            return None
    garth = getattr(client, "garth", None)
    if garth is not None and hasattr(garth, "connectapi"):
        return garth.connectapi(path, method=method, **kw)
    if method == "GET":
        return client.connectapi(path)
    raise RuntimeError("this garminconnect version exposes no way to POST/DELETE to connectapi")


def _create_and_schedule(client, payload: dict, day: str) -> tuple[str, str | None]:
    res = _api(client, "POST", "/workout-service/workout", payload) or {}
    wid = res.get("workoutId")
    if not wid:
        raise RuntimeError(f"no workoutId in response: {str(res)[:200]}")
    sch = _api(client, "POST", f"/workout-service/schedule/{wid}", {"date": day}) or {}
    return str(wid), str(sch.get("workoutScheduleId")) if sch.get("workoutScheduleId") else None


def _delete(client, workout_id: str | None, schedule_id: str | None) -> None:
    for path in ([f"/workout-service/schedule/{schedule_id}"] if schedule_id else []) + \
                ([f"/workout-service/workout/{workout_id}"] if workout_id else []):
        try:
            _api(client, "DELETE", path)
        except Exception:
            pass   # already gone on Garmin — fine


# ── sync ─────────────────────────────────────────────────────────────────────

def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS garmin_workout_push (
        session_id     INTEGER PRIMARY KEY,
        workout_id     TEXT,
        schedule_id    TEXT,
        scheduled_date TEXT,
        payload_hash   TEXT,
        pushed_at      TEXT,
        last_error     TEXT)""")
    conn.commit()


def push_upcoming(conn: sqlite3.Connection, client=None, days: int = WINDOW_DAYS,
                  dry_run: bool = False, verbose: bool = True) -> dict:
    ensure_table(conn)
    today = date.today()
    end = (today + timedelta(days=days)).isoformat()
    tg = _targets(conn)

    sessions = conn.execute(
        """SELECT ps.* FROM plan_sessions ps JOIN race_goals rg ON rg.id = ps.goal_id
           WHERE rg.status='active' AND ps.status='pending' AND ps.session_date BETWEEN ? AND ?
           ORDER BY ps.session_date""",
        (today.isoformat(), end),
    ).fetchall()
    wanted: dict[int, tuple[dict, str, str]] = {}
    for s in sessions:
        payload = build_workout(dict(s), tg)
        if payload:
            wanted[s["id"]] = (payload, s["session_date"], _hash(payload, s["session_date"]))

    pushed = {r["session_id"]: r for r in conn.execute("SELECT * FROM garmin_workout_push")}
    summary = {"created": 0, "updated": 0, "removed": 0, "unchanged": 0, "errors": []}

    if dry_run:
        for sid, (payload, day, _) in wanted.items():
            print(f"--- session {sid} on {day}\n{json.dumps(payload, indent=1)}")
        return {**summary, "would_push": len(wanted)}

    if client is None:
        from domains.health.garmin.garmin_client import get_client
        client = get_client()

    # Remove what's no longer wanted in the window (skipped / displaced / moved away / deleted),
    # but never touch completed sessions or anything dated before today.
    for sid, row in pushed.items():
        if sid in wanted:
            continue
        st = conn.execute("SELECT status, session_date FROM plan_sessions WHERE id=?", (sid,)).fetchone()
        if st and (st["status"] == "completed" or st["session_date"] < today.isoformat()):
            continue
        _delete(client, row["workout_id"], row["schedule_id"])
        conn.execute("DELETE FROM garmin_workout_push WHERE session_id=?", (sid,))
        summary["removed"] += 1

    for sid, (payload, day, h) in wanted.items():
        row = pushed.get(sid)
        if row and row["payload_hash"] == h and row["workout_id"] and not row["last_error"]:
            summary["unchanged"] += 1
            continue
        try:
            if row:
                _delete(client, row["workout_id"], row["schedule_id"])
            wid, sch = _create_and_schedule(client, payload, day)
            conn.execute(
                """INSERT OR REPLACE INTO garmin_workout_push
                   (session_id, workout_id, schedule_id, scheduled_date, payload_hash, pushed_at, last_error)
                   VALUES (?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'),NULL)""",
                (sid, wid, sch, day, h),
            )
            summary["updated" if row else "created"] += 1
            if verbose:
                print(f"  ✓ {day} {payload['workoutName']}", file=sys.stderr)
        except Exception as e:
            conn.execute(
                """INSERT OR REPLACE INTO garmin_workout_push
                   (session_id, workout_id, schedule_id, scheduled_date, payload_hash, pushed_at, last_error)
                   VALUES (?,NULL,NULL,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'),?)""",
                (sid, day, h, str(e)[:300]),
            )
            summary["errors"].append(f"{day} {payload['workoutName']}: {e}")
        conn.commit()
    conn.commit()
    return summary


def push_status(conn: sqlite3.Connection) -> dict[int, dict]:
    ensure_table(conn)
    return {r["session_id"]: {"workout_id": r["workout_id"], "date": r["scheduled_date"],
                              "pushed_at": r["pushed_at"], "error": r["last_error"]}
            for r in conn.execute("SELECT * FROM garmin_workout_push")}


def enabled() -> bool:
    return os.getenv("GARMIN_WORKOUT_PUSH", "1").strip() not in ("0", "false", "no", "")


def main() -> None:
    from infrastructure.db.connection import get_connection

    p = argparse.ArgumentParser(description="Push upcoming plan sessions to Garmin Connect")
    p.add_argument("--days", type=int, default=WINDOW_DAYS)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    if not enabled() and not args.dry_run:
        print("GARMIN_WORKOUT_PUSH=0 — skipping", file=sys.stderr)
        return
    conn = get_connection()
    try:
        s = push_upcoming(conn, days=args.days, dry_run=args.dry_run)
    finally:
        conn.close()
    print(f"workouts → Garmin: {s}", file=sys.stderr)
    if s.get("errors"):
        sys.exit(1)   # surfaces as a failing job in System status


if __name__ == "__main__":
    main()
