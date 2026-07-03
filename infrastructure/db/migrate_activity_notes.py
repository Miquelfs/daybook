"""Add user_notes and user_rating columns to activities table."""

from pathlib import Path
import sys

_REPO = Path(__file__).parents[2]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from infrastructure.db.connection import get_connection


def migrate():
    conn = get_connection()

    existing = {row[1] for row in conn.execute("PRAGMA table_info(activities)").fetchall()}

    added = []
    if "user_notes" not in existing:
        conn.execute("ALTER TABLE activities ADD COLUMN user_notes TEXT")
        added.append("user_notes")
    if "user_rating" not in existing:
        conn.execute("ALTER TABLE activities ADD COLUMN user_rating INTEGER")
        added.append("user_rating")

    conn.commit()
    conn.close()

    if added:
        print(f"Migration done — added columns: {', '.join(added)}")
    else:
        print("Already up to date.")


if __name__ == "__main__":
    migrate()
