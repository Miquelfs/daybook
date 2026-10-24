"""
Supermarket tickets that only exist as an email (El Corte Inglés, Supercor,
Hipercor…): read from phone screenshots with Claude vision.

One call takes every screenshot of one ticket (they may overlap — a long ticket
needs 2–3) and returns the header + one row per ticket line, plus for each
product a generic name and pack size so it can be compared with the same thing
bought elsewhere ("TOFU NATURAL 290G SP" → "tofu natural", 290 g).

The same strictness as the Mercadona parser applies: lines must add up to the
printed total, or the ticket is refused (usually a missing or doubled
screenshot) instead of storing wrong prices.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os

from domains.money.receipts import ReceiptParseError, check_total

log = logging.getLogger(__name__)

RECEIPT_VISION_MODEL = os.getenv("RECEIPT_VISION_MODEL", "claude-opus-5-5")
MAX_IMAGES = 8
_MEDIA = {b"\x89PNG": "image/png", b"\xff\xd8\xff": "image/jpeg", b"RIFF": "image/webp"}

_NUM = {"type": "number"}
_NULLNUM = {"anyOf": [_NUM, {"type": "null"}]}
_SCHEMA = {
    "type": "object",
    "properties": {
        "is_ticket": {"type": "boolean"},
        "store": {"type": "string"},
        "purchased_at": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "operation_no": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "total": _NULLNUM,
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "product": {"type": "string"},
                    "quantity": _NUM,
                    "weight_kg": _NULLNUM,
                    "unit_price": _NULLNUM,
                    "amount": _NUM,
                    "generic": {"type": "string"},
                    "pack_g": _NULLNUM,
                },
                "required": ["product", "quantity", "weight_kg", "unit_price", "amount", "generic", "pack_g"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["is_ticket", "store", "purchased_at", "operation_no", "total", "items"],
    "additionalProperties": False,
}

GENERIC_RULES = (
    '"generic" is the plain Spanish name of WHAT the product is, lower-case, without brand, size or '
    'store abbreviations, so the same thing from two supermarkets gets the same name: "TOFU NATURAL 290G SP" '
    '→ "tofu natural", "BANANA AUTOS. AUTOSERVICI" → "plátano", "LIMON GRANEL" → "limón", '
    '"CALDO POLLO BAJO SAL" → "caldo de pollo bajo en sal", "MARAVILLA GALLO PAQU" → "pasta maravilla", '
    '"GRIEGO LIGERO NAT" → "yogur griego ligero". Keep a distinguishing attribute when it changes the '
    'product (desnatado, sin lactosa, integral, bajo en sal), drop marketing words. '
    '"pack_g" is the pack size in grams (or ml for liquids, 1 l = 1000) when the name states it '
    '("290G" → 290, "1L" → 1000, "6X125G" → 750), else null — never guess a size that isn\'t printed.'
)

_PROMPT = (
    "These are screenshots of ONE supermarket ticket (an emailed purchase receipt, usually El Corte "
    "Inglés / Supercor / Hipercor, in Spanish). Extract it.\n"
    "- The screenshots may overlap: a line visible in two screenshots is ONE line — list it once. Two "
    "separate rows with the same product are two lines.\n"
    "- One item per product row. Sub-lines such as \"Precio Unitario 1,56 €/Kg.\" belong to the row "
    "above, never an item of their own.\n"
    "- Spanish decimals use commas: \"0,335\" is 0.335. \"product\" is the name exactly as printed.\n"
    "- Sold by weight (a quantity like \"0,335/Kg.\"): weight_kg = 0.335, unit_price = the €/kg, "
    "quantity = 1. Otherwise weight_kg = null, quantity = the units, unit_price = price per unit.\n"
    "- \"amount\" is the line TOTAL column; \"total\" is TOTAL COMPRA (or the ticket's final total).\n"
    "- purchased_at as \"YYYY-MM-DD HH:MM\" from Fecha / Hora; operation_no from Número de Operación.\n"
    "- store: the chain (\"El Corte Inglés\", \"Supercor\", \"Hipercor\", …).\n"
    "- If the images are not a purchase ticket, set is_ticket false and leave items empty.\n"
    + GENERIC_RULES
)


def _media_type(raw: bytes) -> str | None:
    return next((m for sig, m in _MEDIA.items() if raw.startswith(sig)), None)


def normalise_image(raw: bytes) -> tuple[bytes, str]:
    """PNG/JPEG/WebP pass through; anything else Pillow can open (HEIC…) becomes JPEG."""
    mt = _media_type(raw)
    if mt:
        return raw, mt
    try:
        from PIL import Image
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except ImportError:
            pass
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=90)
        return out.getvalue(), "image/jpeg"
    except Exception as e:
        raise ReceiptParseError("That isn't an image of a ticket") from e


def create(client, **kwargs):
    """messages.create with server-side refusal fallbacks; if this API/account
    rejects the fallback option (400), the same request goes out without it."""
    import anthropic
    try:
        return client.messages.create(
            **kwargs,
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            extra_body={"fallbacks": "default"},
        )
    except anthropic.BadRequestError as e:
        log.info("fallbacks not accepted (%s) — retrying without", e.message)
        return client.messages.create(**kwargs)


def _call_model(images: list[tuple[bytes, str]]) -> dict:
    """One vision call → the schema-shaped dict. Isolated so tests can stub it."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise ReceiptParseError("Reading screenshots needs ANTHROPIC_API_KEY on the Pi")
    import anthropic

    content: list = [
        {"type": "image", "source": {"type": "base64", "media_type": mt,
                                     "data": base64.standard_b64encode(raw).decode()}}
        for raw, mt in images
    ]
    content.append({"type": "text", "text": _PROMPT})
    client = anthropic.Anthropic(api_key=api_key)
    try:
        resp = create(
            client,
            model=RECEIPT_VISION_MODEL,
            max_tokens=16000,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": _SCHEMA}},
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.APIConnectionError as e:
        raise ReceiptParseError("Couldn't reach Claude to read the screenshots — try again") from e
    except anthropic.RateLimitError as e:
        raise ReceiptParseError("Claude is busy — try again in a minute") from e
    except anthropic.APIStatusError as e:
        log.warning("receipt vision call failed: %s %s", e.status_code, e.message)
        raise ReceiptParseError(f"Couldn't read the screenshots ({e.status_code})") from e
    if resp.stop_reason != "end_turn":
        raise ReceiptParseError(f"Couldn't read the screenshots ({resp.stop_reason})")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ReceiptParseError("Couldn't read the screenshots — try again") from e


def parse_screenshots(images: list[bytes]) -> dict:
    """Screenshots of one emailed ticket → the same shape parse_mercadona returns,
    with "generic" / "pack_g" on each item."""
    if not images:
        raise ReceiptParseError("No screenshots")
    if len(images) > MAX_IMAGES:
        raise ReceiptParseError(f"At most {MAX_IMAGES} screenshots per ticket")
    data = _call_model([normalise_image(raw) for raw in images])
    if not data.get("is_ticket") or not data.get("items"):
        raise ReceiptParseError("That doesn't look like a supermarket ticket")
    total = data.get("total")
    if total is None:
        raise ReceiptParseError("Couldn't find the ticket total — include the screenshot with TOTAL COMPRA")

    items = []
    for n, it in enumerate(data["items"], start=1):
        weight = it.get("weight_kg") or None
        qty = it.get("quantity") or 1
        amount = round(float(it["amount"]), 2)
        unit = it.get("unit_price")
        if unit is None:
            unit = round(amount / weight, 2) if weight else round(amount / qty, 2)
        items.append({
            "line_no": n, "product": it["product"].strip(), "quantity": 1.0 if weight else float(qty),
            "weight_kg": weight, "unit_price": unit, "amount": amount,
            "generic": (it.get("generic") or "").strip().lower() or None, "pack_g": it.get("pack_g") or None,
        })
    check_total(items, float(total), " — a screenshot missing or repeated? Send the whole product list")
    return {
        "store": (data.get("store") or "El Corte Inglés").strip(),
        "purchased_at": data.get("purchased_at"),
        "invoice_no": data.get("operation_no"),
        "total": round(float(total), 2),
        "items": items,
    }
