"""
Best efforts, Strava-style: the fastest time over standard distances found *inside*
each run or ride (sliding window on the 1 Hz track), plus best power over standard
durations for rides with power. Each effort is ranked against your whole history
(🥇 PR / 🥈 2nd / 🥉 3rd), this year and the last 90 days.

Replaces the old pace curve, which spread each activity's *average* pace over every
distance up to its length — one mislabelled activity (a ride or a car trip saved as a
run) then became the "best" at every distance. Implausible values are rejected here.

Efforts are written by domains.health.activity_analysis whenever an activity is
analysed (cached; nightly for the last 7 days; `--days N` to backfill history).
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

RUN_DIST = [(400, "400 m"), (1000, "1 km"), (1609, "1 mile"), (5000, "5 km"), (10000, "10 km"),
            (21097, "Half marathon"), (42195, "Marathon")]
RIDE_DIST = [(10000, "10 km"), (20000, "20 km"), (40000, "40 km"), (50000, "50 km"), (100000, "100 km"),
             (160934, "100 miles")]
RIDE_POWER = [(5, "5 s"), (60, "1 min"), (300, "5 min"), (1200, "20 min"), (3600, "60 min")]

# plausibility: anything faster is a mislabelled activity or a GPS glitch
MIN_RUN_S_PER_KM = 150          # 2:30 /km
MAX_RIDE_KMH = 60.0             # sustained over ≥ 10 km


def ensure_table(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS activity_efforts (
        activity_id TEXT NOT NULL, date TEXT NOT NULL, sport TEXT NOT NULL,
        kind TEXT NOT NULL,            -- dist (value = seconds) | power (value = watts)
        key  INTEGER NOT NULL,         -- metres | seconds
        value REAL NOT NULL,
        PRIMARY KEY (activity_id, kind, key))""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_efforts_lookup ON activity_efforts(sport, kind, key, value)")
    conn.commit()


def fastest(dist: list, meters: float) -> int | None:
    """Fewest seconds to cover `meters` on a 1 Hz cumulative-distance track (two pointers)."""
    if not dist or dist[-1] is None or dist[-1] < meters:
        return None
    best, j, n = None, 0, len(dist)
    for i in range(n):
        if dist[i] is None:
            continue
        if j < i:
            j = i
        while j < n and (dist[j] is None or dist[j] - dist[i] < meters):
            j += 1
        if j >= n:
            break
        t = j - i
        if best is None or t < best:
            best = t
    return best


def compute(sport: str, dist_1hz: list | None, power_bests: list[dict] | None) -> list[tuple[str, int, float]]:
    """[(kind, key, value)] for one activity, plausibility-checked."""
    out: list[tuple[str, int, float]] = []
    if dist_1hz and sport in ("run", "ride"):
        for meters, _ in (RUN_DIST if sport == "run" else RIDE_DIST):
            t = fastest(dist_1hz, meters)
            if not t:
                continue
            if sport == "run" and t / (meters / 1000) < MIN_RUN_S_PER_KM:
                continue
            if sport == "ride" and meters >= 10000 and (meters / 1000) / (t / 3600) > MAX_RIDE_KMH:
                continue
            out.append(("dist", meters, float(t)))
    if sport == "ride" and power_bests:
        for b in power_bests:
            if b.get("watts") and b["secs"] in dict(RIDE_POWER):
                out.append(("power", int(b["secs"]), float(b["watts"])))
    return out


def store(conn, activity_id: str, day: str, sport: str, efforts: list[tuple[str, int, float]]) -> None:
    ensure_table(conn)
    conn.execute("DELETE FROM activity_efforts WHERE activity_id=?", (activity_id,))
    conn.executemany("INSERT INTO activity_efforts (activity_id, date, sport, kind, key, value) VALUES (?,?,?,?,?,?)",
                     [(activity_id, day, sport, k, key, v) for k, key, v in efforts])
    conn.commit()


def _label(sport: str, kind: str, key: int) -> str:
    table = RIDE_POWER if kind == "power" else (RUN_DIST if sport == "run" else RIDE_DIST)
    return dict(table).get(key, str(key))


def _better(kind: str) -> str:
    return ">" if kind == "power" else "<"


def for_activity(conn, activity_id: str) -> list[dict]:
    """This activity's efforts, each ranked vs all-time / this year / last 90 days."""
    try:
        mine = conn.execute("SELECT * FROM activity_efforts WHERE activity_id=? ORDER BY kind, key",
                            (activity_id,)).fetchall()
    except sqlite3.OperationalError:
        return []
    out = []
    for e in mine:
        cmp = _better(e["kind"])
        base = "FROM activity_efforts WHERE sport=? AND kind=? AND key=? AND activity_id != ?"
        args = (e["sport"], e["kind"], e["key"], activity_id)
        rank_all = 1 + conn.execute(f"SELECT COUNT(*) {base} AND value {cmp} ?", (*args, e["value"])).fetchone()[0]
        yr = e["date"][:4]
        rank_year = 1 + conn.execute(f"SELECT COUNT(*) {base} AND substr(date,1,4)=? AND value {cmp} ?",
                                     (*args, yr, e["value"])).fetchone()[0]
        n = 1 + conn.execute(f"SELECT COUNT(*) {base}", args).fetchone()[0]
        best = conn.execute(
            f"SELECT activity_id, date, value FROM activity_efforts WHERE sport=? AND kind=? AND key=? "
            f"ORDER BY value {'DESC' if e['kind'] == 'power' else 'ASC'} LIMIT 1",
            (e["sport"], e["kind"], e["key"])).fetchone()
        out.append({
            "kind": e["kind"], "key": e["key"], "label": _label(e["sport"], e["kind"], e["key"]),
            "value": e["value"], "rank_all": rank_all, "rank_year": rank_year, "n": n, "year": int(yr),
            "pr": {"activity_id": best["activity_id"], "date": best["date"], "value": best["value"]} if best else None,
        })
    return out


def bests(conn, sport: str) -> list[dict]:
    """Per distance/duration: all-time best, best this year, best in the last 90 days (with activity links)."""
    try:
        keys = conn.execute("SELECT DISTINCT kind, key FROM activity_efforts WHERE sport=? ORDER BY kind DESC, key",
                            (sport,)).fetchall()
    except sqlite3.OperationalError:
        return []
    y0 = f"{date.today().year}-01-01"
    d90 = (date.today() - timedelta(days=90)).isoformat()
    out = []
    for k in keys:
        order = "DESC" if k["kind"] == "power" else "ASC"

        def best(where: str = "", args: tuple = ()):
            r = conn.execute(f"SELECT activity_id, date, value FROM activity_efforts WHERE sport=? AND kind=? AND key=? "
                             f"{where} ORDER BY value {order} LIMIT 1", (sport, k["kind"], k["key"], *args)).fetchone()
            return dict(r) if r else None
        out.append({"kind": k["kind"], "key": k["key"], "label": _label(sport, k["kind"], k["key"]),
                    "all_time": best(), "this_year": best("AND date >= ?", (y0,)), "last_90d": best("AND date >= ?", (d90,))})
    return out
