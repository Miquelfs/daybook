"""
Adds is_negative BOOLEAN column to tags table.
Seeds candy and alcohol as negative (clean streak = days without).
"""
import sqlite3
import os

DB_PATH = os.environ.get("DAYBOOK_DB", "infrastructure/db/daybook.db")


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cols = {r["name"] for r in cur.execute("PRAGMA table_info(tags)")}
    if "is_negative" not in cols:
        cur.execute("ALTER TABLE tags ADD COLUMN is_negative BOOLEAN NOT NULL DEFAULT 0")
        print("Added is_negative column.")
    else:
        print("is_negative column already exists.")

    # Seed known negative tags
    for slug in ("candy", "alcohol"):
        cur.execute("UPDATE tags SET is_negative=1 WHERE slug=?", (slug,))
        if conn.total_changes:
            print(f"  Marked '{slug}' as negative.")

    conn.commit()
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
