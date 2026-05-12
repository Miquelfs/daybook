"""
Daybook FastAPI backend.
Local only — binds to 0.0.0.0:8000 behind Tailscale. Never expose publicly.
"""

import os
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

from infrastructure.api.routers import days, insights, questionnaire
from infrastructure.api.routers import locations
from infrastructure.api.routers import money

VERSION = "0.1.0"
ROOT = Path(__file__).parents[2]

app = FastAPI(
    title="Daybook API",
    version=VERSION,
    docs_url="/docs",
    redoc_url=None,
)

_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins],
    allow_methods=["GET", "PATCH", "POST", "DELETE"],
    allow_headers=["*"],
)

app.include_router(days.router)
app.include_router(insights.router)
app.include_router(questionnaire.router)
app.include_router(locations.router)
app.include_router(money.router)


@app.get("/")
def root():
    return {
        "service": "daybook-api",
        "version": VERSION,
        "status": "ok",
        "docs": "/docs",
    }


def _run_garmin_sync() -> None:
    subprocess.run(
        [sys.executable, "-m", "domains.health.garmin.garmin_sync"],
        cwd=str(ROOT),
        capture_output=True,
    )


@app.post("/sync/garmin")
def sync_garmin(background: BackgroundTasks):
    """Trigger an incremental Garmin sync in the background."""
    background.add_task(_run_garmin_sync)
    return {"status": "started"}


def _run_notion_sync() -> None:
    subprocess.run(
        [sys.executable, "-m", "domains.money.notion_sync"],
        cwd=str(ROOT),
        capture_output=True,
    )


@app.post("/sync/notion")
def sync_notion(background: BackgroundTasks):
    """Trigger an incremental Notion finance sync in the background."""
    background.add_task(_run_notion_sync)
    return {"status": "started"}
