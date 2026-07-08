"""
Create the pilot_licenses table — licences, ratings, medicals and recurrent
training with expiry tracking (inspired by vsimakhin/web-logbook).

Run on Pi:
    cd ~/daybook && python -m infrastructure.db.migrate_licenses
"""

from pathlib import Path
import sqlite3

DB_PATH = Path(__file__).parent / "daybook.db"

SQL = """
CREATE TABLE IF NOT EXISTS pilot_licenses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    category     TEXT NOT NULL DEFAULT 'licence',  -- licence | rating | medical | training | other
    name         TEXT NOT NULL,
    number       TEXT,
    issued_date  TEXT,                             -- YYYY-MM-DD
    valid_until  TEXT,                             -- YYYY-MM-DD, NULL = non-expiring
    remarks      TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
);
"""


def run(db_path: Path = DB_PATH) -> None:
    conn = sqlite3.connect(db_path)
    conn.executescript(SQL)
    conn.commit()
    conn.close()
    print("✓ pilot_licenses table ready")


if __name__ == "__main__":
    run()
