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


def _prompt(remaining_kcal: float, remaining_protein: float, profile: list[dict],
            preferences: Optional[str]) -> str:
    lines = "\n".join(
        f"- {r['description']} (eaten {r['n']}x; ~{int(r['kcal'] or 0)} kcal, "
        f"{int(r['protein_g'] or 0)}g protein, {int(r['sugar_g'] or 0)}g sugar)"
        for r in profile
    ) or "(no recent history yet)"
    pref = f"\nPreferences: {preferences.strip()}" if preferences else ""
    return (
        "I'm cutting body fat while training for a Half Ironman — I want lean, "
        "high-protein, whole foods.\n"
        f"For the rest of today I have about {round(remaining_kcal)} kcal and "
        f"{round(remaining_protein)} g protein left.{pref}\n\n"
        "Foods I've eaten recently:\n" + lines + "\n\n"
        "Return ONLY JSON of this exact shape:\n"
        '{\n'
        '  "next_meal": {"name": str, "kcal": number, "protein_g": number, "why": str},\n'
        '  "alternatives": [{"name": str, "kcal": number, "protein_g": number}],\n'
        '  "avoid": [{"item": str, "reason": str, "swap": str}],\n'
        '  "tip": str\n'
        '}\n'
        "next_meal must fit the remaining budget and prioritise protein. "
        "For \"avoid\", pick up to 3 items FROM my recent foods above that hurt fat-loss "
        "or my protein goal (calorie-dense, low-protein, or high-sugar) — give a short "
        "reason and a healthier swap. 1-2 alternatives. Keep the tip to one sentence. "
        "No markdown, no code fences."
    )


def generate(
    conn,
    date: str,
    remaining_kcal: float,
    remaining_protein: float,
    preferences: Optional[str] = None,
) -> Optional[dict]:
    if not ollama_client.is_available():
        log.info("food coach: LLM unavailable, skipping")
        return None
    profile = recent_profile(conn, date)
    data = ollama_client.generate_json(
        _prompt(max(remaining_kcal, 0), max(remaining_protein or 0, 0), profile, preferences)
    )
    if not data:
        return None
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
