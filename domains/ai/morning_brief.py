"""
Morning brief generator — runs as a daily cron at 6am.
Pulls yesterday's data + today's weather, calls Ollama, writes result to days.morning_brief_text.

Usage:
  python -m domains.ai.morning_brief --date 2026-06-28
  python -m domains.ai.morning_brief  # defaults to today
"""

import argparse
import logging
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parents[2]
sys.path.insert(0, str(ROOT))

from infrastructure.db.connection import get_connection
from domains.ai import ollama_client
from domains.ai.prompt_builder import morning_brief as build_brief_prompt

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def _fetch_data(conn, target_date: str, yesterday: str) -> dict:
    sleep = conn.execute(
        "SELECT * FROM sleep WHERE date = ?", (yesterday,)
    ).fetchone()

    daily_stats = conn.execute(
        "SELECT * FROM daily_stats WHERE date = ?", (yesterday,)
    ).fetchone()

    hrv = conn.execute(
        "SELECT * FROM hrv WHERE date = ?", (yesterday,)
    ).fetchone()

    load_index = conn.execute(
        "SELECT * FROM load_index WHERE date = ?", (yesterday,)
    ).fetchone()

    yesterday_day = conn.execute(
        "SELECT energy, mood, notes, daily_answer FROM days WHERE date = ?", (yesterday,)
    ).fetchone()

    weather_today = conn.execute(
        "SELECT condition, temp_min, temp_max FROM weather WHERE date = ?", (target_date,)
    ).fetchone()

    # Weekly summary: last 7 days vs previous 7 days
    week_start = (date.fromisoformat(target_date) - timedelta(days=7)).isoformat()
    prev_start = (date.fromisoformat(target_date) - timedelta(days=14)).isoformat()

    week_row = conn.execute(
        """
        SELECT
            ROUND(AVG(d.energy), 1)       AS avg_energy,
            ROUND(AVG(d.mood), 1)         AS avg_mood,
            COUNT(DISTINCT a.id)          AS activity_count
        FROM days d
        LEFT JOIN activities a ON a.date = d.date
        WHERE d.date BETWEEN ? AND ?
        """,
        (week_start, yesterday),
    ).fetchone()

    prev_row = conn.execute(
        "SELECT ROUND(AVG(energy), 1) AS prev_avg_energy, ROUND(AVG(mood), 1) AS prev_avg_mood FROM days WHERE date BETWEEN ? AND ?",
        (prev_start, week_start),
    ).fetchone()

    # Last week's total spend from money.db (optional — skip if money.db unavailable)
    total_spend = None
    try:
        money_db_path = ROOT / "infrastructure" / "db" / "money.db"
        if money_db_path.exists():
            import sqlite3
            mconn = sqlite3.connect(money_db_path)
            mconn.row_factory = sqlite3.Row
            spend_row = mconn.execute(
                """
                SELECT SUM(ABS(amount)) AS total
                FROM transactions
                WHERE date BETWEEN ? AND ?
                  AND transaction_type = 'Expense'
                  AND deleted_at IS NULL
                """,
                (week_start, yesterday),
            ).fetchone()
            total_spend = spend_row["total"] if spend_row else None
            mconn.close()
    except Exception as e:
        log.warning("Could not fetch money data: %s", e)

    # Last intention / daily answer from last night's questionnaire
    last_intention = None
    if yesterday_day and yesterday_day["daily_answer"]:
        last_intention = yesterday_day["daily_answer"]
    elif yesterday_day and yesterday_day["notes"]:
        last_intention = yesterday_day["notes"][:200]

    # Today's key training session + its fueling target
    todays_session = None
    try:
        has_plan = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='plan_sessions'"
        ).fetchone()
        if has_plan:
            sess = conn.execute(
                """SELECT ps.session_type, ps.discipline, ps.intensity_zone,
                          COALESCE(ps.effective_duration_min, ps.duration_min) AS dur,
                          rg.race_date
                   FROM plan_sessions ps JOIN race_goals rg ON rg.id = ps.goal_id
                   WHERE ps.session_date=? AND rg.status='active' AND ps.status='pending'
                   ORDER BY CASE ps.intensity_zone WHEN 'Z5' THEN 5 WHEN 'Z4' THEN 4
                            WHEN 'Z3' THEN 3 WHEN 'Z2' THEN 2 ELSE 1 END DESC
                   LIMIT 1""",
                (target_date,),
            ).fetchone()
            if sess:
                weeks_to_race = None
                if sess["race_date"]:
                    weeks_to_race = max(0, (date.fromisoformat(sess["race_date"]) - date.fromisoformat(target_date)).days // 7)
                fuel = None
                try:
                    from domains.training import fueling
                    fuel = fueling.session_fuel_targets(sess["dur"], sess["intensity_zone"], sess["discipline"], weeks_to_race)
                except Exception:
                    fuel = None
                todays_session = {
                    "type": sess["session_type"], "discipline": sess["discipline"],
                    "zone": sess["intensity_zone"], "duration_min": sess["dur"], "fueling": fuel,
                }
    except Exception as e:
        log.warning("Could not fetch today's session: %s", e)

    return {
        "todays_session": todays_session,
        "sleep": dict(sleep) if sleep else {},
        "daily_stats": dict(daily_stats) if daily_stats else {},
        "hrv": dict(hrv) if hrv else {},
        "load_index": dict(load_index) if load_index else {},
        "yesterday": dict(yesterday_day) if yesterday_day else {},
        "weather_today": dict(weather_today) if weather_today else {},
        "week_summary": {
            "avg_energy": week_row["avg_energy"] if week_row else None,
            "avg_mood": week_row["avg_mood"] if week_row else None,
            "activity_count": week_row["activity_count"] if week_row else 0,
            "total_spend": total_spend,
            "prev_avg_energy": prev_row["prev_avg_energy"] if prev_row else None,
            "prev_avg_mood": prev_row["prev_avg_mood"] if prev_row else None,
        },
        "last_intention": last_intention,
    }


def run(target_date: str, force: bool = False) -> None:
    yesterday = (date.fromisoformat(target_date) - timedelta(days=1)).isoformat()
    log.info("Generating morning brief for %s (using yesterday=%s)", target_date, yesterday)

    if not ollama_client.is_available():
        log.warning("Ollama not reachable at %s — skipping morning brief", ollama_client.OLLAMA_HOST)
        return

    conn = get_connection()
    try:
        if not force:
            existing = conn.execute(
                "SELECT morning_brief_text FROM days WHERE date = ?", (target_date,)
            ).fetchone()
            if existing and existing["morning_brief_text"]:
                log.info("Brief already exists for %s — skipping (use --force to regenerate)", target_date)
                return
        data = _fetch_data(conn, target_date, yesterday)

        prompt = build_brief_prompt(
            today=target_date,
            yesterday=data["yesterday"],
            sleep=data["sleep"],
            daily_stats=data["daily_stats"],
            hrv=data["hrv"],
            load_index=data["load_index"],
            weather_today=data["weather_today"],
            week_summary=data["week_summary"],
            last_intention=data["last_intention"],
            todays_session=data.get("todays_session"),
        )

        log.info("Calling Ollama (model: %s)...", ollama_client.MODEL_FAST)
        brief = ollama_client.generate(prompt)

        if not brief:
            log.warning("Ollama returned empty response — skipping write")
            return

        brief = brief.strip()
        log.info("Brief generated (%d chars)", len(brief))

        # Ensure the days row exists for today
        conn.execute(
            "INSERT OR IGNORE INTO days (date) VALUES (?)", (target_date,)
        )
        conn.execute(
            "UPDATE days SET morning_brief_text = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE date = ?",
            (brief, target_date),
        )
        conn.commit()
        log.info("Morning brief written to days.morning_brief_text for %s", target_date)

    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--force", action="store_true", help="regenerate even if a brief exists")
    args = parser.parse_args()
    run(args.date, force=args.force)
