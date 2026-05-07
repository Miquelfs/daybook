"""
Run this once (and any time schema changes) to create daybook.db.
Idempotent: uses CREATE TABLE IF NOT EXISTS throughout.
"""

from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from connection import get_connection

SCHEMA = Path(__file__).parent / "schema.sql"


def init_db() -> None:
    conn = get_connection()
    sql = SCHEMA.read_text()
    conn.executescript(sql)
    conn.commit()
    conn.close()
    print(f"Database ready: {(Path(__file__).parent / 'daybook.db').resolve()}")


if __name__ == "__main__":
    init_db()
