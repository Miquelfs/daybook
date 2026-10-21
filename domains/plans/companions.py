"""
Who a training or a trip was *with*. Explicit links, so People can show what you
actually did together instead of guessing from the day.

Marking someone on a training also logs them as a companion for that day
(day_companions) — you were together that day. Removing them doesn't unlog the
day: you might have seen them anyway.
"""

from __future__ import annotations

import sqlite3


def _contacts(conn: sqlite3.Connection, sql: str, params: tuple) -> list[dict]:
    return [dict(r) for r in conn.execute(
        f"SELECT c.id, c.name, c.emoji, c.group_ FROM contacts c WHERE c.id IN ({sql}) ORDER BY c.name", params)]


def activity_with(conn: sqlite3.Connection, activity_id: str) -> list[dict]:
    return _contacts(conn, "SELECT contact_id FROM activity_companions WHERE activity_id=?", (activity_id,))


def set_activity_with(conn: sqlite3.Connection, activity_id: str, contact_ids: list[int]) -> list[dict] | None:
    row = conn.execute("SELECT date FROM activities WHERE id=?", (activity_id,)).fetchone()
    if row is None:
        return None
    conn.execute("DELETE FROM activity_companions WHERE activity_id=?", (activity_id,))
    for cid in dict.fromkeys(contact_ids):
        conn.execute("INSERT OR IGNORE INTO activity_companions VALUES (?, ?)", (activity_id, cid))
        conn.execute("INSERT OR IGNORE INTO day_companions (date, contact_id) VALUES (?, ?)", (row[0], cid))
    conn.commit()
    return activity_with(conn, activity_id)


def trip_with(conn: sqlite3.Connection, start: str, end: str) -> list[dict]:
    return _contacts(conn, "SELECT contact_id FROM trip_companions WHERE start_date=? AND end_date=?", (start, end))


def set_trip_with(conn: sqlite3.Connection, start: str, end: str, contact_ids: list[int]) -> list[dict]:
    conn.execute("DELETE FROM trip_companions WHERE start_date=? AND end_date=?", (start, end))
    for cid in dict.fromkeys(contact_ids):
        conn.execute("INSERT OR IGNORE INTO trip_companions VALUES (?, ?, ?)", (start, end, cid))
    conn.commit()
    return trip_with(conn, start, end)
