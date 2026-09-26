"""storage_report.py — run on the Pi: where the SD card's space goes, how fast it
grows, and roughly when it fills up.

Growth is measured from the data itself, not guessed: for every table with a
date-like column, the share of rows from the last WINDOW days × the table's
on-disk bytes = bytes added per WINDOW. Photos and raw files use mtime.

Stdlib only, read-only (opens every DB with mode=ro).

Usage (on the Pi):  make storage-report
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import time
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_DIR = ROOT / "infrastructure" / "db"
BACKUP_DIR = ROOT / "data" / "backups"
FILE_DIRS = [ROOT / "data" / "photos", ROOT / "data" / "raw", ROOT / "infrastructure" / "scripts" / "logs"]
WINDOW = 30
BACKUP_KEEP = 3          # backup.sh KEEP
BACKUP_MIN_FREE = 1500e6  # backup.sh MIN_FREE_MB

DATE_COLS = ["date", "local_date", "day", "date_str", "start_date", "start_time", "timestamp",
             "ts", "recorded_at", "time", "created_at", "updated_at"]


def mb(n: float) -> str:
    return f"{n / 1e6:,.1f} MB" if abs(n) < 1e9 else f"{n / 1e9:,.2f} GB"


def table_bytes(conn: sqlite3.Connection) -> dict[str, int]:
    """On-disk bytes per table (indexes folded into their table). Needs dbstat;
    falls back to splitting the file size by row count."""
    owner = {r[0]: r[1] for r in conn.execute("SELECT name, tbl_name FROM sqlite_master")}
    try:
        sizes: dict[str, int] = {}
        for name, size in conn.execute("SELECT name, SUM(pgsize) FROM dbstat GROUP BY name"):
            t = owner.get(name, name)
            sizes[t] = sizes.get(t, 0) + size
        return sizes
    except sqlite3.OperationalError:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        counts = {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
        total = sum(counts.values()) or 1
        page_bytes = conn.execute("PRAGMA page_count").fetchone()[0] * conn.execute("PRAGMA page_size").fetchone()[0]
        return {t: page_bytes * c // total for t, c in counts.items()}


def cutoffs(sample) -> tuple[object, object] | None:
    """(window cutoff, 2×window cutoff) in the same representation as `sample`."""
    now = datetime.now()
    a, b = now - timedelta(days=WINDOW), now - timedelta(days=2 * WINDOW)
    if isinstance(sample, str) and len(sample) >= 10 and sample[4] == "-":
        return a.strftime("%Y-%m-%d"), b.strftime("%Y-%m-%d")
    if isinstance(sample, (int, float)):
        if sample > 1e12:
            return a.timestamp() * 1000, b.timestamp() * 1000
        if sample > 1e9:
            return a.timestamp(), b.timestamp()
    return None


def table_growth(conn: sqlite3.Connection, table: str) -> tuple[str, int, int, bool] | None:
    """(date column, total rows, rows in window, old enough to trust) or None."""
    cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]
    for col in [c for c in DATE_COLS if c in cols]:
        sample = conn.execute(f'SELECT "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL LIMIT 1').fetchone()
        if not sample:
            continue
        cut = cutoffs(sample[0])
        if not cut:
            continue
        total, recent, older = conn.execute(
            f'SELECT COUNT(*), SUM("{col}" >= ?), SUM("{col}" < ?) FROM "{table}"', (cut[0], cut[1])
        ).fetchone()
        # A table with nothing older than 2×WINDOW is new or a rewritten cache —
        # its "recent" rows aren't steady daily growth, so don't extrapolate it.
        return col, total, recent or 0, (older or 0) > 0
    return None


def dir_growth(path: Path) -> tuple[int, int]:
    """(total bytes, bytes modified in the last WINDOW days)."""
    total = recent = 0
    cutoff = time.time() - WINDOW * 86400
    for dirpath, _, files in os.walk(path):
        for f in files:
            try:
                st = os.stat(os.path.join(dirpath, f))
            except OSError:
                continue
            total += st.st_size
            if st.st_mtime >= cutoff:
                recent += st.st_size
    return total, recent


def main() -> None:
    disk = shutil.disk_usage(ROOT)
    print(f"Disk: {mb(disk.used)} used of {mb(disk.total)} — {mb(disk.free)} free "
          f"({disk.used / disk.total:.0%} full)\n")

    per_day = 0.0
    db_per_day = 0.0
    db_total = 0
    rows = []
    skipped = []
    for db in sorted(DB_DIR.glob("*.db")):
        size = sum(p.stat().st_size for p in [db, Path(f"{db}-wal")] if p.exists())
        db_total += size
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            for table, nbytes in table_bytes(conn).items():
                if table.startswith("sqlite_") or nbytes < 1e6:
                    continue
                try:
                    g = table_growth(conn, table)
                except sqlite3.Error:
                    g = None
                if not g or not g[1]:
                    skipped.append((f"{db.stem}.{table}", nbytes, "no date column"))
                    continue
                col, total, recent, trusted = g
                if not trusted:
                    skipped.append((f"{db.stem}.{table}", nbytes, "new table or cache"))
                    continue
                daily = nbytes * recent / total / WINDOW
                db_per_day += daily
                rows.append((f"{db.stem}.{table}", nbytes, daily))
        finally:
            conn.close()
    per_day += db_per_day

    print(f"Databases: {mb(db_total)}   growth ≈ {mb(db_per_day)}/day")
    for name, nbytes, daily in sorted(rows, key=lambda r: -r[2])[:12]:
        print(f"    {name:<40} {mb(nbytes):>11}   +{mb(daily)}/day")
    if skipped:
        print("  Not extrapolated (≥1 MB):")
        for name, nbytes, why in sorted(skipped, key=lambda r: -r[1])[:8]:
            print(f"    {name:<40} {mb(nbytes):>11}   ({why})")

    print("\nFiles:")
    for d in FILE_DIRS:
        if d.exists():
            total, recent = dir_growth(d)
            per_day += recent / WINDOW
            print(f"    {str(d.relative_to(ROOT)):<40} {mb(total):>11}   +{mb(recent / WINDOW)}/day")

    backups = sorted(BACKUP_DIR.glob("*.db.gz"), key=lambda p: p.stat().st_mtime)
    backup_total = sum(p.stat().st_size for p in backups)
    # Snapshots are gzip'd DBs, so they grow with the DBs at the compression ratio.
    latest_set = {}
    for p in backups:
        latest_set[p.name.rsplit("_", 2)[0]] = p.stat().st_size
    ratio = sum(latest_set.values()) / db_total if db_total and latest_set else 0.35
    backup_per_day = BACKUP_KEEP * db_per_day * ratio
    per_day += backup_per_day
    print(f"    {'data/backups':<40} {mb(backup_total):>11}   +{mb(backup_per_day)}/day "
          f"({len(backups)} files, gzip ratio {ratio:.0%})")

    print(f"\nTotal growth ≈ {mb(per_day)}/day  ≈ {mb(per_day * 30)}/month  ≈ {mb(per_day * 365)}/year")
    if per_day <= 0:
        return

    def when(days: float) -> str:
        if days > 36500:
            return "more than 100 years"
        return f"≈ {days:,.0f} days  → {date.today() + timedelta(days=days)}"

    stop = (disk.free - BACKUP_MIN_FREE) / per_day
    if stop > 0:
        print(f"Pi backups stop (<{mb(BACKUP_MIN_FREE)} free) in {when(stop)}")
    print(f"SD card full in {when(disk.free / per_day)}")


if __name__ == "__main__":
    main()
