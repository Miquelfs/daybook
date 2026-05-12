import sqlite3
from pathlib import Path

MONEY_DB_PATH = Path(__file__).parent / "money.db"


def get_money_connection(db_path: Path = MONEY_DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn
