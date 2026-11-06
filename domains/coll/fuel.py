"""
A fuel plan for each Coll course, from what Daybook already knows — so the device's
"EAT NOW" / "DRINK NOW" reminders match the plan, not a guess.

Coll's format (firmware/lib/core/fuel.cpp): 'name:every_min[:carbs_g]' items, comma-separated.

Where it comes from, first match wins:
  1. the course's own override (typed on the Coll tab)
  2. a race course whose race has a nutrition plan → that plan's bike leg
  3. a planned session (or a race without a nutrition plan) → the same targets the plan card
     shows (fueling.session_fuel_targets: duration, zone, gut training ramp before the race,
     sweat rate), turned into reminders with your carb product from Nutrition
  4. the global default (Coll tab), else nothing (Coll keeps its own)

The carb product is the one picked on the Coll tab, else your first non-caffeinated gel.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date

PRODUCT_KEY = "coll_fuel_product"
SHORT = {"gel": "Gel", "chew": "Chews", "bar": "Bar", "drink_mix": "Bottle"}
RACE_FALLBACK_KMH = 20.0                  # no target time: a long-race riding speed


def _one(conn, sql, args=()):
    try:
        return conn.execute(sql, args).fetchone()
    except sqlite3.OperationalError:
        return None


def _all(conn, sql, args=()):
    try:
        return conn.execute(sql, args).fetchall()
    except sqlite3.OperationalError:
        return []


def products(conn) -> list[dict]:
    return [dict(r) for r in _all(conn, "SELECT id, name, kind, carbs_g, caffeine_mg, fluid_ml FROM nutrition_products "
                                        "WHERE archived=0 AND carbs_g > 0 ORDER BY id")]


def carb_product(conn) -> dict | None:
    items = products(conn)
    r = _one(conn, "SELECT value FROM app_settings WHERE key=?", (PRODUCT_KEY,))
    if r:
        for p in items:
            if str(p["id"]) == str(r[0]):
                return p
    gels = [p for p in items if p["kind"] == "gel" and not p["caffeine_mg"]]
    return (gels or items or [None])[0]


def item_name(p: dict) -> str:
    n = SHORT.get(p["kind"]) or p["name"].split()[0]
    return "".join(c for c in n if c not in ":,")[:16] or "Eat"


def reminders(carbs_g_h: int, fluid_ml_h: int, product: dict | None) -> tuple[str | None, str]:
    """(Coll plan, a line for people) for an hourly target."""
    parts, note = [], []
    if carbs_g_h > 0:
        carbs = (product or {}).get("carbs_g") or 25
        every = max(15, min(60, 5 * round(60 * carbs / carbs_g_h / 5)))
        name = item_name(product) if product else "Eat"
        parts.append(f"{name}:{every}:{round(carbs)}")
        note.append(f"{carbs_g_h} g/h · {product['name'] if product else 'something'} ({round(carbs)} g) "
                    f"every {every} min")
    if fluid_ml_h > 0:
        parts.append("Drink:20")
        note.append(f"sip ~{round(fluid_ml_h / 3 / 10) * 10} ml every 20 min ({fluid_ml_h} ml/h)")
    return (",".join(parts) or None), " · ".join(note)


def _sweat_rate(conn) -> float | None:
    r = _one(conn, "SELECT sweat_rate_l_h FROM sweat_tests WHERE sweat_rate_l_h IS NOT NULL "
                   "ORDER BY (conditions IN ('hot','humid')) DESC, date DESC LIMIT 1")
    return r[0] if r else None


def _weight(conn) -> float:
    r = _one(conn, "SELECT weight_kg FROM weight_log ORDER BY date DESC LIMIT 1")
    return r[0] if r else 85.0


def _weeks_to(race_date: str | None, on: str) -> int | None:
    if not race_date:
        return None
    return max(0, (date.fromisoformat(race_date[:10]) - date.fromisoformat(on[:10])).days // 7)


def _targets(conn, minutes: int, zone: str, discipline: str, weeks_to_race: int | None) -> dict:
    from domains.training import fueling
    return fueling.session_fuel_targets(minutes, zone or "Z2", discipline or "cycling", weeks_to_race=weeks_to_race,
                                        sweat_rate_l_h=_sweat_rate(conn), weight_kg=_weight(conn))["during"]


def _hms_min(t: str | None) -> int | None:
    try:
        parts = [int(x) for x in (t or "").split(":")]
    except ValueError:
        return None
    return parts[0] * 60 + parts[1] if len(parts) >= 2 else None


def for_course(conn, course: dict, default: str | None = None) -> dict:
    """{'fuel_plan', 'source', 'note'} for one coll_courses row (as a dict)."""
    if course.get("fuel_plan"):
        return {"fuel_plan": course["fuel_plan"], "source": "course", "note": "set on the Coll tab"}
    product = carb_product(conn)

    if course.get("goal_id"):
        n = _one(conn, "SELECT plan_json FROM race_nutrition_plans WHERE goal_id=?", (course["goal_id"],))
        if n:
            from domains.coll.settings import fuel_from_nutrition
            try:
                plan = fuel_from_nutrition(json.loads(n[0]))
            except (ValueError, TypeError, AttributeError):
                plan = None
            if plan:
                return {"fuel_plan": plan, "source": "race nutrition plan", "note": "bike leg of the race plan"}

    if course.get("session_id"):
        s = _one(conn, """SELECT p.session_date, p.discipline, p.intensity_zone,
                                 COALESCE(p.effective_duration_min, p.duration_min) AS minutes, g.race_date
                          FROM plan_sessions p LEFT JOIN race_goals g ON g.id = p.goal_id WHERE p.id=?""",
                 (course["session_id"],))
        if s and s["minutes"]:
            d = _targets(conn, s["minutes"], s["intensity_zone"], s["discipline"],
                         _weeks_to(s["race_date"], s["session_date"]))
            plan, note = reminders(d["carbs_g_h"], d["fluid_ml_h"], product)
            return {"fuel_plan": plan, "source": "planned session", "note": note}

    if course.get("goal_id"):
        g = _one(conn, "SELECT race_date, target_time FROM race_goals WHERE id=?", (course["goal_id"],))
        if g:
            km = course.get("km") or 0
            minutes = _hms_min(g["target_time"]) or round(km / RACE_FALLBACK_KMH * 60) or 600
            d = _targets(conn, minutes, "Z2", "cycling", 0)
            plan, note = reminders(d["carbs_g_h"], d["fluid_ml_h"], product)
            return {"fuel_plan": plan, "source": "race targets", "note": note}

    if default:
        return {"fuel_plan": default, "source": "default", "note": "the default from the Coll tab"}
    return {"fuel_plan": None, "source": None, "note": "no plan: Coll uses its own default"}


def set_product(conn, product_id: int | None) -> None:
    if product_id is None:
        conn.execute("DELETE FROM app_settings WHERE key=?", (PRODUCT_KEY,))
    else:
        if not _one(conn, "SELECT 1 FROM nutrition_products WHERE id=?", (product_id,)):
            raise ValueError("no such product")
        conn.execute("INSERT INTO app_settings (key, value) VALUES (?, ?) "
                     "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (PRODUCT_KEY, str(product_id)))
    conn.commit()
