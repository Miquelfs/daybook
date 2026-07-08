"""
Repair flights that cross midnight UTC: full_csv rows were imported with
landing_utc / on_block_utc on the same calendar date as takeoff, so flights
landing after 00:00 have landing < takeoff and night_seconds computed as 0.

Fix: roll landing/on_block forward a day until chronological, then recompute
night_seconds from the corrected datetimes.

Run on Pi:
    cd ~/daybook && python -m infrastructure.db.migrate_fix_midnight_flights [--dry-run]
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta
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
    from domains.aviation.compute import night_seconds as compute_night

    if not compute._ASTRAL_AVAILABLE:
        raise SystemExit(
            "ABORT: 'astral' is not installed in this Python — night time would "
            "compute as 0. Install it first (pip install astral) or use the venv python."
        )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute("""
        SELECT f.id, f.date, f.off_block_utc, f.takeoff_utc, f.landing_utc, f.on_block_utc,
               f.night_seconds,
               a1.latitude AS dep_lat, a1.longitude AS dep_lon,
               a2.latitude AS arr_lat, a2.longitude AS arr_lon
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE (f.landing_utc < f.takeoff_utc OR f.on_block_utc < f.off_block_utc)
          AND f.is_sim = 0
        ORDER BY f.date
    """).fetchall()

    print(f"Found {len(rows)} flights with inverted times (midnight crossing)")

    fixed = 0
    for r in rows:
        events = [_parse(r["off_block_utc"]), _parse(r["takeoff_utc"]),
                  _parse(r["landing_utc"]), _parse(r["on_block_utc"])]
        latest = None
        for i, t in enumerate(events):
            if t is None:
                continue
            if latest is not None:
                while t < latest:
                    t += timedelta(days=1)
            events[i] = t
            latest = t
        off_b, tof, ldg, on_b = events

        night_s = r["night_seconds"] or 0
        if tof and ldg and r["dep_lat"] is not None:
            night_s = compute_night(
                dep_lat=r["dep_lat"], dep_lon=r["dep_lon"],
                takeoff_utc=tof, landing_utc=ldg,
                arr_lat=r["arr_lat"], arr_lon=r["arr_lon"],
            )

        print(f"  {'DRY ' if dry_run else ''}{r['id']}  "
              f"ldg {r['landing_utc']} → {ldg.isoformat() if ldg else None}  "
              f"night {r['night_seconds']}s → {night_s}s ({night_s / 3600:.2f}h)")

        if not dry_run:
            conn.execute("""
                UPDATE flights
                SET off_block_utc = ?, takeoff_utc = ?, landing_utc = ?, on_block_utc = ?,
                    night_seconds = ?
                WHERE id = ?
            """, (
                off_b.isoformat() if off_b else r["off_block_utc"],
                tof.isoformat() if tof else r["takeoff_utc"],
                ldg.isoformat() if ldg else r["landing_utc"],
                on_b.isoformat() if on_b else r["on_block_utc"],
                night_s, r["id"],
            ))
        fixed += 1

    if not dry_run:
        conn.commit()
        print(f"\n✓ Fixed {fixed} flights")
    else:
        print(f"\n(dry run — {fixed} flights would be fixed)")
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--db", default=str(DB_PATH))
    args = parser.parse_args()
    run(dry_run=args.dry_run, db_path=Path(args.db))
