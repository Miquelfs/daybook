"""
The settings document Coll downloads with its courses (ciclocomputer/docs/DAYBOOK.md §4),
and the device token (§6). Everything comes from what Daybook already stores; a field
Daybook doesn't know is null and Coll keeps its own default.

  profile    weight (weight_log), age (user_profile.birthdate), sex (the fitness-age setting)
  hr_zones   upper bounds of Z1–Z5 for cycling (athlete_zones, sport 'ride'); Z5's is max HR
  fuel_plan  Coll's 'name:every_min[:carbs_g],…' for rides without a course: the default typed
             on the Coll tab. Each course in /coll/sync carries its own plan (domains/coll/fuel.py)
  cutoffs    the race course's 'WHERE@HH:MM name; …' — the on-device course of the next race
  screens    the ride pages and their fields, one line (firmware/lib/core/screens.h):
             'list:speed,distance,…;grid:…;map;climb;fuel' — null: Coll keeps its own
"""

from __future__ import annotations

import hmac
import json
import os
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

from domains.coll.courses import sha1

FORMAT = 1
FUEL_KEY = "coll_fuel_plan"
SCREENS_KEY = "coll_screens"

# The same names and limits as firmware/lib/core/screens.cpp
FIELDS = [
    ("speed", "Speed", "km/h"), ("distance", "Distance", "km"), ("ride_time", "Ride time", None),
    ("elapsed", "Elapsed", "with stops"), ("clock", "Time of day", None), ("hr", "Heart rate", "bpm"),
    ("avg_hr", "Avg heart rate", "bpm"), ("max_hr", "Max heart rate", "bpm"), ("avg_speed", "Avg speed", "km/h"),
    ("max_speed", "Max speed", "km/h"), ("to_go", "To go", "km, with a route"), ("altitude", "Altitude", "m"),
    ("ascent", "Ascent", "m"), ("ascent_to_go", "Ascent to go", "m, with a route"), ("power", "Power", "W"),
    ("calories", "Calories", "kcal"), ("cutoff", "Cut-off margin", "with cut-offs"), ("lap", "Lap", None),
    ("lap_time", "Lap time", None), ("lap_distance", "Lap distance", "km"), ("lap_speed", "Lap avg speed", "km/h"),
    ("lap_hr", "Lap avg heart rate", "bpm"),
]
FIELD_IDS = {f[0] for f in FIELDS}
SCREEN_KINDS = {"list": 5, "grid": 10, "map": 0, "climb": 0, "fuel": 0}
MAX_SCREENS = 8
DEFAULT_SCREENS = ("list:speed,distance,ride_time,hr,to_go;"
                   "grid:distance,to_go,altitude,ascent,ascent_to_go,power,calories,ride_time,elapsed,cutoff;"
                   "map;climb;fuel;list:hr,avg_hr,max_hr,ascent,ride_time;"
                   "list:lap,lap_time,lap_distance,lap_speed,lap_hr")
_FUEL_ITEM = re.compile(r"^[^:,]{1,16}:\d{1,3}(:\d{1,3})?$")
_CUTOFF_ITEM = re.compile(r"^[^@;]+@\s*\d{1,2}:\d{2}(\s+[^;]*)?$")


def _one(conn, sql, args=()):
    try:
        return conn.execute(sql, args).fetchone()
    except sqlite3.OperationalError:                 # a table this install doesn't have yet
        return None


def _setting(conn, key: str) -> str | None:
    r = _one(conn, "SELECT value FROM app_settings WHERE key=?", (key,))
    return r[0] if r else None


def age_on(birthdate: str | None, on: date) -> int | None:
    if not birthdate:
        return None
    b = date.fromisoformat(birthdate[:10])
    return on.year - b.year - ((on.month, on.day) < (b.month, b.day))


def hr_zone_bounds(zones: list[dict], max_hr: int | None) -> list[int]:
    """[Z1 top, …, Z5 top]; the stored open top (999) becomes max HR."""
    tops = [int(z["max_hr"]) for z in zones[:5]]
    if tops and tops[-1] >= 999:
        tops[-1] = int(max_hr) if max_hr else tops[-2] + 15
    return tops


def valid_fuel_plan(s: str) -> bool:
    items = [p.strip() for p in s.split(",") if p.strip()]
    return bool(items) and all(_FUEL_ITEM.match(p) for p in items)


def valid_cutoffs(s: str) -> bool:
    items = [p.strip() for p in s.split(";") if p.strip()]
    return bool(items) and all(_CUTOFF_ITEM.match(p) for p in items)


def parse_screens(spec: str) -> list[dict]:
    """'list:speed,hr;map' → [{kind, fields}]; ValueError with what's wrong (the device refuses the same)."""
    out = []
    for part in (spec or "").split(";"):
        part = part.strip()
        if not part:
            continue
        kind, colon, rest = part.partition(":")
        if kind not in SCREEN_KINDS:
            raise ValueError(f"screens: unknown page '{kind}'")
        cap = SCREEN_KINDS[kind]
        if bool(cap) != bool(colon):
            raise ValueError(f"screens: '{kind}' " + ("needs fields" if cap else "takes no fields"))
        fields = rest.split(",") if colon else []
        bad = [f for f in fields if f not in FIELD_IDS]
        if bad:
            raise ValueError(f"screens: unknown field '{bad[0]}'")
        if len(fields) > cap or (cap and not fields):
            raise ValueError(f"screens: a {kind} page holds 1–{cap} fields")
        out.append({"kind": kind, "fields": fields})
    if not out or len(out) > MAX_SCREENS:
        raise ValueError(f"screens: 1–{MAX_SCREENS} pages")
    return out


def format_screens(pages: list[dict]) -> str:
    return ";".join(p["kind"] + (":" + ",".join(p["fields"]) if p.get("fields") else "") for p in pages)


def set_screens(conn: sqlite3.Connection, spec: str | None) -> None:
    spec = (spec or "").strip()
    if not spec or spec == DEFAULT_SCREENS:
        conn.execute("DELETE FROM app_settings WHERE key=?", (SCREENS_KEY,))
    else:
        spec = format_screens(parse_screens(spec))
        conn.execute("INSERT INTO app_settings (key, value) VALUES (?, ?) "
                     "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (SCREENS_KEY, spec))
    conn.commit()


def fuel_from_nutrition(plan: dict) -> str | None:
    """The bike leg of a race nutrition plan → 'Eat:<every>:<carbs>,Drink:20'."""
    bike = (plan.get("legs") or {}).get("bike") or {}
    feeds = bike.get("schedule") or []
    if not feeds:
        return None
    mins = []
    for f in feeds[:2]:
        h, m = str(f.get("at", "0:00")).split(":")
        mins.append(int(h) * 60 + int(m))
    every = mins[1] - mins[0] if len(mins) == 2 else 30
    out = f"Eat:{every}:{int(feeds[0].get('carbs_g') or 0)}" if feeds[0].get("carbs_g") else f"Eat:{every}"
    return out + (",Drink:20" if bike.get("fluid_ml_h") else "")


def race_course(conn, today: date) -> sqlite3.Row | None:
    """The on-device course of the nearest race still to come."""
    return _one(conn, """SELECT c.id, c.cutoffs, g.id AS goal_id FROM coll_courses c JOIN race_goals g ON g.id = c.goal_id
                         WHERE c.status='ready' AND c.on_device=1 AND g.race_date >= ?
                         ORDER BY g.race_date, c.id LIMIT 1""", (today.isoformat(),))


def build(conn: sqlite3.Connection, today: date | None = None, tz: str | None = None) -> dict:
    today = today or date.today()
    w = _one(conn, "SELECT weight_kg FROM weight_log ORDER BY date DESC LIMIT 1")
    p = _one(conn, "SELECT birthdate FROM user_profile WHERE id=1")
    sex = _setting(conn, "fitness_age_sex")
    z = _one(conn, "SELECT * FROM athlete_zones WHERE sport='ride' AND valid_from <= ? ORDER BY valid_from DESC LIMIT 1",
             (today.isoformat(),))
    zones = None
    if z is not None:
        from domains.training import hr_zones
        zones = hr_zone_bounds(hr_zones.stored(z, "ride"), z["max_hr"])

    race = race_course(conn, today)
    fuel = _setting(conn, FUEL_KEY)
    return {
        "format": FORMAT,
        "profile": {"weight_kg": round(w[0], 1) if w else None,
                    "age": age_on(p[0] if p else None, today),
                    "sex": sex if sex in ("male", "female") else None},
        "hr_zones": zones,
        "max_hr": z["max_hr"] if z is not None else None,
        "timezone": tz or _setting(conn, "timezone"),
        "fuel_plan": fuel or None,                   # the default for rides without a course
        "cutoffs": race["cutoffs"] if race is not None else None,
        "cutoffs_course_id": race["id"] if race is not None else None,
        "screens": _setting(conn, SCREENS_KEY) or None,          # null: Coll keeps its own (the same default)
        "units": "metric",
    }


def digest(settings: dict) -> str:
    return sha1(json.dumps(settings, sort_keys=True, separators=(",", ":")))


def set_fuel_plan(conn: sqlite3.Connection, plan: str | None) -> None:
    plan = (plan or "").strip()
    if not plan:
        conn.execute("DELETE FROM app_settings WHERE key=?", (FUEL_KEY,))
    else:
        if not valid_fuel_plan(plan):
            raise ValueError("fuel plan: items like 'Gel:40:25' (name:every minutes[:carbs g]), comma-separated")
        conn.execute("INSERT INTO app_settings (key, value) VALUES (?, ?) "
                     "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (FUEL_KEY, plan))
    conn.commit()


def sync(conn: sqlite3.Connection, today: date | None = None, tz: str | None = None) -> dict:
    """Everything Coll needs to decide what to download, in one answer (§6.1)."""
    from domains.coll import firmware
    from domains.coll.courses import device_courses
    s = build(conn, today, tz)
    return {
        "server_time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "settings_sha1": digest(s),
        "courses": device_courses(conn, today, s["fuel_plan"]),
        "firmware": firmware.offer(conn),
    }


# ── device token ────────────────────────────────────────────────────────────

def expected_token(env_file: Path | None = None) -> str | None:
    t = os.environ.get("COLL_TOKEN")
    if t:
        return t.strip()
    env_file = env_file or Path(__file__).resolve().parents[2] / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("COLL_TOKEN="):
                return line.split("=", 1)[1].strip() or None
    return None


def token_ok(given: str | None, expected: str | None) -> bool:
    """No COLL_TOKEN configured = the device endpoints stay closed (not open)."""
    return bool(expected) and bool(given) and hmac.compare_digest(given.encode(), expected.encode())
