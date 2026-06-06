"""
Migration: add tags + day_tags tables, seed 28 system tags,
add mood_note + morning_note columns to days, and migrate
legacy days.tags comma-strings into day_tags rows.

Safe to run multiple times (idempotent).

Usage:
    python infrastructure/db/migrate_tags.py
"""

import re
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "daybook.db"

SYSTEM_TAGS = [
    # (slug, name, icon, category)
    ("personal_project", "Personal project", "💻", "work"),
    ("flew",             "Flew (work)",       "🛩️", "work"),
    ("commuting",        "Commuting",         "🚌", "work"),
    ("road_trip",        "Road trip",         "🏔️", "location"),
    ("travel",           "Trip",              "🧳", "location"),
    ("hotel",            "Hotel",             "🏨", "location"),
    ("sea",              "Sea",               "🌊", "location"),
    ("social",           "Social",            "👥", "social"),
    ("eating_out",       "Eating out",        "🍽️", "social"),
    ("date_night",       "Date night",        "🌙", "social"),
    ("family",           "Family",            "👨‍👩‍👧", "social"),
    ("concert",          "Concert / Event",   "🎵", "social"),
    ("running",          "Running",           "🏃", "activity"),
    ("cycling",          "Cycling",           "🚴", "activity"),
    ("swimming",         "Swimming",          "🏊", "activity"),
    ("motorcycle",       "Scooter ride",      "🛵", "activity"),
    ("car_drive",        "Car drive",         "🚗", "activity"),
    ("reading",          "Reading",           "📚", "activity"),
    ("meditation",       "Meditation",        "🧘", "health"),
    ("nap",              "Nap",               "😴", "health"),
    ("sick",             "Sick",              "🤒", "health"),
    ("hangover",         "Hangover",          "🥴", "health"),
    ("alcohol",          "Alcohol",           "🍷", "health"),
    ("sex",              "Sex",               "❤️", "health"),
    ("productive",       "Productive",        "⚡", "emotion"),
    ("creative",         "Creative",          "🎨", "emotion"),
    ("stressed",         "Stressed",          "😤", "emotion"),
    ("early_start",      "Early start",       "🌅", "environment"),
    ("late_night",       "Late night",        "🌃", "environment"),
    # Weather auto-tags (populated by weather sync, can also be set manually)
    ("sunny",            "Sunny",             "☀️", "environment"),
    ("cloudy",           "Cloudy",            "☁️", "environment"),
    ("rainy",            "Rainy",             "🌧️", "environment"),
    ("stormy",           "Stormy",            "⛈️", "environment"),
    ("snowy",            "Snowy",             "❄️", "environment"),
]

# Tags that already exist under a different slug and need renaming/moving
TAG_UPDATES = [
    # (slug, new_name, new_category)  — update existing rows by slug
    ("positioning", "Commuting",    "work"),      # rename Positioning → Commuting
    ("motorcycle",  "Scooter ride", "activity"),  # rename Motorcycle ride → Scooter ride
    ("sea",         "Sea",          "location"),  # move Sea → location (if created as environment)
]


def run(db_path: Path = DB_PATH) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")

    print(f"Migrating: {db_path}")

    # ── 1. Create tags table ──────────────────────────────────────────────────
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tags (
            id         INTEGER PRIMARY KEY,
            slug       TEXT UNIQUE NOT NULL,
            name       TEXT NOT NULL,
            icon       TEXT,
            category   TEXT NOT NULL,
            color      TEXT,
            is_system  INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (date('now'))
        )
    """)
    print("  ✓ tags table")

    # ── 2. Create day_tags table ──────────────────────────────────────────────
    conn.execute("""
        CREATE TABLE IF NOT EXISTS day_tags (
            date       TEXT NOT NULL,
            tag_id     INTEGER NOT NULL,
            note       TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (date, tag_id),
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )
    """)
    print("  ✓ day_tags table")

    # ── 3. Indexes ────────────────────────────────────────────────────────────
    conn.execute("CREATE INDEX IF NOT EXISTS idx_day_tags_date   ON day_tags(date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_day_tags_tag_id ON day_tags(tag_id)")
    print("  ✓ indexes")

    # ── 4. Seed system tags ───────────────────────────────────────────────────
    seeded = 0
    for slug, name, icon, category in SYSTEM_TAGS:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO tags (slug, name, icon, category, is_system) VALUES (?,?,?,?,1)",
            (slug, name, icon, category),
        )
        seeded += cursor.rowcount
    conn.commit()
    print(f"  ✓ seeded {seeded} new system tags (skipped existing)")

    # ── 4b. Apply name/category updates to existing tags ──────────────────────
    updated = 0
    for slug, new_name, new_category in TAG_UPDATES:
        cursor = conn.execute(
            "UPDATE tags SET name=?, category=? WHERE slug=?",
            (new_name, new_category, slug),
        )
        updated += cursor.rowcount
    conn.commit()
    if updated:
        print(f"  ✓ updated {updated} existing tag names/categories")

    # ── 5. Add mood_note column ───────────────────────────────────────────────
    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(days)").fetchall()}
    if "mood_note" not in existing_cols:
        conn.execute("ALTER TABLE days ADD COLUMN mood_note TEXT")
        conn.commit()
        print("  ✓ added mood_note column to days")
    else:
        print("  – mood_note already exists, skipping")

    # ── 6. Add morning_note column (reserved for future) ─────────────────────
    if "morning_note" not in existing_cols:
        conn.execute("ALTER TABLE days ADD COLUMN morning_note TEXT")
        conn.commit()
        print("  ✓ added morning_note column to days")
    else:
        print("  – morning_note already exists, skipping")

    # ── 7. Migrate legacy days.tags comma-strings ─────────────────────────────
    # Build slug → id lookup
    slug_to_id = {
        r["slug"]: r["id"]
        for r in conn.execute("SELECT id, slug FROM tags").fetchall()
    }

    rows = conn.execute(
        "SELECT date, tags FROM days WHERE tags IS NOT NULL AND tags != ''"
    ).fetchall()

    migrated_rows = 0
    migrated_tags = 0
    for row in rows:
        day_date = row["date"]
        tokens = [t.strip() for t in row["tags"].split(",") if t.strip()]
        for token in tokens:
            # Skip si / si:N (intimate rating — has dedicated column treatment)
            if re.match(r"^si(:\d+)?$", token):
                continue
            # Skip with:Name (handled by day_companions table)
            if token.startswith("with:"):
                continue
            # Look up slug in registry
            tag_id = slug_to_id.get(token)
            if tag_id is None:
                continue  # unknown slug, skip silently
            cursor = conn.execute(
                "INSERT OR IGNORE INTO day_tags (date, tag_id) VALUES (?,?)",
                (day_date, tag_id),
            )
            migrated_tags += cursor.rowcount

        migrated_rows += 1

    conn.commit()
    print(f"  ✓ migrated {migrated_tags} tag associations from {migrated_rows} legacy days.tags rows")

    conn.close()
    print("Done.")


if __name__ == "__main__":
    run()
