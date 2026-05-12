"""FastAPI dependency: yields a money.db connection per request, closes after."""

import sqlite3
from typing import Generator
from infrastructure.db.money_connection import get_money_connection


def get_money_db() -> Generator[sqlite3.Connection, None, None]:
    conn = get_money_connection()
    try:
        yield conn
    finally:
        conn.close()
