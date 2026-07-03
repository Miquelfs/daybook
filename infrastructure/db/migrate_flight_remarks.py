"""
Add `remarks` column to flights table and backfill pic_name from Full.csv raw_payload.

Run on Pi:
    python -m infrastructure.db.migrate_flight_remarks
"""

import json
import logging
import sys

from infrastructure.db.connection import get_connection

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

PILOT_CODE = "FARMIQ"


def _captain_from_verified(verified: str) -> str | None:
    v = (verified or "").strip()
    if not v or v.upper() == "NOT VERIFIED":
        return None
    code = v.split(",")[0].strip()
    if len(code) == 6 and code.isalpha() and code.upper() != PILOT_CODE:
        return code.upper()
    return None


def run():
    conn = get_connection()

    # 1. Add remarks column if missing
    cols = {row[1] for row in conn.execute("PRAGMA table_info(flights)").fetchall()}
    if "remarks" not in cols:
        conn.execute("ALTER TABLE flights ADD COLUMN remarks TEXT")
        log.info("Added remarks column to flights")
    else:
        log.info("remarks column already exists")

    # 2. Backfill pic_name for full_csv flights using raw_payload
    #    Group by (date, registration) so the captain from one signed row propagates to all.
    from collections import defaultdict

    rows = conn.execute(
        "SELECT id, date, source, raw_payload, crew_role, takeoff_crew, landing_crew, pic_name "
        "FROM flights WHERE source = 'full_csv'"
    ).fetchall()

    # Build captain index: (raw_date_slash, reg) → captain_code
    by_day_reg: dict[tuple, list] = defaultdict(list)
    for r in rows:
        try:
            payload = json.loads(r["raw_payload"] or "{}")
        except Exception:
            continue
        raw_date = (payload.get("Date") or "").strip()
        reg = (payload.get("Registration") or "").strip()
        by_day_reg[(raw_date, reg)].append((r, payload))

    captain_index: dict[tuple, str] = {}
    for key, group in by_day_reg.items():
        captain = None
        for r, payload in group:
            cap = _captain_from_verified(payload.get("Verified By", ""))
            if cap:
                captain = cap
                break
        if not captain:
            for r, payload in group:
                for col in ("Take Off", "Landing"):
                    c = (payload.get(col) or "").strip().upper()
                    if c and c != PILOT_CODE and len(c) == 6 and c.isalpha():
                        captain = c
                        break
                if captain:
                    break
        if captain:
            captain_index[key] = captain

    # Apply backfill
    updated = 0
    for r in rows:
        if r["pic_name"]:
            continue  # already set, skip
        try:
            payload = json.loads(r["raw_payload"] or "{}")
        except Exception:
            continue
        raw_date = (payload.get("Date") or "").strip()
        reg = (payload.get("Registration") or "").strip()
        captain = captain_index.get((raw_date, reg))
        if captain:
            conn.execute(
                "UPDATE flights SET pic_name = ? WHERE id = ?",
                (captain, r["id"]),
            )
            updated += 1

    # 3. Backfill aircraft_type for 9H-VUA/B/C/E (MAX 8-200, now in fleet CSV)
    vua_regs = ("9H-VUA", "9H-VUB", "9H-VUC", "9H-VUE")
    placeholders = ",".join("?" * len(vua_regs))
    r2 = conn.execute(
        f"UPDATE flights SET aircraft_type = 'Boeing 737 MAX 8-200' WHERE aircraft_reg IN ({placeholders}) AND aircraft_type IS NULL",
        vua_regs,
    )
    log.info("Set aircraft_type for 9H-VUA/B/C/E: %d flights", r2.rowcount)

    conn.commit()
    conn.close()
    log.info("Backfilled pic_name on %d flights", updated)


if __name__ == "__main__":
    run()
