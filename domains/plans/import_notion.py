"""
One-off import of the Notion "Objectius" goals (2025 + 2026) and the open DNI
renewal task. Measurable goals get a metric so their progress is computed from
the daybook's own data; Notion's "Completed" is kept as status 'done', anything
it hadn't closed stays 'active' so the data decides achieved / missed.

Idempotent (skips rows already present). Run on the Pi:
  python -m domains.plans.import_notion
"""

from __future__ import annotations

from infrastructure.db.connection import get_connection
from infrastructure.db.migrate_plans import migrate

# (emoji, title, start, deadline, metric, param, target, status, priority, completed_at, notes)
GOALS = [
    (None, "Notion Implementation", "2025-01-01", "2025-01-31", "manual", None, None, "done", 1, "2025-01-31", None),
    (None, "Budget Tracking", "2025-01-01", "2025-03-31", "manual", None, None, "done", 3, "2025-03-31", None),
    (None, "Half Ironman 2025", "2025-01-01", "2025-09-07", "manual", None, None, "done", 2, "2025-09-07", None),
    (None, "Marathon 2025", "2025-01-01", "2025-10-19", "manual", None, None, "done", 2, "2025-10-19", None),
    (None, "Sub-40min on 10k", "2025-01-01", "2025-12-31", "manual", None, None, "done", 1, None, None),
    (None, "15 Books", "2025-01-01", "2025-12-31", "books", None, 15, "done", 2, None, None),
    (None, "Investments", "2025-01-01", "2025-12-31", "manual", None, None, "done", 3, None, None),
    (None, "2000km Cycle 2025", "2025-01-01", "2025-12-31", "ride_km", None, 2000, "done", 2, None, None),
    (None, "1000km Run 2025", "2025-01-01", "2025-12-31", "run_km", None, 1000, "active", 2, None, None),
    (None, "Side Business", "2025-01-01", "2025-12-31", "manual", None, None, "dropped", 3, None,
     "Still open (green) in Notion at year end — carried on as Omyra."),

    ("🛫", "Norwegian Transition", "2026-01-01", "2026-03-31", "manual", None, None, "done", 3, "2026-03-31", None),
    ("💓", "Viure amb l’Alice", "2026-01-01", "2026-04-01", "manual", None, None, "done", 3, "2026-04-01", None),
    ("🐍", "Python Personal Project", "2026-01-01", "2026-06-30", "manual", None, None, "active", 2, None, None),
    ("🧮", "AI Trading", "2026-01-01", "2026-11-30", "manual", None, None, "active", 2, None, None),
    ("📖", "15 Books", "2026-01-01", "2026-12-31", "books", None, 15, "active", 2, None, None),
    ("🏃", "1000km Run 2026", "2026-01-01", "2026-12-31", "run_km", None, 1000, "active", 2, None, None),
    ("🚴🏼", "4000km Cycle 2026", "2026-01-01", "2026-12-31", "ride_km", None, 4000, "active", 3, None, None),
    ("💸", "50k Net Worth", "2026-01-01", "2026-12-31", "net_worth", None, 50000, "active", 3, None, None),
    ("🍬", "Reducing Candy 2026", "2026-01-01", "2026-12-31", "tag_days", "candy", None, "active", 2, None,
     "Fewer candy days than 2025 by the same date."),
    ("🪁", "Omyra 500 Revenue", "2026-01-01", "2026-12-31", "manual", None, None, "dropped", 2, None, None),
    ("🏍️", "Moto A2 2026", "2026-01-01", "2026-12-31", "manual", None, None, "dropped", 1, None, None),
]

# (title, due, remind_days, area)
TASKS = [
    ("Renovació DNI", "2026-12-01", 30, "Admin"),
]


def run(conn) -> tuple[int, int]:
    migrate(conn)
    goals = tasks = 0
    for emoji, title, start, deadline, metric, param, target, status, prio, done_at, notes in GOALS:
        if conn.execute("SELECT 1 FROM goals WHERE title=? AND start_date=?", (title, start)).fetchone():
            continue
        conn.execute(
            """INSERT INTO goals (title, emoji, start_date, deadline, metric, metric_param, target,
                                  status, priority, completed_at, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (title, emoji, start, deadline, metric, param, target, status, prio, done_at, notes),
        )
        goals += 1
    for title, due, remind, area in TASKS:
        if conn.execute("SELECT 1 FROM tasks WHERE title=? AND due_date=?", (title, due)).fetchone():
            continue
        conn.execute("INSERT INTO tasks (title, due_date, remind_days, area) VALUES (?,?,?,?)",
                     (title, due, remind, area))
        tasks += 1
    conn.commit()
    return goals, tasks


if __name__ == "__main__":
    c = get_connection()
    g, t = run(c)
    c.close()
    print(f"Imported {g} goals, {t} tasks")
