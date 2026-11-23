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
  GET    /vehicles/{id}/days             days used: tagged, or with GPS legs assigned to it (?limit=)
  GET    /vehicles/{id}/routes           its legs of the last N months, for the map
  GET    /vehicles/inbox                 drives waiting for "who drove this?" (untagged / both tags)
  POST   /vehicles/legs/pick             {date, start, vehicle_id} — 0 = not mine
  POST   /vehicles/refresh               read the GPS again now (?all=true)
  GET    /vehicles/{id}/reminders        ITV, insurance, oil change… with when they're due
  POST   /vehicles/{id}/reminders
  GET    /vehicles/reminders/presets     suggestions per kind
  PATCH  /vehicles/reminders/{rid}
  DELETE /vehicles/reminders/{rid}       (its open Plan task goes too)
  POST   /vehicles/reminders/{rid}/done  {date, km, cost?} — next cycle starts; can log the cost
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import date as _date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from domains.vehicles import garage, reminders, routes
from infrastructure.api.db import get_db
from infrastructure.api.db_money import get_money_db

router = APIRouter(prefix="/vehicles", tags=["vehicles"])
DB = Annotated[sqlite3.Connection, Depends(get_money_db)]
DayDB = Annotated[sqlite3.Connection, Depends(get_db)]


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
def list_vehicles(conn: DB, day_conn: DayDB):
    reminders.sync(conn, day_conn)
    out = garage.overview(conn)
    due = {}
    for o in out:
        rs = reminders.listing(conn, o["vehicle"]["id"])
        nxt = next((r for r in rs if r["due"]["date"]), None)
        due[o["vehicle"]["id"]] = {"title": nxt["title"], **nxt["due"]} if nxt else None
    return [o | {"next_reminder": due[o["vehicle"]["id"]]} for o in out]


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
    routes.refresh(conn)
    return garage.vehicle_out(_vehicle(conn, vid))


@router.get("/subcategories")
def transport_subcategories(conn: DB):
    rows = conn.execute(
        """SELECT TRIM(subcategory) s, COUNT(*) n, ROUND(-SUM(amount),2) total, MAX(date) last
           FROM transactions WHERE deleted_at IS NULL AND category='Transportation'
             AND subcategory IS NOT NULL AND TRIM(subcategory) != ''
           GROUP BY LOWER(TRIM(subcategory)) ORDER BY n DESC""").fetchall()
    return [{"subcategory": r["s"], "count": r["n"], "total": r["total"], "last": r["last"]} for r in rows]


@router.get("/inbox")
def inbox(conn: DB):
    return routes.inbox(conn)


class PickBody(BaseModel):
    date: str
    start: str
    vehicle_id: int                        # 0 = not mine


@router.post("/legs/pick")
def pick_leg(body: PickBody, conn: DB):
    if body.vehicle_id:
        _vehicle(conn, body.vehicle_id)
    if not conn.execute("SELECT 1 FROM vehicle_legs WHERE date=? AND start=?", (body.date, body.start)).fetchone():
        raise HTTPException(404, "No such drive")
    routes.pick(conn, body.date, body.start, body.vehicle_id)
    return {"status": "ok"}


@router.post("/refresh")
def refresh_all(conn: DB, all: bool = Query(False)):
    return {"days": routes.refresh(conn, everything=all)}


@router.get("/reminders/presets")
def reminder_presets():
    return {k: [{"title": t, "every_months": m, "every_km": km} for t, m, km in v] for k, v in reminders.PRESETS.items()}


class ReminderBody(BaseModel):
    title: Optional[str] = None
    every_months: Optional[int] = Field(None, ge=1, le=240)
    every_km: Optional[float] = Field(None, gt=0)
    last_date: Optional[str] = None
    last_km: Optional[float] = Field(None, ge=0)
    due_date: Optional[str] = None
    remind_days: Optional[int] = Field(None, ge=0, le=365)
    notes: Optional[str] = None


_RCOLS = ("title", "every_months", "every_km", "last_date", "last_km", "due_date", "remind_days", "notes")


def _check_reminder(f: dict) -> None:
    if not (f.get("title") or "").strip():
        raise HTTPException(422, "Give it a name")
    if not (f.get("every_months") or f.get("every_km") or f.get("due_date")):
        raise HTTPException(422, "Say when it's due: every N months, every N km, or a date")
    if f.get("every_km") and f.get("last_km") is None:
        raise HTTPException(422, "A km interval needs the km it was last done at")
    if f.get("every_months") and not f.get("last_date") and not f.get("due_date"):
        raise HTTPException(422, "A months interval needs when it was last done (or the next date)")


@router.patch("/reminders/{rid}")
def patch_reminder(rid: int, body: ReminderBody, conn: DB, day_conn: DayDB):
    r = conn.execute("SELECT * FROM vehicle_reminders WHERE id=?", (rid,)).fetchone()
    if not r:
        raise HTTPException(404, "Reminder not found")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in _RCOLS}
    _check_reminder({**dict(r), **updates})
    if updates:
        conn.execute(f"UPDATE vehicle_reminders SET {', '.join(f'{k}=?' for k in updates)} WHERE id=?", (*updates.values(), rid))
        conn.commit()
    reminders.sync(conn, day_conn)
    return {"status": "ok"}


@router.delete("/reminders/{rid}")
def delete_reminder(rid: int, conn: DB, day_conn: DayDB):
    reminders.remove(conn, day_conn, rid)
    return {"status": "deleted"}


class DoneCost(BaseModel):
    name: Optional[str] = None
    amount: float = Field(gt=0)
    account: Optional[str] = None
    subcategory: Optional[str] = None


class DoneBody(BaseModel):
    date: str = Field(default_factory=lambda: _date.today().isoformat())
    km: Optional[float] = Field(None, ge=0)
    cost: Optional[DoneCost] = None


@router.post("/reminders/{rid}/done")
def reminder_done(rid: int, body: DoneBody, conn: DB, day_conn: DayDB):
    r = conn.execute("SELECT * FROM vehicle_reminders WHERE id=?", (rid,)).fetchone()
    if not r:
        raise HTTPException(404, "Reminder not found")
    out: dict = {"status": "ok"}
    if body.km is not None:                 # the dial that day is a reading too
        try:
            add_odometer(r["vehicle_id"], OdoBody(date=body.date, km=body.km, note=r["title"]), conn)
        except HTTPException as e:
            out["odometer_error"] = e.detail
    if body.cost:
        out["txn_id"] = add_cost(r["vehicle_id"], CostBody(
            date=body.date, name=(body.cost.name or r["title"]).strip(), amount=body.cost.amount,
            subcategory=body.cost.subcategory or r["title"], account=body.cost.account), conn)["txn_id"]
    reminders.done(conn, day_conn, rid, body.date, body.km)
    return out


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
        routes.refresh(conn)
    return garage.vehicle_out(_vehicle(conn, vid))


@router.delete("/{vid}")
def delete_vehicle(vid: int, conn: DB, day_conn: DayDB):
    _vehicle(conn, vid)
    for (rid,) in conn.execute("SELECT id FROM vehicle_reminders WHERE vehicle_id=?", (vid,)).fetchall():
        reminders.remove(conn, day_conn, rid)
    conn.execute("UPDATE transactions SET vehicle_id=NULL WHERE vehicle_id=?", (vid,))
    conn.execute("DELETE FROM vehicle_leg_picks WHERE vehicle_id=?", (vid,))
    conn.execute("DELETE FROM vehicles WHERE id=?", (vid,))
    routes.assign(conn)
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
    """Every day you used it — tagged, or a drive assigned to it — with what the GPS saw."""
    v = _vehicle(conn, vid)
    used = garage.usage_days(conn, v)
    legs: dict[str, list] = {}
    for l in conn.execute("SELECT date, start, km, minutes, start_place, end_place, how FROM vehicle_legs "
                          "WHERE vehicle_id=? ORDER BY start", (vid,)):
        legs.setdefault(l["date"], []).append(l)
    out = []
    for d in sorted(set(used) | set(legs), reverse=True)[:limit]:
        ls = legs.get(d, [])
        out.append({"date": d, "km": round(sum(l["km"] for l in ls), 1), "minutes": round(sum(l["minutes"] for l in ls)),
                    "legs": len(ls), "start_place": ls[0]["start_place"] if ls else None,
                    "end_place": ls[-1]["end_place"] if ls else None,
                    "picked": any(l["how"] == "pick" for l in ls)})
    return out


@router.get("/{vid}/routes")
def all_routes(vid: int, conn: DB, months: int = Query(12, ge=1, le=120)):
    """Every leg of the period on one map (the heat of where it goes)."""
    _vehicle(conn, vid)
    by_day: dict[str, list] = {}
    for r in conn.execute("SELECT date, route FROM vehicle_legs WHERE vehicle_id=? AND route IS NOT NULL "
                          "AND date >= date('now', ?) ORDER BY start", (vid, f"-{months} months")):
        by_day.setdefault(r["date"], []).append(json.loads(r["route"]))
    return [{"date": d, "legs": ls} for d, ls in sorted(by_day.items())]


@router.get("/{vid}/reminders")
def list_reminders(vid: int, conn: DB, day_conn: DayDB):
    _vehicle(conn, vid)
    reminders.sync(conn, day_conn)
    return reminders.listing(conn, vid)


@router.post("/{vid}/reminders", status_code=201)
def create_reminder(vid: int, body: ReminderBody, conn: DB, day_conn: DayDB):
    _vehicle(conn, vid)
    f = body.model_dump()
    _check_reminder(f)
    conn.execute(
        """INSERT INTO vehicle_reminders (vehicle_id, title, every_months, every_km, last_date, last_km, due_date,
                                          remind_days, notes) VALUES (?,?,?,?,?,?,?,?,?)""",
        (vid, f["title"].strip(), f["every_months"], f["every_km"], f["last_date"], f["last_km"], f["due_date"],
         f["remind_days"] if f["remind_days"] is not None else 30, f["notes"]))
    conn.commit()
    reminders.sync(conn, day_conn)
    return {"status": "ok"}
