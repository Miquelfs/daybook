"""
Screen Time API.
GET  /screen-time/{date}        → daily summary + per-app breakdown
GET  /screen-time?start=&end=   → range of daily summaries
POST /screen-time/ingest        → receive payload from iPhone Shortcuts
"""

import json
import os
import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from infrastructure.api.db import get_db

router = APIRouter(prefix="/screen-time", tags=["screen_time"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


class AppUsage(BaseModel):
    bundle_id: str
    app_name: str | None = None
    minutes: float


class ScreenTimeSummary(BaseModel):
    date: str
    total_minutes: float | None = None
    unlocks: int | None = None
    top_app: str | None = None
    top_app_name: str | None = None
    top_app_minutes: float | None = None
    app_usage: list[AppUsage] = []


def _app_usage(conn: sqlite3.Connection, date_str: str) -> list[AppUsage]:
    rows = conn.execute(
        """SELECT bundle_id, app_name, minutes
           FROM screen_app_usage
           WHERE date = ?
           ORDER BY minutes DESC""",
        (date_str,),
    ).fetchall()
    return [AppUsage(bundle_id=r["bundle_id"], app_name=r["app_name"], minutes=r["minutes"]) for r in rows]


@router.get("/{date_str}", response_model=ScreenTimeSummary)
def get_screen_time(date_str: str, conn: DB):
    row = conn.execute(
        "SELECT * FROM screen_time WHERE date = ?", (date_str,)
    ).fetchone()
    if not row:
        return ScreenTimeSummary(date=date_str)
    return ScreenTimeSummary(
        date=row["date"],
        total_minutes=row["total_minutes"],
        unlocks=row["unlocks"],
        top_app=row["top_app"],
        top_app_name=row["top_app_name"],
        top_app_minutes=row["top_app_minutes"],
        app_usage=_app_usage(conn, date_str),
    )


@router.get("", response_model=list[ScreenTimeSummary])
def get_screen_time_range(
    conn: DB,
    start: str = Query(...),
    end: str = Query(...),
):
    rows = conn.execute(
        """SELECT * FROM screen_time
           WHERE date BETWEEN ? AND ?
           ORDER BY date""",
        (start, end),
    ).fetchall()
    return [
        ScreenTimeSummary(
            date=r["date"],
            total_minutes=r["total_minutes"],
            unlocks=r["unlocks"],
            top_app=r["top_app"],
            top_app_name=r["top_app_name"],
            top_app_minutes=r["top_app_minutes"],
        )
        for r in rows
    ]


# ── Ingest (called from iPhone Shortcuts) ────────────────────────────────────

class IngestAppUsage(BaseModel):
    bundle_id: str
    name: str | None = None
    minutes: float


class IngestPayload(BaseModel):
    date: str                          # YYYY-MM-DD
    total_minutes: float
    unlocks: int | None = None
    app_usage: list[IngestAppUsage] = []


def _token() -> str | None:
    token = os.environ.get("SCREEN_TIME_TOKEN")
    if token:
        return token
    from pathlib import Path
    env_file = Path(__file__).parents[3] / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("SCREEN_TIME_TOKEN="):
                return line.split("=", 1)[1].strip()
    return None


@router.post("/ingest")
def ingest_screen_time(request: Request, payload: IngestPayload, conn: DB):
    """
    Receive screen time data from iPhone Shortcuts.
    Optionally protected by Bearer token (set SCREEN_TIME_TOKEN in .env).
    """
    expected = _token()
    if expected:
        auth = request.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        if token != expected:
            raise HTTPException(status_code=401, detail="Invalid token")

    app_usage = payload.app_usage
    top = app_usage[0] if app_usage else None

    conn.execute(
        """
        INSERT OR REPLACE INTO screen_time
            (date, total_minutes, unlocks, top_app, top_app_name, top_app_minutes, raw_payload, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        """,
        (
            payload.date,
            payload.total_minutes,
            payload.unlocks,
            top.bundle_id if top else None,
            top.name if top else None,
            top.minutes if top else None,
            json.dumps({"app_usage": [a.model_dump() for a in app_usage]}),
        ),
    )

    # Per-app breakdown
    conn.execute("DELETE FROM screen_app_usage WHERE date = ?", (payload.date,))
    for app in app_usage:
        conn.execute(
            """
            INSERT INTO screen_app_usage (date, bundle_id, app_name, minutes)
            VALUES (?, ?, ?, ?)
            """,
            (payload.date, app.bundle_id, app.name, app.minutes),
        )

    conn.commit()
    return {"status": "ok", "date": payload.date, "apps": len(app_usage)}
