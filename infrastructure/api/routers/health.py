"""
Health dashboard API — trends for HRV, sleep, resting HR, body battery, stress.
All endpoints accept ?start=YYYY-MM-DD&end=YYYY-MM-DD for filtering.
"""

import sqlite3
from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query

from infrastructure.db.connection import get_connection
from infrastructure.api.utils.stats import pearson

router = APIRouter(prefix="/health", tags=["health"])

DB = Annotated[sqlite3.Connection, Depends(get_connection)]


def _default_range() -> tuple[str, str]:
    end = date.today()
    start = end - timedelta(days=29)
    return start.isoformat(), end.isoformat()


@router.get("/trends")
def health_trends(
    conn: DB,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
):
    """Daily health metrics for charting. Returns one row per day."""
    if not start or not end:
        start, end = _default_range()

    rows = conn.execute(
        """
        SELECT
            d.date,
            h.last_night_avg   AS hrv,
            h.weekly_avg       AS hrv_weekly,
            h.status           AS hrv_status,
            s.duration_seconds AS sleep_seconds,
            s.deep_seconds,
            s.rem_seconds,
            s.light_seconds,
            s.awake_seconds,
            s.score            AS sleep_score,
            ds.resting_hr,
            ds.stress_avg,
            ds.body_battery_low,
            ds.body_battery_high,
            ds.steps,
            ds.active_calories,
            dy.energy,
            dy.mood,
            dy.sleep_quality,
            li.fatigue_score,
            li.hrv_load,
            li.sleep_debt,
            li.tss_load,
            li.recovery_status
        FROM (
            SELECT DISTINCT date FROM (
                SELECT date FROM hrv WHERE date BETWEEN ? AND ?
                UNION SELECT date FROM sleep WHERE date BETWEEN ? AND ?
                UNION SELECT date FROM daily_stats WHERE date BETWEEN ? AND ?
            )
        ) d
        LEFT JOIN hrv         h  ON h.date  = d.date
        LEFT JOIN sleep       s  ON s.date  = d.date
        LEFT JOIN daily_stats ds ON ds.date = d.date
        LEFT JOIN days        dy ON dy.date = d.date
        LEFT JOIN load_index  li ON li.date = d.date
        ORDER BY d.date
        """,
        (start, end, start, end, start, end),
    ).fetchall()

    return [dict(r) for r in rows]


@router.get("/summary")
def health_summary(conn: DB, days: int = Query(30)):
    """Aggregated summary stats for KPI cards."""
    end = date.today()
    start = end - timedelta(days=days - 1)

    row = conn.execute(
        """
        SELECT
            ROUND(AVG(h.last_night_avg), 1)      AS avg_hrv,
            ROUND(AVG(ds.resting_hr), 1)         AS avg_resting_hr,
            ROUND(AVG(s.duration_seconds), 0)    AS avg_sleep_seconds,
            ROUND(AVG(s.score), 1)               AS avg_sleep_score,
            ROUND(AVG(ds.stress_avg), 1)         AS avg_stress,
            ROUND(AVG(ds.body_battery_high), 1)  AS avg_battery_high,
            ROUND(AVG(ds.steps), 0)              AS avg_steps,
            MAX(h.last_night_avg)                AS max_hrv,
            MIN(h.last_night_avg)                AS min_hrv,
            COUNT(DISTINCT h.date)               AS hrv_days
        FROM days dy
        LEFT JOIN hrv         h  ON h.date  = dy.date
        LEFT JOIN sleep       s  ON s.date  = dy.date
        LEFT JOIN daily_stats ds ON ds.date = dy.date
        WHERE dy.date BETWEEN ? AND ?
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchone()

    # HRV trend direction (compare last 7 days vs previous 7)
    week_end = end
    week_start = end - timedelta(days=6)
    prev_end = week_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=6)

    recent_hrv = conn.execute(
        "SELECT AVG(last_night_avg) FROM hrv WHERE date BETWEEN ? AND ?",
        (week_start.isoformat(), week_end.isoformat()),
    ).fetchone()[0]

    prev_hrv = conn.execute(
        "SELECT AVG(last_night_avg) FROM hrv WHERE date BETWEEN ? AND ?",
        (prev_start.isoformat(), prev_end.isoformat()),
    ).fetchone()[0]

    hrv_trend = None
    if recent_hrv and prev_hrv:
        hrv_trend = round(recent_hrv - prev_hrv, 1)

    return {**dict(row), "hrv_trend_7d": hrv_trend, "period_days": days}


@router.get("/intraday/{date_str}")
def intraday_hr(date_str: str, conn: DB):
    """
    Intraday heart rate time series for a single date, annotated with
    flight windows (off-block→on-block) and activity windows (start→end).
    Returns {points: [{time, bpm}], windows: [{label, from, to, type}], peaks: [{label, peak_bpm, avg_bpm, type}]}
    """
    hr_rows = conn.execute(
        "SELECT time, heart_rate FROM intraday_hr WHERE date = ? ORDER BY time",
        (date_str,),
    ).fetchall()

    points = [{"time": r["time"], "bpm": r["heart_rate"]} for r in hr_rows]

    # Build a lookup: HH:MM → bpm for peak/avg computation
    bpm_by_time: dict[str, int] = {r["time"]: r["heart_rate"] for r in hr_rows}

    def _bpm_in_window(t_from: str | None, t_to: str | None) -> tuple[int | None, int | None]:
        """Return (peak, avg) bpm for readings within [t_from, t_to] (HH:MM strings, UTC)."""
        if not t_from or not t_to:
            return None, None
        t_from_s = t_from[11:16] if "T" in t_from else t_from[:5]
        t_to_s = t_to[11:16] if "T" in t_to else t_to[:5]
        vals = [v for t, v in bpm_by_time.items() if t_from_s <= t <= t_to_s]
        if not vals:
            return None, None
        return max(vals), round(sum(vals) / len(vals))

    windows = []
    peaks = []

    # Flight windows
    flight_rows = conn.execute(
        "SELECT flight_number, dep_icao, dep_iata, arr_icao, arr_iata, "
        "off_block_utc, takeoff_utc, landing_utc, on_block_utc, is_sim "
        "FROM flights WHERE date = ? AND is_sim = 0 ORDER BY off_block_utc",
        (date_str,),
    ).fetchall()

    for f in flight_rows:
        dep = f["dep_icao"] or f["dep_iata"] or "?"
        arr = f["arr_icao"] or f["arr_iata"] or "?"
        label = f["flight_number"] or f"{dep}→{arr}"
        t_from = f["off_block_utc"]
        t_to = f["on_block_utc"]
        if t_from and t_to:
            windows.append({"label": label, "from": t_from[11:16], "to": t_to[11:16], "type": "flight"})
            peak, avg = _bpm_in_window(t_from, t_to)
            if peak:
                peaks.append({"label": label, "peak_bpm": peak, "avg_bpm": avg, "type": "flight"})

    # Activity windows (use start_time + moving_time as proxy for window)
    act_rows = conn.execute(
        "SELECT activity_type, name, start_time, moving_time_seconds "
        "FROM activities WHERE date = ? AND moving_time_seconds > 0 ORDER BY start_time",
        (date_str,),
    ).fetchall()

    for a in act_rows:
        if not a["start_time"]:
            continue
        start_hm = a["start_time"][11:16]
        # Compute end time from moving_time_seconds
        start_parts = start_hm.split(":")
        start_mins = int(start_parts[0]) * 60 + int(start_parts[1])
        end_mins = start_mins + int((a["moving_time_seconds"] or 0) / 60)
        end_hm = f"{(end_mins // 60) % 24:02d}:{end_mins % 60:02d}"
        label = a["name"] or a["activity_type"] or "Activity"
        windows.append({"label": label, "from": start_hm, "to": end_hm, "type": "activity"})
        peak, avg = _bpm_in_window(start_hm, end_hm)
        if peak:
            peaks.append({"label": label, "peak_bpm": peak, "avg_bpm": avg, "type": "activity"})

    # Daily peak (full day)
    all_bpms = list(bpm_by_time.values())
    daily_peak = max(all_bpms) if all_bpms else None

    return {
        "date": date_str,
        "points": points,
        "windows": windows,
        "peaks": peaks,
        "daily_peak_bpm": daily_peak,
        "has_data": len(points) > 0,
    }


@router.get("/hr-context")
def hr_context(conn: DB, days: int = Query(30)):
    """
    Aggregated HR by context over the period: avg/peak during flights, training, and rest.
    Answers: where do I peak — cockpit, sport, or elsewhere?
    Returns {flight, training, rest} each with avg_bpm, peak_bpm, days_sampled.
    Also returns top_peaks: the N highest single-sector/activity HR readings.
    """
    end = date.today()
    start = (end - timedelta(days=days - 1)).isoformat()
    end_str = end.isoformat()

    # ── Flight HR ──────────────────────────────────────────────────────────────
    # For each flight, compute avg/peak from intraday_hr rows inside [off_block, on_block].
    # We do this in Python because SQLite can't easily do time-range joins.
    flight_rows = conn.execute(
        """SELECT f.date, f.flight_number, f.dep_icao, f.dep_iata, f.arr_icao, f.arr_iata,
                  f.off_block_utc, f.on_block_utc
           FROM flights f
           WHERE f.date BETWEEN ? AND ? AND f.is_sim = 0
             AND f.off_block_utc IS NOT NULL AND f.on_block_utc IS NOT NULL
           ORDER BY f.date""",
        (start, end_str),
    ).fetchall()

    flight_avgs: list[float] = []
    flight_peaks: list[int] = []
    top_peaks: list[dict] = []

    for f in flight_rows:
        t_from = f["off_block_utc"][11:16]
        t_to = f["on_block_utc"][11:16]
        hr_rows = conn.execute(
            "SELECT heart_rate FROM intraday_hr WHERE date=? AND time>=? AND time<=?",
            (f["date"], t_from, t_to),
        ).fetchall()
        if not hr_rows:
            continue
        vals = [r["heart_rate"] for r in hr_rows]
        peak = max(vals)
        avg = sum(vals) / len(vals)
        flight_avgs.append(avg)
        flight_peaks.append(peak)
        dep = f["dep_icao"] or f["dep_iata"] or "?"
        arr = f["arr_icao"] or f["arr_iata"] or "?"
        label = f["flight_number"] or f"{dep}→{arr}"
        top_peaks.append({"label": label, "date": f["date"], "peak_bpm": peak,
                          "avg_bpm": round(avg), "context": "flight"})

    # ── Training HR ────────────────────────────────────────────────────────────
    act_rows = conn.execute(
        """SELECT date, activity_type, name, start_time, moving_time_seconds, avg_heart_rate, max_heart_rate
           FROM activities
           WHERE date BETWEEN ? AND ? AND moving_time_seconds > 0 AND start_time IS NOT NULL
           ORDER BY date""",
        (start, end_str),
    ).fetchall()

    training_avgs: list[float] = []
    training_peaks: list[int] = []

    for a in act_rows:
        start_hm = a["start_time"][11:16] if a["start_time"] else None
        if not start_hm:
            continue
        start_mins = int(start_hm[:2]) * 60 + int(start_hm[3:5])
        end_mins = start_mins + int((a["moving_time_seconds"] or 0) / 60)
        end_hm = f"{(end_mins // 60) % 24:02d}:{end_mins % 60:02d}"
        hr_rows = conn.execute(
            "SELECT heart_rate FROM intraday_hr WHERE date=? AND time>=? AND time<=?",
            (a["date"], start_hm, end_hm),
        ).fetchall()
        if hr_rows:
            vals = [r["heart_rate"] for r in hr_rows]
            peak = max(vals)
            avg_v = sum(vals) / len(vals)
        elif a["max_heart_rate"]:
            # Fall back to Garmin summary if no intraday data
            peak = a["max_heart_rate"]
            avg_v = a["avg_heart_rate"] or peak
        else:
            continue
        training_avgs.append(avg_v)
        training_peaks.append(peak)
        label = a["name"] or a["activity_type"] or "Activity"
        top_peaks.append({"label": label, "date": a["date"], "peak_bpm": peak,
                          "avg_bpm": round(avg_v), "context": "training"})

    # ── Rest HR (non-flight, non-training daytime hours) ──────────────────────
    rest_rows = conn.execute(
        """SELECT AVG(heart_rate) AS avg_bpm, MAX(heart_rate) AS peak_bpm
           FROM intraday_hr
           WHERE date BETWEEN ? AND ?
             AND time >= '09:00' AND time <= '22:00'""",
        (start, end_str),
    ).fetchone()

    # Sort top peaks descending, keep top 10
    top_peaks.sort(key=lambda x: x["peak_bpm"], reverse=True)
    top_peaks = top_peaks[:10]

    def _safe(vals: list, fn) -> int | None:
        return round(fn(vals)) if vals else None

    return {
        "period_days": days,
        "flight": {
            "avg_bpm": _safe(flight_avgs, lambda v: sum(v) / len(v)),
            "peak_bpm": _safe(flight_peaks, max),
            "days_sampled": len(flight_avgs),
        },
        "training": {
            "avg_bpm": _safe(training_avgs, lambda v: sum(v) / len(v)),
            "peak_bpm": _safe(training_peaks, max),
            "days_sampled": len(training_avgs),
        },
        "rest": {
            "avg_bpm": round(rest_rows["avg_bpm"]) if rest_rows["avg_bpm"] else None,
            "peak_bpm": rest_rows["peak_bpm"],
            "days_sampled": None,
        },
        "top_peaks": top_peaks,
    }


@router.get("/week-charts")
def week_charts(
    conn: DB,
    start: str = Query(...),
    end: str = Query(...),
):
    """
    Per-day data for the Exist-style small-multiples week view.

    Work logic (priority order):
      1. Actual flights on the day → duty_type=flying_duty, duty_hours from first
         off_block to last on_block (wall-clock span), block_minutes = sum of block_seconds.
         Overrides roster even if roster says standby.
      2. No flights → use roster duty_type / report_time / end_time.
      3. Neither → duty_type=None.
    """
    from datetime import datetime, timedelta as td

    # Calendar spine
    d0 = datetime.strptime(start, "%Y-%m-%d").date()
    d1 = datetime.strptime(end, "%Y-%m-%d").date()
    date_spine: list[str] = []
    cur = d0
    while cur <= d1:
        date_spine.append(cur.isoformat())
        cur += td(days=1)

    # Health + subjective data
    rows = conn.execute(
        """
        SELECT
            d.date,
            s.duration_seconds   AS sleep_seconds,
            s.awake_seconds,
            s.score              AS sleep_score,
            h.last_night_avg     AS hrv,
            ds.resting_hr,
            ds.steps,
            ds.body_battery_high AS body_battery,
            dy.energy,
            dy.mood,
            dy.stress
        FROM (
            SELECT DISTINCT date FROM (
                SELECT date FROM sleep WHERE date BETWEEN ? AND ?
                UNION SELECT date FROM hrv WHERE date BETWEEN ? AND ?
                UNION SELECT date FROM daily_stats WHERE date BETWEEN ? AND ?
                UNION SELECT date FROM days WHERE date BETWEEN ? AND ?
            )
        ) d
        LEFT JOIN sleep       s  ON s.date  = d.date
        LEFT JOIN hrv         h  ON h.date  = d.date
        LEFT JOIN daily_stats ds ON ds.date = d.date
        LEFT JOIN days        dy ON dy.date = d.date
        ORDER BY d.date
        """,
        (start, end, start, end, start, end, start, end),
    ).fetchall()
    data_by_date = {r["date"]: dict(r) for r in rows}

    # Actual flights — one row per sector, grouped in Python
    flight_rows = conn.execute(
        """
        SELECT date, off_block_utc, on_block_utc, block_seconds
        FROM flights
        WHERE date BETWEEN ? AND ? AND is_sim = 0
        ORDER BY date, off_block_utc
        """,
        (start, end),
    ).fetchall()

    # Group flights by date: earliest off_block, latest on_block, sum block_seconds
    flights_by_date: dict[str, dict] = {}
    for f in flight_rows:
        dt = f["date"]
        if dt not in flights_by_date:
            flights_by_date[dt] = {
                "first_off": f["off_block_utc"],
                "last_on": f["on_block_utc"],
                "total_block_seconds": f["block_seconds"] or 0,
                "sector_count": 1,
            }
        else:
            entry = flights_by_date[dt]
            if f["off_block_utc"] and (not entry["first_off"] or f["off_block_utc"] < entry["first_off"]):
                entry["first_off"] = f["off_block_utc"]
            if f["on_block_utc"] and (not entry["last_on"] or f["on_block_utc"] > entry["last_on"]):
                entry["last_on"] = f["on_block_utc"]
            entry["total_block_seconds"] += f["block_seconds"] or 0
            entry["sector_count"] += 1

    # Roster fallback
    try:
        roster_rows = conn.execute(
            "SELECT date, duty_type, report_time, end_time FROM roster WHERE date BETWEEN ? AND ?",
            (start, end),
        ).fetchall()
        roster_by_date = {r["date"]: dict(r) for r in roster_rows}
    except Exception:
        roster_by_date = {}

    def _wall_clock_hours(first_off: str | None, last_on: str | None) -> float | None:
        """Span from first off-block to last on-block in hours (UTC wall clock)."""
        if not first_off or not last_on:
            return None
        try:
            t0 = datetime.fromisoformat(first_off.replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(last_on.replace("Z", "+00:00"))
            mins = (t1 - t0).total_seconds() / 60
            return round(mins / 60, 1) if mins > 0 else None
        except Exception:
            return None

    def _roster_hours(r: dict | None) -> float | None:
        if not r:
            return None
        rep, end_t = r.get("report_time"), r.get("end_time")
        if not rep or not end_t:
            return None
        try:
            rh, rm = int(rep[:2]), int(rep[3:5])
            eh, em = int(end_t[:2]), int(end_t[3:5])
            mins = (eh * 60 + em) - (rh * 60 + rm)
            if mins < 0:
                mins += 24 * 60
            return round(mins / 60, 1)
        except Exception:
            return None

    result = []
    for dt in date_spine:
        d = data_by_date.get(dt, {})
        flt = flights_by_date.get(dt)
        rost = roster_by_date.get(dt)

        if flt:
            # Actual flights take priority — compute duty window from block times
            duty_type = "flying_duty"
            duty_hours = _wall_clock_hours(flt["first_off"], flt["last_on"])
            block_hours = round(flt["total_block_seconds"] / 3600, 1) if flt["total_block_seconds"] else None
            sector_count = flt["sector_count"]
        else:
            duty_type = rost["duty_type"] if rost else None
            duty_hours = _roster_hours(rost)
            block_hours = None
            sector_count = 0

        result.append({
            "date": dt,
            "mood": d.get("mood"),
            "energy": d.get("energy"),
            "stress": d.get("stress"),
            "sleep_hours": round(d["sleep_seconds"] / 3600, 1) if d.get("sleep_seconds") else None,
            "awake_minutes": round(d["awake_seconds"] / 60) if d.get("awake_seconds") else None,
            "sleep_score": d.get("sleep_score"),
            "hrv": d.get("hrv"),
            "resting_hr": d.get("resting_hr"),
            "steps": d.get("steps"),
            "body_battery": d.get("body_battery"),
            "duty_type": duty_type,
            "duty_hours": duty_hours,
            "block_hours": block_hours,      # actual flying time (sum of block_seconds)
            "sector_count": sector_count,
        })

    return result


@router.get("/sleep/summary")
def sleep_summary(conn: DB, days: int = Query(30)):
    """Aggregated sleep statistics for the sleep dashboard."""
    end = date.today()
    start = end - timedelta(days=days - 1)

    rows = conn.execute(
        """
        SELECT duration_seconds, deep_seconds, light_seconds, rem_seconds,
               awake_seconds, score, avg_spo2
        FROM sleep WHERE date BETWEEN ? AND ?
        ORDER BY date
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchall()

    if not rows:
        return {"days": days, "nights": 0}

    durations = [r["duration_seconds"] for r in rows if r["duration_seconds"]]
    scores = [r["score"] for r in rows if r["score"]]
    spo2s = [r["avg_spo2"] for r in rows if r["avg_spo2"]]

    def safe_pct(part_key: str, total_key: str = "duration_seconds"):
        pairs = [(r[part_key], r[total_key]) for r in rows if r[part_key] and r[total_key] and r[total_key] > 0]
        if not pairs:
            return None
        return round(sum(p / t * 100 for p, t in pairs) / len(pairs), 1)

    avg_deep_pct = safe_pct("deep_seconds")
    avg_rem_pct = safe_pct("rem_seconds")
    avg_awake_pct = safe_pct("awake_seconds")

    nights_below_deep = sum(
        1 for r in rows
        if r["deep_seconds"] and r["duration_seconds"] and r["duration_seconds"] > 0
        and (r["deep_seconds"] / r["duration_seconds"] * 100) < 18
    )
    nights_below_rem = sum(
        1 for r in rows
        if r["rem_seconds"] and r["duration_seconds"] and r["duration_seconds"] > 0
        and (r["rem_seconds"] / r["duration_seconds"] * 100) < 20
    )

    import statistics as _stats
    consistency_stdev = _stats.stdev(durations) / 3600 if len(durations) > 1 else None

    target_secs = 8 * 3600 * len(durations)
    sleep_debt_seconds = max(0, target_secs - sum(durations)) if durations else 0

    return {
        "days": days,
        "nights": len(rows),
        "avg_duration_seconds": int(sum(durations) / len(durations)) if durations else None,
        "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
        "avg_deep_pct": avg_deep_pct,
        "avg_rem_pct": avg_rem_pct,
        "avg_awake_pct": avg_awake_pct,
        "avg_spo2": round(sum(spo2s) / len(spo2s), 1) if spo2s else None,
        "nights_below_deep_threshold": nights_below_deep,
        "nights_below_rem_threshold": nights_below_rem,
        "consistency_stdev_hours": round(consistency_stdev, 2) if consistency_stdev else None,
        "sleep_debt_seconds": sleep_debt_seconds,
    }


@router.get("/sleep/stages")
def sleep_stages(conn: DB, days: int = Query(60)):
    """Daily sleep stage breakdown for stacked bar chart."""
    end = date.today()
    start = end - timedelta(days=days - 1)

    rows = conn.execute(
        """
        SELECT s.date, s.duration_seconds, s.deep_seconds, s.light_seconds,
               s.rem_seconds, s.awake_seconds, s.score,
               li.fatigue_score, li.recovery_status,
               EXISTS (
                   SELECT 1 FROM activities a
                   WHERE a.date = s.date AND a.training_stress_score > 100
               ) AS heavy_training_day
        FROM sleep s
        LEFT JOIN load_index li ON li.date = s.date
        WHERE s.date BETWEEN ? AND ?
        ORDER BY s.date
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchall()

    return [dict(r) for r in rows]


@router.get("/sleep/correlations")
def sleep_correlations(conn: DB, days: int = Query(90)):
    """Pearson correlations between sleep metrics and next-day wellbeing."""
    end = date.today()
    start = end - timedelta(days=days - 1)

    rows = conn.execute(
        """
        SELECT
            s.date,
            s.duration_seconds,
            s.deep_seconds,
            s.rem_seconds,
            s.score          AS sleep_score,
            d.mood,
            d.energy,
            d.sleep_quality,
            h.last_night_avg AS hrv,
            LEAD(d.energy, 1) OVER (ORDER BY s.date) AS next_energy,
            LEAD(d.mood, 1)   OVER (ORDER BY s.date) AS next_mood
        FROM sleep s
        LEFT JOIN days d        ON d.date = s.date
        LEFT JOIN hrv  h        ON h.date = s.date
        WHERE s.date BETWEEN ? AND ?
        ORDER BY s.date
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchall()

    def _pct(row, part_key):
        if row[part_key] and row["duration_seconds"] and row["duration_seconds"] > 0:
            return row[part_key] / row["duration_seconds"] * 100
        return None

    def _pairs(xs, ys):
        pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
        return [p[0] for p in pairs], [p[1] for p in pairs]

    dur_h = [r["duration_seconds"] / 3600 if r["duration_seconds"] else None for r in rows]
    deep_pct = [_pct(r, "deep_seconds") for r in rows]
    moods = [r["mood"] for r in rows]
    energies = [r["energy"] for r in rows]
    next_energies = [r["next_energy"] for r in rows]
    next_moods = [r["next_mood"] for r in rows]
    hrvs = [r["hrv"] for r in rows]
    sleep_scores = [r["sleep_score"] for r in rows]

    correlations = []
    for (xs, ys, ma, mb, lag) in [
        (dur_h, energies, "sleep_duration_h", "energy", 0),
        (dur_h, next_energies, "sleep_duration_h", "energy", 1),
        (dur_h, moods, "sleep_duration_h", "mood", 0),
        (dur_h, next_moods, "sleep_duration_h", "mood", 1),
        (deep_pct, hrvs, "deep_sleep_pct", "hrv", 0),
        (sleep_scores, next_energies, "sleep_score", "energy", 1),
    ]:
        xs_f, ys_f = _pairs(xs, ys)
        r = pearson(xs_f, ys_f)
        correlations.append({
            "metric_a": ma,
            "metric_b": mb,
            "lag": lag,
            "r": r,
            "n": len(xs_f),
        })

    return {"correlations": correlations, "days": days}


@router.get("/correlation")
def health_correlation(conn: DB, days: int = Query(90)):
    """
    HRV vs pace and sleep quality vs pace correlation for recent running activities.
    Returns scatter points + Pearson r for each pair.
    """
    end = date.today()
    start = end - timedelta(days=days)

    rows = conn.execute(
        """
        SELECT
            a.date,
            a.avg_speed_mps,
            a.distance_meters,
            a.moving_time_seconds,
            h.last_night_avg   AS hrv,
            s.score            AS sleep_score,
            s.duration_seconds AS sleep_seconds
        FROM activities a
        LEFT JOIN hrv  h ON h.date = a.date
        LEFT JOIN sleep s ON s.date = a.date
        WHERE a.date BETWEEN ? AND ?
          AND a.activity_type IN ('running', 'trail_running', 'treadmill_running', 'track_running')
          AND a.avg_speed_mps > 0
          AND a.distance_meters >= 3000
        ORDER BY a.date
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchall()

    # pace in sec/km (lower = faster)
    points = []
    for r in rows:
        pace = 1000 / r["avg_speed_mps"] if r["avg_speed_mps"] else None
        if pace is None:
            continue
        points.append({
            "date": r["date"],
            "pace_sec_km": round(pace),
            "hrv": r["hrv"],
            "sleep_score": r["sleep_score"],
            "sleep_seconds": r["sleep_seconds"],
            "distance_km": round((r["distance_meters"] or 0) / 1000, 1),
        })

    hrv_pairs = [(p["hrv"], p["pace_sec_km"]) for p in points if p["hrv"] is not None]
    sleep_pairs = [(p["sleep_score"], p["pace_sec_km"]) for p in points if p["sleep_score"] is not None]

    return {
        "points": points,
        "correlation": {
            "hrv_vs_pace": pearson([x for x, _ in hrv_pairs], [y for _, y in hrv_pairs]),
            "sleep_vs_pace": pearson([x for x, _ in sleep_pairs], [y for _, y in sleep_pairs]),
        },
        "sample_size": len(points),
    }
