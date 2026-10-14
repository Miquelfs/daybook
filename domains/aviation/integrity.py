"""
Logbook integrity — find (and safely repair) impossible flight times.

The classic failure: an on-block time stored with the wrong DATE around
midnight UTC. The importer's Block Duration column stays right (e.g. 1:35) but
the off→on span becomes ~25 h, so night time computed over that span comes out
as several hours — "most night in a flight 6:18" while the longest flight is
5:31. Checks:

  night_gt_block   night time longer than block time            (impossible)
  span_mismatch    on-block − off-block ≠ block duration (>10 min)
  rollover         ... and the difference is ~±24 h             (wrong date)
  block_missing    no block duration but both block times exist
  airborne_gt_block airborne longer than block
  absurd_block     block < 5 min or > 18 h

repair() only does what is provably right:
  - rollover: shift the on-block (and landing) date by ±1 day to match block
  - block_missing: block = on-block − off-block (when 5 min … 18 h)
  - night: recompute over [off-block, off-block + block] and cap at block
Everything else is reported for you to look at, never guessed.

  python -m domains.aviation.integrity          # report
  python -m domains.aviation.integrity --fix    # repair what's provable, then report
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

TOLERANCE_S = 10 * 60
MIN_BLOCK_S = 5 * 60
MAX_BLOCK_S = 18 * 3600


def _dt(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _rows(conn):
    return conn.execute(
        """SELECT f.id, f.date, f.dep_icao, f.arr_icao, f.off_block_utc, f.on_block_utc,
                  f.takeoff_utc, f.landing_utc, f.block_seconds, f.airborne_seconds, f.night_seconds,
                  a1.latitude AS dep_lat, a1.longitude AS dep_lon,
                  a2.latitude AS arr_lat, a2.longitude AS arr_lon
           FROM flights f
           LEFT JOIN airports a1 ON a1.icao = f.dep_icao
           LEFT JOIN airports a2 ON a2.icao = f.arr_icao
           WHERE f.is_sim = 0"""
    ).fetchall()


def check(conn: sqlite3.Connection) -> dict:
    issues: dict[str, list[dict]] = {k: [] for k in
                                     ("night_gt_block", "rollover", "span_mismatch", "block_missing",
                                      "airborne_gt_block", "absurd_block")}
    rows = _rows(conn)
    for r in rows:
        off, on = _dt(r["off_block_utc"]), _dt(r["on_block_utc"])
        block = r["block_seconds"] or 0
        night = r["night_seconds"] or 0
        base = {"id": r["id"], "date": r["date"], "route": f"{r['dep_icao'] or '?'}→{r['arr_icao'] or '?'}",
                "block_s": block, "night_s": night}
        if block and night > block + 60:
            issues["night_gt_block"].append(base)
        if off and on:
            span = (on - off).total_seconds()
            if block:
                diff = span - block
                if abs(abs(diff) - 86400) <= TOLERANCE_S:
                    issues["rollover"].append({**base, "span_s": int(span)})
                elif abs(diff) > TOLERANCE_S:
                    issues["span_mismatch"].append({**base, "span_s": int(span)})
            elif MIN_BLOCK_S <= span <= MAX_BLOCK_S:
                issues["block_missing"].append({**base, "span_s": int(span)})
        if block and (r["airborne_seconds"] or 0) > block + 60:
            issues["airborne_gt_block"].append({**base, "airborne_s": r["airborne_seconds"]})
        if block and not (MIN_BLOCK_S <= block <= MAX_BLOCK_S):
            issues["absurd_block"].append(base)
    return {"flights_checked": len(rows),
            "issues": {k: v for k, v in issues.items()},
            "total": sum(len(v) for v in issues.values())}


def repair(conn: sqlite3.Connection, dry_run: bool = False) -> dict:
    from domains.aviation.compute import night_seconds as compute_night

    fixed = {"rollover": 0, "block_filled": 0, "night_recomputed": 0}
    for r in _rows(conn):
        off, on = _dt(r["off_block_utc"]), _dt(r["on_block_utc"])
        block = r["block_seconds"] or 0
        updates: dict = {}

        if off and on and block:
            diff = (on - off).total_seconds() - block
            if abs(abs(diff) - 86400) <= TOLERANCE_S:
                shift = timedelta(days=-1 if diff > 0 else 1)
                updates["on_block_utc"] = (on + shift).isoformat()
                ld = _dt(r["landing_utc"])
                if ld and abs((ld - on).total_seconds()) < 3 * 3600:   # landing shares the bad date
                    updates["landing_utc"] = (ld + shift).isoformat()
                on = on + shift
                fixed["rollover"] += 1
        if off and on and not block:
            span = int((on - off).total_seconds())
            if MIN_BLOCK_S <= span <= MAX_BLOCK_S:
                block = span
                updates["block_seconds"] = span
                fixed["block_filled"] += 1

        # Night over the block span, capped at block — independent of on-block's date.
        if off and block and r["dep_lat"] is not None and r["dep_lon"] is not None:
            night = compute_night(r["dep_lat"], r["dep_lon"], off, off + timedelta(seconds=block),
                                  r["arr_lat"], r["arr_lon"])
            night = min(int(night), int(block))
            if night != (r["night_seconds"] or 0):
                updates["night_seconds"] = night
                fixed["night_recomputed"] += 1
        elif block and (r["night_seconds"] or 0) > block:
            updates["night_seconds"] = int(block)
            fixed["night_recomputed"] += 1

        if updates and not dry_run:
            sets = ", ".join(f"{k}=?" for k in updates)
            conn.execute(f"UPDATE flights SET {sets} WHERE id=?", [*updates.values(), r["id"]])
    if not dry_run:
        conn.commit()
    return fixed


def _fmt(s):
    s = int(s or 0)
    return f"{s // 3600}:{(s % 3600) // 60:02d}"


def main() -> None:
    from infrastructure.db.connection import get_connection

    p = argparse.ArgumentParser(description="Logbook integrity check / repair")
    p.add_argument("--fix", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="with --fix: show counts, write nothing")
    args = p.parse_args()
    conn = get_connection()
    try:
        if args.fix:
            print("repair:", repair(conn, dry_run=args.dry_run))
        rep = check(conn)
        print(f"{rep['flights_checked']} flights checked, {rep['total']} issue(s)")
        for k, items in rep["issues"].items():
            if not items:
                continue
            print(f"\n{k} ({len(items)}):")
            for it in items[:15]:
                extra = f" span {_fmt(it['span_s'])}" if "span_s" in it else ""
                print(f"  {it['date']} {it['route']:<11} block {_fmt(it['block_s'])} night {_fmt(it['night_s'])}{extra}  [{it['id']}]")
            if len(items) > 15:
                print(f"  … {len(items) - 15} more")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
