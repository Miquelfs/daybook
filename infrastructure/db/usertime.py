#!/usr/bin/env python3
"""
Where you are — the timezone every "today" in Daybook should use.

Daybook used to assume Spain everywhere (the Pi's clock, hard-coded
Europe/Madrid) while the web app used the UTC date — so on a trip (Japan,
Taiwan…) things landed on the wrong day/week/hour. Now:

  - the phone/browser you use reports its IANA timezone (iOS switches it
    automatically when you land) → app_settings.timezone;
  - the API applies it process-wide (TZ + tzset) so date.today() and
    datetime.now() everywhere follow you, without touching every call site;
  - daily_sync.sh exports it before computing DATE/HOUR, so the morning brief,
    day finalisation and the weekly jobs run on YOUR clock.

Stdlib only — also runnable as `python3 infrastructure/db/usertime.py` (prints the tz).
"""

from __future__ import annotations

import os
import sqlite3
import time
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

HOME_TZ = "Europe/Madrid"
DB_PATH = Path(__file__).parent / "daybook.db"


def valid(name: str | None) -> bool:
    if not name or "/" not in name and name != "UTC":
        return False
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def read_tz(db_path: Path = DB_PATH) -> str:
    try:
        con = sqlite3.connect(db_path, timeout=5)
        row = con.execute("SELECT value FROM app_settings WHERE key='timezone'").fetchone()
        con.close()
        if row and valid(row[0]):
            return row[0]
    except sqlite3.Error:
        pass
    return HOME_TZ


def write_tz(name: str, db_path: Path = DB_PATH) -> str:
    if not valid(name):
        raise ValueError(f"unknown timezone: {name}")
    con = sqlite3.connect(db_path, timeout=5)
    con.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    con.execute("INSERT INTO app_settings (key, value) VALUES ('timezone', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (name,))
    con.commit()
    con.close()
    apply_tz(name)
    return name


def apply_tz(name: str) -> bool:
    """Make this process's local time = `name`. Returns True if it changed."""
    if os.environ.get("TZ") == name:
        return False
    os.environ["TZ"] = name
    if hasattr(time, "tzset"):
        time.tzset()
    return True


def current_tz() -> str:
    return os.environ.get("TZ") if valid(os.environ.get("TZ")) else read_tz()


def today() -> date:
    return datetime.now(ZoneInfo(current_tz())).date()


if __name__ == "__main__":
    print(read_tz())
