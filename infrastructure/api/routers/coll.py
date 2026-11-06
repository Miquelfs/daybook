"""
Coll — the DIY bike computer (ciclocomputer/docs/DAYBOOK.md). Prefix: /coll

Device (header X-Coll-Token = COLL_TOKEN from .env; no token configured = closed):
GET    /coll/sync                    — settings digest + the courses to keep on the device
GET    /coll/settings                — profile, HR zones, timezone, fuel plan, race cut-offs
GET    /coll/courses/{id}/pack       — the .coll bytes; ETag = pack_sha1, 304 on If-None-Match
POST   /coll/device                  — end of every sync: {have: [{id, pack_sha1}], firmware?, free_kb?,
                                       battery_pct?, rides_waiting?} → what's really on Coll
POST   /coll/rides                   — the ride as the body (GPX, or the .clg ride log); header
                                       X-Coll-Ride-Id (start, UTC ISO) → 201 {activity_id, …};
                                       the same id again → 200 {…, duplicate: true}
GET    /coll/firmware/{version}      — the firmware image /coll/sync offers (ETag = sha1)
Every device request lands in the sync log (coll_sync_log), 401s included.

Web (like the rest of the API, no token):
POST   /coll/courses                 — {name?, gpx, goal_id?, session_id?} → 202, starts a build;
                                       the same GPX again → 200 with the existing course
GET    /coll/courses                 — list, each with its path: on_coll (yes / next sync / old version /
                                       no) and the rides that followed it
GET    /coll/device                  — Coll's last report
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
GET    /coll/reviews/{activity_id}   — a ride of a route against its plan: sections, climbs, fuel
POST   /coll/courses/{id}/weather    — fetch the forecast along it again
GET    /coll/sync-log                — the device's requests grouped into syncs, newest first
GET    /coll/firmware                — uploaded builds + what Coll runs
POST   /coll/firmware?version=&notes= — the .bin as the body (application/octet-stream)
DELETE /coll/firmware/{version}

Planned sessions with a GPX (tour days…) get a course on their own (courses.attach_session).
Rides: domains/coll/rides.py (the watch's copy of the same ride wins, see there).
"""

import sqlite3
import xml.etree.ElementTree as ET
from typing import Annotated, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel

from domains.coll import brief as B
from domains.coll import courses as C
from domains.coll import device_state as D
from domains.coll import firmware as FW
from domains.coll import fuel as F
from domains.coll import packread
from domains.coll import review as RV
from domains.coll import rides as R
from domains.coll import settings as S
from domains.coll import weather as WX
from infrastructure.api.db import get_db

router = APIRouter(prefix="/coll", tags=["coll"])
DB = Annotated[sqlite3.Connection, Depends(get_db)]


def _kind(path: str) -> str:
    p = path.split("/coll/", 1)[-1]
    for k in ("sync", "settings", "device", "rides", "firmware"):
        if p.startswith(k):
            return "ride" if k == "rides" else k
    return "pack" if p.endswith("/pack") else p


def device(request: Request, x_coll_token: Annotated[Optional[str], Header()] = None) -> None:
    if not S.token_ok(x_coll_token, S.expected_token()):
        from infrastructure.db.connection import get_connection
        try:
            conn = get_connection()
            try:
                D.log(conn, "auth", 401, f"{request.method} {request.url.path}: "
                                         + ("no token" if not x_coll_token else "wrong token"))
            finally:
                conn.close()
        except Exception:                                   # noqa: BLE001 — the log never changes the answer
            pass
        raise HTTPException(status_code=401, detail="X-Coll-Token missing or wrong")


Device = Depends(device)


def _tz() -> str:
    from infrastructure.db import usertime
    return usertime.current_tz()


MAX_RIDE_BYTES = 64 * 1024 * 1024          # a 16 h GPX is ~12 MB


def _course(conn, cid: int, refresh_weather: bool = False) -> dict:
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
    fuel = F.for_course(conn, c, S._setting(conn, S.FUEL_KEY))
    full = B.load(conn, cid)
    br = _brief(conn, c, fuel["fuel_plan"], full=True, row=full)
    wx = None
    if br is not None and full is not None:
        try:
            wx = WX.for_course(conn, full, br, _tz(), refresh=refresh_weather)
            WX.apply(br, wx)
            if br.get("carry") is not None:
                br["carry"] = B.carry(fuel["fuel_plan"], br["est_minutes"])
        except Exception:                                   # noqa: BLE001 — weather is extra
            wx = {"status": "unavailable"}
    try:
        rides = RV.rides(conn, cid)
    except Exception:                                       # noqa: BLE001
        rides = []
    return {**c, "fuel": fuel, "map": geo, "brief": br, "weather": wx, "reviews": rides}


def _brief(conn, c: dict, fuel_plan: str | None, full: bool, row: dict | None = None) -> dict | None:
    r = row or B.load(conn, c["id"], full=full)
    if r is None:
        return None
    try:
        return B.build(conn, {**c, **r}, fuel_plan, full=full)
    except Exception:                                       # noqa: BLE001 — the brief is extra, never a 500
        return None


def _finish_ride(activity_id: str, day: str) -> None:
    from infrastructure.db.connection import get_connection
    conn = get_connection()
    try:
        R.finish(conn, activity_id, day)
    finally:
        conn.close()


def _review_ride(activity_id: str) -> None:
    from infrastructure.db.connection import get_connection
    conn = get_connection()
    try:
        RV.after_ride(conn, activity_id)
    finally:
        conn.close()


# ── device ──────────────────────────────────────────────────────────────────

@router.get("/sync", dependencies=[Device])
def sync(conn: DB):
    out = S.sync(conn, tz=_tz())
    fw = out.get("firmware")
    D.log(conn, "sync", 200, f"{len(out['courses'])} route(s) offered" + (f" · firmware {fw['version']}" if fw else ""))
    return out


@router.get("/settings", dependencies=[Device])
def device_settings(conn: DB):
    s = S.build(conn, tz=_tz())
    s.pop("cutoffs_course_id", None)
    D.log(conn, "settings", 200, "settings sent" + (" · custom screens" if s.get("screens") else ""))
    return s


@router.get("/courses/{cid}/pack", dependencies=[Device])
def course_pack(cid: int, conn: DB, if_none_match: Annotated[Optional[str], Header()] = None):
    p = C.pack(conn, cid)
    if p is None:
        D.log(conn, "pack", 404, f"route {cid}: no pack")
        raise HTTPException(status_code=404, detail="no pack (not built yet?)")
    data, etag = p
    name = (C.get(conn, cid) or {}).get("name") or f"route {cid}"
    if if_none_match and if_none_match.strip('"') == etag:
        D.log(conn, "pack", 304, f"{name}: Coll has it already")
        return Response(status_code=304, headers={"ETag": f'"{etag}"'})
    D.log(conn, "pack", 200, name, len(data))
    return Response(content=data, media_type="application/octet-stream",
                    headers={"ETag": f'"{etag}"', "Content-Disposition": f'attachment; filename="course-{cid}.coll"'})


class DeviceReport(BaseModel):
    have: list[dict] = []
    firmware: Optional[str] = None
    free_kb: Optional[int] = None
    battery_pct: Optional[int] = None
    rides_waiting: Optional[int] = None


@router.post("/device", dependencies=[Device])
def device_report(body: DeviceReport, conn: DB):
    try:
        out = D.report(conn, body.model_dump())
    except ValueError as e:
        D.log(conn, "device", 422, str(e))
        raise HTTPException(status_code=422, detail=str(e))
    bits = [f"holds {len(body.have)} route(s)"]
    if body.firmware:
        bits.append(f"firmware {body.firmware}")
    if body.battery_pct is not None:
        bits.append(f"battery {body.battery_pct}%")
    if body.free_kb is not None:
        bits.append(f"{body.free_kb / 1024:.1f} MB free")
    if body.rides_waiting:
        bits.append(f"{body.rides_waiting} ride(s) still to upload")
    D.log(conn, "device", 200, " · ".join(bits))
    return out


@router.get("/firmware/{version}", dependencies=[Device])
def firmware_image(version: str, conn: DB, if_none_match: Annotated[Optional[str], Header()] = None):
    f = next((x for x in FW.listing(conn) if x["version"] == version), None)
    if f is None or not FW.path(version).exists():
        D.log(conn, "firmware", 404, f"no firmware {version}")
        raise HTTPException(status_code=404, detail="no such firmware")
    if if_none_match and if_none_match.strip('"') == f["sha1"]:
        D.log(conn, "firmware", 304, f"{version}: Coll has it already")
        return Response(status_code=304, headers={"ETag": f'"{f["sha1"]}"'})
    D.log(conn, "firmware", 200, f"firmware {version}", f["bytes"])
    return FileResponse(FW.path(version), media_type="application/octet-stream",
                        headers={"ETag": f'"{f["sha1"]}"'}, filename=f"coll-{version}.bin")


@router.post("/rides", status_code=201, dependencies=[Device])
def upload_ride(conn: DB, response: Response, background: BackgroundTasks,
                body: Annotated[bytes, Body(media_type="application/gpx+xml")],
                x_coll_ride_id: Annotated[Optional[str], Header()] = None):
    if len(body) > MAX_RIDE_BYTES:
        D.log(conn, "ride", 413, f"{x_coll_ride_id or 'ride'}: {len(body) / 1e6:.0f} MB, over 64 MB", len(body))
        raise HTTPException(status_code=413, detail="ride too large")
    try:
        ride, created = R.ingest(conn, body, x_coll_ride_id, _tz())
    except ValueError as e:
        D.log(conn, "ride", 422, f"{x_coll_ride_id or 'ride'}: {e}", len(body))
        raise HTTPException(status_code=422, detail=str(e))
    s = ride.get("summary") or {}
    what = f"{ride['name'] or 'Ride'} · {(s.get('distance_m') or 0) / 1000:.1f} km ({ride['format']})"
    if not created:
        response.status_code = 200
        D.log(conn, "ride", 200, f"{what}: already here", len(body))
    else:
        D.log(conn, "ride", 201, what + (" · the watch's copy counts" if ride["status"] == "merged" else ""), len(body))
        if ride["status"] == "activity":
            day = conn.execute("SELECT date FROM activities WHERE id=?", (ride["activity_id"],)).fetchone()
            if day:
                background.add_task(_finish_ride, ride["activity_id"], day[0])
        else:
            background.add_task(_review_ride, ride["activity_id"])
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
    start_time: Optional[str] = None


class SettingsIn(BaseModel):
    fuel_plan: Optional[str] = None
    fuel_product_id: Optional[int] = None
    screens: Optional[str] = None


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
    dev = D.state(conn)
    default = S._setting(conn, S.FUEL_KEY)
    out = []
    for c in C.list_courses(conn):
        fuel = (on_device.get(c["id"]) or {}).get("fuel_plan") or F.for_course(conn, c, default)["fuel_plan"]
        out.append({**c, "synced": c["id"] in on_device, "fuel_plan_now": fuel,
                    **D.steps(conn, c, set(on_device), dev), "brief": _brief(conn, c, fuel, full=False)})
    return out


@router.get("/device")
def device_state(conn: DB):
    d = D.state(conn)
    newest = FW.latest(conn)
    fw = {"newest": newest, "state": FW.state((d or {}).get("firmware"), newest)}
    return {**d, "firmware_update": fw} if d else None


@router.get("/sync-log")
def sync_log(conn: DB, limit: int = 300):
    return D.history(conn, min(1000, max(1, limit)))


@router.get("/firmware")
def firmware_list(conn: DB):
    d = D.state(conn) or {}
    newest = FW.latest(conn)
    return {"builds": FW.listing(conn), "device": d.get("firmware"), "state": FW.state(d.get("firmware"), newest)}


@router.post("/firmware")
def firmware_upload(version: str, conn: DB, body: Annotated[bytes, Body(media_type="application/octet-stream")],
                    notes: Optional[str] = None):
    try:
        FW.add(conn, version, body, notes)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return firmware_list(conn)


@router.delete("/firmware/{version}", status_code=204)
def firmware_delete(version: str, conn: DB):
    if not FW.remove(conn, version):
        raise HTTPException(status_code=404, detail="no such firmware")
    return Response(status_code=204)


@router.get("/reviews/{activity_id}")
def ride_review(activity_id: str, conn: DB):
    try:
        rv = RV.get(conn, activity_id)
    except Exception as e:                                  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"review failed: {e}")
    if rv is None:
        raise HTTPException(status_code=404, detail="not a ride of a Coll route")
    return rv


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
    if fields.get("start_time"):
        import re
        if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", fields["start_time"].strip()):
            raise HTTPException(status_code=422, detail="start: HH:MM, like 07:30")
    C.update(conn, cid, fields)
    return _course(conn, cid)


@router.post("/courses/{cid}/weather")
def refresh_weather(cid: int, conn: DB):
    return _course(conn, cid, refresh_weather=True)


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
            "fuel_product": p, "products": F.products(conn),
            "screens_default": S.DEFAULT_SCREENS,
            "screens_pages": S.parse_screens(s.get("screens") or S.DEFAULT_SCREENS),
            "screens_fields": [{"id": f[0], "label": f[1], "note": f[2]} for f in S.FIELDS],
            "screens_limits": S.SCREEN_KINDS}


@router.put("/settings")
def put_settings(body: SettingsIn, conn: DB):
    fields = body.model_dump(exclude_unset=True)
    try:
        if "fuel_plan" in fields:
            S.set_fuel_plan(conn, body.fuel_plan)
        if "fuel_product_id" in fields:
            F.set_product(conn, body.fuel_product_id)
        if "screens" in fields:
            S.set_screens(conn, body.screens)
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
