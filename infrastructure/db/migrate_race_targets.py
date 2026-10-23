"""
Add body/engine targets to race_goals: the FTP and weight to reach by a date
(default: three weeks before the race). The FTP tests in the plan become
waypoints on the straight line from today's numbers to these targets.
Runs on API startup — idempotent.
"""

from infrastructure.db.connection import get_connection

COLUMNS = {"target_ftp_w": "REAL", "target_weight_kg": "REAL", "targets_date": "TEXT"}


def migrate(conn):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='race_goals'").fetchone():
        return
    cols = {r[1] for r in conn.execute("PRAGMA table_info(race_goals)")}
    for name, kind in COLUMNS.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE race_goals ADD COLUMN {name} {kind}")
    conn.commit()


if __name__ == "__main__":
    c = get_connection()
    migrate(c)
    c.close()
