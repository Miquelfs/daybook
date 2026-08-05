"""
AI meal planning — "what should I eat to hit the rest of today's target?"

Given the remaining calories and protein for the day, ask the LLM (Claude via the
shared client) for a few concrete suggestions, then persist the plan as JSON.
Degrades gracefully to None if the LLM is unreachable.
"""

import json
import logging
from typing import Optional

from domains.ai import ollama_client

log = logging.getLogger(__name__)


def _build_prompt(remaining_kcal: float, remaining_protein_g: float,
                  preferences: Optional[str]) -> str:
    pref = f"\nPreferences / constraints: {preferences.strip()}" if preferences else ""
    return (
        "I'm cutting body fat while training for a Half Ironman, so I want lean, "
        "high-protein, whole foods.\n"
        f"For the rest of today I have about {round(remaining_kcal)} kcal and "
        f"{round(remaining_protein_g)} g of protein left to eat.{pref}\n\n"
        "Suggest 2-3 simple meals/snacks that together roughly fit that budget and "
        "prioritise protein. Return ONLY JSON:\n"
        '{ "meals": [ {"name": str, "kcal": number, "protein_g": number, '
        '"why": str} ], "note": str }'
    )


def generate(
    conn,
    date: str,
    remaining_kcal: float,
    remaining_protein_g: float,
    preferences: Optional[str] = None,
) -> Optional[dict]:
    if not ollama_client.is_available():
        log.info("meal planner: LLM unavailable, skipping")
        return None

    data = ollama_client.generate_json(
        _build_prompt(remaining_kcal, remaining_protein_g, preferences)
    )
    if not data:
        return None

    model = getattr(ollama_client, "CLAUDE_MODEL", None) if \
        ollama_client.LLM_PROVIDER == "claude" else ollama_client.LLM_PROVIDER
    conn.execute(
        "INSERT INTO food_meal_plans (date, plan_json, model) VALUES (?,?,?)",
        (date, json.dumps(data), model),
    )
    conn.commit()
    return data


def latest_for_date(conn, date: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT * FROM food_meal_plans WHERE date=? ORDER BY generated_at DESC, id DESC LIMIT 1",
        (date,),
    ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "date": row["date"],
        "plan": json.loads(row["plan_json"]),
        "model": row["model"],
        "generated_at": row["generated_at"],
    }
