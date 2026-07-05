import sqlite3
from pathlib import Path

MONEY_DB_PATH = Path(__file__).parent / "money.db"


def get_money_connection(db_path: Path = MONEY_DB_PATH) -> sqlite3.Connection:
    # check_same_thread=False: FastAPI generator dependencies may run setup,
    # endpoint, and teardown on different threadpool threads. Each connection
    # is still request-scoped (never used by two requests at once), and
    # Python's sqlite3 is compiled with serialized thread-safety.
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn
