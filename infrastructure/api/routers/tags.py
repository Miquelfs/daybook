import math
import sqlite3
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from infrastructure.api.db import get_db

DB = Annotated[sqlite3.Connection, Depends(get_db)]

tags_router = APIRouter(prefix="/tags", tags=["tags"])
day_tags_router = APIRouter(prefix="/days", tags=["tags"])


# ─── Pydantic models ──────────────────────────────────────────────────────────

class TagOut(BaseModel):
    id: int
    slug: str
    name: str
    icon: str | None = None
    category: str
    color: str | None = None
    is_system: bool = False
    is_negative: bool = False
    usage_count: int = 0


class TagCreate(BaseModel):
    slug: str
    name: str
    icon: str | None = None
    category: str
    color: str | None = None


class TagPatch(BaseModel):
    name: str | None = None
    icon: str | None = None
    category: str | None = None
    color: str | None = None
    is_negative: bool | None = None


class DayTagOut(BaseModel):
    tag_id: int
    slug: str
    name: str
    icon: str | None = None
    category: str
    color: str | None = None
    note: str | None = None


class AddDayTagBody(BaseModel):
    tag_id: int
    note: str | None = None


# ─── /tags routes ─────────────────────────────────────────────────────────────

@tags_router.get("", response_model=list[TagOut])
def list_tags(conn: DB, category: str | None = None):
    """List all tags with usage count. Optional ?category= filter."""
    rows = conn.execute(
        """
        SELECT t.id, t.slug, t.name, t.icon, t.category, t.color, t.is_system,
               COALESCE(t.is_negative, 0) AS is_negative,
               COUNT(dt.tag_id) AS usage_count
        FROM tags t
        LEFT JOIN day_tags dt ON dt.tag_id = t.id
        WHERE (:category IS NULL OR t.category = :category)
        GROUP BY t.id
        ORDER BY t.category, t.name
        """,
        {"category": category},
    ).fetchall()
    return [
        TagOut(
            id=r["id"], slug=r["slug"], name=r["name"], icon=r["icon"],
            category=r["category"], color=r["color"],
            is_system=bool(r["is_system"]), is_negative=bool(r["is_negative"]),
            usage_count=r["usage_count"],
        )
        for r in rows
    ]


@tags_router.get("/streaks")
def all_tag_streaks(conn: DB):
    """Return streak stats for every tag that has been used at least once."""
    today = date.today()

    # Oldest day in DB — used to compute negative streaks from day 1
    first_day_row = conn.execute("SELECT MIN(date) FROM days WHERE date IS NOT NULL").fetchone()
    first_day = date.fromisoformat(first_day_row[0]) if first_day_row and first_day_row[0] else today

    tag_rows = conn.execute(
        "SELECT t.id, t.slug, t.name, t.icon, t.category, COALESCE(t.is_negative,0) AS is_negative FROM tags t "
        "WHERE EXISTS (SELECT 1 FROM day_tags dt WHERE dt.tag_id = t.id)"
    ).fetchall()

    results = []
    for tr in tag_rows:
        rows = conn.execute(
            "SELECT date, note FROM day_tags WHERE tag_id=? ORDER BY date", (tr["id"],)
        ).fetchall()
        if not rows:
            continue

        all_dates = [r["date"] for r in rows]
        parsed = [date.fromisoformat(d) for d in all_dates]

        # Total numeric count (sum of notes for quantity tags like nap:2, si:3)
        total_count: int | None = None
        numeric_notes = []
        for r in rows:
            if r["note"]:
                try:
                    numeric_notes.append(int(float(r["note"])))
                except (ValueError, TypeError):
                    pass
        if numeric_notes:
            total_count = sum(numeric_notes)

        # Longest positive streak
        longest = 1
        longest_end = parsed[-1]
        cur = 1
        for i in range(1, len(parsed)):
            if (parsed[i] - parsed[i - 1]).days == 1:
                cur += 1
                if cur > longest:
                    longest = cur
                    longest_end = parsed[i]
            else:
                cur = 1

        # Current positive streak
        current = 1
        for i in range(len(parsed) - 1, 0, -1):
            if (parsed[i] - parsed[i - 1]).days == 1:
                current += 1
            else:
                break
        if (today - parsed[-1]).days > 1:
            current = 0

        # Frequency
        span_days = (parsed[-1] - parsed[0]).days + 1 if len(parsed) >= 2 else 1
        weekly_avg = round(len(parsed) / max(span_days / 7, 1), 1)

        # Negative streak: consecutive days WITHOUT this tag (clean streak)
        negative_streak: int | None = None
        if bool(tr["is_negative"]):
            tag_date_set = set(all_dates)
            clean = 0
            d = today
            while d >= first_day:
                if d.isoformat() in tag_date_set:
                    break
                clean += 1
                d -= timedelta(days=1)
            negative_streak = clean

        results.append({
            "id": tr["id"],
            "slug": tr["slug"],
            "name": tr["name"],
            "icon": tr["icon"],
            "category": tr["category"],
            "is_negative": bool(tr["is_negative"]),
            "total_days": len(parsed),
            "total_count": total_count,
            "current_streak": current,
            "longest_streak": longest,
            "longest_streak_end": longest_end.isoformat(),
            "last_used": all_dates[-1],
            "first_used": all_dates[0],
            "weekly_avg": weekly_avg,
            "negative_streak": negative_streak,
        })

    results.sort(key=lambda r: r["longest_streak"], reverse=True)
    return results


@tags_router.post("", response_model=TagOut, status_code=201)
def create_tag(body: TagCreate, conn: DB):
    """Create a custom (non-system) tag."""
    try:
        cursor = conn.execute(
            "INSERT INTO tags (slug, name, icon, category, color, is_system) VALUES (?,?,?,?,?,0)",
            (body.slug, body.name, body.icon, body.category, body.color),
        )
        conn.commit()
        tag_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail=f"Tag slug '{body.slug}' already exists")

    row = conn.execute("SELECT * FROM tags WHERE id=?", (tag_id,)).fetchone()
    return TagOut(
        id=row["id"], slug=row["slug"], name=row["name"], icon=row["icon"],
        category=row["category"], color=row["color"],
        is_system=bool(row["is_system"]), usage_count=0,
    )


@tags_router.patch("/{tag_id}", response_model=TagOut)
def patch_tag(tag_id: int, body: TagPatch, conn: DB):
    """Update tag properties: name, icon, category (move), color, is_negative."""
    row = conn.execute("SELECT * FROM tags WHERE id=?", (tag_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Tag not found")

    updates: list[str] = []
    params: list = []
    if body.name is not None and body.name.strip():
        updates.append("name=?")
        params.append(body.name.strip())
    if body.icon is not None:
        updates.append("icon=?")
        params.append(body.icon.strip() or None)
    if body.category is not None and body.category.strip():
        updates.append("category=?")
        params.append(body.category.strip().lower())
    if body.color is not None:
        updates.append("color=?")
        params.append(body.color.strip() or None)
    if body.is_negative is not None:
        updates.append("is_negative=?")
        params.append(int(body.is_negative))

    if updates:
        conn.execute(f"UPDATE tags SET {', '.join(updates)} WHERE id=?", (*params, tag_id))
        conn.commit()
        row = conn.execute("SELECT * FROM tags WHERE id=?", (tag_id,)).fetchone()
    usage = conn.execute("SELECT COUNT(*) FROM day_tags WHERE tag_id=?", (tag_id,)).fetchone()[0]
    return TagOut(
        id=row["id"], slug=row["slug"], name=row["name"], icon=row["icon"],
        category=row["category"], color=row["color"],
        is_system=bool(row["is_system"]),
        is_negative=bool(row["is_negative"]) if row["is_negative"] is not None else False,
        usage_count=usage,
    )


@tags_router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: int, conn: DB):
    """Delete a custom tag. System tags (is_system=1) cannot be deleted."""
    row = conn.execute("SELECT is_system FROM tags WHERE id=?", (tag_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    if row["is_system"]:
        raise HTTPException(status_code=403, detail="Cannot delete a system tag")
    conn.execute("DELETE FROM tags WHERE id=?", (tag_id,))
    conn.commit()


@tags_router.get("/{slug}/stats")
def tag_stats(slug: str, conn: DB):
    """Frequency stats, impact on mood/energy/HRV, and rolling trends for a tag."""
    tag_row = conn.execute("SELECT id, name, icon, category FROM tags WHERE slug=?", (slug,)).fetchone()
    if tag_row is None:
        raise HTTPException(status_code=404, detail="Tag not found")

    tag_id = tag_row["id"]
    today = date.today()

    # ── All-time usage dates ──
    all_usage = conn.execute(
        "SELECT date FROM day_tags WHERE tag_id = ? ORDER BY date",
        (tag_id,),
    ).fetchall()
    usage_dates = [r["date"] for r in all_usage]
    total_days_all = len(usage_dates)
    first_used = usage_dates[0] if usage_dates else None
    last_used = usage_dates[-1] if usage_dates else None

    # 90-day count (for backwards compatibility)
    start_90 = (today - timedelta(days=89)).isoformat()
    total_days_90d = sum(1 for d in usage_dates if d >= start_90)

    # ── Weekly sparkline (last 90 days) ──
    weekly = conn.execute(
        """
        SELECT strftime('%Y-W%W', date) AS week, COUNT(*) AS count
        FROM day_tags
        WHERE tag_id = ? AND date >= ?
        GROUP BY week
        ORDER BY week
        """,
        (tag_id, start_90),
    ).fetchall()

    # ── Rolling 28-day counts over last 12 months ──
    rolling_28d = []
    for i in range(12, -1, -1):
        window_end = today - timedelta(days=i * 28)
        window_start = window_end - timedelta(days=27)
        count = sum(1 for d in usage_dates if window_start.isoformat() <= d <= window_end.isoformat())
        rolling_28d.append({
            "period_end": window_end.isoformat(),
            "count": count,
        })

    # ── Average gap between uses ──
    avg_gap_days = None
    if len(usage_dates) >= 2:
        gaps = []
        for i in range(1, len(usage_dates)):
            d1 = date.fromisoformat(usage_dates[i - 1])
            d2 = date.fromisoformat(usage_dates[i])
            gaps.append((d2 - d1).days)
        avg_gap_days = round(sum(gaps) / len(gaps), 1)

    # ── Peak month (by average monthly usage rate) ──
    month_counts: dict[int, int] = {}
    for d in usage_dates:
        m = int(d[5:7])
        month_counts[m] = month_counts.get(m, 0) + 1
    peak_month = max(month_counts, key=month_counts.get) if month_counts else None

    # ── Mood impact ──
    def _metric_impact(col: str, table: str = "days") -> dict | None:
        with_rows = conn.execute(
            f"""
            SELECT d.{col} FROM day_tags dt
            JOIN {table} d ON d.date = dt.date
            WHERE dt.tag_id = ? AND d.{col} IS NOT NULL
            """,
            (tag_id,),
        ).fetchall()
        with_vals = [float(r[col]) for r in with_rows]
        if len(with_vals) < 3:
            return None

        # All days with this metric, excluding tag days
        tag_dates = set(usage_dates)
        without_rows = conn.execute(
            f"SELECT date, {col} FROM {table} WHERE {col} IS NOT NULL",
        ).fetchall()
        without_vals = [float(r[col]) for r in without_rows if r["date"] not in tag_dates]

        avg_with = round(sum(with_vals) / len(with_vals), 2)
        avg_without = round(sum(without_vals) / len(without_vals), 2) if without_vals else None
        delta = round(avg_with - avg_without, 2) if avg_without is not None else None

        return {
            "avg_with": avg_with,
            "avg_without": avg_without,
            "delta": delta,
            "n": len(with_vals),
        }

    # HRV lives in a different table
    hrv_with = conn.execute(
        """
        SELECT h.last_night_avg FROM day_tags dt
        JOIN hrv h ON h.date = dt.date
        WHERE dt.tag_id = ? AND h.last_night_avg IS NOT NULL
        """,
        (tag_id,),
    ).fetchall()
    hrv_impact = None
    if len(hrv_with) >= 3:
        tag_dates = set(usage_dates)
        hrv_all = conn.execute("SELECT date, last_night_avg FROM hrv WHERE last_night_avg IS NOT NULL").fetchall()
        hrv_without_vals = [float(r["last_night_avg"]) for r in hrv_all if r["date"] not in tag_dates]
        hrv_with_vals = [float(r["last_night_avg"]) for r in hrv_with]
        avg_with = round(sum(hrv_with_vals) / len(hrv_with_vals), 2)
        avg_without = round(sum(hrv_without_vals) / len(hrv_without_vals), 2) if hrv_without_vals else None
        hrv_impact = {
            "avg_with": avg_with,
            "avg_without": avg_without,
            "delta": round(avg_with - avg_without, 2) if avg_without is not None else None,
            "n": len(hrv_with_vals),
        }

    # ── Streak computation ──
    def _streaks(dates: list[str]):
        if not dates:
            return 0, 0, None
        parsed = [date.fromisoformat(d) for d in dates]
        longest = 1
        longest_end = parsed[-1]
        cur = 1
        for i in range(1, len(parsed)):
            if (parsed[i] - parsed[i - 1]).days == 1:
                cur += 1
                if cur > longest:
                    longest = cur
                    longest_end = parsed[i]
            else:
                cur = 1
        # Current streak: count back from today
        current = 1
        for i in range(len(parsed) - 1, 0, -1):
            if (parsed[i] - parsed[i - 1]).days == 1:
                current += 1
            else:
                break
        last = parsed[-1]
        if (today - last).days > 1:
            current = 0
        return current, longest, longest_end.isoformat() if longest_end else None

    current_streak, longest_streak, longest_streak_end = _streaks(usage_dates)

    # ── Frequency ──
    if len(usage_dates) >= 2:
        span_days = (date.fromisoformat(usage_dates[-1]) - date.fromisoformat(usage_dates[0])).days + 1
        weekly_avg = round(len(usage_dates) / max(span_days / 7, 1), 1)
        monthly_avg = round(len(usage_dates) / max(span_days / 30.44, 1), 1)
    else:
        weekly_avg = float(len(usage_dates))
        monthly_avg = float(len(usage_dates))

    return {
        "slug": slug,
        "name": tag_row["name"],
        "icon": tag_row["icon"],
        "category": tag_row["category"],
        "total_days_all": total_days_all,
        "total_days_90d": total_days_90d,
        "first_used": first_used,
        "last_used": last_used,
        "avg_gap_days": avg_gap_days,
        "peak_month": peak_month,
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "longest_streak_end": longest_streak_end,
        "weekly_avg": weekly_avg,
        "monthly_avg": monthly_avg,
        "usage_dates": usage_dates,
        "weekly_sparkline": [{"week": r["week"], "count": r["count"]} for r in weekly],
        "rolling_28d": rolling_28d,
        "mood_impact": _metric_impact("mood"),
        "energy_impact": _metric_impact("energy"),
        "hrv_impact": hrv_impact,
    }


# ─── /days/{date}/tags routes ──────────────────────────────────────────────────

def _day_tags_list(conn: sqlite3.Connection, date_str: str) -> list[DayTagOut]:
    rows = conn.execute(
        """
        SELECT dt.tag_id, t.slug, t.name, t.icon, t.category, t.color, dt.note
        FROM day_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.date = ?
        ORDER BY t.category, t.name
        """,
        (date_str,),
    ).fetchall()
    return [
        DayTagOut(
            tag_id=r["tag_id"], slug=r["slug"], name=r["name"], icon=r["icon"],
            category=r["category"], color=r["color"], note=r["note"],
        )
        for r in rows
    ]


@day_tags_router.get("/{date_str}/tags", response_model=list[DayTagOut])
def get_day_tags(date_str: str, conn: DB):
    try:
        date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    return _day_tags_list(conn, date_str)


@day_tags_router.post("/{date_str}/tags", response_model=list[DayTagOut], status_code=201)
def add_day_tag(date_str: str, body: AddDayTagBody, conn: DB):
    try:
        date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")

    tag = conn.execute("SELECT id FROM tags WHERE id=?", (body.tag_id,)).fetchone()
    if tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")

    # Ensure spine row exists
    conn.execute("INSERT OR IGNORE INTO days (date) VALUES (?)", (date_str,))
    conn.execute(
        "INSERT OR REPLACE INTO day_tags (date, tag_id, note) VALUES (?,?,?)",
        (date_str, body.tag_id, body.note),
    )
    conn.commit()
    return _day_tags_list(conn, date_str)


@day_tags_router.delete("/{date_str}/tags/{tag_id}", status_code=204)
def remove_day_tag(date_str: str, tag_id: int, conn: DB):
    try:
        date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    conn.execute("DELETE FROM day_tags WHERE date=? AND tag_id=?", (date_str, tag_id))
    conn.commit()
