"""
Patch the 3 full_csv flights whose departure ICAO was blank in the source CSV.
All three departed Berlin Brandenburg (EDDB / BER).

Their departure timestamps are corrupted: the source row had a blank departure
timezone (Region_x), so the departure times were parsed as UTC (2h late in
summer), landing appeared before takeoff, and migrate_fix_midnight_flights then
rolled the landing forward a day — producing bogus ~23h flights.

Fix: trust the arrival side (its timezone was applied correctly) plus the
authoritative block/airborne durations from the CSV. Reconstruct all four
timestamps on the flight date:
    landing   = arrival clock time on the flight date
    on_block  = arrival clock time on the flight date
    takeoff   = landing  - airborne_seconds
    off_block = on_block - block_seconds
then set the departure airport and recompute distance + night_seconds.

Run on Pi (must use the venv python — system python lacks astral):
    cd ~/daybook && .venv/bin/python -m infrastructure.db.migrate_fix_berlin_departures [--dry-run]
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
from pathlib import Path

DB_PATH = Path(__file__).parent / "daybook.db"


def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso)
    except ValueError:
        return None


def run(dry_run: bool = False, db_path: Path = DB_PATH) -> None:
    import sqlite3
    from domains.aviation import compute
    from domains.aviation.compute import night_seconds as compute_night, great_circle_nm

    if not compute._ASTRAL_AVAILABLE:
        raise SystemExit(
            "ABORT: 'astral' is not installed in this Python — night time would "
            "compute as 0. Use ~/daybook/.venv/bin/python."
        )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    edb = conn.execute("SELECT latitude, longitude FROM airports WHERE icao = 'EDDB'").fetchone()
    if not edb or edb["latitude"] is None:
        raise SystemExit("ABORT: EDDB not found / no coords in airports table.")

    rows = conn.execute("""
        SELECT f.id, f.date, f.landing_utc, f.on_block_utc,
               f.block_seconds, f.airborne_seconds,
               a2.latitude AS arr_lat, a2.longitude AS arr_lon
        FROM flights f
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE f.source = 'full_csv' AND f.dep_icao IS NULL
        ORDER BY f.date
    """).fetchall()

    print(f"Found {len(rows)} full_csv flights with a blank departure → setting EDDB/BER")

    for r in rows:
        fd = date.fromisoformat(r["date"])

        def _anchor(iso: str | None) -> datetime | None:
            """Keep the (correctly tz'd) arrival clock time, force it onto the flight date."""
            dt = _parse(iso)
            if not dt:
                return None
            return dt.replace(year=fd.year, month=fd.month, day=fd.day)

        landing = _anchor(r["landing_utc"])
        on_block = _anchor(r["on_block_utc"])
        airborne_s = r["airborne_seconds"]
        block_s = r["block_seconds"]

        takeoff = landing - timedelta(seconds=airborne_s) if (landing and airborne_s) else None
        off_block = on_block - timedelta(seconds=block_s) if (on_block and block_s) else None

        night_s = 0
        if takeoff and landing:
            night_s = compute_night(
                dep_lat=edb["latitude"], dep_lon=edb["longitude"],
                takeoff_utc=takeoff, landing_utc=landing,
                arr_lat=r["arr_lat"], arr_lon=r["arr_lon"],
            )

        dist_nm = None
        if r["arr_lat"] is not None:
            dist_nm = round(great_circle_nm(edb["latitude"], edb["longitude"], r["arr_lat"], r["arr_lon"]), 1)

        print(f"  {'DRY ' if dry_run else ''}{r['id']}  {r['date']}  "
              f"{takeoff.strftime('%H:%M') if takeoff else '--'}→{landing.strftime('%H:%M') if landing else '--'}  "
              f"night={night_s / 3600:.2f}h ({night_s}s)  dist={dist_nm} NM")

        if not dry_run:
            conn.execute("""
                UPDATE flights
                SET dep_icao = 'EDDB', dep_iata = 'BER',
                    off_block_utc = COALESCE(?, off_block_utc),
                    takeoff_utc   = COALESCE(?, takeoff_utc),
                    landing_utc   = COALESCE(?, landing_utc),
                    on_block_utc  = COALESCE(?, on_block_utc),
                    night_seconds = ?,
                    distance_nm   = COALESCE(?, distance_nm)
                WHERE id = ?
            """, (
                off_block.isoformat() if off_block else None,
                takeoff.isoformat() if takeoff else None,
                landing.isoformat() if landing else None,
                on_block.isoformat() if on_block else None,
                night_s, dist_nm, r["id"],
            ))

    if not dry_run:
        conn.commit()
        print(f"\n✓ Fixed {len(rows)} flights")
    else:
        print(f"\n(dry run — {len(rows)} flights would be fixed)")
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--db", default=str(DB_PATH))
    args = parser.parse_args()
    run(dry_run=args.dry_run, db_path=Path(args.db))
