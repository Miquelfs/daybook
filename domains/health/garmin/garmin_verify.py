"""
Coverage report for all Garmin health tables.
Prints row counts, date ranges, and gap detection for each table.
Also compares health table dates against the days spine.

Usage:
    python -m daybook.domains.health.garmin.garmin_verify
"""

import sys
from datetime import date, timedelta
from pathlib import Path

_ROOT = Path(__file__).parents[3]   # daybook/

from infrastructure.db.connection import get_connection

TABLES = ["sleep", "daily_stats", "hrv"]


def find_gaps(dates: list[str]) -> list[tuple[str, str]]:
    """Return list of (gap_start, gap_end) for missing date ranges."""
    if not dates:
        return []
    gaps = []
    prev = date.fromisoformat(dates[0])
    for ds in dates[1:]:
        curr = date.fromisoformat(ds)
        if (curr - prev).days > 1:
            gaps.append((
                (prev + timedelta(days=1)).isoformat(),
                (curr - timedelta(days=1)).isoformat(),
            ))
        prev = curr
    return gaps


def report() -> None:
    conn = get_connection()

    # Days spine
    spine_dates = [r[0] for r in conn.execute("SELECT date FROM days ORDER BY date").fetchall()]
    spine_set = set(spine_dates)
    print(f"\n{'─'*60}")
    print(f"  days (spine)  {len(spine_dates)} rows  {spine_dates[0]} → {spine_dates[-1]}")

    for table in TABLES:
        rows = conn.execute(f"SELECT date FROM {table} ORDER BY date").fetchall()
        dates = [r[0] for r in rows]
        if not dates:
            print(f"\n  {table:<16} NO DATA")
            continue

        gaps = find_gaps(dates)
        orphans = [d for d in dates if d not in spine_set]

        print(f"\n{'─'*60}")
        print(f"  {table:<16} {len(dates)} rows  {dates[0]} → {dates[-1]}")
        print(f"  {'coverage':<16} {len(gaps)} gaps  {len(orphans)} orphans (not in days spine)")
        if gaps[:5]:
            for gs, ge in gaps[:5]:
                print(f"    gap: {gs} → {ge}")
            if len(gaps) > 5:
                print(f"    ... and {len(gaps) - 5} more gaps")

    # Activities
    act_rows = conn.execute(
        "SELECT COUNT(*), MIN(date), MAX(date) FROM activities"
    ).fetchone()
    print(f"\n{'─'*60}")
    print(f"  {'activities':<16} {act_rows[0]} rows  {act_rows[1]} → {act_rows[2]}")

    # Sync log summary
    log_rows = conn.execute(
        "SELECT source, data_type, status, COUNT(*) as n, MAX(run_at) FROM sync_log GROUP BY source, data_type, status ORDER BY source, data_type"
    ).fetchall()
    if log_rows:
        print(f"\n{'─'*60}")
        print("  sync_log:")
        for r in log_rows:
            print(f"    {r[0]}/{r[1]:<14} {r[2]:<8} {r[3]:>5} runs  last: {r[4]}")

    print(f"\n{'─'*60}\n")
    conn.close()


def main() -> None:
    report()


if __name__ == "__main__":
    main()
