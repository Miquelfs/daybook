"""
Add target_time column to race_goals table.
Run once on Pi: python -m infrastructure.db.migrate_race_plans_target_time
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    # Check if column already exists
    cols = [r[1] for r in conn.execute("PRAGMA table_info(race_goals)").fetchall()]
    if "target_time" not in cols:
        conn.execute("ALTER TABLE race_goals ADD COLUMN target_time TEXT")
        conn.commit()
        print("Added target_time to race_goals.")
    else:
        print("target_time already exists — skipping.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
