"""
Intraday heart rate sync from Garmin Connect.

Pulls ~15-minute HR readings for each day via get_heart_rates() and stores
them in intraday_hr. This gives a continuous all-day HR signal (not just
during activities) for correlating HR spikes with:
  - duty_day / flight hours
  - companions (who were you with when HR was elevated?)
  - garmin stress_avg
  - locations

Data structure from Garmin:
  {
    "heartRateValues": [[epoch_ms, bpm], ...],   # may include null bpm
    "startTimestampLocal": "YYYY-MM-DDThh:mm:ss",
    ...
  }

Usage:
    python -m domains.health.garmin.intraday_hr_sync [--date YYYY-MM-DD] [--backfill-days N]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

_ROOT = Path(__file__).parents[3]

from infrastructure.db.connection import get_connection
from domains.health.garmin.garmin_client import get_client

RAW_DIR = _ROOT / "data" / "raw" / "garmin_hr"


def _store_raw(date_str: str, payload: object) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / f"{date_str}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2)
    )


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS intraday_hr (
            date       TEXT NOT NULL,
            time       TEXT NOT NULL,
            heart_rate INTEGER NOT NULL,
            PRIMARY KEY (date, time)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_intraday_hr_date ON intraday_hr(date)")
    conn.commit()


def _parse_heart_rates(raw: dict, date_str: str) -> list[tuple[str, str, int]]:
    """
    Returns [(date, HH:MM, bpm), ...] from Garmin's heartRateValues payload.
    Skips null readings. Converts epoch_ms → local HH:MM using the start
    timestamp's UTC offset so timezone-aware logging stays accurate.
    """
    values = raw.get("heartRateValues") or []
    start_local = raw.get("startTimestampLocal", "")
    start_gmt   = raw.get("startTimestampGMT", "")

    # Compute UTC offset from the two timestamps so we localise each reading
    tz_offset_s = 0
    if start_local and start_gmt:
        try:
            fmt = "%Y-%m-%dT%H:%M:%S"
            local_dt = datetime.strptime(start_local[:19], fmt)
            gmt_dt   = datetime.strptime(start_gmt[:19], fmt)
            tz_offset_s = int((local_dt - gmt_dt).total_seconds())
        except Exception:
            pass

    rows: list[tuple[str, str, int]] = []
    for entry in values:
        if not entry or len(entry) < 2:
            continue
        epoch_ms, bpm = entry[0], entry[1]
        if bpm is None or epoch_ms is None:
            continue
        bpm = int(bpm)
        if bpm <= 0:
            continue
        epoch_s = epoch_ms / 1000 + tz_offset_s
        dt = datetime.fromtimestamp(epoch_s, tz=timezone.utc).replace(tzinfo=None)
        time_str = dt.strftime("%H:%M")
        rows.append((date_str, time_str, bpm))
    return rows


def sync_date(client, conn: sqlite3.Connection, date_str: str, force: bool = False) -> int:
    """Sync intraday HR for a single date. Returns number of rows inserted."""
    if not force:
        existing = conn.execute(
            "SELECT COUNT(*) FROM intraday_hr WHERE date=?", (date_str,)
        ).fetchone()[0]
        if existing > 0:
            print(f"  {date_str}: {existing} readings already stored, skipping")
            return 0

    try:
        raw = client.get_heart_rates(date_str)
    except Exception as e:
        print(f"  {date_str}: fetch failed — {e}")
        return 0

    if not raw:
        print(f"  {date_str}: no data")
        return 0

    _store_raw(date_str, raw)

    rows = _parse_heart_rates(raw, date_str)
    if not rows:
        print(f"  {date_str}: parsed 0 readings")
        return 0

    conn.executemany(
        "INSERT OR REPLACE INTO intraday_hr (date, time, heart_rate) VALUES (?,?,?)",
        rows,
    )
    conn.commit()
    print(f"  {date_str}: stored {len(rows)} HR readings")
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="Sync a specific date YYYY-MM-DD (default: yesterday)")
    parser.add_argument("--backfill-days", type=int, default=0,
                        help="Sync the last N days")
    parser.add_argument("--force", action="store_true",
                        help="Re-sync even if data already exists")
    args = parser.parse_args()

    conn = get_connection()
    _ensure_table(conn)

    client = get_client()

    if args.backfill_days > 0:
        today = date.today()
        dates = [(today - timedelta(days=i)).isoformat() for i in range(args.backfill_days, 0, -1)]
    else:
        target = args.date or (date.today() - timedelta(days=1)).isoformat()
        dates = [target]

    total = 0
    for d in dates:
        total += sync_date(client, conn, d, force=args.force)

    conn.close()
    print(f"\nDone: {total} HR readings synced across {len(dates)} day(s)")


if __name__ == "__main__":
    main()
