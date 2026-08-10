"""
AI food coach — the richer "what to eat next".

Beyond a generic meal list, this returns:
- next_meal: the single best thing to eat now to hit the remaining budget
- alternatives: a couple of swaps
- avoid: recurring foods (from YOUR recent logs) that work against fat-loss or
  the protein goal, each flagged with a reason + a healthier swap
- tip: one short coaching line

Inspired by MyFitnessPal / MacroFactor / Cronometer coaching patterns, but
grounded in what you actually eat. Degrades to None when the LLM is unavailable.
"""

import json
import logging
from datetime import date as _date, timedelta
from typing import Optional

from domains.ai import ollama_client

log = logging.getLogger(__name__)


def recent_profile(conn, on_date: str, days: int = 14) -> list[dict]:
    """Aggregate the foods eaten over the last `days` by name (for the avoid analysis)."""
    start = (_date.fromisoformat(on_date) - timedelta(days=days)).isoformat()
    rows = conn.execute(
        """SELECT TRIM(description) AS description,
                  COUNT(*)          AS n,
                  ROUND(AVG(kcal))       AS kcal,
                  ROUND(AVG(protein_g))  AS protein_g,
                  ROUND(AVG(sugar_g))    AS sugar_g
           FROM food_entries
           WHERE date BETWEEN ? AND ?
           GROUP BY LOWER(TRIM(description))
           ORDER BY n DESC, MAX(date) DESC
           LIMIT 20""",
        (start, on_date),
    ).fetchall()
    return [dict(r) for r in rows]


def today_items(conn, date: str) -> list[dict]:
    """What's already been eaten today — grounds the suggestion in the real day."""
    rows = conn.execute(
        "SELECT meal_type, description, ROUND(kcal) AS kcal, ROUND(protein_g) AS protein_g "
        "FROM food_entries WHERE date=? ORDER BY COALESCE(eaten_at, logged_at)",
        (date,),
    ).fetchall()
    return [dict(r) for r in rows]


def crew_presets(conn, limit: int = 25) -> list[dict]:
    """Duty-day crew meals available as realistic options."""
    try:
        rows = conn.execute(
            "SELECT name, ROUND(kcal) AS kcal, ROUND(protein_g) AS protein_g "
            "FROM crew_meal_presets ORDER BY protein_g DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


_MEAL_WORD = {
    "breakfast": "breakfast", "lunch": "lunch", "dinner": "dinner",
    "snack": "a snack", "extra": "an extra bite",
}


def _prompt(remaining_kcal: float, remaining_protein: float, profile: list[dict],
            eaten: list[dict], presets: list[dict], meal_type: Optional[str],
            preferences: Optional[str]) -> str:
    recent = "\n".join(
        f"- {r['description']} (eaten {r['n']}x; ~{int(r['kcal'] or 0)} kcal, "
        f"{int(r['protein_g'] or 0)}g protein, {int(r['sugar_g'] or 0)}g sugar)"
        for r in profile
    ) or "(no recent history yet)"
    today = "\n".join(
        f"- {r.get('meal_type') or 'meal'}: {r['description']} "
        f"(~{int(r['kcal'] or 0)} kcal, {int(r['protein_g'] or 0)}g protein)"
        for r in eaten
    ) or "(nothing logged yet today)"
    preset_lines = "\n".join(
        f"- {p['name']} (~{int(p['kcal'] or 0)} kcal, {int(p['protein_g'] or 0)}g protein)"
        for p in presets[:15]
    ) or "(none)"
    meal_line = (
        f"Plan specifically for {_MEAL_WORD.get(meal_type, meal_type)}."
        if meal_type else "Plan the single best next thing to eat now."
    )
    pref = f"\nExtra request: {preferences.strip()}" if preferences else ""
    return (
        "You are my nutrition coach. I'm cutting body fat while training for a Half "
        "Ironman — I want lean, high-protein, whole foods, realistic portions.\n"
        f"{meal_line}\n"
        f"Budget left for the rest of today: ~{round(remaining_kcal)} kcal and "
        f"~{round(remaining_protein)} g protein.{pref}\n\n"
        "Already eaten today:\n" + today + "\n\n"
        "Foods I eat often (last 14 days):\n" + recent + "\n\n"
        "Crew meals available on duty days:\n" + preset_lines + "\n\n"
        "Return ONLY JSON of this exact shape:\n"
        '{\n'
        '  "meal_type": str,\n'
        '  "next_meal": {"name": str, "kcal": number, "protein_g": number, "why": str},\n'
        '  "alternatives": [{"name": str, "kcal": number, "protein_g": number}],\n'
        '  "avoid": [{"item": str, "reason": str, "swap": str}],\n'
        '  "tip": str\n'
        '}\n'
        "Rules: next_meal must fit the remaining budget and prioritise protein. Give me "
        "VARIETY — do NOT suggest anything I already ate today, and avoid repeating the "
        "foods at the TOP of my recent list (I eat those too often); introduce something "
        "different that still fits my lean, high-protein goal. Crew meals are fair game on "
        "duty days. Give realistic kcal/protein numbers. For \"avoid\", pick up to 3 items "
        "FROM my recent foods that hurt fat-loss or protein (calorie-dense, low-protein, or "
        "high-sugar) with a reason and a healthier swap. Make the 1-2 alternatives genuinely "
        "different from next_meal. One-sentence tip. No markdown, no code fences."
    )


def generate(
    conn,
    date: str,
    remaining_kcal: float,
    remaining_protein: float,
    preferences: Optional[str] = None,
    meal_type: Optional[str] = None,
) -> Optional[dict]:
    if not ollama_client.is_available():
        log.info("food coach: LLM unavailable, skipping")
        return None
    profile = recent_profile(conn, date)
    data = ollama_client.generate_json(
        _prompt(max(remaining_kcal, 0), max(remaining_protein or 0, 0), profile,
                today_items(conn, date), crew_presets(conn), meal_type, preferences)
    )
    if not data:
        return None
    data.setdefault("meal_type", meal_type or "next")
    model = getattr(ollama_client, "CLAUDE_MODEL", None) if \
        ollama_client.LLM_PROVIDER == "claude" else ollama_client.LLM_PROVIDER
    conn.execute(
        "INSERT INTO food_coach (date, coach_json, model) VALUES (?,?,?)",
        (date, json.dumps(data), model),
    )
    conn.commit()
    return data


def latest(conn, date: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT * FROM food_coach WHERE date=? ORDER BY generated_at DESC, id DESC LIMIT 1",
        (date,),
    ).fetchone()
    if not row:
        return None
    return {
        "date": date,
        "coach": json.loads(row["coach_json"]),
        "model": row["model"],
        "generated_at": row["generated_at"],
    }
