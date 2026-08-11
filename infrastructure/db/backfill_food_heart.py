"""
Backfill the cholesterol rating on food_entries logged before the heart-health
columns existed, so the whole history is colour-coded (not just new entries).

Uses the heuristic (name + macros) since older rows have no saturated-fat/fibre
estimate. Idempotent — only touches rows with no heart_rating yet.

Run once on the Pi (venv):
    .venv/bin/python -m infrastructure.db.backfill_food_heart
"""

import sys

from infrastructure.db.connection import get_connection
from domains.food import heart_healthy


def main() -> None:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, description, kcal, fat_g, saturated_fat_g, fiber_g, sugar_g "
        "FROM food_entries WHERE heart_rating IS NULL OR heart_rating = ''"
    ).fetchall()
    n = 0
    for r in rows:
        a = heart_healthy.assess(
            r["description"], r["kcal"] or 0, r["fat_g"],
            r["saturated_fat_g"], r["fiber_g"], r["sugar_g"],
        )
        conn.execute(
            "UPDATE food_entries SET heart_rating=?, heart_note=COALESCE(heart_note, ?) WHERE id=?",
            (a["rating"], a["note"], r["id"]),
        )
        n += 1
    conn.commit()
    conn.close()
    print(f"Rated {n} existing food entry(ies).", file=sys.stderr)


if __name__ == "__main__":
    main()
