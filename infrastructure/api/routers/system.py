"""
System status — is Daybook healthy, and is the data fresh?

One endpoint the app (and `make deploy`'s health check) can read:
  - nightly jobs (daily_sync.sh records each step in job_runs): last result,
    last success, consecutive failures
  - data freshness: Garmin daily stats/sleep, GPS pings, weather, activities
  - roster horizon (upload next month's roster before it runs out)
  - backups (newest snapshot in data/backups) and free disk on the SD card
Each check is ok / warn / fail; `overall` is the worst of them.
"""

from __future__ import annotations

import shutil
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/system", tags=["system"])

_ROOT = Path(__file__).parents[3]
_DAYBOOK = _ROOT / "infrastructure" / "db" / "daybook.db"
_LOCATIONS = _ROOT / "infrastructure" / "db" / "locations.db"
_BACKUPS = _ROOT / "data" / "backups"

LEVELS = {"ok": 0, "warn": 1, "fail": 2}

# Jobs worth alerting on, with how stale their last SUCCESS may get (hours).
# Others are listed but never alert (weekly / optional / time-windowed jobs).
JOB_MAX_AGE_H = {
    "garmin_sync": 26, "overland_process": 26, "trip_detection": 26, "weather_sync": 26,
    "wellness_sync": 26, "intraday_hr_sync": 26, "compute_load_index": 26, "reflow": 26,
    "garmin_activity_detail_sync": 26, "compute_activity_metrics": 26, "compute_training_load": 26,
    "price_sync": 50, "morning_brief": 30, "garmin_workout_push": 26,
}
JOB_LABEL = {
    "garmin_sync": "Garmin sync", "overland_process": "GPS processing", "trip_detection": "Trip detection",
    "weather_sync": "Weather", "wellness_sync": "Garmin wellness", "intraday_hr_sync": "Garmin heart rate",
    "compute_load_index": "Load index", "reflow": "Training re-plan", "coach": "AI coach",
    "garmin_activity_detail_sync": "Activity details", "compute_activity_metrics": "Activity metrics",
    "compute_training_load": "Fitness / form", "price_sync": "Portfolio prices", "morning_brief": "Morning brief",
    "garmin_workout_push": "Workouts → Garmin", "metar": "METARs", "life_review": "Weekly review", "plan_executor": "Investment plans",
    "compute_correlations": "Correlations", "roster_tag_sync": "Roster tags", "strava_sync": "Strava",
}


def _conn(path: Path) -> sqlite3.Connection | None:
    if not path.exists() or path.stat().st_size == 0:
        return None
    con = sqlite3.connect(path, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def _has(con: sqlite3.Connection, table: str) -> bool:
    return bool(con.execute("SELECT 1 FROM sqlite_master WHERE name=?", (table,)).fetchone())


def _age_h(ts: str | None) -> float | None:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds() / 3600


def _ago(hours: float | None) -> str:
    if hours is None:
        return "never"
    if hours < 1:
        return "just now"
    if hours < 36:
        return f"{round(hours)}h ago"
    return f"{round(hours / 24)}d ago"


def _days_since(d: str | None) -> int | None:
    if not d:
        return None
    try:
        return (date.today() - date.fromisoformat(d[:10])).days
    except ValueError:
        return None


@router.get("/status")
def system_status():
    checks: list[dict] = []
    jobs: list[dict] = []

    def add(key, label, level, detail, group="data"):
        checks.append({"key": key, "label": label, "level": level, "detail": detail, "group": group})

    con = _conn(_DAYBOOK)
    if con is None:
        add("db", "Main database", "fail", "daybook.db missing or empty", "system")
    else:
        try:
            # ── jobs ─────────────────────────────────────────────────────────
            if _has(con, "job_runs"):
                rows = con.execute(
                    """SELECT job,
                              MAX(finished_at) AS last_run,
                              MAX(CASE WHEN status='ok' THEN finished_at END) AS last_ok
                       FROM job_runs GROUP BY job"""
                ).fetchall()
                for r in rows:
                    base = r["job"].split(":")[0]
                    last = con.execute(
                        "SELECT status, message FROM job_runs WHERE job=? ORDER BY finished_at DESC, id DESC LIMIT 1",
                        (r["job"],),
                    ).fetchone()
                    fails = 0
                    for x in con.execute(
                        "SELECT status FROM job_runs WHERE job=? ORDER BY finished_at DESC, id DESC LIMIT 48",
                        (r["job"],),
                    ):
                        if x["status"] != "fail":
                            break
                        fails += 1
                    ok_age = _age_h(r["last_ok"])
                    max_age = JOB_MAX_AGE_H.get(r["job"])  # suffixed variants (":today") never alert
                    level = "ok"
                    if last["status"] == "fail":
                        level = "warn"
                    if max_age and (ok_age is None or ok_age > max_age):
                        level = "fail"
                    jobs.append({
                        "job": r["job"], "label": JOB_LABEL.get(base, base.replace("_", " ")),
                        "last_run": r["last_run"], "last_ok": r["last_ok"], "status": last["status"],
                        "consecutive_failures": fails, "level": level,
                        "message": last["message"] if last["status"] == "fail" else None,
                    })
                jobs.sort(key=lambda j: (-LEVELS[j["level"]], j["label"]))
                for j in jobs:
                    if j["level"] != "ok" and JOB_MAX_AGE_H.get(j["job"]):
                        add(f"job:{j['job']}", j["label"], j["level"],
                            f"failing {j['consecutive_failures']}× in a row · last OK {_ago(_age_h(j['last_ok']))}",
                            "jobs")
            else:
                add("jobs", "Nightly jobs", "warn", "no job history yet (first sync after deploy fills it)", "jobs")

            # ── data freshness ───────────────────────────────────────────────
            if _has(con, "daily_stats"):
                d = con.execute("SELECT MAX(date) FROM daily_stats WHERE steps IS NOT NULL").fetchone()[0]
                n = _days_since(d)
                add("garmin_daily", "Garmin daily data", "ok" if n is not None and n <= 1 else "warn" if n == 2 else "fail",
                    f"latest {d or 'none'}")
            if _has(con, "sleep"):
                d = con.execute("SELECT MAX(date) FROM sleep WHERE duration_seconds > 0").fetchone()[0]
                n = _days_since(d)
                add("sleep", "Sleep", "ok" if n is not None and n <= 1 else "warn" if n is not None and n <= 3 else "fail",
                    f"latest night {d or 'none'}")
            if _has(con, "weather"):
                d = con.execute("SELECT MAX(date) FROM weather").fetchone()[0]
                n = _days_since(d)
                add("weather", "Weather", "ok" if n is not None and n <= 1 else "warn", f"latest {d or 'none'}")
            if _has(con, "roster"):
                d = con.execute("SELECT MAX(date) FROM roster").fetchone()[0]
                ahead = -(_days_since(d) or 0) if d else None
                level = "ok" if ahead is not None and ahead >= 10 else "warn"
                add("roster", "Roster horizon", level,
                    f"known until {d} ({ahead}d ahead)" + ("" if level == "ok" else " — upload next month's roster")
                    if d else "no roster uploaded", "plan")
        finally:
            con.close()

    lcon = _conn(_LOCATIONS)
    if lcon is not None:
        try:
            if _has(lcon, "overland_locations"):
                ts = lcon.execute("SELECT MAX(recorded_at) FROM overland_locations").fetchone()[0]
                h = _age_h(ts)
                add("gps", "GPS (Overland)", "ok" if h is not None and h <= 24 else "warn" if h is not None and h <= 72 else "fail",
                    f"last ping {_ago(h)}")
        finally:
            lcon.close()

    # ── backups + disk ───────────────────────────────────────────────────────
    snaps = sorted(_BACKUPS.glob("*.db*"), key=lambda p: p.stat().st_mtime, reverse=True) if _BACKUPS.exists() else []
    if snaps:
        h = (datetime.now().timestamp() - snaps[0].stat().st_mtime) / 3600
        add("backup", "Backups", "ok" if h <= 30 else "warn" if h <= 72 else "fail",
            f"newest snapshot {_ago(h)}", "system")
    else:
        add("backup", "Backups", "fail", "no snapshots in data/backups", "system")
    du = shutil.disk_usage(_ROOT)
    free_gb = du.free / 1e9
    add("disk", "SD card", "ok" if free_gb >= 1.5 else "warn" if free_gb >= 0.5 else "fail",
        f"{free_gb:.1f} GB free of {du.total / 1e9:.0f} GB", "system")

    overall = max((c["level"] for c in checks), key=lambda l: LEVELS[l], default="ok")
    return {
        "overall": overall,
        "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "checks": sorted(checks, key=lambda c: -LEVELS[c["level"]]),
        "jobs": jobs,
    }
