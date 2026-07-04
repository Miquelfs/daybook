"""
AI router — endpoints for Ollama-powered features.
All endpoints degrade gracefully when Ollama is unreachable.
"""

import sqlite3
from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from infrastructure.db.connection import get_connection
from domains.ai import ollama_client
from domains.ai.prompt_builder import health_narrative as build_narrative_prompt

router = APIRouter(prefix="/ai", tags=["ai"])

DB = Annotated[sqlite3.Connection, Depends(get_connection)]


# ─── Status ──────────────────────────────────────────────────────────────────

@router.get("/status")
def ai_status():
    """Check if Ollama is reachable on the HP."""
    available = ollama_client.is_available()
    return {
        "ollama_available": available,
        "ollama_host": ollama_client.OLLAMA_HOST,
        "model_fast": ollama_client.MODEL_FAST,
        "model_default": ollama_client.MODEL_DEFAULT,
    }


# ─── Morning brief ───────────────────────────────────────────────────────────

@router.get("/morning-brief/{date_str}")
def get_morning_brief(date_str: str, conn: DB):
    """Return the pre-computed morning brief for a date (written by the 6am cron)."""
    row = conn.execute(
        "SELECT morning_brief_text FROM days WHERE date = ?", (date_str,)
    ).fetchone()
    if not row or not row["morning_brief_text"]:
        return {"date": date_str, "brief": None, "available": False}
    return {"date": date_str, "brief": row["morning_brief_text"], "available": True}


@router.post("/morning-brief/{date_str}/regenerate")
def regenerate_morning_brief(date_str: str, conn: DB):
    """Trigger an on-demand morning brief generation (for manual refresh)."""
    import subprocess, sys
    from pathlib import Path
    ROOT = Path(__file__).parents[3]
    result = subprocess.run(
        [sys.executable, "-m", "domains.ai.morning_brief", "--date", date_str, "--force"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=240,
    )
    if result.returncode != 0:
        return {"status": "error", "detail": result.stderr[-500:]}

    row = conn.execute(
        "SELECT morning_brief_text FROM days WHERE date = ?", (date_str,)
    ).fetchone()
    brief = row["morning_brief_text"] if row else None
    return {"status": "ok", "brief": brief}


# ─── Health narratives ────────────────────────────────────────────────────────

class NarrativeRequest(BaseModel):
    topic: str          # sleep | hrv | training | load
    days: int = 14


@router.post("/health-narrative")
def health_narrative(req: NarrativeRequest, conn: DB):
    """
    Generate (or return cached) a plain-English health narrative for a topic.
    Cached in ai_narratives for 24h to avoid re-running on every page load.
    """
    end = date.today()
    start = end - timedelta(days=req.days - 1)
    date_range = f"{start.isoformat()}:{end.isoformat()}"

    # Return cached if generated today
    cached = conn.execute(
        """
        SELECT text, generated_at FROM ai_narratives
        WHERE topic = ? AND date_range = ?
        ORDER BY generated_at DESC LIMIT 1
        """,
        (req.topic, date_range),
    ).fetchone()

    if cached and cached["generated_at"][:10] == date.today().isoformat():
        return {
            "topic": req.topic,
            "text": cached["text"],
            "generated_at": cached["generated_at"],
            "cached": True,
        }

    if not ollama_client.is_available():
        return {"topic": req.topic, "text": None, "available": False}

    data = _fetch_narrative_data(conn, req.topic, start.isoformat(), end.isoformat(), req.days)
    prompt = build_narrative_prompt(req.topic, data)
    text = ollama_client.generate(prompt)

    if not text:
        return {"topic": req.topic, "text": None, "available": False}

    text = text.strip()
    conn.execute(
        "INSERT INTO ai_narratives (topic, date_range, text, model) VALUES (?, ?, ?, ?)",
        (req.topic, date_range, text, ollama_client.MODEL_FAST),
    )
    conn.commit()

    return {
        "topic": req.topic,
        "text": text,
        "generated_at": date.today().isoformat(),
        "cached": False,
    }


def _fetch_narrative_data(conn, topic: str, start: str, end: str, days: int) -> dict:
    data: dict = {"days": days}

    if topic == "sleep":
        rows = conn.execute(
            """
            SELECT duration_seconds, deep_seconds, rem_seconds, awake_seconds, score, avg_spo2
            FROM sleep WHERE date BETWEEN ? AND ?
            """,
            (start, end),
        ).fetchall()

        if rows:
            durations = [r["duration_seconds"] for r in rows if r["duration_seconds"]]
            deep_pcts = [r["deep_seconds"] / r["duration_seconds"] * 100 for r in rows if r["duration_seconds"] and r["deep_seconds"]]
            rem_pcts = [r["rem_seconds"] / r["duration_seconds"] * 100 for r in rows if r["duration_seconds"] and r["rem_seconds"]]
            awake_pcts = [r["awake_seconds"] / r["duration_seconds"] * 100 for r in rows if r["duration_seconds"] and r["awake_seconds"]]
            scores = [r["score"] for r in rows if r["score"]]
            spo2s = [r["avg_spo2"] for r in rows if r["avg_spo2"]]

            import statistics
            data["avg_duration_seconds"] = int(sum(durations) / len(durations)) if durations else None
            data["avg_score"] = round(sum(scores) / len(scores), 1) if scores else None
            data["avg_deep_pct"] = round(sum(deep_pcts) / len(deep_pcts), 1) if deep_pcts else None
            data["avg_rem_pct"] = round(sum(rem_pcts) / len(rem_pcts), 1) if rem_pcts else None
            data["avg_awake_pct"] = round(sum(awake_pcts) / len(awake_pcts), 1) if awake_pcts else None
            data["avg_spo2"] = round(sum(spo2s) / len(spo2s), 1) if spo2s else None
            data["nights_below_deep"] = sum(1 for p in deep_pcts if p < 18)
            data["nights_below_rem"] = sum(1 for p in rem_pcts if p < 20)
            if len(durations) > 1:
                stdev_secs = statistics.stdev(durations)
                data["consistency_stdev_hours"] = round(stdev_secs / 3600, 1)
            target_secs = 8 * 3600 * len(durations)
            actual_secs = sum(durations)
            data["sleep_debt_seconds"] = max(0, target_secs - actual_secs)

    elif topic == "hrv":
        recent = conn.execute(
            "SELECT AVG(last_night_avg) AS avg, AVG(weekly_avg) AS wavg, status FROM hrv WHERE date BETWEEN ? AND ? ORDER BY date DESC LIMIT 7",
            (start, end),
        ).fetchone()
        li = conn.execute(
            "SELECT fatigue_score, recovery_status FROM load_index WHERE date = ?", (end,)
        ).fetchone()
        sleep_avg = conn.execute(
            "SELECT AVG(duration_seconds) AS avg FROM sleep WHERE date BETWEEN ? AND ?", (start, end)
        ).fetchone()
        atl_row = conn.execute(
            "SELECT atl FROM training_load_daily WHERE date = ? AND sport = 'combined'", (end,)
        ).fetchone()
        if recent:
            data["recent_avg_hrv"] = round(recent["avg"], 1) if recent["avg"] else None
            data["weekly_avg_hrv"] = round(recent["wavg"], 1) if recent["wavg"] else None
            data["hrv_status"] = recent["status"]
        if li:
            data["fatigue_score"] = li["fatigue_score"]
            data["recovery_status"] = li["recovery_status"]
        if sleep_avg and sleep_avg["avg"]:
            data["avg_sleep_seconds"] = int(sleep_avg["avg"])
        if atl_row:
            data["atl"] = round(atl_row["atl"], 1) if atl_row["atl"] else None

    elif topic == "training":
        tl = conn.execute(
            "SELECT ctl, atl, tsb, ramp_rate FROM training_load_daily WHERE date = ? AND sport = 'combined'",
            (end,),
        ).fetchone()
        week_acts = conn.execute(
            "SELECT COUNT(*) AS cnt, SUM(activity_type) FROM activities WHERE date BETWEEN ? AND ?",
            (start, end),
        ).fetchone()
        tss_row = conn.execute(
            "SELECT SUM(daily_tss) AS total FROM training_load_daily WHERE date BETWEEN ? AND ? AND sport = 'combined'",
            (start, end),
        ).fetchone()
        sports = conn.execute(
            "SELECT DISTINCT activity_type FROM activities WHERE date BETWEEN ? AND ? AND activity_type IS NOT NULL",
            (start, end),
        ).fetchall()
        if tl:
            data["ctl"] = round(tl["ctl"], 1) if tl["ctl"] else None
            data["atl"] = round(tl["atl"], 1) if tl["atl"] else None
            data["tsb"] = round(tl["tsb"], 1) if tl["tsb"] else None
            data["ramp_rate"] = round(tl["ramp_rate"], 1) if tl["ramp_rate"] else None
        if week_acts:
            data["weekly_workouts"] = week_acts["cnt"]
        if tss_row and tss_row["total"]:
            data["weekly_tss"] = round(tss_row["total"], 0)
        if sports:
            data["sports_this_week"] = ", ".join(r["activity_type"] for r in sports)

    elif topic == "load":
        li = conn.execute(
            "SELECT fatigue_score, recovery_status, hrv_load, sleep_debt, tss_load, timezone_penalty, duty_load FROM load_index WHERE date = ?",
            (end,),
        ).fetchone()
        prev = conn.execute(
            "SELECT AVG(fatigue_score) AS avg FROM load_index WHERE date BETWEEN ? AND ?",
            (start, (date.fromisoformat(end) - timedelta(days=3)).isoformat()),
        ).fetchone()
        if li:
            data.update(dict(li))
        if li and prev and prev["avg"]:
            current = li["fatigue_score"] or 0
            trend_val = current - prev["avg"]
            data["trend"] = "worsening" if trend_val > 3 else "improving" if trend_val < -3 else "stable"

    return data
