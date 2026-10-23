"""
Claude-powered food analyzer: turn a text description and/or a photo into
calories + macros.

Text is the primary path; a photo is optional. Works from text alone, a photo
alone, or both. When the text reads like a crew meal (e.g. "duty meal: lasagna
and ham tapas with bread, yoghurt and pear"), the PMI crew-meal presets are
handed to the model so it reuses their stored macros instead of guessing.

Cost-tuned to Haiku (vision-capable, ~a fraction of a cent per photo). Degrades
gracefully to None if ANTHROPIC_API_KEY is unset, the SDK is missing, or a call
fails — callers then fall back to manual macro entry.
"""

import base64
import json
import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
# Sonnet: sharper macro estimates + heart-health judgement (saturated fat, fibre,
# processed-ness) than Haiku, still vision-capable. Override per-env if needed.
FOOD_VISION_MODEL = os.getenv("FOOD_VISION_MODEL", "claude-sonnet-5")


def is_available() -> bool:
    if not ANTHROPIC_API_KEY:
        return False
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        nl = t.find("\n")
        t = t[nl + 1:] if nl != -1 else t[3:]
        t = t.rstrip()
        if t.endswith("```"):
            t = t[:-3]
    return t.strip()


def _presets_block(presets: Optional[list]) -> str:
    """Render the PMI crew-meal catalog for the prompt (name + macros)."""
    if not presets:
        return ""
    lines = []
    for p in presets:
        lines.append(
            f"- {p['name']}: {round(p['kcal'])} kcal, "
            f"P {round(p['protein_g'])}g / C {round(p['carbs_g'])}g / F {round(p['fat_g'])}g"
        )
    return (
        "\nKnown PMI crew-meal items (if a logged item clearly matches one of "
        "these, use its exact macros rather than estimating):\n" + "\n".join(lines)
    )


_NUM = {"type": "number"}
_ITEM_FIELDS = ("kcal", "protein_g", "carbs_g", "fat_g", "saturated_fat_g", "fiber_g", "sugar_g")

# Structured output: the API guarantees the reply parses and matches this shape.
# Totals aren't asked for — they're summed from the items, so they always agree.
_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "grams": {"anyOf": [_NUM, {"type": "null"}]},
                    **{f: _NUM for f in _ITEM_FIELDS},
                },
                "required": ["name", "grams", *_ITEM_FIELDS],
                "additionalProperties": False,
            },
        },
        "heart_rating": {"type": "string", "enum": ["good", "ok", "limit", "avoid"]},
        "heart_note": {"type": "string"},
        "confidence": _NUM,
    },
    "required": ["items", "heart_rating", "heart_note", "confidence"],
    "additionalProperties": False,
}

_GUIDANCE = (
    'The description may be in English, Catalan or Spanish; name the items in the '
    'same language. Split a meal into one item per distinct food. '
    '"saturated_fat_g" is the saturated subset of fat_g; "sugar_g" the sugar '
    'subset of carbs. "confidence" is 0..1, your confidence in the estimate.\n'
    'Judge "heart_rating" as OVERALL healthiness, weighting saturated fat & fibre '
    'most heavily (the user has elevated LDL cholesterol) but also penalising added '
    'sugar, refined carbs, frying and heavy processing, and rewarding whole, '
    'minimally-processed foods: "good" = whole & nutrient-dense, low saturated fat '
    '& sugar, good fibre / unsaturated fats (veg, fruit, legumes, wholegrains, oily '
    'fish, olive oil, nuts); "limit"/"avoid" = high saturated fat, fried, sugary, '
    'refined or processed (fatty/processed meat, butter, cream, cheese, pastries, '
    'sweets, sugary drinks, white bread/rice). "heart_note" is one sentence: why, '
    're: cholesterol/LDL, and when limit/avoid, a concrete healthier swap.'
)


def analyze(
    text: Optional[str] = None,
    image_bytes: Optional[bytes] = None,
    presets: Optional[list] = None,
    model: Optional[str] = None,
) -> Optional[dict]:
    """Analyze food from text and/or a JPEG photo. Returns the parsed dict or None."""
    if not text and not image_bytes:
        return None
    if not ANTHROPIC_API_KEY:
        log.warning("food analyzer: ANTHROPIC_API_KEY not set")
        return None
    try:
        import anthropic
    except ImportError:
        log.warning("food analyzer: `anthropic` SDK not installed")
        return None

    prompt = (
        "You are a nutrition estimator. Estimate the calories and macronutrients "
        "of the food described"
        + (" and shown in the photo" if image_bytes else "")
        + ".\n"
    )
    if text:
        prompt += f"\nDescription: {text.strip()}\n"
    prompt += _presets_block(presets)
    prompt += "\n\n" + _GUIDANCE

    content: list = []
    if image_bytes:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": base64.standard_b64encode(image_bytes).decode("utf-8"),
            },
        })
    content.append({"type": "text", "text": prompt})

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        # max_tokens covers the model's thinking too — the old 1024 cap cut longer
        # meals off mid-JSON, which then failed to parse and fell back to zeros.
        resp = client.messages.create(
            model=model or FOOD_VISION_MODEL,
            max_tokens=16000,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": _SCHEMA}},
            messages=[{"role": "user", "content": content}],
        )
    except Exception as e:
        log.warning("food analyzer call failed: %s: %s", type(e).__name__, e)
        return None

    if resp.stop_reason != "end_turn":
        log.warning("food analyzer stopped early (%s) for: %s", resp.stop_reason, (text or "photo")[:80])
        return None
    raw = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        data = json.loads(_strip_fences(raw))
    except json.JSONDecodeError as e:
        log.warning("food analyzer returned invalid JSON: %s — raw: %s", e, raw[:200])
        return None

    items = data.get("items") or []
    for field in _ITEM_FIELDS:
        data[f"total_{field}"] = round(sum((it.get(field) or 0) for it in items), 1)
    return data
