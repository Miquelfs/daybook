"""
Life-wide stress insights for Insights → Stress, built from everything the daybook
already logs: CIRQA all-day stress, the roster, sleep, training, tags.

  overview  — the window's average vs the one before, minutes at rest / high per day,
              a daily series for the trend line
  rhythm    — average stress by hour of day, split by the kind of day
              (flying duty · standby · off), so a duty day's shape shows
  drivers   — what moves your daily average: the day's duty, the night's sleep,
              training, tags that day and the day after. Δ vs your average.
  extremes  — your most stressful and calmest days, with what they held

Daily averages are what Garmin reports (exercise included). The rhythm skips the
minutes inside an activity — the watch reads effort as stress, and a 07:00 run
would otherwise paint 07:00 as your worst hour.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta
from statistics import mean

DAY_KIND = {"flying_duty": "flying", "ground_duty": "flying", "standby": "standby", "day_off": "off"}
KIND_LABEL = {"flying": "Flying duty", "standby": "Standby", "off": "Day off"}
MIN_DAYS = 3


def _has(conn, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def _daily_stress(conn, since: str) -> dict[str, float]:
    """Per-day average stress: CIRQA wellness_daily first, Garmin daily_stats to fill gaps."""
    out: dict[str, float] = {}
    if _has(conn, "daily_stats"):
        for r in conn.execute("SELECT date, stress_avg FROM daily_stats WHERE date >= ? AND stress_avg > 0", (since,)):
            out[r[0]] = float(r[1])
    if _has(conn, "wellness_daily"):
        for r in conn.execute("SELECT date, stress_avg FROM wellness_daily WHERE date >= ? AND stress_avg > 0", (since,)):
            out[r[0]] = float(r[1])
    return out


def _day_kinds(conn, since: str) -> dict[str, str]:
    if not _has(conn, "roster"):
        return {}
    return {r[0]: DAY_KIND.get(r[1], "off") for r in conn.execute(
        "SELECT date, duty_type FROM roster WHERE date >= ?", (since,))}


def _row(label: str, vals: list[float], base: float, icon: str | None = None) -> dict | None:
    if len(vals) < MIN_DAYS:
        return None
    avg = mean(vals)
    return {"label": label, "icon": icon, "avg": round(avg), "delta": round(avg - base, 1), "days": len(vals)}


def overview(conn, today: date, days: int) -> dict:
    since = (today - timedelta(days=2 * days)).isoformat()
    cut = (today - timedelta(days=days)).isoformat()
    daily = _daily_stress(conn, since)
    now = [v for d, v in daily.items() if d > cut]
    before = [v for d, v in daily.items() if d <= cut]
    rest = high = None
    if _has(conn, "wellness_daily"):
        r = conn.execute(
            "SELECT AVG(stress_rest_min), AVG(COALESCE(stress_med_min,0) + COALESCE(stress_high_min,0)) "
            "FROM wellness_daily WHERE date > ? AND stress_avg > 0", (cut,)).fetchone()
        rest, high = (round(r[0]) if r[0] is not None else None), (round(r[1]) if r[1] is not None else None)
    return {
        "avg": round(mean(now)) if now else None,
        "prev_avg": round(mean(before)) if before else None,
        "rest_min_per_day": rest,
        "stressed_min_per_day": high,
        "series": [{"date": d, "v": v} for d, v in sorted(daily.items()) if d > cut],
    }


def _activity_windows(conn, since: str) -> dict[str, list[tuple[int, int]]]:
    """Local minute windows of each day's activities (start_time is UTC; shift by the day's offset)."""
    out: dict[str, list[tuple[int, int]]] = {}
    if not _has(conn, "activities"):
        return out
    offsets = {}
    if _has(conn, "wellness_daily"):
        offsets = {r[0]: r[1] or 0 for r in conn.execute(
            "SELECT date, utc_offset_min FROM wellness_daily WHERE date >= ?", (since,))}
    for r in conn.execute("SELECT date, start_time, duration_seconds FROM activities WHERE date >= ?", (since,)):
        try:
            t = datetime.strptime(r[1][:19].replace(" ", "T"), "%Y-%m-%dT%H:%M:%S")
        except (TypeError, ValueError):
            continue
        s = (t.hour * 60 + t.minute + offsets.get(r[0], 0)) % 1440
        out.setdefault(r[0], []).append((s, s + int((r[2] or 0) // 60)))
    return out


def rhythm(conn, today: date, days: int) -> dict:
    since = (today - timedelta(days=days)).isoformat()
    if not _has(conn, "intraday_stress"):
        return {"kinds": []}
    kinds = _day_kinds(conn, since)
    active = _activity_windows(conn, since)
    # day → hour → [levels]
    per_day: dict[str, dict[int, list[int]]] = {}
    for d, t, lvl in conn.execute(
        "SELECT date, time, level FROM intraday_stress WHERE date >= ? AND level >= 0", (since,)
    ):
        h, m = int(t[:2]), int(t[3:5])
        mn = h * 60 + m
        if any(s <= mn <= e for s, e in active.get(d, ())):
            continue
        per_day.setdefault(d, {}).setdefault(h, []).append(lvl)

    by_kind: dict[str, dict[int, list[float]]] = {}
    day_count: dict[str, int] = {}
    for d, hours in per_day.items():
        k = kinds.get(d, "off")
        day_count[k] = day_count.get(k, 0) + 1
        for h, lv in hours.items():
            by_kind.setdefault(k, {}).setdefault(h, []).append(mean(lv))
    out = []
    for k in ("flying", "standby", "off"):
        if day_count.get(k, 0) < MIN_DAYS:
            continue
        hours = [round(mean(by_kind[k][h])) if by_kind[k].get(h) else None for h in range(24)]
        awake = [v for h, v in enumerate(hours) if v is not None and 8 <= h < 22]
        peak_h = max(range(24), key=lambda h: hours[h] if hours[h] is not None and 6 <= h < 23 else -1)
        out.append({"key": k, "label": KIND_LABEL[k], "days": day_count[k], "hours": hours,
                    "awake_avg": round(mean(awake)) if awake else None, "peak_hour": peak_h})
    return {"kinds": out}


def drivers(conn, today: date, days: int) -> dict:
    since = (today - timedelta(days=days + 1)).isoformat()
    daily = _daily_stress(conn, since)
    if len(daily) < 2 * MIN_DAYS:
        return {"baseline": None, "groups": []}
    base = mean(daily.values())
    groups = []

    # The day's duty
    kinds = _day_kinds(conn, since)
    rows = [_row(KIND_LABEL[k], [v for d, v in daily.items() if kinds.get(d, "off") == k], base)
            for k in ("flying", "standby", "off")]
    groups.append({"key": "duty", "label": "The day", "rows": [r for r in rows if r]})

    # Last night's sleep (a sleep row is dated the morning you woke)
    if _has(conn, "sleep"):
        sleep = {r[0]: r[1] / 3600 for r in conn.execute(
            "SELECT date, duration_seconds FROM sleep WHERE date >= ? AND duration_seconds > 0", (since,))}
        bands = [("Under 6h", 0, 6), ("6–7h", 6, 7), ("7–8h", 7, 8), ("8h+", 8, 99)]
        rows = [_row(lbl, [v for d, v in daily.items() if d in sleep and lo <= sleep[d] < hi], base)
                for lbl, lo, hi in bands]
        groups.append({"key": "sleep", "label": "After a night of", "rows": [r for r in rows if r]})

    # Training
    if _has(conn, "activities"):
        trained = {r[0] for r in conn.execute("SELECT DISTINCT date FROM activities WHERE date >= ?", (since,))}
        rows = [_row("Trained", [v for d, v in daily.items() if d in trained], base),
                _row("No training", [v for d, v in daily.items() if d not in trained], base),
                _row("Day after training", [v for d, v in daily.items()
                                            if (date.fromisoformat(d) - timedelta(days=1)).isoformat() in trained], base)]
        groups.append({"key": "training", "label": "Training", "rows": [r for r in rows if r]})

    # Tags: same day and the day after — the ones that move it most
    if _has(conn, "day_tags") and _has(conn, "tags"):
        tag_days: dict[tuple[str, str | None], set[str]] = {}
        for d, name, icon in conn.execute(
            "SELECT dt.date, COALESCE(t.name, t.slug), t.icon FROM day_tags dt "
            "JOIN tags t ON t.id = dt.tag_id WHERE dt.date >= ?", (since,)
        ):
            tag_days.setdefault((name, icon), set()).add(d)
        same, after = [], []
        for (name, icon), ds in tag_days.items():
            if len(ds) > 0.8 * len(daily):                 # on almost every day — no contrast
                continue
            r = _row(name, [v for d, v in daily.items() if d in ds], base, icon)
            if r:
                same.append(r)
            nxt = {(date.fromisoformat(d) + timedelta(days=1)).isoformat() for d in ds}
            r = _row(name, [v for d, v in daily.items() if d in nxt and d not in ds], base, icon)
            if r:
                after.append(r)
        pick = lambda rs: sorted([r for r in rs if abs(r["delta"]) >= 1.5],
                                 key=lambda r: -abs(r["delta"]))[:6]
        groups.append({"key": "tags", "label": "Tagged that day", "rows": pick(same)})
        groups.append({"key": "tags_after", "label": "The day after a tag", "rows": pick(after)})

    return {"baseline": round(base, 1), "days": len(daily), "groups": [g for g in groups if g["rows"]]}


def extremes(conn, today: date, days: int, n: int = 3) -> dict:
    since = (today - timedelta(days=days)).isoformat()
    daily = _daily_stress(conn, since)
    if not daily:
        return {"high": [], "low": []}
    kinds = _day_kinds(conn, since)
    tags: dict[str, list[str]] = {}
    if _has(conn, "day_tags") and _has(conn, "tags"):
        for d, label in conn.execute(
            "SELECT dt.date, COALESCE(t.icon || ' ', '') || COALESCE(t.name, t.slug) FROM day_tags dt "
            "JOIN tags t ON t.id = dt.tag_id WHERE dt.date >= ?", (since,)
        ):
            tags.setdefault(d, []).append(label)
    sleep = {}
    if _has(conn, "sleep"):
        sleep = {r[0]: r[1] for r in conn.execute(
            "SELECT date, duration_seconds FROM sleep WHERE date >= ? AND duration_seconds > 0", (since,))}

    def card(d: str, v: float) -> dict:
        bits = [KIND_LABEL.get(kinds.get(d, ""), None)]
        if d in sleep:
            bits.append(f"slept {sleep[d] / 3600:.1f}h")
        return {"date": d, "avg": round(v), "context": [b for b in bits if b], "tags": tags.get(d, [])[:4]}

    ranked = sorted(daily.items(), key=lambda kv: kv[1])
    return {"high": [card(d, v) for d, v in reversed(ranked[-n:])], "low": [card(d, v) for d, v in ranked[:n]]}


def insights(conn: sqlite3.Connection, days: int = 90, today: date | None = None) -> dict:
    today = today or date.today()
    return {
        "days": days,
        "overview": overview(conn, today, days),
        "rhythm": rhythm(conn, today, days),
        "drivers": drivers(conn, today, max(days, 180)),
        "extremes": extremes(conn, today, days),
    }
