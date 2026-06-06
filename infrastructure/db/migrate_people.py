"""
One-time migration: parse all with:Name tags from days.tags → populate contacts + day_companions.
Idempotent — safe to re-run.

Usage:
    python -m infrastructure.db.migrate_people
    # or directly:
    python infrastructure/db/migrate_people.py
"""

import sqlite3
from pathlib import Path

ROOT = Path(__file__).parents[2]
DB_PATH = ROOT / "infrastructure" / "db" / "daybook.db"


def run() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    # Collect all (date, name) pairs from with: tags
    rows = conn.execute(
        "SELECT date, tags FROM days WHERE tags LIKE '%with:%'"
    ).fetchall()

    pairs: list[tuple[str, str]] = []
    for row in rows:
        for part in (row["tags"] or "").split(","):
            part = part.strip()
            if part.startswith("with:"):
                name = part[5:].strip()
                if name:
                    pairs.append((row["date"], name))

    if not pairs:
        print("No with: tags found — nothing to migrate.")
        conn.close()
        return

    # Upsert all unique names into contacts
    unique_names = sorted({name for _, name in pairs})
    contacts_created = 0
    for name in unique_names:
        cur = conn.execute(
            "INSERT OR IGNORE INTO contacts (name) VALUES (?)", (name,)
        )
        if cur.rowcount:
            contacts_created += 1

    conn.commit()

    # Build name→id lookup
    name_to_id: dict[str, int] = {}
    for row in conn.execute("SELECT id, name FROM contacts").fetchall():
        name_to_id[row["name"]] = row["id"]

    # Insert day_companions rows
    companions_inserted = 0
    for date_str, name in pairs:
        contact_id = name_to_id.get(name)
        if contact_id is None:
            print(f"  ! Could not find contact id for '{name}' — skipping")
            continue
        # Ensure spine row exists
        conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (date_str,))
        cur = conn.execute(
            "INSERT OR IGNORE INTO day_companions (date, contact_id) VALUES (?, ?)",
            (date_str, contact_id),
        )
        if cur.rowcount:
            companions_inserted += 1

    conn.commit()
    conn.close()

    print(f"Done: {contacts_created} contact(s) created, {companions_inserted} companion row(s) inserted")
    print(f"      ({len(unique_names)} unique people across {len(pairs)} day-person pairs)")


if __name__ == "__main__":
    run()
