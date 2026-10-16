"""
Weather × stress: how the conditions at takeoff/landing (from flight_metars)
move your physiological response (flight_physio: stress / HR spike vs the day's
baseline), and which landings were toughest — with their METAR and your notes.

effects(conn, phase)  condition → mean stress delta with vs without, n, Welch t
                      (gusty, low ceiling, low visibility, rain, thunderstorm,
                      IMC, night, and you-as-pilot-flying)
toughest(conn, phase) highest stress spikes with weather, captain, notes
"""

from __future__ import annotations

import sqlite3
import statistics
from datetime import datetime, timezone

from domains.aviation.metar import conditions

LABELS = {
    "gusty": "Gusty / strong wind (≥25 kt gust or ≥20 kt)",
    "low_ceiling": "Ceiling below 1000 ft",
    "low_visibility": "Visibility below 5 km",
    "precipitation": "Rain / snow",
    "thunderstorm": "Thunderstorm / CB around",
    "imc": "IFR conditions",
    "crosswind": "Crosswind ≥ 15 kt on the runway",
    "night": "Night",
    "you_flew": "You were pilot flying",
}


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def _welch(a, b) -> float:
    if len(a) < 2 or len(b) < 2:
        return 0.0
    se = (statistics.variance(a) / len(a) + statistics.variance(b) / len(b)) ** 0.5
    return (statistics.mean(a) - statistics.mean(b)) / se if se else 0.0


def _night(lat, lon, ts) -> bool | None:
    try:
        from domains.aviation.compute import is_night_moment, _ASTRAL_AVAILABLE
        if not _ASTRAL_AVAILABLE or lat is None or not ts:
            return None
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return bool(is_night_moment(lat, lon, t if t.tzinfo else t.replace(tzinfo=timezone.utc)))
    except Exception:
        return None


def _rows(conn, phase: str) -> list[dict]:
    t = _tables(conn)
    if not {"flight_physio", "flight_metars", "flights"} <= t:
        return []
    p = "takeoff" if phase == "takeoff" else "landing"
    apt = "dep_icao" if p == "takeoff" else "arr_icao"
    rows = conn.execute(
        f"""SELECT fp.flight_id, fp.date, fp.dep_iata, fp.arr_iata,
                   fp.{p}_stress_delta AS stress_delta, fp.{p}_hr_delta AS hr_delta, fp.{p}_stress AS stress,
                   fp.{p}_you_flew AS you_flew, fp.{p}_crew AS crew,
                   fm.raw, fm.obs_time, fm.wind_dir, fm.wind_kt, fm.gust_kt, fm.vis_m, fm.ceiling_ft, fm.wx, fm.cb,
                   fm.category, f.notes, a.latitude AS lat, a.longitude AS lon,
                   {"COALESCE(f.landings_day,0) + COALESCE(f.landings_night,0)" if p == "landing"
                    else "COALESCE(f.takeoffs_day,0) + COALESCE(f.takeoffs_night,0)"} AS logged_by_you,
                   {"fr.runway, fr.source AS runway_source, fr.crosswind_kt, fr.headwind_kt" if p == "landing" and "flight_runways" in t
                    else "NULL AS runway, NULL AS runway_source, NULL AS crosswind_kt, NULL AS headwind_kt"}
            FROM flight_physio fp
            JOIN flight_metars fm ON fm.flight_id = fp.flight_id AND fm.phase = ?
            JOIN flights f ON f.id = fp.flight_id
            LEFT JOIN airports a ON a.icao = f.{apt}
            {"LEFT JOIN flight_runways fr ON fr.flight_id = fp.flight_id" if p == "landing" and "flight_runways" in t else ""}
            WHERE fm.obs_time IS NOT NULL AND fp.{p}_stress_delta IS NOT NULL""",
        (p,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        m = {"wind_kt": r["wind_kt"], "gust_kt": r["gust_kt"], "vis_m": r["vis_m"], "ceiling_ft": r["ceiling_ft"],
             "wx": (r["wx"] or "").split(), "cb": bool(r["cb"]), "category": r["category"]}
        d["cond"] = conditions(m)
        n = _night(r["lat"], r["lon"], r["obs_time"])
        if n is not None:
            d["cond"]["night"] = n
        # PF: the physio snapshot's own flag, or your logged T/O / landing (manual entries)
        d["cond"]["you_flew"] = bool(r["you_flew"]) or (r["logged_by_you"] or 0) > 0
        if r["crosswind_kt"] is not None:
            d["cond"]["crosswind"] = r["crosswind_kt"] >= 15
        out.append(d)
    return out


def effects(conn: sqlite3.Connection, phase: str = "landing", min_n: int = 4) -> dict:
    rows = _rows(conn, phase)
    res = []
    for key, label in LABELS.items():
        on = [r["stress_delta"] for r in rows if r["cond"].get(key) is True]
        off = [r["stress_delta"] for r in rows if r["cond"].get(key) is False]
        if len(on) < min_n or len(off) < min_n:
            res.append({"condition": key, "label": label, "n_with": len(on), "n_without": len(off),
                        "enough_data": False})
            continue
        hr_on = [r["hr_delta"] for r in rows if r["cond"].get(key) is True and r["hr_delta"] is not None]
        hr_off = [r["hr_delta"] for r in rows if r["cond"].get(key) is False and r["hr_delta"] is not None]
        t = _welch(on, off)
        res.append({
            "condition": key, "label": label, "enough_data": True,
            "stress_with": round(statistics.mean(on), 1), "stress_without": round(statistics.mean(off), 1),
            "delta": round(statistics.mean(on) - statistics.mean(off), 1),
            "hr_delta": round(statistics.mean(hr_on) - statistics.mean(hr_off), 1) if len(hr_on) > 1 and len(hr_off) > 1 else None,
            "n_with": len(on), "n_without": len(off), "t": round(t, 1),
            "strength": "strong" if abs(t) >= 2.5 else "likely" if abs(t) >= 1.4 else "unclear",
        })
    res.sort(key=lambda e: (not e["enough_data"], -abs(e.get("t", 0))))
    return {"phase": phase, "flights": len(rows),
            "avg_stress_delta": round(statistics.mean([r["stress_delta"] for r in rows]), 1) if rows else None,
            "effects": res}


def _metar_summary(r: dict) -> str:
    parts = []
    if r["wind_kt"] is not None:
        w = f"{r['wind_dir']:03d}°" if r["wind_dir"] is not None else "VRB"
        parts.append(f"{w}/{r['wind_kt']}" + (f"G{r['gust_kt']}" if r["gust_kt"] else "") + " kt")
    if r["vis_m"] is not None and r["vis_m"] < 10000:
        parts.append(f"vis {r['vis_m'] / 1000:.1f} km")
    if r["ceiling_ft"] is not None:
        parts.append(f"ceiling {r['ceiling_ft']} ft")
    if r["wx"]:
        parts.append(r["wx"])
    if r["category"] and r["category"] != "VFR":
        parts.append(r["category"])
    return " · ".join(parts) or "fine"


def toughest(conn: sqlite3.Connection, phase: str = "landing", limit: int = 8) -> list[dict]:
    rows = sorted(_rows(conn, phase), key=lambda r: -(r["stress_delta"] or 0))[:limit]
    return [{
        "flight_id": r["flight_id"], "date": r["date"], "route": f"{r['dep_iata'] or '?'}→{r['arr_iata'] or '?'}",
        "stress_delta": r["stress_delta"], "hr_delta": r["hr_delta"], "you_flew": r["cond"]["you_flew"],
        "crew": r["crew"], "weather": _metar_summary(r), "raw": r["raw"], "notes": r["notes"],
        "runway": r["runway"], "runway_source": r["runway_source"],
        "crosswind_kt": r["crosswind_kt"], "headwind_kt": r["headwind_kt"],
        "conditions": [LABELS[k].split(" (")[0] for k, v in r["cond"].items() if v and k != "you_flew"],
    } for r in rows]


def coverage(conn: sqlite3.Connection) -> dict:
    t = _tables(conn)
    flights = conn.execute("SELECT COUNT(*) FROM flights WHERE is_sim=0").fetchone()[0] if "flights" in t else 0
    with_metar = conn.execute(
        "SELECT COUNT(DISTINCT flight_id) FROM flight_metars WHERE obs_time IS NOT NULL").fetchone()[0] \
        if "flight_metars" in t else 0
    with_physio = conn.execute("SELECT COUNT(*) FROM flight_physio").fetchone()[0] if "flight_physio" in t else 0
    return {"flights": flights, "with_metar": with_metar, "with_physio": with_physio}
