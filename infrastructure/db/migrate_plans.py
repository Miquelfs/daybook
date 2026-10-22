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
  tracked_habits    tags you chose to track as habits (goals / experiments track theirs too).
  planned_trips     trips you're about to take — name, dates, who, currency + rate,
                    flights cost. Per day (planned_trip_days): the plan, kind
                    (travel / rest / ride), where you sleep, its price, booked + ref.
                    planned_trip_items: packing (by section), open decisions, risks,
                    info notes (logistics, numbers). planned_trip_budget: lines with
                    low / mid / high / actual in the local currency. The checklist is
                    tasks with planned_trip_id. Once the trip happens and is detected,
                    its name and companions carry over and its page shows the plan.
  activity_companions / trip_companions
                    who a training or a trip was *with* — explicit, so People can say
                    what you actually did together. Trips are keyed by their dates
                    because the nightly trip detection rebuilds the rows.

Idempotent. Runs on API startup; manual: python -m infrastructure.db.migrate_plans
"""

from infrastructure.db.connection import get_connection

_GOALS_SQL = """
        CREATE TABLE IF NOT EXISTS goals (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT NOT NULL,
            emoji        TEXT,
            area         TEXT,                             -- NULL → the metric's area
            priority     INTEGER NOT NULL DEFAULT 2,       -- 1 moderate · 2 important · 3 very important
            start_date   TEXT,                             -- progress counted from here; NULL → 1 Jan
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
"""


def _goals_start_optional(conn) -> None:
    """Goals created before start_date became optional have it NOT NULL — rebuild once.

    SQLite's documented table rebuild: foreign keys off (so tasks.goal_id isn't
    nulled by the drop), build goals_new, copy, drop, rename into place."""
    info = {r[1]: r for r in conn.execute("PRAGMA table_info(goals)")}
    if not info.get("start_date") or not info["start_date"][3]:      # [3] = notnull
        return
    cols = ", ".join(info)
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.executescript(f"""
            BEGIN;
            {_GOALS_SQL.replace("IF NOT EXISTS goals", "goals_new")}
            INSERT INTO goals_new ({cols}) SELECT {cols} FROM goals;
            DROP TABLE goals;
            ALTER TABLE goals_new RENAME TO goals;
            COMMIT;
        """)
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def _add_columns(conn, table: str, cols: dict[str, str]) -> None:
    have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    for col, typ in cols.items():
        if col not in have:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")


def migrate(conn) -> None:
    conn.executescript(_GOALS_SQL + """

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

        CREATE TABLE IF NOT EXISTS tracked_habits (
            tag_id     INTEGER PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS activity_companions (
            activity_id TEXT    NOT NULL,
            contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            PRIMARY KEY (activity_id, contact_id)
        );
        CREATE INDEX IF NOT EXISTS idx_activity_companions_contact ON activity_companions(contact_id);

        CREATE TABLE IF NOT EXISTS trip_companions (
            start_date TEXT    NOT NULL,
            end_date   TEXT    NOT NULL,
            contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            PRIMARY KEY (start_date, end_date, contact_id)
        );
        CREATE INDEX IF NOT EXISTS idx_trip_companions_contact ON trip_companions(contact_id);

        CREATE TABLE IF NOT EXISTS planned_trips (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            destination   TEXT,
            start_date    TEXT NOT NULL,
            end_date      TEXT NOT NULL,
            notes         TEXT,
            adopted_start TEXT,                             -- the detected trip it became
            adopted_end   TEXT,
            created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );

        CREATE TABLE IF NOT EXISTS planned_trip_days (
            planned_id INTEGER NOT NULL REFERENCES planned_trips(id) ON DELETE CASCADE,
            date       TEXT    NOT NULL,
            note       TEXT    NOT NULL,
            PRIMARY KEY (planned_id, date)
        );

        CREATE TABLE IF NOT EXISTS planned_trip_items (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            planned_id INTEGER NOT NULL REFERENCES planned_trips(id) ON DELETE CASCADE,
            kind       TEXT    NOT NULL,              -- pack | decision | risk | info
            section    TEXT,                          -- pack category / risk "where" / info heading
            title      TEXT    NOT NULL,
            detail     TEXT,                          -- decision answer / risk plan / info text
            done       INTEGER NOT NULL DEFAULT 0,    -- packed / decided
            sort       INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_trip_items ON planned_trip_items(planned_id, kind);

        CREATE TABLE IF NOT EXISTS planned_trip_budget (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            planned_id INTEGER NOT NULL REFERENCES planned_trips(id) ON DELETE CASCADE,
            line       TEXT    NOT NULL,
            low        REAL,
            mid        REAL,
            high       REAL,
            actual     REAL,
            sort       INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS planned_trip_companions (
            planned_id INTEGER NOT NULL REFERENCES planned_trips(id) ON DELETE CASCADE,
            contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            PRIMARY KEY (planned_id, contact_id)
        );
    """)
    _goals_start_optional(conn)
    _add_columns(conn, "tasks", {
        "due_time": "TEXT",                                   # HH:MM, optional
        "planned_trip_id": "INTEGER REFERENCES planned_trips(id) ON DELETE SET NULL",  # trip checklist
    })
    _add_columns(conn, "planned_trips", {
        "budget": "REAL",
        "currency": "TEXT",            # local currency code, e.g. TWD
        "fx_rate": "REAL",             # local units per €
        "flights_eur": "REAL",         # flights, paid in €
    })
    _add_columns(conn, "planned_trip_days", {
        "kind": "TEXT",                # travel | rest | ride
        "sleep": "TEXT",               # town you sleep in
        "sleep_cost": "REAL",          # local currency
        "booked": "INTEGER NOT NULL DEFAULT 0",
        "booking_ref": "TEXT",
    })
    cols = {r[1] for r in conn.execute("PRAGMA table_info(contacts)")}
    if cols and "birthday" not in cols:
        conn.execute("ALTER TABLE contacts ADD COLUMN birthday TEXT")
    conn.commit()


if __name__ == "__main__":
    c = get_connection()
    migrate(c)
    c.close()
    print("goals / tasks / contacts.birthday ready")
