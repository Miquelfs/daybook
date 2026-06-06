"""
Best efforts engine — computes fastest times over standard distances from GPS streams.

For each running activity, slides a two-pointer window over the distance+time streams
to find the minimum elapsed time covering each target distance. Results stored in
best_efforts table and queryable as all-time or per-year PRs.

Usage:
    python -m domains.health.insights.best_efforts               # process all unprocessed
    python -m domains.health.insights.best_efforts --activity-id garmin_12345
    python -m domains.health.insights.best_efforts --all          # recompute all history
    python -m domains.health.insights.best_efforts --show         # print current PR table
"""

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parents[3]
DB_PATH = ROOT / "infrastructure" / "db" / "daybook.db"

# Standard distances in meters with human labels
TARGETS: list[tuple[float, str]] = [
    (400,    "400m"),
    (805,    "1/2 mile"),
    (1000,   "1K"),
    (1609,   "1 mile"),
    (3219,   "2 mile"),
    (5000,   "5K"),
    (10000,  "10K"),
    (15000,  "15K"),
    (16093,  "10 mile"),
    (20000,  "20K"),
    (21097,  "Half Marathon"),
    (30000,  "30K"),
    (42195,  "Marathon"),
]

RUNNING_TYPES = {"running", "trail_running", "treadmill_running", "track_running"}


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def _ensure_table(con: sqlite3.Connection) -> None:
    con.execute("""
        CREATE TABLE IF NOT EXISTS best_efforts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            activity_id     TEXT NOT NULL,
            date            TEXT NOT NULL,
            distance_meters REAL NOT NULL,
            target_label    TEXT NOT NULL,
            duration_seconds REAL NOT NULL,
            UNIQUE(activity_id, target_label)
        )
    """)
    con.execute("CREATE INDEX IF NOT EXISTS idx_be_date ON best_efforts(date)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_be_label ON best_efforts(target_label)")
    con.commit()


def _sliding_window(distances: list[float], times: list[float], target_m: float) -> float | None:
    """
    Two-pointer sliding window over cumulative distance/time arrays.
    Returns the minimum elapsed seconds to cover target_m, or None if
    the activity total distance is less than target_m.
    """
    n = len(distances)
    if n < 2:
        return None
    if distances[-1] < target_m:
        return None

    best: float | None = None
    left = 0

    for right in range(1, n):
        covered = distances[right] - distances[left]
        while covered >= target_m:
            elapsed = times[right] - times[left]
            if elapsed > 0 and (best is None or elapsed < best):
                best = elapsed
            left += 1
            if left >= right:
                break
            covered = distances[right] - distances[left]

    return best


def compute_for_activity(con: sqlite3.Connection, activity_id: str, date: str) -> int:
    """
    Compute best efforts for one activity. Returns number of efforts stored.
    Reads distance and time streams from activity_streams table.
    """
    row = con.execute(
        "SELECT stream_type, data_json FROM activity_streams WHERE activity_id = ? AND stream_type IN ('distance', 'time')",
        (activity_id,)
    ).fetchall()

    streams: dict[str, list[float]] = {}
    for r in row:
        try:
            streams[r["stream_type"]] = json.loads(r["data_json"])
        except Exception:
            continue

    if "distance" not in streams or "time" not in streams:
        return 0

    distances = streams["distance"]
    times = streams["time"]

    if len(distances) != len(times) or len(distances) < 2:
        return 0

    # Delete existing efforts for this activity (idempotent)
    con.execute("DELETE FROM best_efforts WHERE activity_id = ?", (activity_id,))

    stored = 0
    for target_m, label in TARGETS:
        best_secs = _sliding_window(distances, times, target_m)
        if best_secs is not None:
            con.execute(
                "INSERT OR REPLACE INTO best_efforts (activity_id, date, distance_meters, target_label, duration_seconds) VALUES (?, ?, ?, ?, ?)",
                (activity_id, date, target_m, label, best_secs)
            )
            stored += 1

    con.commit()
    return stored


def process_all(con: sqlite3.Connection, force: bool = False, activity_id: str | None = None) -> int:
    """Process all eligible running activities. Returns total efforts stored."""
    if activity_id:
        rows = con.execute(
            "SELECT id, date, activity_type FROM activities WHERE id = ?",
            (activity_id,)
        ).fetchall()
    elif force:
        rows = con.execute(
            "SELECT id, date, activity_type FROM activities WHERE activity_type IN ({})".format(
                ",".join("?" * len(RUNNING_TYPES))
            ),
            list(RUNNING_TYPES)
        ).fetchall()
    else:
        # Only activities not yet processed
        rows = con.execute(
            """SELECT a.id, a.date, a.activity_type FROM activities a
               LEFT JOIN best_efforts be ON be.activity_id = a.id
               WHERE a.activity_type IN ({})
                 AND be.id IS NULL
                 AND EXISTS (SELECT 1 FROM activity_streams s WHERE s.activity_id = a.id AND s.stream_type = 'distance')
            """.format(",".join("?" * len(RUNNING_TYPES))),
            list(RUNNING_TYPES)
        ).fetchall()

    total = 0
    for r in rows:
        n = compute_for_activity(con, r["id"], r["date"])
        if n:
            print(f"  {r['id']} ({r['date']}): {n} efforts")
        total += n

    return total


def get_prs(con: sqlite3.Connection, year: int | None = None) -> list[dict]:
    """Return all-time (or per-year) PRs: best duration per target distance."""
    params: list = []
    year_clause = ""
    if year:
        year_clause = "WHERE date LIKE ?"
        params.append(f"{year}-%")

    rows = con.execute(
        f"""
        SELECT
            be.target_label,
            be.distance_meters,
            MIN(be.duration_seconds) AS duration_seconds,
            be.activity_id,
            be.date
        FROM best_efforts be
        {year_clause}
        GROUP BY be.target_label
        ORDER BY be.distance_meters
        """,
        params
    ).fetchall()

    return [dict(r) for r in rows]


def fmt_duration(seconds: float) -> str:
    s = int(seconds)
    h = s // 3600
    m = (s % 3600) // 60
    sec = s % 60
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


def fmt_pace(seconds: float, distance_m: float) -> str:
    pace_sec_km = seconds / (distance_m / 1000)
    m = int(pace_sec_km // 60)
    s = int(pace_sec_km % 60)
    return f"{m}:{s:02d}/km"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="Recompute all history")
    parser.add_argument("--activity-id", help="Process single activity")
    parser.add_argument("--show", action="store_true", help="Print PR table")
    parser.add_argument("--year", type=int, help="Filter PRs by year")
    args = parser.parse_args()

    con = _conn()
    _ensure_table(con)

    if args.show:
        prs = get_prs(con, year=args.year)
        print(f"\n{'Distance':<18} {'Time':<12} {'Pace':<12} {'Date':<12} Activity")
        print("─" * 70)
        for pr in prs:
            print(
                f"{pr['target_label']:<18} "
                f"{fmt_duration(pr['duration_seconds']):<12} "
                f"{fmt_pace(pr['duration_seconds'], pr['distance_meters']):<12} "
                f"{pr['date']:<12} "
                f"{pr['activity_id']}"
            )
        return

    print(f"Computing best efforts {'(all)' if args.all else '(new only)'}...")
    total = process_all(con, force=args.all, activity_id=args.activity_id)
    print(f"Done. {total} efforts stored.")

    # Show PRs after compute
    prs = get_prs(con, year=args.year)
    if prs:
        print(f"\nAll-time PRs ({len(prs)} distances):")
        print(f"{'Distance':<18} {'Time':<12} {'Pace':<12} {'Date'}")
        print("─" * 55)
        for pr in prs:
            print(
                f"{pr['target_label']:<18} "
                f"{fmt_duration(pr['duration_seconds']):<12} "
                f"{fmt_pace(pr['duration_seconds'], pr['distance_meters']):<12} "
                f"{pr['date']}"
            )


if __name__ == "__main__":
    main()
