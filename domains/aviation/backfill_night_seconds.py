"""
One-shot backfill: recompute night_seconds for manual flights that have
off_block_utc / on_block_utc stored as plain HH:MM (not ISO datetime).

Run on Pi:
    python -m domains.aviation.backfill_night_seconds --start 2026-06-02 --end 2026-06-18
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB_PATH = Path(__file__).parents[2] / "infrastructure" / "db" / "daybook.db"


def _parse_hhmm(date_str: str, value: str | None) -> datetime | None:
    if not value:
        return None
    t = value[11:16] if len(value) > 5 else value
    if ":" not in t:
        return None
    try:
        h, m = map(int, t.split(":"))
        d = datetime.fromisoformat(date_str)
        return datetime(d.year, d.month, d.day, h, m, tzinfo=timezone.utc)
    except Exception:
        return None


def run(start: str, end: str, dry_run: bool = False, db_path: Path = DB_PATH) -> None:
    import sqlite3
    from domains.aviation.compute import night_seconds as compute_night, great_circle_nm

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        """
        SELECT f.id, f.date, f.off_block_utc, f.on_block_utc,
               f.takeoff_utc, f.landing_utc,
               a1.latitude AS dep_lat, a1.longitude AS dep_lon,
               a2.latitude AS arr_lat, a2.longitude AS arr_lon
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE f.date BETWEEN ? AND ?
          AND f.is_sim = 0
          AND (f.night_seconds IS NULL OR f.night_seconds = 0)
          AND (f.off_block_utc IS NOT NULL OR f.takeoff_utc IS NOT NULL)
        ORDER BY f.date
        """,
        (start, end),
    ).fetchall()

    print(f"Found {len(rows)} flights with night_seconds=0 in {start}→{end}")

    updated = 0
    for r in rows:
        if not r["dep_lat"]:
            print(f"  SKIP {r['id']} — no airport coords")
            continue

        tof_dt = _parse_hhmm(r["date"], r["takeoff_utc"] or r["off_block_utc"])
        ldg_dt = _parse_hhmm(r["date"], r["landing_utc"] or r["on_block_utc"])

        if not tof_dt or not ldg_dt:
            print(f"  SKIP {r['id']} — could not parse times")
            continue

        if ldg_dt <= tof_dt:
            ldg_dt += timedelta(days=1)

        night_s = compute_night(
            dep_lat=r["dep_lat"],
            dep_lon=r["dep_lon"],
            takeoff_utc=tof_dt,
            landing_utc=ldg_dt,
            arr_lat=r["arr_lat"],
            arr_lon=r["arr_lon"],
        )

        night_h = round(night_s / 3600, 2)
        print(f"  {'DRY ' if dry_run else ''}{r['id']}  {r['date']}  {r['off_block_utc']}→{r['on_block_utc']}  night={night_h:.2f}h ({night_s}s)")

        if not dry_run:
            conn.execute(
                "UPDATE flights SET night_seconds = ? WHERE id = ?",
                (night_s, r["id"]),
            )
        updated += 1

    if not dry_run:
        conn.commit()
        print(f"\n✓ Updated {updated} flights")
    else:
        print(f"\n(dry run — {updated} flights would be updated)")

    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2026-06-02")
    parser.add_argument("--end", default="2026-06-20")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--db", default=str(DB_PATH))
    args = parser.parse_args()

    run(args.start, args.end, dry_run=args.dry_run, db_path=Path(args.db))
