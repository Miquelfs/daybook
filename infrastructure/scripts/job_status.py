#!/usr/bin/env python3
"""
Record the outcome of one sync step into daybook.db → job_runs.

Called by daily_sync.sh's `step` helper after every job, so a failure is a row
the app can show ("Garmin sync failing since Tue"), not a line buried in a log
on the Pi. Stdlib only and never raises — recording must not break the sync.

  python infrastructure/scripts/job_status.py record <job> <exit_code> <seconds> [message]
"""

import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "db" / "daybook.db"

DDL = """CREATE TABLE IF NOT EXISTS job_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job         TEXT NOT NULL,
    finished_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    status      TEXT NOT NULL,          -- ok | fail
    exit_code   INTEGER,
    duration_s  INTEGER,
    message     TEXT
)"""


def record(job: str, code: int, seconds: int, message: str = "") -> None:
    con = sqlite3.connect(DB, timeout=30)
    try:
        con.execute(DDL)
        con.execute("CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job, finished_at)")
        con.execute(
            "INSERT INTO job_runs (job, status, exit_code, duration_s, message) VALUES (?,?,?,?,?)",
            (job, "ok" if code == 0 else "fail", code, seconds, (message or "")[-500:] or None),
        )
        # Keep ~60 days of hourly history per job at most
        con.execute("DELETE FROM job_runs WHERE finished_at < datetime('now', '-60 days')")
        con.commit()
    finally:
        con.close()


if __name__ == "__main__":
    try:
        if len(sys.argv) >= 5 and sys.argv[1] == "record":
            record(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5] if len(sys.argv) > 5 else "")
    except Exception as e:  # never fail the caller
        print(f"job_status: {e}", file=sys.stderr)
