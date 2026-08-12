"""
Weekly meal plan + consolidated shopping list.

The single-day meal_planner answers "what fills the rest of today?". This answers
the planning question: give me a whole week of heart-healthy, target-hitting meals
AND the one shopping list I take to the supermarket — grouped by aisle with rough
quantities, so I can plan and buy instead of only seeing today.

Asks Claude (smart model) for the plan, persists it as JSON keyed by the Monday of
the week. Degrades to None when the LLM is unreachable.
"""

import json
import logging
from datetime import date as _date, timedelta
from typing import Optional

from domains.ai import ollama_client
from domains.food import heart_healthy

log = logging.getLogger(__name__)

_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def week_start_for(date: str) -> str:
    """Monday of the week containing `date`."""
    d = _date.fromisoformat(date)
    return (d - timedelta(days=d.weekday())).isoformat()


def _build_prompt(target_kcal: Optional[float], protein_g: Optional[float],
                  recent: list[str], preferences: Optional[str]) -> str:
    budget = (
        f"Each day should land near {round(target_kcal)} kcal and hit about "
        f"{round(protein_g)} g of protein."
        if target_kcal and protein_g else
        "Aim for lean, high-protein days (roughly 1800-2200 kcal, 140g+ protein)."
    )
    liked = (
        "Foods I already eat and like (reuse some so the plan is realistic): "
        + ", ".join(recent[:15]) + ".\n"
        if recent else ""
    )
    pref = f"\nExtra request: {preferences.strip()}" if preferences else ""
    return (
        "You are my nutrition coach. Plan my whole week of eating. I'm cutting body "
        "fat while training for a Half Ironman — I want lean, high-protein, whole "
        "foods, realistic home-cooked Spanish/Mediterranean meals.\n"
        f"{heart_healthy.guidance_directive()}\n"
        f"{budget}\n"
        f"{liked}{pref}\n\n"
        "Give me 7 days (Mon-Sun), each with breakfast, lunch, dinner and one snack. "
        "Reuse ingredients across days so the shopping list stays short and nothing "
        "is wasted. Then produce ONE consolidated shopping list for the whole week, "
        "grouped by supermarket aisle, with rough quantities.\n\n"
        "Return ONLY JSON of this exact shape (no markdown, no code fences):\n"
        "{\n"
        '  "days": [\n'
        '    {"day":"Mon","breakfast":{"name":str,"kcal":number,"protein_g":number},\n'
        '     "lunch":{...},"dinner":{...},"snack":{...},\n'
        '     "kcal":number,"protein_g":number}\n'
        "  ],\n"
        '  "shopping_list": [\n'
        '    {"category":"Produce","items":[{"name":str,"qty":str}]},\n'
        '    {"category":"Protein & fish","items":[...]},\n'
        '    {"category":"Dairy & eggs","items":[...]},\n'
        '    {"category":"Pantry & grains","items":[...]},\n'
        '    {"category":"Other","items":[...]}\n'
        "  ],\n"
        '  "note": str\n'
        "}\n"
        "Rules: exactly 7 day objects Mon-Sun. Per-day kcal/protein_g must be the sum "
        "of that day's meals. Quantities should be shopping-friendly (e.g. \"6 eggs\", "
        "\"500 g\", \"2 tins\", \"1 bag\"). Keep the list de-duplicated across the week. "
        "One short encouraging note."
    )


def _recent_liked(conn, on_date: str, days: int = 21) -> list[str]:
    start = (_date.fromisoformat(on_date) - timedelta(days=days)).isoformat()
    rows = conn.execute(
        """SELECT TRIM(description) AS name, COUNT(*) AS n
           FROM food_entries
           WHERE date BETWEEN ? AND ? AND heart_rating IN ('good','ok')
             AND description IS NOT NULL AND TRIM(description) <> ''
           GROUP BY LOWER(TRIM(description))
           ORDER BY n DESC LIMIT 15""",
        (start, on_date),
    ).fetchall()
    return [r["name"] for r in rows]


def generate(conn, week_start: str, target_kcal: Optional[float],
             protein_g: Optional[float], preferences: Optional[str] = None) -> Optional[dict]:
    if not ollama_client.is_available():
        log.info("weekly planner: LLM unavailable, skipping")
        return None

    recent = _recent_liked(conn, week_start)
    # A whole week (28 meals) + a full shopping list is a big JSON payload — give it
    # plenty of output budget so it isn't truncated mid-object into invalid JSON.
    data = ollama_client.generate_json(
        _build_prompt(target_kcal, protein_g, recent, preferences),
        model=ollama_client.CLAUDE_MODEL_SMART,
        max_tokens=6000,
    )
    if not data or "days" not in data:
        return None

    model = ollama_client.CLAUDE_MODEL_SMART if \
        ollama_client.LLM_PROVIDER == "claude" else ollama_client.LLM_PROVIDER
    conn.execute(
        "INSERT INTO food_weekly_plans (week_start, plan_json, model) VALUES (?,?,?)",
        (week_start, json.dumps(data), model),
    )
    conn.commit()
    return data


def latest_for_week(conn, week_start: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT * FROM food_weekly_plans WHERE week_start=? "
        "ORDER BY generated_at DESC, id DESC LIMIT 1",
        (week_start,),
    ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "week_start": row["week_start"],
        "plan": json.loads(row["plan_json"]),
        "model": row["model"],
        "generated_at": row["generated_at"],
    }
