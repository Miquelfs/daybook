"""
Vehicles (car, scooter…): odometer, costs from expenses, routes from GPS (domains/vehicles/).

  GET    /vehicles                       every vehicle with this year's km / cost / €/km
  POST   /vehicles                       add one
  GET    /vehicles/subcategories         Transportation subcategories (to say which are a vehicle's)
  GET    /vehicles/{id}                  the full summary (?months=12)
  PATCH  /vehicles/{id}
  DELETE /vehicles/{id}                  (its expenses stay; they just lose the link)
  GET    /vehicles/{id}/odometer         readings
  POST   /vehicles/{id}/odometer         {date, km, note}
  DELETE /vehicles/{id}/odometer/{rid}
  GET    /vehicles/{id}/costs            its expenses (newest first)
  POST   /vehicles/{id}/costs            log an expense for it (a Transportation transaction)
  GET    /vehicles/{id}/days             days used, from GPS (?limit=)
  GET    /vehicles/{id}/days/{date}      that day's route
  POST   /vehicles/{id}/refresh          recompute routes now (?all=true)
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import date as _date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from domains.vehicles import garage, routes
from infrastructure.api.db_money import get_money_db

router = APIRouter(prefix="/vehicles", tags=["vehicles"])
DB = Annotated[sqlite3.Connection, Depends(get_money_db)]


def _vehicle(conn: sqlite3.Connection, vid: int) -> sqlite3.Row:
    v = conn.execute("SELECT * FROM vehicles WHERE id=?", (vid,)).fetchone()
    if not v:
        raise HTTPException(404, "Vehicle not found")
    return v


class VehicleBody(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    make_model: Optional[str] = None
    plate: Optional[str] = None
    year: Optional[int] = None
    fuel: Optional[str] = None
    bought_on: Optional[str] = None
    bought_km: Optional[float] = None
    bought_price: Optional[float] = None
    sold_on: Optional[str] = None
    day_tag: Optional[str] = None
    subcategories: Optional[list[str]] = None
    notes: Optional[str] = None


_COLS = ("name", "kind", "make_model", "plate", "year", "fuel", "bought_on", "bought_km", "bought_price",
         "sold_on", "day_tag", "subcategories", "notes")


@router.get("")
def list_vehicles(conn: DB):
    return garage.overview(conn)


@router.post("", status_code=201)
def create_vehicle(body: VehicleBody, conn: DB):
    if not (body.name or "").strip():
        raise HTTPException(422, "Give it a name")
    kind = body.kind if body.kind in garage.KINDS else "car"
    tag = body.day_tag if body.day_tag is not None else garage.DEFAULT_TAG.get(kind)
    cur = conn.execute(
        """INSERT INTO vehicles (name, kind, make_model, plate, year, fuel, bought_on, bought_km, bought_price,
                                 sold_on, day_tag, subcategories, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (body.name.strip(), kind, body.make_model, body.plate, body.year, body.fuel, body.bought_on, body.bought_km,
         body.bought_price, body.sold_on, tag or None, json.dumps(body.subcategories or []), body.notes),
    )
    conn.commit()
    vid = cur.lastrowid
    if tag:
        routes.refresh(conn, vid)
    return garage.vehicle_out(_vehicle(conn, vid))


@router.get("/subcategories")
def transport_subcategories(conn: DB):
    rows = conn.execute(
        """SELECT TRIM(subcategory) s, COUNT(*) n, ROUND(-SUM(amount),2) total, MAX(date) last
           FROM transactions WHERE deleted_at IS NULL AND category='Transportation'
             AND subcategory IS NOT NULL AND TRIM(subcategory) != ''
           GROUP BY LOWER(TRIM(subcategory)) ORDER BY n DESC""").fetchall()
    return [{"subcategory": r["s"], "count": r["n"], "total": r["total"], "last": r["last"]} for r in rows]


@router.get("/{vid}")
def get_vehicle(vid: int, conn: DB, months: int = Query(12, ge=1, le=120)):
    return garage.summary(conn, _vehicle(conn, vid), months)


@router.patch("/{vid}")
def patch_vehicle(vid: int, body: VehicleBody, conn: DB):
    before = _vehicle(conn, vid)
    sent = body.model_dump(exclude_unset=True)
    updates = {k: (json.dumps(v or []) if k == "subcategories" else v) for k, v in sent.items() if k in _COLS}
    if "kind" in updates and updates["kind"] not in garage.KINDS:
        raise HTTPException(422, "Unknown kind")
    if "name" in updates and not (updates["name"] or "").strip():
        raise HTTPException(422, "Give it a name")
    if updates:
        conn.execute(f"UPDATE vehicles SET {', '.join(f'{k}=?' for k in updates)} WHERE id=?", (*updates.values(), vid))
        conn.commit()
    if "day_tag" in updates and updates["day_tag"] != before["day_tag"]:
        conn.execute("DELETE FROM vehicle_days WHERE vehicle_id=?", (vid,))
        routes.refresh(conn, vid)
    return garage.vehicle_out(_vehicle(conn, vid))


@router.delete("/{vid}")
def delete_vehicle(vid: int, conn: DB):
    _vehicle(conn, vid)
    conn.execute("UPDATE transactions SET vehicle_id=NULL WHERE vehicle_id=?", (vid,))
    conn.execute("DELETE FROM vehicles WHERE id=?", (vid,))
    conn.commit()
    return {"status": "deleted"}


class OdoBody(BaseModel):
    date: str = Field(default_factory=lambda: _date.today().isoformat())
    km: float = Field(ge=0)
    note: Optional[str] = None


@router.get("/{vid}/odometer")
def list_odometer(vid: int, conn: DB):
    _vehicle(conn, vid)
    return [dict(r) for r in conn.execute(
        "SELECT id, date, km, note FROM vehicle_odometer WHERE vehicle_id=? ORDER BY date DESC, km DESC", (vid,))]


@router.post("/{vid}/odometer", status_code=201)
def add_odometer(vid: int, body: OdoBody, conn: DB):
    _vehicle(conn, vid)
    prev = conn.execute("SELECT date, km FROM vehicle_odometer WHERE vehicle_id=? AND date<=? ORDER BY date DESC, km DESC "
                        "LIMIT 1", (vid, body.date)).fetchone()
    nxt = conn.execute("SELECT date, km FROM vehicle_odometer WHERE vehicle_id=? AND date>? ORDER BY date, km LIMIT 1",
                       (vid, body.date)).fetchone()
    if prev and body.km < prev["km"]:
        raise HTTPException(422, f"Lower than the {prev['km']:.0f} km you logged on {prev['date']}")
    if nxt and body.km > nxt["km"]:
        raise HTTPException(422, f"Higher than the {nxt['km']:.0f} km you logged on {nxt['date']}")
    cur = conn.execute("INSERT INTO vehicle_odometer (vehicle_id, date, km, note) VALUES (?,?,?,?)",
                       (vid, body.date, body.km, body.note))
    conn.commit()
    return {"id": cur.lastrowid, "date": body.date, "km": body.km, "note": body.note}


@router.delete("/{vid}/odometer/{rid}")
def delete_odometer(vid: int, rid: int, conn: DB):
    conn.execute("DELETE FROM vehicle_odometer WHERE id=? AND vehicle_id=?", (rid, vid))
    conn.commit()
    return {"status": "deleted"}


@router.get("/{vid}/costs")
def list_costs(vid: int, conn: DB, limit: int = Query(100, le=1000)):
    v = _vehicle(conn, vid)
    where, params = garage.cost_where(v)
    return [dict(r) | {"linked": r["vehicle_id"] == vid} for r in conn.execute(
        f"SELECT id, date, name, amount, account, subcategory, notes, vehicle_id FROM transactions WHERE {where} "
        f"ORDER BY date DESC, created_at DESC LIMIT ?", (*params, limit))]


class CostBody(BaseModel):
    date: str = Field(default_factory=lambda: _date.today().isoformat())
    name: str
    amount: float = Field(gt=0)
    subcategory: Optional[str] = None
    account: Optional[str] = None
    notes: Optional[str] = None
    odometer_km: Optional[float] = None       # logged alongside (a fill-up, a service)


@router.post("/{vid}/costs", status_code=201)
def add_cost(vid: int, body: CostBody, conn: DB):
    _vehicle(conn, vid)
    txn_id = "local-" + str(uuid.uuid4())
    conn.execute(
        """INSERT INTO transactions (id, source, date, name, amount, account, category, subcategory,
                                     transaction_type, notes, vehicle_id)
           VALUES (?,?,?,?,?,?,'Transportation',?,'Expense',?,?)""",
        (txn_id, "local", body.date, body.name.strip(), -abs(body.amount), body.account,
         (body.subcategory or "").strip() or None, body.notes, vid),
    )
    conn.commit()
    if body.odometer_km is not None:
        try:
            add_odometer(vid, OdoBody(date=body.date, km=body.odometer_km, note=body.name.strip()), conn)
        except HTTPException as e:
            return {"txn_id": txn_id, "odometer_error": e.detail}
    return {"txn_id": txn_id}


@router.get("/{vid}/days")
def list_days(vid: int, conn: DB, limit: int = Query(60, le=1000)):
    _vehicle(conn, vid)
    return [dict(r) for r in conn.execute(
        "SELECT date, km, minutes, legs, start_place, end_place FROM vehicle_days WHERE vehicle_id=? "
        "ORDER BY date DESC LIMIT ?", (vid, limit))]


@router.get("/{vid}/days/{day}")
def day_route(vid: int, day: str, conn: DB):
    _vehicle(conn, vid)
    r = conn.execute("SELECT * FROM vehicle_days WHERE vehicle_id=? AND date=?", (vid, day)).fetchone()
    if not r:
        raise HTTPException(404, "No route that day")
    return dict(r) | {"route": json.loads(r["route"] or "[]")}


@router.get("/{vid}/routes")
def all_routes(vid: int, conn: DB, months: int = Query(12, ge=1, le=120)):
    """Every leg of the period on one map (the heat of where it goes)."""
    _vehicle(conn, vid)
    rows = conn.execute(
        "SELECT date, route FROM vehicle_days WHERE vehicle_id=? AND route IS NOT NULL AND date >= date('now', ?) "
        "ORDER BY date", (vid, f"-{months} months")).fetchall()
    return [{"date": r["date"], "legs": json.loads(r["route"])} for r in rows]


@router.post("/{vid}/refresh")
def refresh(vid: int, conn: DB, all: bool = Query(False)):
    _vehicle(conn, vid)
    return {"days": routes.refresh(conn, vid, everything=all)}
