import subprocess
import sys
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, BackgroundTasks
import sqlite3

from infrastructure.db.connection import get_connection as get_db

ROOT = Path(__file__).parents[3]
router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("")
def get_weather_range(start: str, end: str, conn: Annotated[sqlite3.Connection, Depends(get_db)]):
    """Return stored weather rows for a date range."""
    rows = conn.execute(
        "SELECT * FROM weather WHERE date BETWEEN ? AND ? ORDER BY date",
        (start, end),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/{date_str}")
def get_weather_day(date_str: str, conn: Annotated[sqlite3.Connection, Depends(get_db)]):
    """Return weather for a single date, or null if not yet fetched."""
    row = conn.execute("SELECT * FROM weather WHERE date = ?", (date_str,)).fetchone()
    return dict(row) if row else None


def _run_weather_sync(start: str, end: str) -> None:
    subprocess.run(
        [sys.executable, "-m", "domains.weather.weather_sync", start, end],
        cwd=str(ROOT),
        capture_output=True,
    )


@router.post("/sync")
def sync_weather(start: str, end: str, background: BackgroundTasks):
    """Trigger a weather sync for a date range in the background."""
    background.add_task(_run_weather_sync, start, end)
    return {"status": "started", "start": start, "end": end}
