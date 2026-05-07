"""FastAPI dependency: yields a SQLite connection per request, closes after."""

import sqlite3
from typing import Generator
from infrastructure.db.connection import get_connection


def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()
