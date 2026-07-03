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
    "When did you feel most alive today?",
    "What part of today felt like the real you?",
    "What emotion showed up most today, and did you listen to it?",
    "What did your gut tell you today that you overrode with your head?",
    "What did you tolerate today that you shouldn't have?",
    "What's something you noticed about yourself today that you haven't noticed before?",

    # Decisions & judgment
    "What was the best decision you made today?",
    "If today repeated, what's the one thing you'd change?",
    "What decision are you postponing that you already know the answer to?",
    "Where did you say yes when you wanted to say no?",
    "What did you do today that you'll be glad you did in a year?",
    "Where did you spend attention today that didn't deserve it?",
    "What would the most disciplined version of you have done differently today?",
    "What was the smallest thing you did today that had the biggest impact?",
    "What risk did you take today — or avoid taking?",

    # Relationships & people
    "Who deserves a thank-you message you haven't sent?",
    "Who made today better just by being around?",
    "Is there someone you've been meaning to reconnect with?",
    "What did you give to someone today without being asked?",
    "Who did you show up for today, and was it enough?",
    "What did someone do today that you want to remember?",
    "Where could you have been more present with the people around you?",
    "Is there a relationship you've been neglecting?",

    # Body & aviation awareness
    "How did your body feel during the flight or work today — not the numbers, the feeling?",
    "Were there any signs of fatigue you pushed through that you shouldn't have?",
    "How well did you manage your energy across time zones or shift changes?",
    "What did you eat today, and did it serve you?",
    "How much water did you drink — honestly?",
    "How did your posture and tension feel at the end of the day?",
    "At what point today did fatigue start affecting your thinking?",
    "How aware were you of your own stress while it was happening today?",
    "What did your body need today that you didn't give it?",
    "How did the cockpit or workspace feel today — mentally, not just physically?",

    # Training & performance
    "What did you practise today, even for five minutes?",
    "Where did you push yourself today, and where did you hold back?",
    "What would a great training week look like from here?",
    "Did today's effort align with where you want to be in 6 months?",
    "What physical or mental skill are you quietly letting rust?",

    # Reflection & meaning
    "What moment from today do you want to remember?",
    "What was hard today that was worth being hard?",
    "If a close friend had lived your exact day, what advice would you give them?",
    "What are you looking forward to tomorrow?",
    "What would make tomorrow a 9 out of 10?",
    "What's one thing that happened today that you're grateful for?",
    "What small thing went better than expected?",
    "Was today a good use of your one wild and precious life?",
    "What did today teach you about what you actually value?",
    "What would you tell your past self about today?",
    "What's one thing you did today that future you will thank you for?",
    "What does today say about the kind of person you're becoming?",
    "What are you carrying from today that you should put down?",
    "If today had a title, what would it be?",

    # Growth & habits
    "What habit served you well today?",
    "What habit let you down today?",
    "What's one thing you keep saying you'll do — and haven't?",
    "Where did you choose comfort over growth today?",
    "What new thing did you try, or what did you do differently?",
    "What's one belief you tested today?",

    # Clarity & goals
    "How clear are you right now on what matters most this week?",
    "What's the one thing that would make this month feel successful?",
    "What are you optimising for right now — and is it the right thing?",
    "What's quietly draining your energy that you haven't addressed?",
    "What would you do tomorrow if you knew it would definitely work?",
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
