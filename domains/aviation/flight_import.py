"""
Import flight figures from what you actually receive on the line:

  1. Altea "final figures" loadsheet messages (SMS/ACARS text) — parsed
     deterministically, no AI:
         D85623/OSLPMI/15OCT26        flight / route / date
         1808/15OCT                   message time (UTC)
         SERXA/15809                  registration / ref
         166/1/0                      adults / children / infants
         167+0                        total pax + infants
         A47/B73/C47                  pax per cabin zone
         1/0kg 2/496kg 3/1564kg 4/0kg hold weights
         C+M:0kg                      cargo + mail
         B:124pcs                     bags
         TOT 2060kg                   total hold load
         Remarks: … ACT AVG BW 15.9KG
  2. Anything else — a photo of the FMC (OUT/OFF/ON/IN, fuel), a fuel slip,
     another message format — read by Claude vision into the same fields.

Every import is stored in flight_loadsheets. It's applied to the matching
logbook flight (same date + flight number, else date + route) by filling only
EMPTY fields — never overwriting what's there. Imports for flights not yet in
the logbook wait and are linked automatically once the flight exists
(link_pending, nightly and after each import / new flight).
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import sqlite3
from datetime import datetime

log = logging.getLogger(__name__)

MONTHS = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                                       "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}
# Single-letter ICAO nationality prefixes (G-ABCD, D-ABCD, F-…, I-…, C-…, B-…)
_ONE_LETTER = set("GDFICBN")

# Fields we fill on the flight (when empty) — flight column → parsed key
APPLY = {
    "pax_total": "pax_total", "pax_adult": "pax_adult", "pax_child": "pax_child", "pax_infant": "pax_infant",
    "baggage_kg": "baggage_kg", "freight_kg": "freight_kg",
    "fuel_block_kg": "fuel_block_kg", "fuel_uplift_kg": "fuel_uplift_kg", "fuel_burn_kg": "fuel_burn_kg",
    "fuel_trip_kg": "fuel_trip_kg", "aircraft_reg": "aircraft_reg",
}


def _date(tok: str) -> str | None:
    m = re.fullmatch(r"(\d{2})([A-Z]{3})(\d{2})", tok)
    if not m or m.group(2) not in MONTHS:
        return None
    return f"20{m.group(3)}-{MONTHS[m.group(2)]:02d}-{m.group(1)}"


def format_reg(raw: str) -> str:
    raw = raw.strip().upper().replace("-", "")
    if len(raw) == 5 and raw[0] in _ONE_LETTER and raw[:2] not in ("CS", "SE", "EI", "EC", "OH", "OY", "LN"):
        return f"{raw[0]}-{raw[1:]}"
    return f"{raw[:2]}-{raw[2:]}" if len(raw) >= 4 else raw


def parse_loadsheet(text: str) -> dict | None:
    """Altea final-figures message → fields, or None if it doesn't look like one."""
    raw_t = text.replace("\r", "")
    t = raw_t.upper()            # structure matched case-insensitively; remarks keep their case
    head = re.search(r"\b([A-Z0-9]{2}\d{1,4}[A-Z]?)/([A-Z]{3})([A-Z]{3})/(\d{2}[A-Z]{3}\d{2})\b", t)
    if not head:
        return None
    out: dict = {"source": "loadsheet", "flight_number": head.group(1), "dep_iata": head.group(2),
                 "arr_iata": head.group(3), "date": _date(head.group(4))}
    if (m := re.search(r"^\s*(\d{4})/(\d{2}[A-Z]{3})\s*$", t, re.M)):
        out["message_time_utc"] = f"{m.group(1)[:2]}:{m.group(1)[2:]}"
    if (m := re.search(r"^\s*([A-Z]{2}[A-Z0-9]{2,4})/(\d+)\s*$", t, re.M)):
        out["aircraft_reg"] = format_reg(m.group(1))
        out["ref"] = m.group(2)
    if (m := re.search(r"^\s*(\d{1,3})/(\d{1,3})/(\d{1,3})\s*$", t, re.M)):
        out["pax_adult"], out["pax_child"], out["pax_infant"] = (int(m.group(i)) for i in (1, 2, 3))
    if (m := re.search(r"^\s*(\d{1,3})\+(\d{1,3})\s*$", t, re.M)):
        out["pax_total"] = int(m.group(1))
        out.setdefault("pax_infant", int(m.group(2)))
    if (m := re.search(r"^\s*((?:[A-Z]\d{1,3}/?)+)\s*$", t, re.M)):
        out["zones"] = {z[0]: int(z[1:]) for z in m.group(1).split("/") if z}
    holds = {int(h): int(kg) for h, kg in re.findall(r"^\s*(\d)/(\d+)\s*kg\s*$", t, re.M | re.I)}
    if holds:
        out["holds_kg"] = holds
    if (m := re.search(r"C\+M:\s*(\d+)\s*kg", t, re.I)):
        out["freight_kg"] = int(m.group(1))
    if (m := re.search(r"\bB:\s*(\d+)\s*pcs", t, re.I)):
        out["bags_pcs"] = int(m.group(1))
    if (m := re.search(r"\bTOT\s*(\d+)\s*kg", t, re.I)):
        out["hold_total_kg"] = int(m.group(1))
        out["baggage_kg"] = int(m.group(1)) - int(out.get("freight_kg") or 0)
    if (m := re.search(r"Remarks:\s*(.+)", raw_t, re.S | re.I)):
        out["remarks"] = " ".join(m.group(1).split()).strip(", ")
        if (bw := re.search(r"AVG BW\s*([\d.]+)\s*KG", out["remarks"], re.I)):
            out["avg_bag_kg"] = float(bw.group(1))
    if "pax_total" not in out and "pax_adult" in out:
        out["pax_total"] = out["pax_adult"] + out.get("pax_child", 0)
    return out


AI_PROMPT = """Extract flight data from this airline document (an FMC/ACARS screen photo, a
loadsheet, a fuel slip or a crew message). Use ONLY what is visible; null when absent.
Times are UTC as HH:MM. Weights in kg (convert from tonnes / lbs if needed).

Reply with ONLY this JSON:
{"date": "YYYY-MM-DD", "flight_number": "", "dep_iata": "", "arr_iata": "", "dep_icao": "", "arr_icao": "",
 "aircraft_reg": "", "off_block_utc": "HH:MM", "takeoff_utc": "HH:MM", "landing_utc": "HH:MM",
 "on_block_utc": "HH:MM", "block_minutes": 0, "airborne_minutes": 0,
 "fuel_block_kg": 0, "fuel_uplift_kg": 0, "fuel_burn_kg": 0, "fuel_trip_kg": 0, "fuel_remaining_kg": 0,
 "pax_total": 0, "pax_adult": 0, "pax_child": 0, "pax_infant": 0,
 "baggage_kg": 0, "bags_pcs": 0, "freight_kg": 0, "remarks": ""}"""


def ai_extract(text: str | None = None, image_bytes: bytes | None = None) -> dict | None:
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key or not (text or image_bytes):
        return None
    try:
        import anthropic
    except ImportError:
        return None
    content: list = []
    if image_bytes:
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                    "data": base64.standard_b64encode(image_bytes).decode()}})
    content.append({"type": "text", "text": AI_PROMPT + (f"\n\nText:\n{text}" if text else "")})
    try:
        resp = anthropic.Anthropic(api_key=key).messages.create(
            model=os.getenv("FLIGHT_VISION_MODEL", os.getenv("FOOD_VISION_MODEL", "claude-sonnet-5")),
            max_tokens=1024, messages=[{"role": "user", "content": content}])
        raw = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
        raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
        data = json.loads(raw)
    except Exception as e:
        log.warning("flight import AI failed: %s", e)
        return None
    clean = {k: v for k, v in data.items() if v not in (None, "", 0) or k.startswith("pax_infant")}
    clean["source"] = "photo" if image_bytes else "ai_text"
    return clean


def parse(text: str | None = None, image_bytes: bytes | None = None) -> dict | None:
    if text and not image_bytes:
        ls = parse_loadsheet(text)
        if ls:
            return ls
    return ai_extract(text, image_bytes)


# ── storage + matching ──────────────────────────────────────────────────────

def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS flight_loadsheets (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        flight_number TEXT, date TEXT, dep_iata TEXT, arr_iata TEXT,
        source        TEXT, raw_text TEXT, parsed_json TEXT NOT NULL,
        flight_id     TEXT,
        created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))""")
    conn.commit()


def _fn_key(fn: str | None) -> str:
    """'D8 5623' / 'D85623' / 'DY5623' → '5623' plus airline, compared loosely."""
    return re.sub(r"\s+", "", (fn or "").upper())


def match_flight(conn, parsed: dict) -> sqlite3.Row | None:
    if not parsed.get("date"):
        return None
    rows = conn.execute(
        """SELECT id, date, flight_number, dep_iata, arr_iata, dep_icao, arr_icao FROM flights
           WHERE date = ? AND is_sim = 0""", (parsed["date"],)).fetchall()
    fn = _fn_key(parsed.get("flight_number"))
    digits = re.sub(r"\D", "", fn[2:]) if len(fn) > 2 else ""
    for r in rows:
        k = _fn_key(r["flight_number"])
        if fn and (k == fn or (digits and re.sub(r"\D", "", k[2:]) == digits)):
            return r
    for r in rows:   # same day + same route
        if parsed.get("dep_iata") and r["dep_iata"] == parsed["dep_iata"] and r["arr_iata"] == parsed.get("arr_iata"):
            return r
    return None


def save(conn, parsed: dict, raw_text: str | None) -> int:
    ensure_table(conn)
    cur = conn.execute(
        """INSERT INTO flight_loadsheets (flight_number, date, dep_iata, arr_iata, source, raw_text, parsed_json)
           VALUES (?,?,?,?,?,?,?)""",
        (parsed.get("flight_number"), parsed.get("date"), parsed.get("dep_iata"), parsed.get("arr_iata"),
         parsed.get("source"), raw_text, json.dumps(parsed)))
    conn.commit()
    return cur.lastrowid


def apply(conn, loadsheet_id: int, flight_id: str) -> dict:
    """Fill the flight's EMPTY fields from the import; link it. Returns what changed."""
    ensure_table(conn)
    ls = conn.execute("SELECT * FROM flight_loadsheets WHERE id=?", (loadsheet_id,)).fetchone()
    f = conn.execute("SELECT * FROM flights WHERE id=?", (flight_id,)).fetchone()
    if not ls or not f:
        raise ValueError("not found")
    parsed = json.loads(ls["parsed_json"])
    keys = f.keys()
    sets: dict = {}
    for col, k in APPLY.items():
        if col in keys and parsed.get(k) not in (None, "") and f[col] in (None, "", 0):
            sets[col] = parsed[k]
    # Times only when the flight has none (an FMC photo of OUT/OFF/ON/IN)
    for col in ("off_block_utc", "takeoff_utc", "landing_utc", "on_block_utc"):
        v = parsed.get(col)
        if v and col in keys and not f[col] and re.fullmatch(r"\d{2}:\d{2}", v):
            sets[col] = f"{f['date']}T{v}:00+00:00"
    for col, k in (("block_seconds", "block_minutes"), ("airborne_seconds", "airborne_minutes")):
        if parsed.get(k) and col in keys and not f[col]:
            sets[col] = int(parsed[k]) * 60
    if sets:
        conn.execute(f"UPDATE flights SET {', '.join(f'{c}=?' for c in sets)} WHERE id=?",
                     [*sets.values(), flight_id])
    conn.execute("UPDATE flight_loadsheets SET flight_id=? WHERE id=?", (flight_id, loadsheet_id))
    conn.commit()
    return {"flight_id": flight_id, "filled": sorted(sets)}


def link_pending(conn) -> int:
    """Imports saved before their flight was logged → apply once the flight exists."""
    ensure_table(conn)
    n = 0
    for ls in conn.execute("SELECT id, parsed_json FROM flight_loadsheets WHERE flight_id IS NULL").fetchall():
        m = match_flight(conn, json.loads(ls["parsed_json"]))
        if m:
            apply(conn, ls["id"], m["id"])
            n += 1
    return n


def for_flight(conn, flight_id: str) -> list[dict]:
    ensure_table(conn)
    return [{"id": r["id"], "source": r["source"], "created_at": r["created_at"], **json.loads(r["parsed_json"])}
            for r in conn.execute("SELECT * FROM flight_loadsheets WHERE flight_id=? ORDER BY id", (flight_id,))]


def main() -> None:
    from infrastructure.db.connection import get_connection
    conn = get_connection()
    try:
        print(f"loadsheets linked: {link_pending(conn)}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
