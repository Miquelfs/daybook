"""
School flights get an operator: every Aerolink-imported entry is logged with
operator 'Aerolink' (they came in with none), so school time groups under one
name everywhere — hours breakdown, operator rollups, milestones, exports.

Idempotent. Runs on API startup; manual: python -m infrastructure.db.migrate_aerolink_operator
"""

from infrastructure.db.connection import get_connection


def migrate(conn) -> int:
    try:
        cur = conn.execute(
            "UPDATE flights SET operator = 'Aerolink' "
            "WHERE source = 'aerolink' AND (operator IS NULL OR TRIM(operator) = '')"
        )
    except Exception:   # no flights table yet (fresh DB)
        return 0
    conn.commit()
    return cur.rowcount


if __name__ == "__main__":
    c = get_connection()
    print(f"Aerolink operator set on {migrate(c)} flights")
    c.close()
