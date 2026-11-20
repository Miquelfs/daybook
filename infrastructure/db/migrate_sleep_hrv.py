"""
sleep.avg_hrv held Garmin's avgSleepStress (a parser slip), so anything reading it as HRV got
sleep stress. Refill it from each night's raw payload: avgOvernightHrv (NULL when absent).
Idempotent — only rows whose payload carries dailySleepDTO and whose value differs.
"""

import sqlite3


def migrate(conn: sqlite3.Connection) -> int:
    try:
        cur = conn.execute(
            """UPDATE sleep SET avg_hrv = json_extract(raw_payload, '$.avgOvernightHrv')
               WHERE json_valid(raw_payload) AND json_extract(raw_payload, '$.dailySleepDTO') IS NOT NULL
                 AND avg_hrv IS NOT json_extract(raw_payload, '$.avgOvernightHrv')""")
    except sqlite3.OperationalError:
        return 0
    conn.commit()
    return cur.rowcount
