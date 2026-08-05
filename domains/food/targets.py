"""
Daily calorie/protein targets — auto-suggested from data you already have,
but fully editable.

The *suggestion* uses your real Garmin expenditure (trailing average of
daily_stats.total_calories) as maintenance, minus a deficit you choose, and a
protein floor of protein_per_kg × your latest logged bodyweight. `PUT /food/targets`
persists a manual override that wins over the suggestion.
"""

from typing import Optional

DEFAULT_DEFICIT_KCAL = 500      # you can pick anything; this is just the suggestion
DEFAULT_PROTEIN_PER_KG = 2.0    # g per kg bodyweight
DEFAULT_WATER_GOAL_ML = 3000    # daily hydration target (endurance training → higher)


def _latest_weight_kg(conn) -> Optional[float]:
    row = conn.execute(
        "SELECT weight_kg FROM weight_log WHERE weight_kg IS NOT NULL "
        "ORDER BY date DESC LIMIT 1"
    ).fetchone()
    return row["weight_kg"] if row else None


def maintenance_kcal(conn, days: int = 14) -> Optional[float]:
    """Trailing average of Garmin total daily expenditure (real, not a BMR formula)."""
    row = conn.execute(
        """SELECT AVG(total_calories) AS avg_kcal
           FROM (
               SELECT total_calories FROM daily_stats
               WHERE total_calories IS NOT NULL AND total_calories > 0
               ORDER BY date DESC LIMIT ?
           )""",
        (days,),
    ).fetchone()
    return round(row["avg_kcal"]) if row and row["avg_kcal"] else None


def suggest_target(
    conn,
    deficit_kcal: float = DEFAULT_DEFICIT_KCAL,
    protein_per_kg: float = DEFAULT_PROTEIN_PER_KG,
) -> dict:
    """A starting suggestion. Every field is overridable via save_target()."""
    maint = maintenance_kcal(conn)
    weight = _latest_weight_kg(conn)
    target_kcal = round(maint - deficit_kcal) if maint else None
    protein_g = round(protein_per_kg * weight) if weight else None
    return {
        "maintenance_kcal": maint,
        "deficit_kcal": deficit_kcal,
        "target_kcal": target_kcal,
        "protein_g": protein_g,
        "basis_weight_kg": weight,
        "protein_per_kg": protein_per_kg,
        "method": "auto",
    }


def active_target(conn, on_date: Optional[str] = None) -> Optional[dict]:
    """The most recent target whose effective_date <= on_date (defaults to today)."""
    if on_date:
        row = conn.execute(
            "SELECT * FROM food_targets WHERE effective_date <= ? "
            "ORDER BY effective_date DESC, id DESC LIMIT 1",
            (on_date,),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT * FROM food_targets ORDER BY effective_date DESC, id DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def save_target(
    conn,
    effective_date: str,
    target_kcal: float,
    protein_g: float,
    maintenance_kcal: Optional[float] = None,
    deficit_kcal: Optional[float] = None,
    basis_weight_kg: Optional[float] = None,
    method: str = "manual",
    notes: Optional[str] = None,
) -> dict:
    cur = conn.execute(
        """INSERT INTO food_targets
           (effective_date, maintenance_kcal, deficit_kcal, target_kcal,
            protein_g, basis_weight_kg, method, notes)
           VALUES (?,?,?,?,?,?,?,?)""",
        (effective_date, maintenance_kcal, deficit_kcal, target_kcal,
         protein_g, basis_weight_kg, method, notes),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM food_targets WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)
