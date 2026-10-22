"""
Garmin stores 0 moving time for stopwatch / gym activities. A 0 hides the real duration everywhere that
falls back from moving time to duration (week totals, lists, planned vs actual), so make it NULL.
Idempotent; runs at API startup.
"""

from infrastructure.db.connection import get_connection


def migrate(conn) -> int:
    try:
        n = conn.execute("UPDATE activities SET moving_time_seconds = NULL WHERE moving_time_seconds = 0").rowcount
        conn.commit()
        return n
    except Exception:
        return 0


if __name__ == "__main__":
    c = get_connection()
    print(f"activities fixed: {migrate(c)}")
    c.close()
