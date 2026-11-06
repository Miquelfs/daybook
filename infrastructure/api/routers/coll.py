"""
Coll — the DIY bike computer (ciclocomputer/docs/DAYBOOK.md). Prefix: /coll

Device (header X-Coll-Token = COLL_TOKEN from .env; no token configured = closed):
GET    /coll/sync                    — settings digest + the courses to keep on the device
GET    /coll/settings                — profile, HR zones, timezone, fuel plan, race cut-offs
GET    /coll/courses/{id}/pack       — the .coll bytes; ETag = pack_sha1, 304 on If-None-Match

Web (like the rest of the API, no token):
POST   /coll/courses                 — {name?, gpx, goal_id?, session_id?} → 202, starts a build;
                                       the same GPX again → 200 with the existing course
GET    /coll/courses                 — list
GET    /coll/courses/{id}            — detail: summary, turn prompts, polyline
PATCH  /coll/courses/{id}            — {name?, on_device?, goal_id?, session_id?, cutoffs?}
POST   /coll/courses/{id}/rebuild    — 202
DELETE /coll/courses/{id}            — 204
GET    /coll/settings/preview        — what the device would get, + where the fuel plan comes from
PUT    /coll/settings                — {fuel_plan?, fuel_product_id?}: the default plan for rides
                                       without a course; the carb product per-course plans use

Planned sessions with a GPX (tour days…) get a course on their own (courses.attach_session).
"""

import sqlite3
import xml.etree.ElementTree as ET
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel

from domains.coll import courses as C
from domains.coll import fuel as F
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


def _course(conn, cid: int) -> dict:
    c = C.get(conn, cid)
    if c is None:
        raise HTTPException(status_code=404, detail="course not found")
    return {**c, "fuel": F.for_course(conn, c, S._setting(conn, S.FUEL_KEY))}


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
