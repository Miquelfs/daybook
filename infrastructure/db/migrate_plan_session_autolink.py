"""
Add auto-match support to plan_sessions.

- plan_sessions.auto_matched: 1 when the session was completed by automatically
  linking a real activity (Garmin/Strava) logged on the same day for the same
  discipline, 0 when completed/edited manually. Lets the UI show an
  "auto-matched" tag with an unlink action, and keeps the auto-matcher from ever
  clobbering a manually-edited session.

Idempotent. Run: python -m infrastructure.db.migrate_plan_session_autolink
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(plan_sessions)")}
    if "auto_matched" not in cols:
        conn.execute(
            "ALTER TABLE plan_sessions ADD COLUMN auto_matched INTEGER NOT NULL DEFAULT 0"
        )
    conn.commit()
    print("plan_sessions.auto_matched ready.")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
