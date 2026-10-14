"""
AI coach — a weekly review that reads all of your data and proposes concrete,
one-tap changes to the coming week of the plan.

It sees: the last 14 days of planned vs done sessions (with RPE, actual time,
HR and power when a ride is linked), sleep, HRV status, resting HR, body
battery, Garmin readiness, form (CTL/ATL/TSB, ramp), mood/energy, active
injuries, FTP / threshold HR / weight, and next week's sessions together with
each day's roster window (domains.training.day_context).

It returns a short assessment plus up to ~5 adjustments — move / shorten /
downgrade / skip — each referencing a real session id. Adjustments are
validated server-side (pending session of this goal, inside that Mon–Sun week,
not in the past, sane durations/zones) and only applied when you tap them, so
the plan's structure stays in charge and the coach fine-tunes it.

Usage:
  python -m domains.training.coach --auto     # weekends: review next week if not done yet
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date, timedelta

from domains.training.day_context import DayContextReader

ZONES = ("Z1", "Z2", "Z3", "Z4", "Z5")
ACTIONS = ("move", "shorten", "downgrade", "skip")


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS coach_reviews (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id     INTEGER NOT NULL,
        week_start  TEXT NOT NULL,
        review_json TEXT NOT NULL,
        applied_json TEXT NOT NULL DEFAULT '[]',
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )""")
    conn.commit()


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def gather(conn: sqlite3.Connection, goal_id: int, week_start: str) -> dict:
    """Everything the coach needs, compact enough for one prompt."""
    t = _tables(conn)
    goal = conn.execute("SELECT * FROM race_goals WHERE id=?", (goal_id,)).fetchone()
    ws = date.fromisoformat(week_start)
    we = ws + timedelta(days=6)
    today = date.today()
    since = (today - timedelta(days=14)).isoformat()

    recent = []
    for r in conn.execute(
        """SELECT ps.session_date, ps.session_type, ps.effective_duration_min, ps.intensity_zone,
                  ps.status, ps.rpe_actual, ps.notes, ps.is_optional,
                  a.duration_seconds, a.avg_heart_rate, a.avg_power_watts, a.distance_meters,
                  a.elevation_gain_meters
           FROM plan_sessions ps LEFT JOIN activities a ON a.id = ps.completed_activity_id
           WHERE ps.goal_id=? AND ps.session_date BETWEEN ? AND ?
           ORDER BY ps.session_date""",
        (goal_id, since, (today - timedelta(days=1)).isoformat()),
    ):
        s = {"date": r["session_date"], "type": r["session_type"], "planned_min": r["effective_duration_min"],
             "zone": r["intensity_zone"], "status": "missed" if r["status"] == "pending" else r["status"],
             "optional": bool(r["is_optional"])}
        if r["rpe_actual"]:
            s["rpe"] = r["rpe_actual"]
        if r["duration_seconds"]:
            s["actual_min"] = round(r["duration_seconds"] / 60)
        if r["avg_heart_rate"]:
            s["avg_hr"] = round(r["avg_heart_rate"])
        if r["avg_power_watts"]:
            s["avg_w"] = round(r["avg_power_watts"])
        if r["distance_meters"]:
            s["km"] = round(r["distance_meters"] / 1000, 1)
        if r["elevation_gain_meters"]:
            s["climb_m"] = round(r["elevation_gain_meters"])
        if r["notes"]:
            s["notes"] = r["notes"][:120]
        recent.append(s)

    # Unplanned activities too (a spontaneous ride still counts as load)
    unplanned = []
    if "activities" in t:
        for r in conn.execute(
            """SELECT date, activity_type, duration_seconds, avg_heart_rate FROM activities
               WHERE date BETWEEN ? AND ? AND id NOT IN
                 (SELECT completed_activity_id FROM plan_sessions WHERE completed_activity_id IS NOT NULL)""",
            (since, today.isoformat()),
        ):
            unplanned.append({"date": r["date"], "type": r["activity_type"],
                              "min": round((r["duration_seconds"] or 0) / 60),
                              "avg_hr": round(r["avg_heart_rate"]) if r["avg_heart_rate"] else None})

    daily = []
    d = today - timedelta(days=14)
    while d <= today:
        ds = d.isoformat()
        row: dict = {"date": ds}
        if "sleep" in t:
            sl = conn.execute("SELECT duration_seconds, score FROM sleep WHERE date=?", (ds,)).fetchone()
            if sl and sl["duration_seconds"]:
                row["sleep_h"] = round(sl["duration_seconds"] / 3600, 1)
                if sl["score"]:
                    row["sleep_score"] = sl["score"]
        if "hrv" in t:
            h = conn.execute("SELECT status, last_night_avg FROM hrv WHERE date=?", (ds,)).fetchone()
            if h and h["status"]:
                row["hrv"] = h["status"]
        if "daily_stats" in t:
            ds_ = conn.execute("SELECT resting_hr, body_battery_high, stress_avg FROM daily_stats WHERE date=?",
                               (ds,)).fetchone()
            if ds_:
                if ds_["resting_hr"]:
                    row["rhr"] = ds_["resting_hr"]
                if ds_["body_battery_high"]:
                    row["bb"] = ds_["body_battery_high"]
        if "garmin_physio" in t:
            p = conn.execute("SELECT training_readiness_score FROM garmin_physio WHERE date=?", (ds,)).fetchone()
            if p and p[0]:
                row["readiness"] = p[0]
        if "days" in t:
            dd = conn.execute("SELECT mood, energy FROM days WHERE date=?", (ds,)).fetchone()
            if dd and dd["mood"]:
                row["mood"] = dd["mood"]
            if dd and dd["energy"]:
                row["energy"] = dd["energy"]
        if "roster" in t:
            ro = conn.execute("SELECT duty_type, end_time FROM roster WHERE date=?", (ds,)).fetchone()
            if ro:
                row["duty"] = ro["duty_type"] + (f" until {ro['end_time']}" if ro["end_time"] else "")
        daily.append(row)
        d += timedelta(days=1)

    load = None
    if "training_load_daily" in t:
        lr = conn.execute(
            """SELECT ctl, atl, tsb, ramp_rate FROM training_load_daily WHERE date <= ?
               ORDER BY date DESC, CASE sport WHEN 'combi' THEN 0 ELSE 1 END LIMIT 1""",
            (today.isoformat(),),
        ).fetchone()
        if lr:
            load = {k: round(lr[k], 1) for k in ("ctl", "atl", "tsb", "ramp_rate") if lr[k] is not None}

    injuries = []
    if "injuries" in t:
        injuries = [f"{r['zone']} (pain {r['pain_scale']}/10)" for r in conn.execute(
            "SELECT zone, pain_scale FROM injuries WHERE status='active'")]

    engine = {}
    if "athlete_zones" in t:
        z = conn.execute("SELECT ftp_w, threshold_hr FROM athlete_zones WHERE sport='ride' "
                         "ORDER BY valid_from DESC LIMIT 1").fetchone()
        if z:
            engine = {"ftp_w": z["ftp_w"], "threshold_hr": z["threshold_hr"]}
    if "weight_log" in t:
        w = conn.execute("SELECT weight_kg FROM weight_log ORDER BY date DESC LIMIT 1").fetchone()
        if w:
            engine["weight_kg"] = w["weight_kg"]

    reader = DayContextReader(conn, (goal["available_days"] or "").split(","))
    week = []
    for i in range(7):
        dd = ws + timedelta(days=i)
        ctx = reader.context(dd.isoformat())
        sessions = [
            {"id": r["id"], "type": r["session_type"], "min": r["effective_duration_min"],
             "zone": r["intensity_zone"], "optional": bool(r["is_optional"]),
             "moved_by_user": bool(r["is_displaced"])}
            for r in conn.execute(
                """SELECT id, session_type, effective_duration_min, intensity_zone, is_optional, is_displaced
                   FROM plan_sessions WHERE goal_id=? AND session_date=? AND status='pending'""",
                (goal_id, dd.isoformat()),
            )
        ]
        week.append({"date": dd.isoformat(), "day": dd.strftime("%a"), "context": ctx["label"],
                     "ride_window_min": ctx["window_min"], "sessions": sessions})

    quality = {}
    try:
        from domains.training import ride_quality as rq
        quality["long_rides"] = [
            {k: v for k, v in r.items() if k in ("date", "minutes", "km", "climb_m", "avg_hr",
                                                 "decoupling_pct", "carbs_g_h")}
            for r in rq.long_rides(conn, goal_id, days=42)[:4]]
        quality["climbs"] = [{k: c[k] for k in ("date", "gain_m", "duration_min", "vam", "avg_hr")}
                             for c in rq.climbs(conn, days=120)[:4]]
    except Exception:
        pass

    return {
        "ride_quality": quality,
        "goal": {"name": goal["name"], "race_date": goal["race_date"], "race_type": goal["race_type"],
                 "days_to_race": (date.fromisoformat(goal["race_date"]) - today).days},
        "today": today.isoformat(),
        "engine": engine, "load": load, "injuries": injuries,
        "recent_sessions": recent, "unplanned_activities": unplanned,
        "daily": daily, "week_to_plan": {"start": ws.isoformat(), "end": we.isoformat(), "days": week},
    }


PROMPT = """You are an experienced endurance cycling coach reviewing ONE athlete's week.
Athlete: airline pilot (irregular roster, late landings, layovers), training for the
Mallorca 312 (312 km, 4,750 m climbing, cut-offs: km 97 by 11:15, km 220 by 16:30,
finish ~20:40). No power meter on the road bike: intervals/tests are on a smart trainer
(watts), outdoor rides by HR/RPE. Gym strength 1-2x/week. The plan's structure (phases,
long-ride progression, recovery weeks) is sound — your job is to FINE-TUNE the coming
week from the data, not rewrite it.

Principles:
- Protect, in order: the long ride (and back-to-back day), then 1 quality session, then easy volume, then gym.
- Fatigue signals (several short nights < 6.5h, HRV unbalanced/low, RHR up ≥ 5, readiness < 40,
  TSB < -20, high RPE on easy days, missed sessions from exhaustion, injury) → reduce intensity
  or trim easy volume before touching the long ride.
- Consistent misses on a weekday pattern → move sessions to days that actually work.
- Good adherence + good recovery → keep the plan; don't add volume (> 10% jumps are not allowed).
- ride_quality: decoupling > 5 % on long rides = durability still building (keep them aerobic);
  carbs_g_h well under ~80 = fuelling must be practised; climb VAM trend = climbing progress.
- Never schedule hard work the morning after a duty that ended after 23:00, or on a day with
  ride_window_min 0. Respect sessions moved_by_user unless there's a clear safety reason.
- Moves stay inside the week ({week_start}..{week_end}) and on or after {today}.
- Be specific and brief, like a coach talking to the athlete ("you"). Use numbers from the data.

DATA (JSON):
{data}

Reply with ONLY this JSON:
{{
  "headline": "max 10 words",
  "assessment": "2-4 sentences: how last week went and how the body is responding",
  "wins": ["short", "..."],
  "watch": ["short risk/concern", "..."],
  "adjustments": [
    {{"session_id": 123, "action": "move|shorten|downgrade|skip",
      "to_date": "YYYY-MM-DD (move only)", "duration_min": 60 (shorten only),
      "zone": "Z2 (downgrade only)", "reason": "one sentence"}}
  ],
  "focus": "one sentence: the single most important thing this week"
}}
Use at most 5 adjustments; an empty list is a fine answer when the week already fits."""


def _validate(conn, goal_id: int, ws: date, adjustments: list) -> list[dict]:
    today = date.today()
    we = ws + timedelta(days=6)
    ok = []
    for a in adjustments or []:
        try:
            sid = int(a.get("session_id"))
        except (TypeError, ValueError):
            continue
        action = a.get("action")
        if action not in ACTIONS:
            continue
        r = conn.execute("SELECT * FROM plan_sessions WHERE id=? AND goal_id=? AND status='pending'",
                         (sid, goal_id)).fetchone()
        if not r:
            continue
        sd = date.fromisoformat(r["session_date"])
        if not (ws <= sd <= we) or "race day" == (r["session_type"] or "").lower():
            continue
        clean = {"session_id": sid, "action": action, "reason": str(a.get("reason") or "")[:240],
                 "session_type": r["session_type"], "session_date": r["session_date"],
                 "current_min": r["effective_duration_min"], "current_zone": r["intensity_zone"]}
        if action == "move":
            try:
                to = date.fromisoformat(str(a.get("to_date")))
            except ValueError:
                continue
            if not (ws <= to <= we) or to < today or to == sd:
                continue
            clean["to_date"] = to.isoformat()
        elif action == "shorten":
            try:
                m = int(a.get("duration_min"))
            except (TypeError, ValueError):
                continue
            base = r["effective_duration_min"] or r["duration_min"] or 0
            if not (10 <= m < base):
                continue
            clean["duration_min"] = m
        elif action == "downgrade":
            z = str(a.get("zone") or "")
            if z not in ZONES or z >= (r["intensity_zone"] or "Z2"):
                continue
            clean["zone"] = z
        ok.append(clean)
    return ok[:6]


def generate_review(conn: sqlite3.Connection, goal_id: int, week_start: str) -> dict | None:
    from domains.ai import ollama_client

    ensure_table(conn)
    ws = _monday(date.fromisoformat(week_start))
    data = gather(conn, goal_id, ws.isoformat())
    prompt = PROMPT.format(data=json.dumps(data, separators=(",", ":"), default=str),
                           week_start=ws.isoformat(), week_end=(ws + timedelta(days=6)).isoformat(),
                           today=date.today().isoformat())
    model = getattr(ollama_client, "CLAUDE_MODEL_SMART", None) if ollama_client.LLM_PROVIDER == "claude" else None
    out = ollama_client.generate_json(prompt, model=model, max_tokens=2500)
    if not isinstance(out, dict):
        return None
    review = {
        "headline": str(out.get("headline") or "")[:120],
        "assessment": str(out.get("assessment") or "")[:900],
        "wins": [str(x)[:160] for x in (out.get("wins") or [])][:4],
        "watch": [str(x)[:160] for x in (out.get("watch") or [])][:4],
        "focus": str(out.get("focus") or "")[:240],
        "adjustments": _validate(conn, goal_id, ws, out.get("adjustments")),
    }
    cur = conn.execute("INSERT INTO coach_reviews (goal_id, week_start, review_json) VALUES (?,?,?)",
                       (goal_id, ws.isoformat(), json.dumps(review)))
    conn.commit()
    return {"id": cur.lastrowid, "week_start": ws.isoformat(), **review, "applied": []}


def latest_review(conn: sqlite3.Connection, goal_id: int, week_start: str) -> dict | None:
    ensure_table(conn)
    ws = _monday(date.fromisoformat(week_start)).isoformat()
    r = conn.execute(
        "SELECT * FROM coach_reviews WHERE goal_id=? AND week_start=? ORDER BY id DESC LIMIT 1",
        (goal_id, ws),
    ).fetchone()
    if not r:
        return None
    return {"id": r["id"], "week_start": r["week_start"], "created_at": r["created_at"],
            **json.loads(r["review_json"]), "applied": json.loads(r["applied_json"] or "[]")}


def apply_adjustment(conn: sqlite3.Connection, review_id: int, index: int) -> dict:
    ensure_table(conn)
    r = conn.execute("SELECT * FROM coach_reviews WHERE id=?", (review_id,)).fetchone()
    if not r:
        raise ValueError("review not found")
    review = json.loads(r["review_json"])
    applied = json.loads(r["applied_json"] or "[]")
    if index in applied:
        return {"applied": applied}
    adj = review["adjustments"][index]
    # Re-validate against the current plan (the week may have changed since)
    still = _validate(conn, r["goal_id"], date.fromisoformat(r["week_start"]),
                      [{**adj, "to_date": adj.get("to_date"), "duration_min": adj.get("duration_min"),
                        "zone": adj.get("zone")}])
    if not still:
        raise ValueError("this change no longer fits the current plan")
    a = still[0]
    note = f"Coach: {a['reason']}"
    sid = a["session_id"]
    if a["action"] == "move":
        conn.execute("UPDATE plan_sessions SET session_date=?, is_displaced=1, schedule_note=? WHERE id=?",
                     (a["to_date"], note, sid))
    elif a["action"] == "shorten":
        conn.execute("UPDATE plan_sessions SET effective_duration_min=?, schedule_note=? WHERE id=?",
                     (a["duration_min"], note, sid))
    elif a["action"] == "downgrade":
        conn.execute("UPDATE plan_sessions SET intensity_zone=?, schedule_note=? WHERE id=?",
                     (a["zone"], note, sid))
    elif a["action"] == "skip":
        conn.execute("UPDATE plan_sessions SET status='skipped', notes=? WHERE id=?", (note, sid))
    applied.append(index)
    conn.execute("UPDATE coach_reviews SET applied_json=? WHERE id=?", (json.dumps(applied), review_id))
    conn.commit()
    return {"applied": applied}


def main() -> None:
    from infrastructure.db.connection import get_connection

    p = argparse.ArgumentParser(description="AI coach weekly review")
    p.add_argument("--auto", action="store_true", help="Sat/Sun: review next week if not done yet")
    args = p.parse_args()
    today = date.today()
    if args.auto and today.weekday() < 5:
        return
    nxt = (_monday(today) + timedelta(days=7)).isoformat()
    conn = get_connection()
    try:
        ensure_table(conn)
        for g in conn.execute("SELECT id, name, race_date FROM race_goals WHERE status='active'").fetchall():
            if g["race_date"] < nxt or latest_review(conn, g["id"], nxt):
                continue
            rev = generate_review(conn, g["id"], nxt)
            print(f"  coach review for {g['name']} week {nxt}: "
                  f"{'ok — ' + rev['headline'] if rev else 'LLM unavailable'}", file=sys.stderr)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
