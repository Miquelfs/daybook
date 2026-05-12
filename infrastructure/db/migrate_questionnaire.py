#!/usr/bin/env python3
"""
Add alcohol, social, outdoors columns to the days table.
Safe to run multiple times — uses ALTER TABLE only if column is missing.
"""
from pathlib import Path
import sqlite3

DB = Path(__file__).parent / "daybook.db"

NEW_COLUMNS = [
    ("alcohol",  "INTEGER"),   # drinks 0-10, nullable
    ("social",   "INTEGER"),   # boolean (0/1), nullable
    ("outdoors", "INTEGER"),   # boolean (0/1), nullable
]

def main() -> None:
    con = sqlite3.connect(DB)
    existing = {r[1] for r in con.execute("PRAGMA table_info(days)")}
    added = []
    for col, typ in NEW_COLUMNS:
        if col not in existing:
            con.execute(f"ALTER TABLE days ADD COLUMN {col} {typ}")
            added.append(col)
    con.commit()
    con.close()
    if added:
        print(f"Added columns: {', '.join(added)}")
    else:
        print("All columns already present — nothing to do.")

if __name__ == "__main__":
    main()
