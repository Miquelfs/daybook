"""
Nutrition / fueling API — product library, fueling logs, sweat tests, and the
gut-training tracker. Prefix: /nutrition
"""

import json
import sqlite3
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from infrastructure.api.db import get_db
from domains.training import fueling

router = APIRouter(prefix="/nutrition", tags=["nutrition"])

DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _table(conn, name: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone())


# ── Products ─────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    name: str
    kind: str  # gel|drink_mix|bar|chew|real_food
    carbs_g: float
    sodium_mg: float = 0
    caffeine_mg: float = 0
    fluid_ml: float = 0
    glucose_fructose_ratio: Optional[str] = None
    notes: Optional[str] = None


class ProductPatch(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    carbs_g: Optional[float] = None
    sodium_mg: Optional[float] = None
    caffeine_mg: Optional[float] = None
    fluid_ml: Optional[float] = None
    glucose_fructose_ratio: Optional[str] = None
    notes: Optional[str] = None
    archived: Optional[bool] = None


def _product_out(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "name": r["name"], "kind": r["kind"],
        "carbs_g": r["carbs_g"], "sodium_mg": r["sodium_mg"],
        "caffeine_mg": r["caffeine_mg"], "fluid_ml": r["fluid_ml"],
        "glucose_fructose_ratio": r["glucose_fructose_ratio"],
        "notes": r["notes"], "archived": bool(r["archived"]),
    }


@router.get("/products")
def list_products(conn: DB, include_archived: bool = Query(False)):
    if not _table(conn, "nutrition_products"):
        return []
    where = "" if include_archived else "WHERE archived=0"
    rows = conn.execute(f"SELECT * FROM nutrition_products {where} ORDER BY kind, name").fetchall()
    return [_product_out(r) for r in rows]


@router.post("/products", status_code=201)
def create_product(body: ProductCreate, conn: DB):
    cur = conn.execute(
        """INSERT INTO nutrition_products
           (name, kind, carbs_g, sodium_mg, caffeine_mg, fluid_ml, glucose_fructose_ratio, notes)
           VALUES (?,?,?,?,?,?,?,?)""",
        (body.name, body.kind, body.carbs_g, body.sodium_mg, body.caffeine_mg,
         body.fluid_ml, body.glucose_fructose_ratio, body.notes),
    )
    conn.commit()
    r = conn.execute("SELECT * FROM nutrition_products WHERE id=?", (cur.lastrowid,)).fetchone()
    return _product_out(r)


@router.patch("/products/{product_id}")
def patch_product(product_id: int, body: ProductPatch, conn: DB):
    r = conn.execute("SELECT * FROM nutrition_products WHERE id=?", (product_id,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="product not found")
    updates, params = [], []
    for field in ("name", "kind", "carbs_g", "sodium_mg", "caffeine_mg", "fluid_ml",
                  "glucose_fructose_ratio", "notes"):
        val = getattr(body, field)
        if val is not None:
            updates.append(f"{field}=?")
            params.append(val)
    if body.archived is not None:
        updates.append("archived=?")
        params.append(1 if body.archived else 0)
    if updates:
        params.append(product_id)
        conn.execute(f"UPDATE nutrition_products SET {', '.join(updates)} WHERE id=?", params)
        conn.commit()
    r = conn.execute("SELECT * FROM nutrition_products WHERE id=?", (product_id,)).fetchone()
    return _product_out(r)


# ── Fueling logs ─────────────────────────────────────────────────────────────

class FuelingLogCreate(BaseModel):
    date: Optional[str] = None
    plan_session_id: Optional[int] = None
    activity_id: Optional[str] = None
    duration_min: Optional[int] = None
    carbs_g: Optional[float] = None
    fluids_ml: Optional[float] = None
    sodium_mg: Optional[float] = None
    caffeine_mg: Optional[float] = None
    gi_severity: Optional[int] = None  # 1 (none) .. 5 (severe)
    gi_notes: Optional[str] = None
    products: Optional[list] = None    # [{product_id, qty}]


def _log_out(r: sqlite3.Row) -> dict:
    carbs_h = None
    if r["carbs_g"] and r["duration_min"]:
        carbs_h = round(r["carbs_g"] / (r["duration_min"] / 60.0), 1)
    return {
        "id": r["id"], "date": r["date"], "plan_session_id": r["plan_session_id"],
        "activity_id": r["activity_id"], "duration_min": r["duration_min"],
        "carbs_g": r["carbs_g"], "carbs_g_h": carbs_h, "fluids_ml": r["fluids_ml"],
        "sodium_mg": r["sodium_mg"], "caffeine_mg": r["caffeine_mg"],
        "gi_severity": r["gi_severity"], "gi_notes": r["gi_notes"],
        "products": json.loads(r["products_json"]) if r["products_json"] else None,
    }


@router.get("/fueling-logs")
def list_fueling_logs(conn: DB, start: Optional[str] = Query(None), end: Optional[str] = Query(None),
                      session_id: Optional[int] = Query(None), activity_id: Optional[str] = Query(None)):
    if not _table(conn, "fueling_logs"):
        return []
    clauses, params = [], []
    if start:
        clauses.append("date >= ?"); params.append(start)
    if end:
        clauses.append("date <= ?"); params.append(end)
    if session_id:
        clauses.append("plan_session_id = ?"); params.append(session_id)
    if activity_id:
        clauses.append("activity_id = ?"); params.append(activity_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(f"SELECT * FROM fueling_logs {where} ORDER BY date DESC, id DESC", params).fetchall()
    return [_log_out(r) for r in rows]


@router.post("/fueling-logs", status_code=201)
def create_fueling_log(body: FuelingLogCreate, conn: DB):
    # Derive duration from the linked plan session if not given
    dur = body.duration_min
    if dur is None and body.plan_session_id:
        s = conn.execute(
            "SELECT effective_duration_min, duration_min FROM plan_sessions WHERE id=?",
            (body.plan_session_id,),
        ).fetchone()
        if s:
            dur = s["effective_duration_min"] or s["duration_min"]
    cur = conn.execute(
        """INSERT INTO fueling_logs
           (date, plan_session_id, activity_id, duration_min, carbs_g, fluids_ml,
            sodium_mg, caffeine_mg, gi_severity, gi_notes, products_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (body.date or date.today().isoformat(), body.plan_session_id, body.activity_id, dur,
         body.carbs_g, body.fluids_ml, body.sodium_mg, body.caffeine_mg,
         body.gi_severity, body.gi_notes,
         json.dumps(body.products) if body.products else None),
    )
    conn.commit()
    r = conn.execute("SELECT * FROM fueling_logs WHERE id=?", (cur.lastrowid,)).fetchone()
    return _log_out(r)


# ── Sweat tests ──────────────────────────────────────────────────────────────

class SweatTestCreate(BaseModel):
    date: Optional[str] = None
    sport: str
    duration_min: int
    temp_c: Optional[float] = None
    conditions: Optional[str] = None  # indoor|cool|warm|hot|humid
    weight_pre_kg: float
    weight_post_kg: float
    fluid_intake_ml: float = 0
    urine_ml: float = 0
    notes: Optional[str] = None


def _sweat_out(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "date": r["date"], "sport": r["sport"],
        "duration_min": r["duration_min"], "temp_c": r["temp_c"], "conditions": r["conditions"],
        "weight_pre_kg": r["weight_pre_kg"], "weight_post_kg": r["weight_post_kg"],
        "fluid_intake_ml": r["fluid_intake_ml"], "urine_ml": r["urine_ml"],
        "sweat_rate_l_h": r["sweat_rate_l_h"], "notes": r["notes"],
    }


@router.get("/sweat-tests")
def list_sweat_tests(conn: DB):
    if not _table(conn, "sweat_tests"):
        return []
    rows = conn.execute("SELECT * FROM sweat_tests ORDER BY date DESC, id DESC").fetchall()
    return [_sweat_out(r) for r in rows]


@router.post("/sweat-tests", status_code=201)
def create_sweat_test(body: SweatTestCreate, conn: DB):
    rate = fueling.sweat_rate(body.weight_pre_kg, body.weight_post_kg,
                              body.fluid_intake_ml, body.urine_ml, body.duration_min)
    cur = conn.execute(
        """INSERT INTO sweat_tests
           (date, sport, duration_min, temp_c, conditions, weight_pre_kg, weight_post_kg,
            fluid_intake_ml, urine_ml, sweat_rate_l_h, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (body.date or date.today().isoformat(), body.sport, body.duration_min, body.temp_c,
         body.conditions, body.weight_pre_kg, body.weight_post_kg, body.fluid_intake_ml,
         body.urine_ml, rate, body.notes),
    )
    conn.commit()
    r = conn.execute("SELECT * FROM sweat_tests WHERE id=?", (cur.lastrowid,)).fetchone()
    return {**_sweat_out(r), "hydration_target": fueling.hydration_target(rate)}


@router.get("/sweat-rate")
def sweat_rate_summary(conn: DB):
    """Average measured sweat rate overall and by conditions band."""
    if not _table(conn, "sweat_tests"):
        return {"overall": None, "by_conditions": []}
    rows = conn.execute(
        "SELECT conditions, sweat_rate_l_h FROM sweat_tests WHERE sweat_rate_l_h IS NOT NULL"
    ).fetchall()
    if not rows:
        return {"overall": None, "by_conditions": []}
    overall = round(sum(r["sweat_rate_l_h"] for r in rows) / len(rows), 2)
    by: dict[str, list] = {}
    for r in rows:
        by.setdefault(r["conditions"] or "unknown", []).append(r["sweat_rate_l_h"])
    bands = [{"conditions": k, "sweat_rate_l_h": round(sum(v) / len(v), 2), "n": len(v)}
             for k, v in sorted(by.items())]
    # Hottest-conditions rate drives race hydration planning
    hot = next((b for b in bands if b["conditions"] in ("hot", "humid")), None)
    return {"overall": overall, "by_conditions": bands,
            "race_planning_rate": (hot or {"sweat_rate_l_h": overall})["sweat_rate_l_h"]}


# ── Gut training tracker ─────────────────────────────────────────────────────

@router.get("/gut-training")
def gut_training(conn: DB, goal_id: int = Query(...)):
    """
    Per-week gut-training progression for a goal: the week's key long session,
    its carb target (ramping 60→90 g/h), and the best carbs/h actually logged.
    """
    goal = conn.execute(
        "SELECT race_date FROM race_goals WHERE id=?", (goal_id,)
    ).fetchone()
    if not goal:
        raise HTTPException(status_code=404, detail="goal not found")
    race_date = date.fromisoformat(goal["race_date"])

    # One qualifying long session per week (the longest brick/ride/run)
    rows = conn.execute(
        """SELECT id, session_date, week_number, session_type, discipline,
                  effective_duration_min, duration_min
           FROM plan_sessions WHERE goal_id=?
           ORDER BY week_number, COALESCE(effective_duration_min, duration_min) DESC""",
        (goal_id,),
    ).fetchall()

    best_by_week: dict[int, sqlite3.Row] = {}
    for r in rows:
        dur = r["effective_duration_min"] or r["duration_min"] or 0
        if fueling._is_gut_training_session(dur, r["discipline"]) and r["week_number"] not in best_by_week:
            best_by_week[r["week_number"]] = r

    out = []
    for week, s in sorted(best_by_week.items()):
        s_date = date.fromisoformat(s["session_date"])
        weeks_to_race = max(0, (race_date - s_date).days // 7)
        target = fueling.gut_training_target(weeks_to_race)
        logged = conn.execute(
            """SELECT MAX(carbs_g / (duration_min/60.0)) AS best_gh
               FROM fueling_logs WHERE plan_session_id=? AND carbs_g IS NOT NULL AND duration_min>0""",
            (s["id"],),
        ).fetchone()
        best_gh = round(logged["best_gh"], 1) if logged and logged["best_gh"] else None
        out.append({
            "week": week,
            "session_date": s["session_date"],
            "session_id": s["id"],
            "session_type": s["session_type"],
            "duration_min": s["effective_duration_min"] or s["duration_min"],
            "target_g_h": target,
            "best_logged_g_h": best_gh,
            "on_track": (best_gh is not None and best_gh >= target - 5),
        })
    return out
