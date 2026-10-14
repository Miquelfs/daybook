"""Shared fixtures: throwaway SQLite schemas + a frozen 'today'."""

import datetime as _dt
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def fake_date(y, m, d):
    """A `date` subclass whose today() is frozen — patch it into a module."""
    class FakeDate(_dt.date):
        @classmethod
        def today(cls):
            return cls(y, m, d)
    return FakeDate


def plan_db(path: str = ":memory:") -> sqlite3.Connection:
    """race_goals + plan_sessions (as migrated) + the roster/sleep tables day_context reads."""
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    src = (ROOT / "infrastructure/db/migrate_race_plans.py").read_text()
    c.executescript(src.split('conn.executescript("""')[1].split('""")')[0])
    c.execute("ALTER TABLE plan_sessions ADD COLUMN structure_json TEXT")
    c.execute("ALTER TABLE plan_sessions ADD COLUMN auto_matched INTEGER NOT NULL DEFAULT 0")
    c.execute("ALTER TABLE race_goals ADD COLUMN target_time TEXT")
    c.executescript("""
        CREATE TABLE roster(date PRIMARY KEY, duty_type, report_time, end_time, raw_code);
        CREATE TABLE roster_legs(id, date, flight_number, dep_iata, arr_iata, dep_time, arr_time, leg_order);
        CREATE TABLE sleep(date PRIMARY KEY, duration_seconds, score);
    """)
    return c


def tmpdir() -> Path:
    return Path(tempfile.mkdtemp(prefix="daybook-test-"))
