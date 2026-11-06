"""
Coll — the DIY bike computer (ciclocomputer/docs/DAYBOOK.md). Prefix: /coll

Device (header X-Coll-Token = COLL_TOKEN from .env; no token configured = closed):
GET    /coll/sync                    — settings digest + the courses to keep on the device
GET    /coll/settings                — profile, HR zones, timezone, fuel plan, race cut-offs
GET    /coll/courses/{id}/pack       — the .coll bytes; ETag = pack_sha1, 304 on If-None-Match
POST   /coll/rides                   — the ride as the body (GPX, or the .clg ride log); header
                                       X-Coll-Ride-Id (start, UTC ISO) → 201 {activity_id, …};
                                       the same id again → 200 {…, duplicate: true}

Web (like the rest of the API, no token):
POST   /coll/courses                 — {name?, gpx, goal_id?, session_id?} → 202, starts a build;
                                       the same GPX again → 200 with the existing course
GET    /coll/courses                 — list
GET    /coll/courses/map             — every built course's line, for the overview map
GET    /coll/courses/{id}            — detail: summary, turn prompts, polyline, map (turn and
                                       waypoint positions read from the pack)
PATCH  /coll/courses/{id}            — {name?, on_device?, goal_id?, session_id?, cutoffs?}
POST   /coll/courses/{id}/rebuild    — 202
DELETE /coll/courses/{id}            — 204
GET    /coll/settings/preview        — what the device would get, + where the fuel plan comes from
PUT    /coll/settings                — {fuel_plan?, fuel_product_id?}: the default plan for rides
                                       without a course; the carb product per-course plans use
GET    /coll/rides                   — rides Coll uploaded, newest first
POST   /coll/rides/{id}/reimport     — rebuild its activity from the stored upload
DELETE /coll/rides/{id}              — forget it (and its Coll activity), e.g. a test upload

Planned sessions with a GPX (tour days…) get a course on their own (courses.attach_session).
Rides: domains/coll/rides.py (the watch's copy of the same ride wins, see there).
"""

import sqlite3
import xml.etree.ElementTree as ET
from typing import Annotated, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, Header, HTTPException, Response
from pydantic import BaseModel

from domains.coll import courses as C
from domains.coll import fuel as F
from domains.coll import packread
from domains.coll import rides as R
from domains.coll import settings as S
from infrastructure.api.db import get_db

router = APIRouter(prefix="/coll", tags=["coll"])
DB = Annotated[sqlite3.Connection, Depends(get_db)]


def device(x_coll_token: Annotated[Optional[str], Header()] = None) -> None:
    if not S.token_ok(x_coll_token, S.expected_token()):
        raise HTTPException(status_code=401, detail="X-Coll-Token missing or wrong")


Device = Depends(device)


def _tz() -> str:
    from infrastructure.db import usertime
    return usertime.current_tz()


MAX_RIDE_BYTES = 64 * 1024 * 1024          # a 16 h GPX is ~12 MB


def _course(conn, cid: int) -> dict:
    c = C.get(conn, cid)
    if c is None:
        raise HTTPException(status_code=404, detail="course not found")
    geo = None
    p = C.pack(conn, cid)
    if p is not None:
        try:
            geo = packread.geometry(p[0])
        except (ValueError, IndexError, UnicodeDecodeError):
            geo = None
    return {**c, "fuel": F.for_course(conn, c, S._setting(conn, S.FUEL_KEY)), "map": geo}


def _finish_ride(activity_id: str, day: str) -> None:
    from infrastructure.db.connection import get_connection
    conn = get_connection()
    try:
        R.finish(conn, activity_id, day)
    finally:
        conn.close()


# ── device ──────────────────────────────────────────────────────────────────

@router.get("/sync", dependencies=[Device])
def sync(conn: DB):
    return S.sync(conn, tz=_tz())


@router.get("/settings", dependencies=[Device])
def device_settings(conn: DB):
    s = S.build(conn, tz=_tz())
    s.pop("cutoffs_course_id", None)
    return s


@router.get("/courses/{cid}/pack", dependencies=[Device])
def course_pack(cid: int, conn: DB, if_none_match: Annotated[Optional[str], Header()] = None):
    p = C.pack(conn, cid)
    if p is None:
        raise HTTPException(status_code=404, detail="no pack (not built yet?)")
    data, etag = p
    if if_none_match and if_none_match.strip('"') == etag:
        return Response(status_code=304, headers={"ETag": f'"{etag}"'})
    return Response(content=data, media_type="application/octet-stream",
                    headers={"ETag": f'"{etag}"', "Content-Disposition": f'attachment; filename="course-{cid}.coll"'})


@router.post("/rides", status_code=201, dependencies=[Device])
def upload_ride(conn: DB, response: Response, background: BackgroundTasks,
                body: Annotated[bytes, Body(media_type="application/gpx+xml")],
                x_coll_ride_id: Annotated[Optional[str], Header()] = None):
    if len(body) > MAX_RIDE_BYTES:
        raise HTTPException(status_code=413, detail="ride too large")
    try:
        ride, created = R.ingest(conn, body, x_coll_ride_id, _tz())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if not created:
        response.status_code = 200
    elif ride["status"] == "activity":
        day = conn.execute("SELECT date FROM activities WHERE id=?", (ride["activity_id"],)).fetchone()
        if day:
            background.add_task(_finish_ride, ride["activity_id"], day[0])
    return {**ride, "duplicate": not created}


# ── web ─────────────────────────────────────────────────────────────────────

class CourseIn(BaseModel):
    gpx: str
    name: Optional[str] = None
    goal_id: Optional[int] = None
    session_id: Optional[int] = None


class CoursePatch(BaseModel):
    fuel_plan: Optional[str] = None
    name: Optional[str] = None
    on_device: Optional[bool] = None
    goal_id: Optional[int] = None
    session_id: Optional[int] = None
    cutoffs: Optional[str] = None


class SettingsIn(BaseModel):
    fuel_plan: Optional[str] = None
    fuel_product_id: Optional[int] = None


@router.post("/courses", status_code=202)
def create_course(body: CourseIn, conn: DB, response: Response):
    try:
        course, created = C.create(conn, body.name, body.gpx, body.goal_id, body.session_id)
    except ET.ParseError as e:
        raise HTTPException(status_code=422, detail=f"GPX could not be read: {e}")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if created:
        C.kick()
    else:
        response.status_code = 200
    return {**course, "duplicate": not created}


@router.get("/courses")
def list_courses(conn: DB):
    on_device = {c["id"]: c for c in C.device_courses(conn, default_fuel=S._setting(conn, S.FUEL_KEY))}
    return [{**c, "synced": c["id"] in on_device, "fuel_plan_now": (on_device.get(c["id"]) or {}).get("fuel_plan")}
            for c in C.list_courses(conn)]


@router.get("/courses/map")
def courses_map(conn: DB):
    on_device = {c["id"] for c in C.device_courses(conn, default_fuel=S._setting(conn, S.FUEL_KEY))}
    rows = conn.execute("""SELECT c.id, c.name, c.goal_id, c.polyline, ps.session_date
                           FROM coll_courses c LEFT JOIN plan_sessions ps ON ps.id = c.session_id
                           WHERE c.status='ready' AND c.polyline IS NOT NULL ORDER BY c.id DESC""").fetchall()
    return [{**dict(r), "synced": r["id"] in on_device} for r in rows]


@router.get("/courses/{cid}")
def get_course(cid: int, conn: DB):
    return _course(conn, cid)


@router.patch("/courses/{cid}")
def patch_course(cid: int, body: CoursePatch, conn: DB):
    _course(conn, cid)
    fields = body.model_dump(exclude_unset=True)
    if fields.get("cutoffs") and not S.valid_cutoffs(fields["cutoffs"]):
        raise HTTPException(status_code=422,
                            detail="cut-offs: items like '112.5@13:30 Lluc' or 'Temps tall@13:30', separated by ';'")
    if fields.get("fuel_plan") and not S.valid_fuel_plan(fields["fuel_plan"]):
        raise HTTPException(status_code=422, detail="fuel plan: items like 'Gel:40:25' (name:every minutes[:carbs g])")
    C.update(conn, cid, fields)
    return _course(conn, cid)


@router.post("/courses/{cid}/rebuild", status_code=202)
def rebuild_course(cid: int, conn: DB):
    _course(conn, cid)
    if not C.rebuild(conn, cid):
        raise HTTPException(status_code=409, detail="already building")
    C.kick()
    return _course(conn, cid)


@router.delete("/courses/{cid}", status_code=204)
def delete_course(cid: int, conn: DB):
    if not C.delete(conn, cid):
        raise HTTPException(status_code=404, detail="course not found")
    return Response(status_code=204)


@router.get("/settings/preview")
def settings_preview(conn: DB):
    s = S.build(conn, tz=_tz())
    p = F.carb_product(conn)
    return {**s, "token_configured": bool(S.expected_token()),
            "fuel_product": p, "products": F.products(conn)}


@router.put("/settings")
def put_settings(body: SettingsIn, conn: DB):
    fields = body.model_dump(exclude_unset=True)
    try:
        if "fuel_plan" in fields:
            S.set_fuel_plan(conn, body.fuel_plan)
        if "fuel_product_id" in fields:
            F.set_product(conn, body.fuel_product_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return settings_preview(conn)


@router.get("/rides")
def list_rides(conn: DB, limit: int = 50):
    return R.list_rides(conn, limit)


@router.post("/rides/{rid}/reimport")
def reimport_ride(rid: int, conn: DB, background: BackgroundTasks):
    try:
        ride = R.reimport(conn, rid, _tz())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if ride is None:
        raise HTTPException(status_code=404, detail="ride not found")
    if ride["status"] == "activity":
        day = conn.execute("SELECT date FROM activities WHERE id=?", (ride["activity_id"],)).fetchone()
        if day:
            background.add_task(_finish_ride, ride["activity_id"], day[0])
    return ride


@router.delete("/rides/{rid}", status_code=204)
def delete_ride(rid: int, conn: DB):
    if not R.delete(conn, rid):
        raise HTTPException(status_code=404, detail="ride not found")
    return Response(status_code=204)
