"""
Plan ahead — the future side of the daybook.

  goals             yearly / dated goals. `metric` makes progress automatic from
                    data the daybook already has (km, books, net worth, tag days);
                    'manual' goals are ticked off by hand.
  tasks             things to do (kind='task') and notes that resurface on a date
                    (kind='note'). `remind_days` surfaces a cutoff N days early;
                    `repeat` re-arms the task when it's done (the done occurrence
                    is kept as its own row, so it shows on the day it was done).
  contacts.birthday 'YYYY-MM-DD', or '--MM-DD' when the year is unknown.

Idempotent. Runs on API startup; manual: python -m infrastructure.db.migrate_plans
"""

from infrastructure.db.connection import get_connection


def migrate(conn) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS goals (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT NOT NULL,
            emoji        TEXT,
            area         TEXT,                             -- NULL → the metric's area
            priority     INTEGER NOT NULL DEFAULT 2,       -- 1 moderate · 2 important · 3 very important
            start_date   TEXT NOT NULL,                    -- progress is counted from here
            deadline     TEXT,
            metric       TEXT NOT NULL DEFAULT 'manual',   -- key in domains/plans/metrics.py
            metric_param TEXT,                             -- tag slug | contact id | distance (m)
            target       REAL,
            baseline     REAL,                             -- value at start_date (level metrics)
            current      REAL,                             -- manual numeric progress
            status       TEXT NOT NULL DEFAULT 'active',   -- active|done|dropped
            notes        TEXT,
            completed_at TEXT,
            created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT NOT NULL,
            notes       TEXT,
            kind        TEXT NOT NULL DEFAULT 'task',      -- task | note
            due_date    TEXT,                              -- note: the date it resurfaces
            remind_days INTEGER,                           -- surface N days before due_date
            repeat      TEXT,                              -- NULL|weekly|monthly|yearly
            area        TEXT,                              -- page it belongs to: money, health, aviation…
            goal_id     INTEGER REFERENCES goals(id) ON DELETE SET NULL,
            done_at     TEXT,                              -- local YYYY-MM-DD
            created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_due  ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done_at);
    """)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(contacts)")}
    if cols and "birthday" not in cols:
        conn.execute("ALTER TABLE contacts ADD COLUMN birthday TEXT")
    conn.commit()


if __name__ == "__main__":
    c = get_connection()
    migrate(c)
    c.close()
    print("goals / tasks / contacts.birthday ready")
