"""
Add correlation_snapshots table to daybook.db.
Run once on Pi: python -m infrastructure.db.migrate_correlations
"""

from infrastructure.db.connection import get_connection


def migrate(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS correlation_snapshots (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            computed_at  TEXT NOT NULL,
            window_days  INTEGER NOT NULL,
            metric_a     TEXT NOT NULL,
            metric_b     TEXT NOT NULL,
            r            REAL,
            p_value      REAL,
            n            INTEGER,
            lag          INTEGER DEFAULT 0,
            is_new       INTEGER DEFAULT 0,
            r_prev       REAL,
            UNIQUE(computed_at, metric_a, metric_b, lag, window_days)
        );
        CREATE INDEX IF NOT EXISTS idx_corr_snap_date ON correlation_snapshots(computed_at);
    """)
    conn.commit()
    print("correlation_snapshots table ready")


if __name__ == "__main__":
    conn = get_connection()
    migrate(conn)
    conn.close()
