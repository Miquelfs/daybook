"""
Recompute night time and the day/night takeoff·landing split on the EASA basis:
night is the portion of BLOCK time (off-block → on-block) in darkness, and a
takeoff/landing counts as night when the off-block/on-block moment is in darkness.

This fixes flights whose night_seconds was corrected by an earlier pass while the
day/night T/O·Ldg counts were left stale. It only reassigns day↔night within each
flight's existing totals (so it never invents takeoffs/landings for sectors you
didn't fly as PF).

Run on Pi (recompute everything):
    python -m domains.aviation.backfill_night_seconds

Preview only (no writes), optionally scoped to a date range:
    python -m domains.aviation.backfill_night_seconds --dry-run --start 2026-06-02 --end 2026-06-18
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
    from domains.aviation import compute
    from domains.aviation.compute import night_seconds as compute_night, is_night_moment

    if not compute._ASTRAL_AVAILABLE:
        raise SystemExit(
            "ABORT: 'astral' is not installed in this Python — night time would "
            "compute as 0. Install it first (pip install astral) or use the venv python."
        )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        """
        SELECT f.id, f.date, f.off_block_utc, f.on_block_utc,
               f.takeoff_utc, f.landing_utc, f.night_seconds,
               f.takeoffs_day, f.takeoffs_night, f.landings_day, f.landings_night,
               a1.latitude AS dep_lat, a1.longitude AS dep_lon,
               a2.latitude AS arr_lat, a2.longitude AS arr_lon
        FROM flights f
        LEFT JOIN airports a1 ON a1.icao = f.dep_icao
        LEFT JOIN airports a2 ON a2.icao = f.arr_icao
        WHERE f.date BETWEEN ? AND ?
          AND f.is_sim = 0
          AND (f.off_block_utc IS NOT NULL OR f.takeoff_utc IS NOT NULL)
        ORDER BY f.date
        """,
        (start, end),
    ).fetchall()

    print(f"Found {len(rows)} flights in {start}→{end}")

    updated = 0
    for r in rows:
        if r["dep_lat"] is None:
            print(f"  SKIP {r['id']} — no departure airport coords")
            continue

        # Block times are the EASA basis; fall back to airborne times if missing.
        off_dt = _parse_hhmm(r["date"], r["off_block_utc"] or r["takeoff_utc"])
        on_dt = _parse_hhmm(r["date"], r["on_block_utc"] or r["landing_utc"])
        if not off_dt or not on_dt:
            print(f"  SKIP {r['id']} — could not parse times")
            continue
        if on_dt <= off_dt:
            on_dt += timedelta(days=1)

        night_s = compute_night(
            dep_lat=r["dep_lat"], dep_lon=r["dep_lon"],
            takeoff_utc=off_dt, landing_utc=on_dt,
            arr_lat=r["arr_lat"], arr_lon=r["arr_lon"],
        )

        # Reassign day↔night within existing PF totals (never invent counts).
        tot_to = (r["takeoffs_day"] or 0) + (r["takeoffs_night"] or 0)
        tot_ldg = (r["landings_day"] or 0) + (r["landings_night"] or 0)
        to_is_night = is_night_moment(r["dep_lat"], r["dep_lon"], off_dt)
        arr_lat = r["arr_lat"] if r["arr_lat"] is not None else r["dep_lat"]
        arr_lon = r["arr_lon"] if r["arr_lon"] is not None else r["dep_lon"]
        ldg_is_night = is_night_moment(arr_lat, arr_lon, on_dt)

        to_night = tot_to if to_is_night else 0
        to_day = tot_to - to_night
        ldg_night = tot_ldg if ldg_is_night else 0
        ldg_day = tot_ldg - ldg_night

        changed = (
            night_s != (r["night_seconds"] or 0)
            or to_day != (r["takeoffs_day"] or 0)
            or to_night != (r["takeoffs_night"] or 0)
            or ldg_day != (r["landings_day"] or 0)
            or ldg_night != (r["landings_night"] or 0)
        )
        if not changed:
            continue

        night_h = round(night_s / 3600, 2)
        print(
            f"  {'DRY ' if dry_run else ''}{r['id']}  {r['date']}  "
            f"{r['off_block_utc']}→{r['on_block_utc']}  night={night_h:.2f}h  "
            f"T/O {r['takeoffs_day']}d/{r['takeoffs_night']}n→{to_day}d/{to_night}n  "
            f"Ldg {r['landings_day']}d/{r['landings_night']}n→{ldg_day}d/{ldg_night}n"
        )

        if not dry_run:
            conn.execute(
                """
                UPDATE flights
                SET night_seconds = ?,
                    takeoffs_day = ?, takeoffs_night = ?,
                    landings_day = ?, landings_night = ?
                WHERE id = ?
                """,
                (night_s, to_day, to_night, ldg_day, ldg_night, r["id"]),
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
    parser.add_argument("--start", default="2000-01-01")
    parser.add_argument("--end", default="2100-01-01")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--db", default=str(DB_PATH))
    args = parser.parse_args()

    run(args.start, args.end, dry_run=args.dry_run, db_path=Path(args.db))
