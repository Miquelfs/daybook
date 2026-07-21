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
    """Check if the active LLM backend (Ollama local or Groq cloud) is reachable."""
    available = ollama_client.is_available()
    provider = ollama_client.LLM_PROVIDER
    is_groq = provider == "groq"
    return {
        # `ollama_available` kept for client back-compat; it means "LLM available".
        "ollama_available": available,
        "provider": provider,
        "host": ollama_client.GROQ_BASE if is_groq else ollama_client.OLLAMA_HOST,
        "ollama_host": ollama_client.OLLAMA_HOST,
        "model_fast": ollama_client.GROQ_MODEL_FAST if is_groq else ollama_client.MODEL_FAST,
        "model_default": ollama_client.GROQ_MODEL if is_groq else ollama_client.MODEL_DEFAULT,
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
    topic: str          # sleep | hrv | training | load | money | insights
    days: int = 14
    force: bool = False  # bypass today's cache (the Regenerate button)


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

    if not req.force and cached and cached["generated_at"][:10] == date.today().isoformat():
        return {
            "topic": req.topic,
            "text": cached["text"],
            "generated_at": cached["generated_at"],
            "cached": True,
        }

    if not ollama_client.is_available():
        return {"topic": req.topic, "text": None, "available": False}

    prompt = _build_prompt_for_topic(conn, req.topic, start.isoformat(), end.isoformat(), req.days)
    if prompt is None:
        return {"topic": req.topic, "text": None, "available": False}
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


@router.get("/health-narrative")
def get_health_narrative(conn: DB, topic: str = Query(...), days: int = Query(14)):
    """Return today's cached narrative for a topic without generating one.
    Lets the UI restore a previously generated narrative on page load."""
    end = date.today()
    start = end - timedelta(days=days - 1)
    date_range = f"{start.isoformat()}:{end.isoformat()}"
    cached = conn.execute(
        """
        SELECT text, generated_at FROM ai_narratives
        WHERE topic = ? AND date_range = ?
        ORDER BY generated_at DESC LIMIT 1
        """,
        (topic, date_range),
    ).fetchone()
    if cached and cached["generated_at"][:10] == date.today().isoformat():
        return {"topic": topic, "text": cached["text"], "generated_at": cached["generated_at"], "cached": True}
    return {"topic": topic, "text": None, "cached": False}


# Training-load and other keys the correlation catalog doesn't label — spelled out
# so the LLM never has to guess what a cryptic code means (it was reading "tsb" as
# "screen time"). Everything else falls back to the shared catalog.
_EXTRA_METRIC_LABELS = {
    "ctl": "Fitness (CTL, 42-day training load)",
    "atl": "Fatigue (ATL, 7-day training load)",
    "tsb": "Form (TSB = fitness minus fatigue)",
    "daily_spend": "Daily spend",
}


def _metric_label(key: str) -> str:
    """Human-readable label for a correlation metric key."""
    try:
        from infrastructure.api.routers.correlations import _STATIC_CATALOG
        if key in _STATIC_CATALOG:
            return _STATIC_CATALOG[key]["label"]
    except Exception:
        pass
    if key in _EXTRA_METRIC_LABELS:
        return _EXTRA_METRIC_LABELS[key]
    if ":" in key:  # dynamic keys like money:Transportation, tag:running, person:Anna
        pref, _, rest = key.partition(":")
        pretty = {"money": "Spend", "cat": "Spend", "tag": "Tag", "person": "Time with"}.get(pref, pref.capitalize())
        return f"{pretty}: {rest}"
    return key.replace("_", " ").capitalize()


def _fetch_insights_data(conn) -> dict:
    """Strongest correlations from the latest snapshot, for the insights narrative."""
    latest = conn.execute("SELECT MAX(computed_at) AS c FROM correlation_snapshots").fetchone()
    if not latest or not latest["c"]:
        return {}
    rows = conn.execute(
        """
        SELECT metric_a, metric_b, r, lag, n, is_new FROM correlation_snapshots
        WHERE computed_at = ?
        ORDER BY ABS(r) DESC LIMIT 8
        """,
        (latest["c"],),
    ).fetchall()
    corrs = [dict(r) for r in rows]
    for c in corrs:
        c["label_a"] = _metric_label(c["metric_a"])
        c["label_b"] = _metric_label(c["metric_b"])
    return {"computed_at": latest["c"], "correlations": corrs}


def _build_prompt_for_topic(conn, topic: str, start: str, end: str, days: int):
    """Route a narrative topic to the right data-fetch + prompt. Returns None if
    there's not enough data to generate (caller reports unavailable)."""
    if topic == "money":
        from domains.ai.weekly_expense_summary import _fetch_week_spend
        from domains.ai.prompt_builder import weekly_expense_summary as build_money_prompt
        mdata = _fetch_week_spend(start, end)
        if not mdata or not mdata.get("total_spent"):
            return None
        return build_money_prompt(start, mdata)

    if topic == "insights":
        from domains.ai.prompt_builder import insights_narrative as build_insights_prompt
        idata = _fetch_insights_data(conn)
        if not idata.get("correlations"):
            return None
        return build_insights_prompt(idata)

    data = _fetch_narrative_data(conn, topic, start, end, days)
    return build_narrative_prompt(topic, data)


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
