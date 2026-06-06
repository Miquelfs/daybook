"""
Pi-side Screen Time ingest script.
Reads a JSON file written by screentime_collect.py and writes to daybook.db.

Usage:
    python -m domains.screen_time.screentime_ingest /tmp/screentime_payload.json
"""

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).parents[2]
DB_PATH = ROOT / "infrastructure" / "db" / "daybook.db"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS screen_time (
            date            TEXT PRIMARY KEY,
            total_minutes   REAL,
            unlocks         INTEGER,
            top_app         TEXT,
            top_app_name    TEXT,
            top_app_minutes REAL,
            raw_payload     TEXT,
            synced_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS screen_app_usage (
            date        TEXT NOT NULL,
            bundle_id   TEXT NOT NULL,
            app_name    TEXT,
            minutes     REAL,
            PRIMARY KEY (date, bundle_id)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_screen_app_date ON screen_app_usage(date)"
    )
    conn.commit()


def ingest(records: list[dict]) -> None:
    conn = _get_conn()
    _ensure_tables(conn)

    inserted = 0
    for rec in records:
        date_str = rec["date"]
        app_usage = rec.get("app_usage", [])
        top = app_usage[0] if app_usage else None

        conn.execute(
            """
            INSERT OR REPLACE INTO screen_time
                (date, total_minutes, unlocks, top_app, top_app_name, top_app_minutes, raw_payload)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                date_str,
                rec.get("total_minutes"),
                rec.get("unlocks"),
                top["bundle_id"] if top else None,
                top["name"] if top else None,
                top["minutes"] if top else None,
                json.dumps(rec),
            ),
        )

        # Replace per-app rows for this date
        conn.execute("DELETE FROM screen_app_usage WHERE date = ?", (date_str,))
        for app in app_usage:
            conn.execute(
                """
                INSERT INTO screen_app_usage (date, bundle_id, app_name, minutes)
                VALUES (?, ?, ?, ?)
                """,
                (date_str, app["bundle_id"], app["name"], app["minutes"]),
            )

        inserted += 1
        top_label = f" · top: {top['name']} {top['minutes']:.0f}m" if top else ""
        print(f"  ✓ {date_str}: {rec.get('total_minutes', 0):.0f} min, {rec.get('unlocks', 0)} unlocks{top_label}")

    conn.commit()
    conn.close()
    print(f"Done: {inserted} day(s) stored.")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m domains.screen_time.screentime_ingest <payload.json>")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}")
        sys.exit(1)

    records = json.loads(path.read_text())
    if isinstance(records, dict):
        records = [records]

    ingest(records)


if __name__ == "__main__":
    main()
