"""
1. Adds gratitude, intention, learning (TEXT) and focus_score (INTEGER) columns
   to the days table.
2. Migrates any existing notes content into mood_note (if mood_note is empty).
3. NOTE: alcohol/social/outdoors columns are left in place in the DB (SQLite
   DROP COLUMN requires v3.35+). The API model no longer reads or writes them,
   so they are effectively dead columns.
"""
import sqlite3
import os

DB_PATH = os.environ.get("DAYBOOK_DB", "infrastructure/db/daybook.db")


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cols = {r["name"] for r in cur.execute("PRAGMA table_info(days)")}

    added = []
    for col, typedef in [
        ("gratitude", "TEXT"),
        ("intention", "TEXT"),
        ("learning", "TEXT"),
        ("focus_score", "INTEGER"),
    ]:
        if col not in cols:
            cur.execute(f"ALTER TABLE days ADD COLUMN {col} {typedef}")
            added.append(col)

    # Migrate: copy notes → mood_note where mood_note is NULL/empty and notes has content
    if "notes" in cols:
        cur.execute("""
            UPDATE days
            SET mood_note = notes
            WHERE (mood_note IS NULL OR mood_note = '')
              AND notes IS NOT NULL
              AND notes != ''
        """)
        migrated = conn.total_changes
        if migrated:
            print(f"Migrated {migrated} rows: notes → mood_note")

    conn.commit()
    conn.close()

    if added:
        print(f"Added columns: {', '.join(added)}")
    else:
        print("All columns already exist.")
    print("Done.")


if __name__ == "__main__":
    main()
