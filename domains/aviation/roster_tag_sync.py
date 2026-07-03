"""
Roster → tag auto-sync.

Reads the roster table and upserts tags into day_tags so that duty types
flow into the existing tag infrastructure (correlations, weekly stats, habits).

Mapping:
  flying_duty  → no auto-tag    (applied manually by the user after work)
  standby      → tag:standby     (auto-created if missing)
  ground_duty  → tag:ground_duty (auto-created if missing)
  day_off      → no tag

Tags auto-applied here are marked with note='auto' so they can be
distinguished from manually added tags if needed. They are never deleted
by the user's manual tag edits — only re-synced when this runs.

Run standalone (backfill last 90 days):
    python -m domains.aviation.roster_tag_sync [--days 90] [--db PATH]
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from pathlib import Path

DB_PATH = Path(__file__).parents[2] / "infrastructure" / "db" / "daybook.db"

# duty_type value → tag slug
_DUTY_TAG: dict[str, str] = {
    "standby":     "standby",
    "ground_duty": "ground_duty",
}

# Tags to auto-create if they don't exist (slug → name, icon, category)
_AUTO_TAGS: dict[str, tuple[str, str, str]] = {
    "standby":     ("Standby",     "🟡", "work"),
    "ground_duty": ("Ground duty", "📋", "work"),
}


def _ensure_tags(conn: sqlite3.Connection) -> dict[str, int]:
    """Ensure all roster tags exist; return {slug: id} map."""
    slug_to_id: dict[str, int] = {}

    for slug in _DUTY_TAG.values():
        row = conn.execute("SELECT id FROM tags WHERE slug=?", (slug,)).fetchone()
        if row:
            slug_to_id[slug] = row["id"]
        elif slug in _AUTO_TAGS:
            name, icon, category = _AUTO_TAGS[slug]
            conn.execute(
                "INSERT INTO tags (slug, name, icon, category) VALUES (?, ?, ?, ?)",
                (slug, name, icon, category),
            )
            row = conn.execute("SELECT id FROM tags WHERE slug=?", (slug,)).fetchone()
            slug_to_id[slug] = row["id"]

    conn.commit()
    return slug_to_id


def sync(start: str, end: str, db_path: Path = DB_PATH) -> int:
    """
    Apply roster-derived tags for all days in [start, end].
    Returns number of tags upserted.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    count = 0

    slug_to_id = _ensure_tags(conn)

    # All duty_type slugs we manage, so we can clean up stale auto-tags when
    # a day's duty type changes (e.g. re-import shifts standby → flying).
    managed_tag_ids = list(slug_to_id.values())

    try:
        rows = conn.execute(
            "SELECT date, duty_type FROM roster WHERE date BETWEEN ? AND ? ORDER BY date",
            (start, end),
        ).fetchall()
    except sqlite3.OperationalError:
        conn.close()
        return 0

    for row in rows:
        day_date = row["date"]
        duty_type = row["duty_type"]
        target_slug = _DUTY_TAG.get(duty_type)  # None for day_off / unknown

        # Ensure the day spine exists
        conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (day_date,))

        if managed_tag_ids:
            placeholders = ",".join("?" * len(managed_tag_ids))
            conn.execute(
                f"DELETE FROM day_tags WHERE date=? AND note='auto' AND tag_id IN ({placeholders})",
                [day_date] + managed_tag_ids,
            )

        if target_slug and target_slug in slug_to_id:
            tag_id = slug_to_id[target_slug]
            conn.execute(
                "INSERT OR IGNORE INTO day_tags (date, tag_id, note) VALUES (?, ?, 'auto')",
                (day_date, tag_id),
            )
            count += 1

    conn.commit()
    conn.close()
    return count


if __name__ == "__main__":
    import argparse, sys

    parser = argparse.ArgumentParser(description="Sync roster duty types → tags")
    parser.add_argument("--days", type=int, default=90, help="Look-back window in days (default 90)")
    parser.add_argument("--db", default=str(DB_PATH), help="SQLite DB path")
    args = parser.parse_args()

    end = date.today().isoformat()
    start = (date.today() - timedelta(days=args.days)).isoformat()

    n = sync(start, end, Path(args.db))
    print(f"✓ Synced {n} roster tags for {start} → {end}")
