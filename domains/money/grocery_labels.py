"""
A generic name + pack size for every product on a ticket, so the same thing
bought at two supermarkets can be compared: "TOFU NATURAL 290G SP" (El Corte
Inglés) and "TOFU NATURAL" (Mercadona) are both "tofu natural".

Screenshot tickets come labelled from the vision call; PDF tickets (Mercadona)
get labelled here in one text call for every product that has no label yet —
after attaching a ticket, and nightly as a catch-up. Labels live in
grocery_products (generic, pack_g), next to the user's type/avoid overrides,
and are editable the same way.

CLI:  python -m domains.money.grocery_labels           # label what's missing
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys

from domains.money.receipt_vision import GENERIC_RULES, RECEIPT_VISION_MODEL, create

log = logging.getLogger(__name__)
BATCH = 80

_SCHEMA = {
    "type": "object",
    "properties": {
        "labels": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "product": {"type": "string"},
                    "generic": {"type": "string"},
                    "pack_g": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                },
                "required": ["product", "generic", "pack_g"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["labels"],
    "additionalProperties": False,
}


def save(conn: sqlite3.Connection, labels: list[dict]) -> int:
    """Store generic/pack_g per product; never overwrites a label already set."""
    n = 0
    for lb in labels:
        if not lb.get("product") or not lb.get("generic"):
            continue
        conn.execute("INSERT OR IGNORE INTO grocery_products (product) VALUES (?)", (lb["product"],))
        n += conn.execute(
            "UPDATE grocery_products SET generic=?, pack_g=? WHERE product=? AND generic IS NULL",
            (lb["generic"].strip().lower(), lb.get("pack_g"), lb["product"]),
        ).rowcount
    conn.commit()
    return n


def missing(conn: sqlite3.Connection) -> list[str]:
    return [r[0] for r in conn.execute(
        """SELECT DISTINCT i.product FROM receipt_items i
           LEFT JOIN grocery_products g ON g.product = i.product
           WHERE g.generic IS NULL ORDER BY i.product""")]


def _call_model(products: list[str]) -> list[dict]:
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return []
    import anthropic

    prompt = ("Supermarket ticket product names (Spanish, abbreviated as printed). For each one give "
              "\"generic\" and \"pack_g\".\n" + GENERIC_RULES + "\n\nProducts:\n" + "\n".join(products))
    try:
        resp = create(
            anthropic.Anthropic(api_key=api_key),
            model=RECEIPT_VISION_MODEL,
            max_tokens=16000,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": _SCHEMA}},
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIError as e:
        log.warning("grocery labelling failed: %s", e)
        return []
    if resp.stop_reason != "end_turn":
        return []
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        return json.loads(text).get("labels") or []
    except json.JSONDecodeError:
        return []


def label_missing(conn: sqlite3.Connection, call=_call_model) -> int:
    todo = missing(conn)
    done = 0
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        wanted = set(chunk)
        done += save(conn, [lb for lb in call(chunk) if lb.get("product") in wanted])
    return done


def main() -> None:
    from infrastructure.db.money_connection import get_money_connection
    conn = get_money_connection()
    print(f"labelled {label_missing(conn)} products ({len(missing(conn))} still unlabelled)", file=sys.stderr)


if __name__ == "__main__":
    main()
