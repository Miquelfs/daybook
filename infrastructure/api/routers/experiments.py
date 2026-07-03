"""
Horizon 3 — N-of-1 Experiments.

POST  /experiments          — create experiment
GET   /experiments          — list (status filter optional)
GET   /experiments/{id}     — single
PATCH /experiments/{id}     — update / conclude
DELETE /experiments/{id}    — remove
"""

from __future__ import annotations

import math
import sqlite3
import uuid
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from infrastructure.api.db import get_db

router = APIRouter(prefix="/experiments", tags=["experiments"])
DB = Annotated[sqlite3.Connection, Depends(get_db)]


# ── Models ────────────────────────────────────────────────────────────────────

class ExperimentCreate(BaseModel):
    title: str
    hypothesis: str
    protocol: Optional[str] = None
    tag: Optional[str] = None              # tag slug for compliance (treatment days)
    metric: Optional[str] = None           # outcome metric key OR "tag:<slug>" for tag-rate outcome
    outcome_threshold: Optional[float] = None  # for metric outcomes: "days where metric >= X"
    start_date: str
    end_date: Optional[str] = None

class ExperimentPatch(BaseModel):
    title: Optional[str] = None
    hypothesis: Optional[str] = None
    protocol: Optional[str] = None
    tag: Optional[str] = None
    metric: Optional[str] = None
    outcome_threshold: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = None       # active | concluded | abandoned
    result: Optional[str] = None
    effect_size: Optional[float] = None
    p_value: Optional[float] = None
    notes: Optional[str] = None

class ExperimentOut(BaseModel):
    id: str
    title: str
    hypothesis: str
    protocol: Optional[str]
    tag: Optional[str]
    metric: Optional[str]
    outcome_threshold: Optional[float]
    start_date: str
    end_date: Optional[str]
    status: str
    result: Optional[str]
    effect_size: Optional[float]
    p_value: Optional[float]
    notes: Optional[str]
    created_at: str
    updated_at: str


class ExperimentResult(BaseModel):
    treatment_n: int
    control_n: int
    treatment_mean: Optional[float]   # mean value OR rate (0-1) for tag outcomes
    control_mean: Optional[float]
    delta: Optional[float]
    effect_size: Optional[float]      # Cohen's d for metric, rate difference for tag
    metric_label: str
    outcome_type: str                 # "metric" | "tag_rate" | "metric_threshold"


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS experiments (
            id                 TEXT PRIMARY KEY,
            title              TEXT NOT NULL,
            hypothesis         TEXT NOT NULL,
            protocol           TEXT,
            tag                TEXT,
            metric             TEXT,
            outcome_threshold  REAL,
            start_date         TEXT NOT NULL,
            end_date           TEXT,
            status             TEXT NOT NULL DEFAULT 'active',
            result             TEXT,
            effect_size        REAL,
            p_value            REAL,
            notes        TEXT,
            created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    """)
    conn.commit()


def _row(r: sqlite3.Row) -> ExperimentOut:
    return ExperimentOut(**{k: r[k] for k in r.keys()})


@router.post("", response_model=ExperimentOut, status_code=201)
def create_experiment(body: ExperimentCreate, conn: DB):
    _ensure_table(conn)
    exp_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO experiments (id, title, hypothesis, protocol, tag, metric, outcome_threshold, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (exp_id, body.title, body.hypothesis, body.protocol, body.tag, body.metric, body.outcome_threshold, body.start_date, body.end_date),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM experiments WHERE id=?", (exp_id,)).fetchone()
    return _row(row)


@router.get("", response_model=list[ExperimentOut])
def list_experiments(conn: DB, status: Optional[str] = Query(None)):
    _ensure_table(conn)
    if status:
        rows = conn.execute(
            "SELECT * FROM experiments WHERE status=? ORDER BY start_date DESC", (status,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM experiments ORDER BY start_date DESC"
        ).fetchall()
    return [_row(r) for r in rows]


@router.get("/{exp_id}", response_model=ExperimentOut)
def get_experiment(exp_id: str, conn: DB):
    _ensure_table(conn)
    row = conn.execute("SELECT * FROM experiments WHERE id=?", (exp_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Not found")
    return _row(row)


@router.patch("/{exp_id}", response_model=ExperimentOut)
def update_experiment(exp_id: str, body: ExperimentPatch, conn: DB):
    _ensure_table(conn)
    row = conn.execute("SELECT * FROM experiments WHERE id=?", (exp_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Not found")

    updates = body.model_dump(exclude_none=True)
    if not updates:
        return _row(row)

    updates["updated_at"] = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    set_clause = ", ".join(
        f"{k} = strftime('%Y-%m-%dT%H:%M:%SZ','now')" if k == "updated_at" else f"{k} = ?"
        for k in updates
    )
    values = [v for k, v in updates.items() if k != "updated_at"]
    values.append(exp_id)

    conn.execute(f"UPDATE experiments SET {set_clause} WHERE id=?", values)
    conn.commit()
    row = conn.execute("SELECT * FROM experiments WHERE id=?", (exp_id,)).fetchone()
    return _row(row)


@router.delete("/{exp_id}", status_code=204)
def delete_experiment(exp_id: str, conn: DB):
    _ensure_table(conn)
    row = conn.execute("SELECT id FROM experiments WHERE id=?", (exp_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Not found")
    conn.execute("DELETE FROM experiments WHERE id=?", (exp_id,))
    conn.commit()


# ── Metric definitions (mirrors correlations router) ─────────────────────────

_METRIC_MAP: dict[str, dict] = {
    "energy":        {"label": "Energy",          "unit": "1-10",  "table": "days",        "col": "energy"},
    "mood":          {"label": "Mood",             "unit": "1-10",  "table": "days",        "col": "mood"},
    "stress":        {"label": "Stress",           "unit": "1-10",  "table": "days",        "col": "stress"},
    "sleep_quality": {"label": "Sleep quality",    "unit": "1-10",  "table": "days",        "col": "sleep_quality"},
    "hrv_avg":       {"label": "HRV",              "unit": "ms",    "table": "hrv",         "col": "last_night_avg"},
    "sleep_duration":{"label": "Sleep duration",   "unit": "hours", "table": "sleep",       "col": "duration_seconds", "scale": 1/3600},
    "resting_hr":    {"label": "Resting HR",       "unit": "bpm",   "table": "daily_stats", "col": "resting_hr"},
    "stress_avg":    {"label": "Garmin stress",    "unit": "score", "table": "daily_stats", "col": "stress_avg"},
    "battery_high":  {"label": "Body battery",     "unit": "score", "table": "daily_stats", "col": "body_battery_high"},
    "steps":         {"label": "Steps",            "unit": "steps", "table": "daily_stats", "col": "steps"},
}


def _fetch_metric_values(conn: sqlite3.Connection, metric: str, dates: list[str]) -> list[float]:
    if not dates or metric not in _METRIC_MAP:
        return []
    m = _METRIC_MAP[metric]
    placeholders = ",".join("?" * len(dates))
    rows = conn.execute(
        f"SELECT {m['col']} FROM {m['table']} WHERE date IN ({placeholders}) AND {m['col']} IS NOT NULL",
        dates,
    ).fetchall()
    scale = m.get("scale", 1.0)
    return [row[0] * scale for row in rows]


def _cohens_d(a: list[float], b: list[float]) -> Optional[float]:
    if len(a) < 2 or len(b) < 2:
        return None
    mean_a = sum(a) / len(a)
    mean_b = sum(b) / len(b)
    var_a = sum((x - mean_a) ** 2 for x in a) / (len(a) - 1)
    var_b = sum((x - mean_b) ** 2 for x in b) / (len(b) - 1)
    pooled_sd = math.sqrt((var_a + var_b) / 2)
    if pooled_sd == 0:
        return None
    return round((mean_a - mean_b) / pooled_sd, 3)


def _get_treatment_dates(conn: sqlite3.Connection, tag: str, start: str, end: str) -> set[str]:
    rows = conn.execute(
        """
        SELECT DISTINCT dt.date FROM day_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE t.slug = ? AND dt.date BETWEEN ? AND ?
        """,
        (tag, start, end),
    ).fetchall()
    return {r[0] for r in rows}


@router.get("/{exp_id}/compute", response_model=ExperimentResult)
def compute_experiment(exp_id: str, conn: DB):
    """
    Compute treatment vs. control stats.
    treatment = days in window where compliance tag is present
    control   = days in window where compliance tag is absent

    metric can be:
      - a key from _METRIC_MAP  → compare means, compute Cohen's d
      - "tag:<slug>"            → compare tag occurrence rate (0/1 per day)
      - a key + outcome_threshold → compare % of days meeting threshold
    """
    _ensure_table(conn)
    row = conn.execute("SELECT * FROM experiments WHERE id=?", (exp_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Not found")

    exp = dict(row)
    tag = exp.get("tag")
    metric = exp.get("metric")
    threshold = exp.get("outcome_threshold")
    start = exp.get("start_date")
    end = exp.get("end_date") or date.today().isoformat()

    if not tag or not metric:
        raise HTTPException(422, "Experiment must have both tag and metric defined")

    treatment_dates = _get_treatment_dates(conn, tag, start, end)

    # ── TAG-RATE outcome: metric = "tag:<slug>" ────────────────────────────
    if metric.startswith("tag:"):
        outcome_slug = metric[4:]
        outcome_dates = _get_treatment_dates(conn, outcome_slug, start, end)

        # All days in window (use days table as calendar source)
        all_rows = conn.execute(
            "SELECT date FROM days WHERE date BETWEEN ? AND ? ORDER BY date", (start, end)
        ).fetchall()
        all_dates = [r[0] for r in all_rows]

        t_dates = [d for d in all_dates if d in treatment_dates]
        c_dates = [d for d in all_dates if d not in treatment_dates]

        t_rate = round(sum(1 for d in t_dates if d in outcome_dates) / len(t_dates), 3) if t_dates else None
        c_rate = round(sum(1 for d in c_dates if d in outcome_dates) / len(c_dates), 3) if c_dates else None
        delta = round(t_rate - c_rate, 3) if t_rate is not None and c_rate is not None else None

        # Cohen's h for proportions (arcsin transform)
        effect: Optional[float] = None
        if t_rate is not None and c_rate is not None:
            import math as _math
            h = 2 * (_math.asin(_math.sqrt(t_rate)) - _math.asin(_math.sqrt(c_rate)))
            effect = round(h, 3)

        # Find tag name for label
        tag_row = conn.execute("SELECT name FROM tags WHERE slug=?", (outcome_slug,)).fetchone()
        label = f"#{outcome_slug}" + (f" ({tag_row['name']})" if tag_row else "")

        return ExperimentResult(
            treatment_n=len(t_dates),
            control_n=len(c_dates),
            treatment_mean=t_rate,
            control_mean=c_rate,
            delta=delta,
            effect_size=effect,
            metric_label=label,
            outcome_type="tag_rate",
        )

    # ── METRIC outcome ─────────────────────────────────────────────────────
    if metric not in _METRIC_MAP:
        raise HTTPException(422, f"Unknown metric: {metric}")

    m = _METRIC_MAP[metric]
    all_rows = conn.execute(
        f"SELECT date FROM {m['table']} WHERE date BETWEEN ? AND ? AND {m['col']} IS NOT NULL ORDER BY date",
        (start, end),
    ).fetchall()
    all_dates = [r[0] for r in all_rows]

    t_dates = [d for d in all_dates if d in treatment_dates]
    c_dates = [d for d in all_dates if d not in treatment_dates]

    t_vals = _fetch_metric_values(conn, metric, t_dates)
    c_vals = _fetch_metric_values(conn, metric, c_dates)

    if threshold is not None:
        # Threshold mode: % of days where metric >= threshold
        t_rate = round(sum(1 for v in t_vals if v >= threshold) / len(t_vals), 3) if t_vals else None
        c_rate = round(sum(1 for v in c_vals if v >= threshold) / len(c_vals), 3) if c_vals else None
        delta = round(t_rate - c_rate, 3) if t_rate is not None and c_rate is not None else None
        return ExperimentResult(
            treatment_n=len(t_vals),
            control_n=len(c_vals),
            treatment_mean=t_rate,
            control_mean=c_rate,
            delta=delta,
            effect_size=None,
            metric_label=f"{m['label']} ≥ {threshold}",
            outcome_type="metric_threshold",
        )

    # Plain mean comparison
    t_mean = round(sum(t_vals) / len(t_vals), 2) if t_vals else None
    c_mean = round(sum(c_vals) / len(c_vals), 2) if c_vals else None
    delta = round(t_mean - c_mean, 2) if t_mean is not None and c_mean is not None else None

    return ExperimentResult(
        treatment_n=len(t_vals),
        control_n=len(c_vals),
        treatment_mean=t_mean,
        control_mean=c_mean,
        delta=delta,
        effect_size=_cohens_d(t_vals, c_vals),
        metric_label=m["label"],
        outcome_type="metric",
    )
