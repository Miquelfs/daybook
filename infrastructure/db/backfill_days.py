"""
Ensures every date from START_DATE to today has a row in the 'days' spine table.
Rows added here have NULL for all subjective fields — they act as placeholders
that Garmin sync and other importers can join against.

Run after init_db.py and again after any historical import to close gaps.
"""

import argparse
from datetime import date, timedelta
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))  # find connection.py as sibling
from connection import get_connection

DEFAULT_START = "2015-01-01"


def backfill(start_date: str = DEFAULT_START, end_date: str | None = None) -> int:
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date) if end_date else date.today()

    conn = get_connection()
    inserted = 0
    d = start
    while d <= end:
        cur = conn.execute(
            "INSERT OR IGNORE INTO days (date) VALUES (?)", (d.isoformat(),)
        )
        inserted += cur.rowcount
        d += timedelta(days=1)

    conn.commit()
    conn.close()
    total = (end - start).days + 1
    print(f"Backfill complete: {inserted} new rows, {total} total dates ({start} → {end})")
    return inserted


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill days spine table")
    parser.add_argument("--start-date", default=DEFAULT_START)
    parser.add_argument("--end-date", default=None)
    args = parser.parse_args()
    backfill(args.start_date, args.end_date)
