"""
Short-horizon meal plan + shopping list.

The single-day meal_planner answers "what fills the rest of today?". This plans
the next few days ahead — heart-healthy, target-hitting meals plus one small
consolidated shopping list, so you can plan and buy a couple of days at a time
(matching small, frequent grocery runs) instead of only seeing today.

Kept short on purpose: a 3-day plan is a reliable LLM payload and realistic to
shop for. Asks Claude (smart model), persists the plan as JSON keyed by its start
date. Degrades to None when the LLM is unreachable.

Storage note: the table is still `food_weekly_plans` and the key column
`week_start` — here it just holds the plan's START date (not a Monday), so no
migration was needed when the horizon shrank from a week to a few days.
"""

import json
import logging
from datetime import date as _date, timedelta
from typing import Optional

from domains.ai import ollama_client
from domains.food import heart_healthy

log = logging.getLogger(__name__)

# How many days each plan covers. Small = reliable to generate and realistic to
# shop for; bump if you ever want a longer look-ahead.
PLAN_DAYS = 3


def plan_start_for(date: Optional[str]) -> str:
    """The plan's start date — the given date, or today."""
    return date or _date.today().isoformat()


def _day_labels(start: str, n: int = PLAN_DAYS) -> list[str]:
    """Human day labels from the start date, e.g. ['Today', 'Tomorrow', 'Thu 14']."""
    d0 = _date.fromisoformat(start)
    out = []
    for i in range(n):
        d = d0 + timedelta(days=i)
        if i == 0:
            out.append("Today")
        elif i == 1:
            out.append("Tomorrow")
        else:
            out.append(d.strftime("%a %-d"))
    return out


def _build_prompt(target_kcal: Optional[float], protein_g: Optional[float],
                  labels: list[str], recent: list[str], preferences: Optional[str]) -> str:
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
    day_list = ", ".join(f'"{l}"' for l in labels)
    n = len(labels)
    return (
        "You are my nutrition coach. Plan my next few days of eating. I'm cutting "
        "body fat while training for a Half Ironman — I want lean, high-protein, "
        "whole foods, realistic home-cooked Spanish/Mediterranean meals.\n"
        f"{heart_healthy.guidance_directive()}\n"
        f"{budget}\n"
        f"{liked}{pref}\n\n"
        f"Give me exactly {n} days ({day_list}), each with breakfast, lunch, dinner "
        "and one snack. Reuse ingredients across days so the shopping list stays "
        "short and nothing is wasted. Then produce ONE small consolidated shopping "
        "list for these days, grouped by supermarket aisle, with rough quantities.\n\n"
        "Return ONLY JSON of this exact shape (no markdown, no code fences):\n"
        "{\n"
        '  "days": [\n'
        f'    {{"day":{labels[0]!r},"breakfast":{{"name":str,"kcal":number,"protein_g":number}},\n'
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
        f"Rules: exactly {n} day objects using these day labels in order: {day_list}. "
        "Per-day kcal/protein_g must be the sum of that day's meals. Quantities should "
        "be shopping-friendly (e.g. \"6 eggs\", \"500 g\", \"2 tins\", \"1 bag\"). "
        "Keep the list de-duplicated. One short encouraging note."
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


def generate(conn, start_date: str, target_kcal: Optional[float],
             protein_g: Optional[float], preferences: Optional[str] = None) -> Optional[dict]:
    if not ollama_client.is_available():
        log.info("meal planner: LLM unavailable, skipping")
        return None

    labels = _day_labels(start_date)
    recent = _recent_liked(conn, start_date)
    # Structured JSON — generate_json disables extended thinking by default, so the
    # full token budget goes to the plan (Sonnet otherwise burns it on thinking and
    # truncates the JSON). 3000 is ample headroom for a 3-day plan + shopping list.
    data = ollama_client.generate_json(
        _build_prompt(target_kcal, protein_g, labels, recent, preferences),
        model=ollama_client.CLAUDE_MODEL_SMART,
        max_tokens=3000,
    )
    if not data:
        log.warning("meal planner: model returned no usable JSON for %s", start_date)
        return None
    if "days" not in data:
        log.warning("meal planner: JSON missing 'days' key for %s (keys=%s)", start_date, list(data)[:6])
        return None

    model = ollama_client.CLAUDE_MODEL_SMART if \
        ollama_client.LLM_PROVIDER == "claude" else ollama_client.LLM_PROVIDER
    conn.execute(
        "INSERT INTO food_weekly_plans (week_start, plan_json, model) VALUES (?,?,?)",
        (start_date, json.dumps(data), model),
    )
    conn.commit()
    return data


def latest_for_start(conn, start_date: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT * FROM food_weekly_plans WHERE week_start=? "
        "ORDER BY generated_at DESC, id DESC LIMIT 1",
        (start_date,),
    ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "start_date": row["week_start"],
        "plan": json.loads(row["plan_json"]),
        "model": row["model"],
        "generated_at": row["generated_at"],
    }
