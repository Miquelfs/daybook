"""
Learning plans — a curriculum laid out in weeks, followed day by day.

  learning_plans   one per thing you're learning (robotics, …). `start_date` is the
                   Monday of week 1; `weeks` the detailed horizon; `weekly_hours` the target.
  learning_phases  a block of weeks with a gate (the "you can…" check that closes it).
  learning_items   what to do: a course week, a build, a skill, a decision. `week` +
                   `weeks` is when it's planned; NULL week → any time in the phase.
                   tier core | pick | later, as in the roadmap. status todo | done | skipped.
  learning_logs    time spent studying, per day (optionally on an item).

Seeds the robot-builder roadmap once (domains/learning/robotics_seed.py).
Idempotent. Runs on API startup; manual: python -m infrastructure.db.migrate_learning
"""

from domains.learning import robotics_seed
from infrastructure.db.connection import get_connection

ROBOTICS_START = "2026-10-26"        # Monday of the week the plan was set up


def migrate(conn) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS learning_plans (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            slug         TEXT UNIQUE,
            title        TEXT NOT NULL,
            emoji        TEXT,
            goal         TEXT,
            start_date   TEXT NOT NULL,                    -- Monday of week 1
            weeks        INTEGER NOT NULL DEFAULT 26,
            weekly_hours REAL,
            status       TEXT NOT NULL DEFAULT 'active',   -- active | paused | done
            created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS learning_phases (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id        INTEGER NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
            ord            INTEGER NOT NULL DEFAULT 0,
            title          TEXT NOT NULL,
            summary        TEXT,
            week_from      INTEGER,
            week_to        INTEGER,
            gate           TEXT,
            gate_passed_at TEXT                            -- local YYYY-MM-DD
        );

        CREATE TABLE IF NOT EXISTS learning_items (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id    INTEGER NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
            phase_id   INTEGER REFERENCES learning_phases(id) ON DELETE SET NULL,
            ord        INTEGER NOT NULL DEFAULT 0,
            title      TEXT NOT NULL,
            notes      TEXT,
            kind       TEXT NOT NULL DEFAULT 'learn',      -- course | learn | skill | build | buy | decide
            tier       TEXT NOT NULL DEFAULT 'core',       -- core | pick | later
            resource   TEXT,
            url        TEXT,
            week       INTEGER,                            -- NULL → any time in the phase
            weeks      INTEGER NOT NULL DEFAULT 1,
            est_hours  REAL,
            status     TEXT NOT NULL DEFAULT 'todo',       -- todo | done | skipped
            done_at    TEXT,                               -- local YYYY-MM-DD
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_learning_items_plan ON learning_items(plan_id, week);
        CREATE INDEX IF NOT EXISTS idx_learning_items_done ON learning_items(done_at);

        CREATE TABLE IF NOT EXISTS learning_logs (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id    INTEGER NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
            item_id    INTEGER REFERENCES learning_items(id) ON DELETE SET NULL,
            date       TEXT NOT NULL,
            minutes    INTEGER NOT NULL,
            note       TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_learning_logs_date ON learning_logs(plan_id, date);
    """)
    conn.commit()
    robotics_seed.seed(conn, ROBOTICS_START)


if __name__ == "__main__":
    c = get_connection()
    migrate(c)
    c.close()
    print("learning tables ready")
