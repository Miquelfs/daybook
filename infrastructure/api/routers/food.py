"""Food API router — dietary calorie + macro logging (the intake side).

Distinct from `/nutrition` (endurance race-fuelling). Pairs logged intake with the
energy-OUT side that already exists (Garmin daily_stats calories).
"""

import sqlite3
from datetime import date as _date
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from infrastructure.api.db import get_db
from infrastructure.api.image_utils import process_image_to_jpeg
from infrastructure.api.models.food import (
    CrewMealPreset,
    FoodEntryIn,
    FoodEntryOut,
    FoodEntryPatch,
    FoodTargetIn,
    WaterBody,
)
from domains.ai import ollama_client
from domains.food import analyzer, coach as coach_mod, meal_planner, targets as targets_mod

router = APIRouter(prefix="/food", tags=["food"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]

PHOTOS_DIR = Path(__file__).parents[3] / "data" / "photos"
FOOD_PHOTOS_DIR = PHOTOS_DIR / "food"
FOOD_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)


def _row_to_entry(row: sqlite3.Row) -> FoodEntryOut:
    photo_path = row["photo_path"]
    return FoodEntryOut(
        id=row["id"],
        date=row["date"],
        description=row["description"],
        meal_type=row["meal_type"],
        source=row["source"],
        photo_path=photo_path,
        photo_url=(f"/photos/{photo_path}" if photo_path else None),
        kcal=row["kcal"],
        protein_g=row["protein_g"],
        carbs_g=row["carbs_g"],
        fat_g=row["fat_g"],
        sugar_g=row["sugar_g"],
        ai_confidence=row["ai_confidence"],
        logged_at=row["logged_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── AI status & presets ───────────────────────────────────────────────────────

@router.get("/status")
def get_status():
    return {"provider": ollama_client.LLM_PROVIDER, "available": analyzer.is_available()}


@router.get("/presets", response_model=list[CrewMealPreset])
def list_presets(location: str = Query("PMI"), conn: DB = None):
    rows = conn.execute(
        "SELECT * FROM crew_meal_presets WHERE location=? ORDER BY category, name",
        (location,),
    ).fetchall()
    return [CrewMealPreset(**dict(r)) for r in rows]


# ── AI analyze (text and/or photo → proposed macros, no DB write) ─────────────

@router.post("/analyze")
async def analyze_food(
    text: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    conn: DB = None,
):
    image_bytes = None
    if file is not None:
        raw = await file.read()
        if raw:
            try:
                image_bytes = process_image_to_jpeg(raw)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))

    if not text and image_bytes is None:
        raise HTTPException(status_code=422, detail="Provide text and/or a photo")

    # Hand the PMI crew menu to the model only when there's text to match against.
    presets = None
    if text:
        rows = conn.execute(
            "SELECT name, kcal, protein_g, carbs_g, fat_g FROM crew_meal_presets WHERE location='PMI'"
        ).fetchall()
        presets = [dict(r) for r in rows]

    result = analyzer.analyze(text=text, image_bytes=image_bytes, presets=presets)
    if result is None:
        raise HTTPException(
            status_code=503,
            detail="AI analysis unavailable — enter macros manually.",
        )
    return result


# ── Entries CRUD ──────────────────────────────────────────────────────────────

@router.get("/recent")
def recent_foods(limit: int = Query(8, ge=1, le=30), conn: DB = None):
    """Distinct recently/frequently logged foods for one-tap re-logging (MFP-style)."""
    rows = conn.execute(
        """SELECT description, meal_type, kcal, protein_g, carbs_g, fat_g, sugar_g
           FROM food_entries
           WHERE id IN (SELECT MAX(id) FROM food_entries GROUP BY LOWER(TRIM(description)))
           ORDER BY (
               SELECT COUNT(*) FROM food_entries f2
               WHERE LOWER(TRIM(f2.description)) = LOWER(TRIM(food_entries.description))
           ) DESC, logged_at DESC
           LIMIT ?""",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/entries", response_model=list[FoodEntryOut])
def list_entries(
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    conn: DB = None,
):
    clauses, params = [], []
    if date:
        clauses.append("date=?")
        params.append(date)
    else:
        if date_from:
            clauses.append("date>=?")
            params.append(date_from)
        if date_to:
            clauses.append("date<=?")
            params.append(date_to)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM food_entries {where} ORDER BY date DESC, logged_at DESC, id DESC",
        params,
    ).fetchall()
    return [_row_to_entry(r) for r in rows]


@router.post("/entries", response_model=FoodEntryOut, status_code=201)
def create_entry(body: FoodEntryIn, conn: DB):
    if not body.description.strip():
        raise HTTPException(status_code=422, detail="Description is required")
    conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (body.date,))
    cur = conn.execute(
        """INSERT INTO food_entries
           (date, meal_type, description, source, kcal, protein_g, carbs_g, fat_g,
            sugar_g, ai_confidence, ai_raw_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (body.date, body.meal_type, body.description.strip(), body.source,
         body.kcal, body.protein_g, body.carbs_g, body.fat_g,
         body.sugar_g, body.ai_confidence, body.ai_raw_json),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM food_entries WHERE id=?", (cur.lastrowid,)).fetchone()
    return _row_to_entry(row)


@router.patch("/entries/{entry_id}", response_model=FoodEntryOut)
def update_entry(entry_id: int, body: FoodEntryPatch, conn: DB):
    existing = conn.execute("SELECT * FROM food_entries WHERE id=?", (entry_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Entry not found")
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return _row_to_entry(existing)
    set_clause = ", ".join(f"{k}=?" for k in updates)
    set_clause += ", updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    conn.execute(
        f"UPDATE food_entries SET {set_clause} WHERE id=?", [*updates.values(), entry_id]
    )
    conn.commit()
    row = conn.execute("SELECT * FROM food_entries WHERE id=?", (entry_id,)).fetchone()
    return _row_to_entry(row)


@router.delete("/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: int, conn: DB):
    row = conn.execute("SELECT photo_path FROM food_entries WHERE id=?", (entry_id,)).fetchone()
    if row and row["photo_path"]:
        (PHOTOS_DIR / row["photo_path"]).unlink(missing_ok=True)
    conn.execute("DELETE FROM food_entries WHERE id=?", (entry_id,))
    conn.commit()


@router.post("/entries/{entry_id}/photo", response_model=FoodEntryOut)
async def attach_photo(entry_id: int, file: UploadFile, conn: DB):
    row = conn.execute("SELECT id FROM food_entries WHERE id=?", (entry_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Entry not found")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        jpeg = process_image_to_jpeg(raw)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    rel = f"food/{entry_id}.jpg"
    (PHOTOS_DIR / rel).write_bytes(jpeg)
    conn.execute(
        "UPDATE food_entries SET photo_path=?, source='photo', "
        "updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
        (rel, entry_id),
    )
    conn.commit()
    out = conn.execute("SELECT * FROM food_entries WHERE id=?", (entry_id,)).fetchone()
    return _row_to_entry(out)


# ── Water ─────────────────────────────────────────────────────────────────────

def _water_ml(conn, date: str) -> float:
    row = conn.execute("SELECT ml FROM water_log WHERE date=?", (date,)).fetchone()
    return float(row["ml"]) if row and row["ml"] else 0.0


@router.get("/water")
def get_water(date: str = Query(...), conn: DB = None):
    return {"date": date, "ml": _water_ml(conn, date), "goal_ml": targets_mod.DEFAULT_WATER_GOAL_ML}


@router.post("/water")
def set_water(body: WaterBody, conn: DB):
    current = _water_ml(conn, body.date)
    if body.set_ml is not None:
        new_ml = max(0.0, body.set_ml)
    else:
        new_ml = max(0.0, current + (body.add_ml or 0))
    conn.execute(
        """INSERT INTO water_log (date, ml) VALUES (?, ?)
           ON CONFLICT(date) DO UPDATE SET ml=excluded.ml,
             updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')""",
        (body.date, new_ml),
    )
    conn.commit()
    return {"date": body.date, "ml": new_ml, "goal_ml": targets_mod.DEFAULT_WATER_GOAL_ML}


# ── Daily summary (intake vs target vs Garmin burn) ───────────────────────────

@router.get("/summary")
def daily_summary(date: str = Query(...), conn: DB = None):
    agg = conn.execute(
        """SELECT COUNT(*) AS n,
                  COALESCE(SUM(kcal),0)       AS kcal,
                  COALESCE(SUM(protein_g),0)  AS protein,
                  COALESCE(SUM(carbs_g),0)    AS carbs,
                  COALESCE(SUM(fat_g),0)      AS fat,
                  COALESCE(SUM(sugar_g),0)    AS sugar,
                  COALESCE(MAX(kcal),0)       AS biggest_meal
           FROM food_entries WHERE date=?""",
        (date,),
    ).fetchone()

    burn = conn.execute(
        "SELECT active_calories, total_calories FROM daily_stats WHERE date=?",
        (date,),
    ).fetchone()
    burned_active = burn["active_calories"] if burn else None
    burned_total = burn["total_calories"] if burn else None

    tgt = targets_mod.active_target(conn, date)
    target_kcal = tgt["target_kcal"] if tgt else None
    protein_target = tgt["protein_g"] if tgt else None

    consumed_kcal = round(agg["kcal"], 1)
    consumed_protein = round(agg["protein"], 1)

    return {
        "date": date,
        "entries_count": agg["n"],
        "consumed_kcal": consumed_kcal,
        "consumed_protein_g": consumed_protein,
        "consumed_carbs_g": round(agg["carbs"], 1),
        "consumed_fat_g": round(agg["fat"], 1),
        "consumed_sugar_g": round(agg["sugar"], 1),
        "biggest_meal_kcal": round(agg["biggest_meal"], 1),
        "target_kcal": target_kcal,
        "protein_target_g": protein_target,
        "remaining_kcal": (round(target_kcal - consumed_kcal, 1) if target_kcal is not None else None),
        "remaining_protein_g": (round(protein_target - consumed_protein, 1) if protein_target is not None else None),
        "burned_active_kcal": burned_active,
        "burned_total_kcal": burned_total,
        "net_vs_burn_kcal": (round(consumed_kcal - burned_total, 1) if burned_total else None),
        "water_ml": _water_ml(conn, date),
        "water_goal_ml": targets_mod.DEFAULT_WATER_GOAL_ML,
    }


# ── Targets ───────────────────────────────────────────────────────────────────

@router.get("/targets")
def get_targets(
    date: Optional[str] = Query(None),
    deficit: float = Query(targets_mod.DEFAULT_DEFICIT_KCAL),
    protein_per_kg: float = Query(targets_mod.DEFAULT_PROTEIN_PER_KG),
    conn: DB = None,
):
    return {
        "active": targets_mod.active_target(conn, date),
        "suggestion": targets_mod.suggest_target(conn, deficit, protein_per_kg),
    }


@router.put("/targets")
def put_targets(body: FoodTargetIn, conn: DB):
    eff = body.effective_date or _date.today().isoformat()
    saved = targets_mod.save_target(
        conn,
        effective_date=eff,
        target_kcal=body.target_kcal,
        protein_g=body.protein_g,
        maintenance_kcal=body.maintenance_kcal,
        deficit_kcal=body.deficit_kcal,
        basis_weight_kg=body.basis_weight_kg,
        method="manual",
        notes=body.notes,
    )
    return saved


# ── AI meal planning ──────────────────────────────────────────────────────────

@router.get("/meal-plan")
def get_meal_plan(date: str = Query(...), conn: DB = None):
    plan = meal_planner.latest_for_date(conn, date)
    if plan is None:
        raise HTTPException(status_code=404, detail="No meal plan for this date")
    return plan


def _remaining_budget(conn, date: str):
    """Remaining (kcal, protein_g) for the day, falling back to the suggestion."""
    summary = daily_summary(date=date, conn=conn)
    remaining_kcal = summary["remaining_kcal"]
    remaining_protein = summary["remaining_protein_g"]
    if remaining_kcal is None:
        sug = targets_mod.suggest_target(conn)
        if sug["target_kcal"] is None:
            raise HTTPException(status_code=422, detail="Set a target first (no Garmin data to suggest one)")
        remaining_kcal = sug["target_kcal"] - summary["consumed_kcal"]
        remaining_protein = (sug["protein_g"] or 0) - summary["consumed_protein_g"]
    return remaining_kcal, remaining_protein


@router.post("/meal-plan/generate")
def generate_meal_plan(
    date: str = Query(...),
    preferences: Optional[str] = Query(None),
    conn: DB = None,
):
    rk, rp = _remaining_budget(conn, date)
    plan = meal_planner.generate(conn, date, max(rk, 0), max(rp or 0, 0), preferences)
    if plan is None:
        raise HTTPException(status_code=503, detail="AI meal planning unavailable")
    return {"date": date, "plan": plan}


# ── AI coach (next meal + foods to flag) ──────────────────────────────────────

@router.get("/coach")
def get_coach(date: str = Query(...), conn: DB = None):
    result = coach_mod.latest(conn, date)
    if result is None:
        raise HTTPException(status_code=404, detail="No coach output for this date")
    return result


@router.post("/coach/generate")
def generate_coach(
    date: str = Query(...),
    preferences: Optional[str] = Query(None),
    conn: DB = None,
):
    rk, rp = _remaining_budget(conn, date)
    coach = coach_mod.generate(conn, date, max(rk, 0), max(rp or 0, 0), preferences)
    if coach is None:
        raise HTTPException(status_code=503, detail="AI coach unavailable")
    return {"date": date, "coach": coach}
