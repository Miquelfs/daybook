"""
One-off (Oct 2026): re-test FTP on Sunday 25 Oct with a calibrated trainer, and
set the Mallorca 312 engine targets.

  1. every pending FTP test gets the new structure (trainer warm-up → calibrate → test)
  2. a new FTP test on 2026-10-25 (the pre-Taiwan test)
  3. the 23 Oct ride stays completed but becomes a threshold session — the
     paced-too-easy test no longer counts as a benchmark (its FTP, 193 W, stays
     as the provisional value until Sunday's result replaces it)
  4. targets: 220 W and 79.5 kg by 3 Apr 2027 (unless already set)

Idempotent. Run on the Pi:  python -m infrastructure.db.oneoff_ftp_retest
"""

import json

from domains.training.plan_templates.mallorca_312 import ftp_test
from infrastructure.db.connection import get_connection

GOAL_ID = 10
RETEST_DATE = "2026-10-25"
OLD_TEST_ID = 908
TARGETS = {"target_ftp_w": 220, "target_weight_kg": 79.5, "targets_date": "2027-04-03"}
KEEP = {"id", "session_date", "original_date", "week_number", "status", "completed_activity_id",
        "rpe_actual", "notes", "created_at", "updated_at", "auto_matched", "is_displaced"}


def run(conn) -> None:
    t = ftp_test()
    structure = json.dumps(t["structure"])

    n = conn.execute(
        """UPDATE plan_sessions SET structure_json=?, duration_min=?, effective_duration_min=?,
                  updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
           WHERE goal_id=? AND status='pending' AND session_type=?""",
        (structure, t["duration"], t["duration"], GOAL_ID, t["type"])).rowcount
    print(f"FTP tests with calibration step: {n}")

    exists = conn.execute("SELECT id FROM plan_sessions WHERE goal_id=? AND session_date=? AND session_type=?",
                          (GOAL_ID, RETEST_DATE, t["type"])).fetchone()
    if exists:
        print(f"Re-test already on {RETEST_DATE} (session {exists['id']})")
    else:
        src = conn.execute("SELECT * FROM plan_sessions WHERE goal_id=? AND status='pending' AND session_type=? "
                           "ORDER BY session_date LIMIT 1", (GOAL_ID, t["type"])).fetchone()
        cols = [c for c in src.keys() if c not in KEEP]
        conn.execute(
            f"""INSERT INTO plan_sessions (session_date, original_date, week_number, status, {', '.join(cols)})
                VALUES (?, ?, 1, 'pending', {', '.join('?' * len(cols))})""",
            (RETEST_DATE, RETEST_DATE, *[src[c] for c in cols]))
        print(f"Added FTP re-test on {RETEST_DATE}")

    old = conn.execute("SELECT session_type, structure_json FROM plan_sessions WHERE id=?", (OLD_TEST_ID,)).fetchone()
    if old and old["session_type"].startswith("Test"):
        steps = json.loads(old["structure_json"] or "[]")
        for s in steps:
            if s.get("kind") == "intervals":
                s["label"] = "20min hard"
                s["cue"] = "First FTP attempt — paced too easy, re-tested on 25 Oct"
        conn.execute("UPDATE plan_sessions SET session_type='Cycling - Threshold (trainer)', structure_json=?, "
                     "updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
                     (json.dumps(steps), OLD_TEST_ID))
        d = conn.execute("DELETE FROM benchmark_results WHERE session_id=?", (OLD_TEST_ID,)).rowcount
        print(f"23 Oct → threshold session; benchmark rows removed: {d}")

    g = conn.execute("SELECT target_ftp_w, target_weight_kg FROM race_goals WHERE id=?", (GOAL_ID,)).fetchone()
    if g and g["target_ftp_w"] is None and g["target_weight_kg"] is None:
        conn.execute("UPDATE race_goals SET target_ftp_w=?, target_weight_kg=?, targets_date=? WHERE id=?",
                     (*TARGETS.values(), GOAL_ID))
        print(f"Targets set: {TARGETS}")
    conn.commit()


if __name__ == "__main__":
    from infrastructure.db.migrate_race_targets import migrate
    c = get_connection()
    migrate(c)
    run(c)
    c.close()
