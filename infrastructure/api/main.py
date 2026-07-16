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
from fastapi.staticfiles import StaticFiles

from infrastructure.api.routers import days, insights, questionnaire
from infrastructure.api.routers import locations
from infrastructure.api.routers import money
from infrastructure.api.routers import contacts
from infrastructure.api.routers import activities
from infrastructure.api.routers import health
from infrastructure.api.routers import training
from infrastructure.api.routers import stats
from infrastructure.api.routers import tags as tags_module
from infrastructure.api.routers import correlations as correlations_module
from infrastructure.api.routers import weather as weather_module
from infrastructure.api.routers import screen_time as screen_time_module
from infrastructure.api.routers import books as books_module
from infrastructure.api.routers import life as life_module
from infrastructure.api.routers import aviation as aviation_module
from infrastructure.api.routers import restaurants as restaurants_module
from infrastructure.api.routers import shows as shows_module
from infrastructure.api.routers import decisions as decisions_module
from infrastructure.api.routers import roster as roster_module
from infrastructure.api.routers import experiments as experiments_module
from infrastructure.api.routers import injuries as injuries_module
from infrastructure.api.routers import ai as ai_module
from infrastructure.api.routers import groceries as groceries_module
from infrastructure.api.routers import race_plans as race_plans_module
from infrastructure.api.routers import nutrition as nutrition_module

VERSION = "0.1.0"
ROOT = Path(__file__).parents[2]

# Load .env from repo root so CORS_ORIGINS, TZ, etc. are available
# without having to prefix every `nohup` command with env vars.
_env_file = ROOT / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

_docs_url = None if os.getenv("DISABLE_DOCS") else "/docs"

app = FastAPI(
    title="Daybook API",
    version=VERSION,
    docs_url=_docs_url,
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
app.include_router(contacts.router)
app.include_router(activities.router)
app.include_router(health.router)
app.include_router(training.router)
app.include_router(stats.router)
app.include_router(tags_module.tags_router)
app.include_router(tags_module.day_tags_router)
app.include_router(correlations_module.router)
app.include_router(weather_module.router)
app.include_router(screen_time_module.router)
app.include_router(books_module.router)
app.include_router(life_module.router)
app.include_router(aviation_module.router)
app.include_router(restaurants_module.router)
app.include_router(shows_module.router)
app.include_router(decisions_module.router)
app.include_router(roster_module.router)
app.include_router(experiments_module.router)
app.include_router(injuries_module.router)
app.include_router(ai_module.router)
app.include_router(groceries_module.router)
app.include_router(race_plans_module.router)
app.include_router(nutrition_module.router)

_photos_dir = ROOT / "data" / "photos"
_photos_dir.mkdir(parents=True, exist_ok=True)
app.mount("/photos", StaticFiles(directory=str(_photos_dir)), name="photos")


@app.on_event("startup")
def _run_migrations() -> None:
    """Ensure all DB tables exist. Safe to run on every startup."""
    from infrastructure.db.migrate_screen_time import run as _migrate_screen_time
    _migrate_screen_time()
    from infrastructure.db.migrate_add_error_log import migrate as _migrate_error_log
    _migrate_error_log()
    from infrastructure.db.migrate_load_index_and_decisions import migrate as _migrate_h1_h3
    _migrate_h1_h3()
    from infrastructure.db.migrate_intraday_hr import migrate as _migrate_intraday_hr
    _migrate_intraday_hr()
    from infrastructure.db.migrate_injuries import migrate as _migrate_injuries
    from infrastructure.db.connection import get_connection as _get_conn
    _conn = _get_conn()
    _migrate_injuries(_conn)
    _conn.close()
    from infrastructure.db.migrate_ai import migrate as _migrate_ai
    _migrate_ai()
    from infrastructure.db.migrate_groceries import migrate as _migrate_groceries
    _migrate_groceries()
    from infrastructure.db.migrate_race_plans import migrate as _migrate_race_plans
    _conn2 = _get_conn()
    _migrate_race_plans(_conn2)
    _conn2.close()
    from infrastructure.db.migrate_plan_session_structure import migrate as _migrate_plan_structure
    from infrastructure.db.migrate_adaptation_log import migrate as _migrate_adaptation_log
    from infrastructure.db.migrate_nutrition import migrate as _migrate_nutrition
    _conn3 = _get_conn()
    _migrate_plan_structure(_conn3)
    _migrate_adaptation_log(_conn3)
    _migrate_nutrition(_conn3)
    _conn3.close()


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


def _run_strava_sync() -> None:
    subprocess.run(
        [sys.executable, "-m", "domains.health.strava.strava_sync"],
        cwd=str(ROOT),
        capture_output=True,
    )


@app.post("/sync/strava")
def sync_strava(background: BackgroundTasks):
    """Trigger an incremental Strava enrichment sync in the background."""
    background.add_task(_run_strava_sync)
    return {"status": "started"}


def _run_aviation_import() -> None:
    subprocess.run(
        [sys.executable, "-m", "domains.aviation.importers.full_csv_importer"],
        cwd=str(ROOT),
        capture_output=True,
    )


@app.post("/sync/aviation")
def sync_aviation(background: BackgroundTasks):
    """Re-import Full.csv into the flights table in the background."""
    background.add_task(_run_aviation_import)
    return {"status": "started"}


def _run_weather_sync_today() -> None:
    from datetime import date as _date, timedelta
    today = _date.today().isoformat()
    week_ago = (_date.today() - timedelta(days=6)).isoformat()
    subprocess.run(
        [sys.executable, "-m", "domains.weather.weather_sync", week_ago, today],
        cwd=str(ROOT),
        capture_output=True,
    )


@app.post("/sync/weather")
def sync_weather(background: BackgroundTasks):
    """Trigger a weather sync for the past 7 days in the background."""
    background.add_task(_run_weather_sync_today)
    return {"status": "started"}


@app.get("/sync/status")
def get_sync_status():
    """Return last sync attempt/success times for each source."""
    from infrastructure.db.connection import get_connection as _get_conn
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM sync_status ORDER BY source").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/strava/auth-url")
def strava_auth_url():
    """Return the Strava OAuth authorization URL for first-time setup."""
    import os
    client_id = os.getenv("STRAVA_CLIENT_ID", "")
    if not client_id:
        return {"error": "STRAVA_CLIENT_ID not set in .env"}
    redirect_uri = os.getenv("STRAVA_REDIRECT_URI", "http://localhost:8000/strava/callback")
    url = (
        f"https://www.strava.com/oauth/authorize"
        f"?client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&approval_prompt=auto"
        f"&scope=activity:read_all"
    )
    return {"auth_url": url}


@app.get("/strava/callback")
def strava_callback(code: str):
    """Exchange OAuth code for tokens. Open this URL in a browser after authorizing."""
    from domains.health.strava.strava_client import exchange_code
    try:
        tokens = exchange_code(code)
        return {
            "status": "ok",
            "message": "Strava tokens saved. You can now run make sync-strava.",
            "athlete": tokens.get("athlete", {}).get("firstname", ""),
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}
