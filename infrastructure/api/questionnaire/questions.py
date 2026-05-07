"""
Evening questionnaire design for Daybook.

Structure (inspired by Whoop journal but more personal and reflective):

CORE — asked every evening, always. Short, fast. Target: under 30 seconds.
  1. Energy (1-10 slider)
  2. Mood (1-10 slider)
  3. Stress (1-10 slider)
  4. Sleep quality last night (1-10 — asked before showing Garmin sleep data)
  5. Alcohol today? (yes/no)
  6. Did you exercise? (yes/no — cross-reference with Garmin activities)

ROTATING — one question per day, deterministic by date hash.
  Reflective, open-ended, one-sentence answer.
  Covers: self-awareness, decision quality, relationships, aviation, body awareness.

The rotating question is selected by:
    index = int(hashlib.md5(date.encode()).hexdigest(), 16) % len(ROTATING_QUESTIONS)

This guarantees the same question all day but variety across days.
"""

from __future__ import annotations
import hashlib

# ─── Core questions (shown every evening) ────────────────────────────────────

CORE_QUESTIONS: list[dict] = [
    {
        "id": "energy",
        "text": "How was your energy today?",
        "type": "scale",          # 1-10
        "field": "energy",
    },
    {
        "id": "mood",
        "text": "How was your mood?",
        "type": "scale",
        "field": "mood",
    },
    {
        "id": "stress",
        "text": "How stressed did you feel?",
        "type": "scale",
        "field": "stress",
    },
    {
        "id": "sleep_quality",
        "text": "How was last night's sleep — before you see the data?",
        "type": "scale",
        "field": "sleep_quality",
        "hint": "Answer from memory first, then we'll show you what Garmin recorded.",
    },
    {
        "id": "alcohol",
        "text": "Did you drink alcohol today?",
        "type": "boolean",
        "tag": "alcohol",         # stored as a tag in days.tags
    },
    {
        "id": "exercised",
        "text": "Did you exercise today?",
        "type": "boolean",
        "tag": "exercise",        # cross-checked against activities table
    },
]

# ─── Rotating reflective questions (one per day) ─────────────────────────────

ROTATING_QUESTIONS: list[str] = [
    # Self-awareness
    "What did you avoid today that you shouldn't have?",
    "What surprised you today?",
    "What were you most distracted by?",
    "At what point today did you feel most like yourself?",
    "What assumption did you carry into today that turned out to be wrong?",
    "What did you learn today — about the world or about yourself?",
    "What conversation do you keep having in your head that you haven't had out loud?",

    # Decisions & judgment
    "What was the best decision you made today?",
    "If today repeated, what's the one thing you'd change?",
    "What decision are you postponing that you already know the answer to?",
    "Where did you say yes when you wanted to say no?",
    "What did you do today that you'll be glad you did in a year?",

    # Relationships & people
    "Who deserves a thank-you message you haven't sent?",
    "Who made today better just by being around?",
    "Is there someone you've been meaning to reconnect with?",
    "What did you give to someone today without being asked?",

    # Body & aviation awareness
    "How did your body feel during the flight or work today — not the numbers, the feeling?",
    "Were there any signs of fatigue you pushed through that you shouldn't have?",
    "How well did you manage your energy across time zones or shift changes?",
    "What did you eat today, and did it serve you?",
    "How much water did you drink — honestly?",
    "How did your posture and tension feel at the end of the day?",

    # Reflection & meaning
    "What moment from today do you want to remember?",
    "What was hard today that was worth being hard?",
    "If a close friend had lived your exact day, what advice would you give them?",
    "What are you looking forward to tomorrow?",
    "What would make tomorrow a 9 out of 10?",
    "What's one thing that happened today that you're grateful for?",
    "What small thing went better than expected?",
    "Was today a good use of your one wild and precious life?",
]


def get_rotating_question(date: str) -> dict:
    """
    Deterministically pick one rotating question for a given date.
    Same question all day; different questions across days.
    """
    idx = int(hashlib.md5(date.encode()).hexdigest(), 16) % len(ROTATING_QUESTIONS)
    return {
        "id": "daily_question",
        "text": ROTATING_QUESTIONS[idx],
        "type": "text",
        "field": "daily_answer",
        "question_stored_in": "daily_question",
    }


def get_questionnaire(date: str) -> dict:
    """Full questionnaire for a given date: core + one rotating question."""
    return {
        "date": date,
        "core": CORE_QUESTIONS,
        "rotating": get_rotating_question(date),
    }
