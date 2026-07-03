"""
Training adaptation engine — ported from omyra_v3/backend/ai_engine.py.
Reads real daybook data (HRV, sleep, compliance, TSS) to recommend
weekly plan adjustments (volume/intensity factors).
"""

import math
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
from datetime import datetime, date, timedelta
import json


class PlanPhase(Enum):
    BASE_BUILDING = "base_building"
    BUILD = "build"
    PEAK = "peak"
    TAPER = "taper"
    RECOVERY = "recovery"


class RiskLevel(Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"


class ReadinessLevel(Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"


@dataclass
class WeekData:
    compliance_score: float        # 0-1
    avg_rpe: float                 # 1-10
    planned_vs_actual_rpe: float   # ratio; 1.0 = perfect
    sleep_hours_avg: float         # daily average
    sleep_debt: float              # cumulative hours short of 8h target
    hrv_trend: Optional[float] = None   # % change from baseline (negative = declining)
    rhr_trend: Optional[float] = None   # % change from baseline
    monotony_index: float = 0.0
    performance_indicator: float = 1.0


class ReadinessCalculator:
    def __init__(self):
        self.component_weights = {
            "compliance": 0.35,
            "recovery": 0.30,
            "performance_trend": 0.25,
            "rpe_alignment": 0.10,
        }

    def get_time_weights(self, plan_phase: PlanPhase, weeks_remaining: int) -> List[float]:
        if plan_phase == PlanPhase.TAPER:
            return [0.5, 0.3, 0.15, 0.05]
        elif plan_phase == PlanPhase.BASE_BUILDING:
            return [0.3, 0.25, 0.25, 0.2]
        elif weeks_remaining < 4:
            return [0.4, 0.35, 0.2, 0.05]
        return [0.4, 0.3, 0.2, 0.1]

    def calculate_compliance_score(self, week_data: WeekData) -> float:
        base = week_data.compliance_score * 100
        rpe_penalty = abs(week_data.planned_vs_actual_rpe - 1.0) * 20
        return max(0.0, base - rpe_penalty)

    def calculate_recovery_score(self, week_data: WeekData) -> float:
        sleep_score = min(100.0, (week_data.sleep_hours_avg / 8.0) * 100)
        debt_penalty = min(50.0, week_data.sleep_debt * 10)
        base = max(0.0, sleep_score - debt_penalty)
        if week_data.hrv_trend is not None:
            if week_data.hrv_trend > 0.05:
                base = min(100.0, base * 1.1)
            elif week_data.hrv_trend < -0.15:
                base *= 0.8
        return base

    def calculate_performance_score(self, week_data: WeekData) -> float:
        return min(100.0, week_data.performance_indicator * 100)

    def calculate_rpe_alignment_score(self, week_data: WeekData) -> float:
        ratio = week_data.planned_vs_actual_rpe
        if 0.9 <= ratio <= 1.1:
            return 100.0
        elif 0.8 <= ratio <= 1.2:
            return 80.0
        return max(0.0, 100.0 - abs(ratio - 1.0) * 100)

    def calculate(
        self,
        recent_weeks: List[WeekData],
        plan_phase: PlanPhase,
        weeks_remaining: int,
    ) -> float:
        if not recent_weeks:
            return 50.0
        weeks_to_use = recent_weeks[:4]
        time_weights = self.get_time_weights(plan_phase, weeks_remaining)[: len(weeks_to_use)]
        weekly_scores = []
        for week in weeks_to_use:
            score = (
                self.calculate_compliance_score(week) * self.component_weights["compliance"]
                + self.calculate_recovery_score(week) * self.component_weights["recovery"]
                + self.calculate_performance_score(week) * self.component_weights["performance_trend"]
                + self.calculate_rpe_alignment_score(week) * self.component_weights["rpe_alignment"]
            )
            weekly_scores.append(score)
        weighted = sum(s * w for s, w in zip(weekly_scores, time_weights))
        return round(weighted, 1)


class RiskAssessment:
    def __init__(self):
        self.signal_weights = {
            "hrv_decline": 0.35,
            "rpe_spike": 0.25,
            "sleep_debt": 0.20,
            "monotony_index": 0.15,
            "rhr_trend": 0.05,
        }

    def _safe_mean(self, values: List[float]) -> float:
        return sum(values) / len(values) if values else 0.0

    def _safe_std(self, values: List[float]) -> float:
        if len(values) < 2:
            return 0.0
        mean = self._safe_mean(values)
        variance = sum((v - mean) ** 2 for v in values) / len(values)
        return math.sqrt(variance)

    def calculate_monotony_risk(self, daily_loads: List[float]) -> float:
        if len(daily_loads) < 7:
            return 0.0
        mean = self._safe_mean(daily_loads)
        std = self._safe_std(daily_loads)
        if std == 0:
            return 1.0
        monotony = mean / std
        if monotony >= 2.5:
            return 1.0
        elif monotony >= 2.0:
            return 0.7
        elif monotony >= 1.5:
            return 0.4
        return 0.0

    def calculate_rpe_spike_risk(self, recent_rpe: List[float]) -> float:
        if len(recent_rpe) < 3:
            return 0.0
        baseline = self._safe_mean(recent_rpe[1:])
        current = recent_rpe[0]
        if baseline == 0:
            return 0.0
        ratio = current / baseline
        if ratio >= 1.4:
            return 1.0
        elif ratio >= 1.25:
            return 0.7
        elif ratio >= 1.15:
            return 0.4
        return 0.0

    def calculate_hrv_decline_risk(self, hrv_trend: Optional[float]) -> float:
        if hrv_trend is None:
            return 0.0
        if hrv_trend <= -0.20:
            return 1.0
        elif hrv_trend <= -0.15:
            return 0.7
        elif hrv_trend <= -0.10:
            return 0.4
        return 0.0

    def calculate_sleep_debt_risk(self, sleep_debt: float) -> float:
        if sleep_debt >= 8:
            return 1.0
        elif sleep_debt >= 5:
            return 0.7
        elif sleep_debt >= 3:
            return 0.4
        return 0.0

    def calculate_risk(
        self,
        week_data: WeekData,
        recent_rpe: Optional[List[float]] = None,
        daily_loads: Optional[List[float]] = None,
    ) -> Tuple[float, RiskLevel]:
        signals: Dict[str, float] = {}
        if week_data.hrv_trend is not None:
            signals["hrv_decline"] = self.calculate_hrv_decline_risk(week_data.hrv_trend)
        if recent_rpe:
            signals["rpe_spike"] = self.calculate_rpe_spike_risk(recent_rpe)
        if week_data.sleep_debt > 0:
            signals["sleep_debt"] = self.calculate_sleep_debt_risk(week_data.sleep_debt)
        if daily_loads:
            signals["monotony_index"] = self.calculate_monotony_risk(daily_loads)
        if week_data.rhr_trend is not None and week_data.hrv_trend is None:
            signals["rhr_trend"] = self.calculate_hrv_decline_risk(-week_data.rhr_trend)

        total_weight = sum(self.signal_weights.get(k, 0) for k in signals)
        if total_weight == 0:
            return 0.0, RiskLevel.LOW

        risk_score = sum(v * self.signal_weights.get(k, 0) for k, v in signals.items()) / total_weight

        if risk_score >= 0.6:
            level = RiskLevel.HIGH
        elif risk_score >= 0.3:
            level = RiskLevel.MODERATE
        else:
            level = RiskLevel.LOW

        return round(risk_score, 3), level


class DecisionEngine:
    def __init__(self, decision_matrix: Optional[Dict] = None):
        self.matrix = decision_matrix or {
            "high_readiness":     {"low_risk": "progressive_overload", "moderate_risk": "maintain_intensity", "high_risk": "reduce_intensity"},
            "moderate_readiness": {"low_risk": "maintain_course",      "moderate_risk": "reduce_volume",      "high_risk": "active_recovery"},
            "low_readiness":      {"low_risk": "reduce_volume",         "moderate_risk": "active_recovery",    "high_risk": "complete_rest"},
        }

    def categorize_readiness(self, score: float) -> ReadinessLevel:
        if score >= 75:
            return ReadinessLevel.HIGH
        elif score >= 50:
            return ReadinessLevel.MODERATE
        return ReadinessLevel.LOW

    def get_recommendation(self, readiness_score: float, risk_level: RiskLevel) -> str:
        readiness = self.categorize_readiness(readiness_score)
        try:
            return self.matrix[f"{readiness.value}_readiness"][f"{risk_level.value}_risk"]
        except KeyError:
            return "maintain_course"


class SafetyConstraints:
    def __init__(self):
        self.overrides = {
            "progressive_overload": ["maintain_intensity", "reduce_volume"],
            "maintain_intensity":   ["reduce_volume", "active_recovery"],
            "maintain_course":      ["reduce_volume", "active_recovery"],
        }

    def _should_override(self, week_data: WeekData, risk_level: RiskLevel) -> bool:
        return (
            (week_data.avg_rpe >= 8.0 and week_data.sleep_debt >= 4.0)
            or (week_data.hrv_trend is not None and week_data.hrv_trend <= -0.15 and risk_level == RiskLevel.HIGH)
            or (week_data.compliance_score < 0.6)
        )

    def validate(self, recommendation: str, week_data: WeekData, risk_level: RiskLevel) -> str:
        if self._should_override(week_data, risk_level) and recommendation in self.overrides:
            options = self.overrides[recommendation]
            return options[-1] if risk_level == RiskLevel.HIGH else options[0]
        return recommendation


RECOMMENDATION_FACTORS = {
    "progressive_overload": {"volume": 1.10, "intensity": 1.05},
    "maintain_intensity":   {"volume": 1.0,  "intensity": 1.0},
    "maintain_course":      {"volume": 1.0,  "intensity": 1.0},
    "reduce_volume":        {"volume": 0.85, "intensity": 1.0},
    "reduce_intensity":     {"volume": 1.0,  "intensity": 0.90},
    "active_recovery":      {"volume": 0.70, "intensity": 0.85},
    "complete_rest":        {"volume": 0.50, "intensity": 0.80},
}

RECOMMENDATION_EXPLANATIONS = {
    "progressive_overload": "Readiness is high. Time to push a little harder.",
    "maintain_intensity":   "You're adapting well. Keeping intensity steady.",
    "maintain_course":      "Training is working. Staying the course.",
    "reduce_volume":        "Moderate fatigue detected. Reducing volume to support recovery.",
    "reduce_intensity":     "High fatigue signals. Converting hard sessions to easier efforts.",
    "active_recovery":      "Recovery needed. Focus on easy sessions this week.",
    "complete_rest":        "High overreaching risk. Rest is the training.",
}


class OMYRATrainingEngine:
    """Main engine integrating readiness, risk, decision, and safety."""

    def __init__(self, decision_matrix: Optional[Dict] = None):
        self.readiness_calculator = ReadinessCalculator()
        self.risk_assessor = RiskAssessment()
        self.decision_engine = DecisionEngine(decision_matrix)
        self.safety_constraints = SafetyConstraints()

    def process_training_week(
        self,
        recent_weeks: List[WeekData],
        plan_phase: PlanPhase,
        weeks_remaining: int,
        recent_rpe: Optional[List[float]] = None,
        daily_loads: Optional[List[float]] = None,
    ) -> Dict:
        current_week = recent_weeks[0] if recent_weeks else WeekData(
            compliance_score=0.8, avg_rpe=6.0, planned_vs_actual_rpe=1.0,
            sleep_hours_avg=7.5, sleep_debt=0.0
        )

        readiness_score = self.readiness_calculator.calculate(recent_weeks, plan_phase, weeks_remaining)
        risk_score, risk_level = self.risk_assessor.calculate_risk(current_week, recent_rpe, daily_loads)
        raw_rec = self.decision_engine.get_recommendation(readiness_score, risk_level)
        final_rec = self.safety_constraints.validate(raw_rec, current_week, risk_level)

        factors = RECOMMENDATION_FACTORS.get(final_rec, {"volume": 1.0, "intensity": 1.0})
        explanation = RECOMMENDATION_EXPLANATIONS.get(final_rec, "Maintaining current plan.")
        if raw_rec != final_rec:
            explanation += " (Safety override applied.)"

        confidence = 0.5
        if current_week.hrv_trend is not None:
            confidence += 0.2
        if len(recent_weeks) >= 3:
            confidence += 0.15
        if current_week.sleep_hours_avg > 0:
            confidence += 0.1
        if current_week.compliance_score > 0:
            confidence += 0.05

        return {
            "readiness_score": readiness_score,
            "risk_score": risk_score,
            "risk_level": risk_level.value,
            "recommendation": final_rec,
            "volume_factor": factors["volume"],
            "intensity_factor": factors["intensity"],
            "explanation": explanation,
            "confidence": round(min(1.0, confidence), 2),
            "override_applied": raw_rec != final_rec,
            "timestamp": datetime.now().isoformat(),
        }


def map_daybook_data(conn, goal_id: int) -> WeekData:
    """
    Build a WeekData object from the last 7 days of daybook tables.
    Used by the /adapt endpoint to feed real athlete data into the engine.
    """
    today = date.today().isoformat()
    week_ago = (date.today() - timedelta(days=7)).isoformat()

    # Compliance: sessions completed or skipped vs total planned
    row = conn.execute(
        """SELECT COUNT(*) as total,
                  SUM(CASE WHEN status IN ('completed','skipped') THEN 1 ELSE 0 END) as done
           FROM plan_sessions
           WHERE goal_id=? AND original_date BETWEEN ? AND ?""",
        (goal_id, week_ago, today),
    ).fetchone()
    total = row["total"] or 1
    compliance = (row["done"] or 0) / total

    # Average RPE from completed sessions
    rpe_row = conn.execute(
        """SELECT AVG(rpe_actual) as avg_rpe FROM plan_sessions
           WHERE goal_id=? AND status='completed' AND session_date BETWEEN ? AND ?""",
        (goal_id, week_ago, today),
    ).fetchone()
    avg_rpe = rpe_row["avg_rpe"] or 6.0

    # Zone-implied RPE for comparison
    zone_rpe = {"Z1": 3, "Z2": 5, "Z3": 6.5, "Z4": 8, "Z5": 9.5}
    zone_rows = conn.execute(
        """SELECT intensity_zone FROM plan_sessions
           WHERE goal_id=? AND session_date BETWEEN ? AND ? AND status='completed'""",
        (goal_id, week_ago, today),
    ).fetchall()
    if zone_rows:
        implied = sum(zone_rpe.get(r["intensity_zone"], 6.0) for r in zone_rows) / len(zone_rows)
        planned_vs_actual = avg_rpe / implied if implied > 0 else 1.0
    else:
        planned_vs_actual = 1.0

    # Sleep
    sleep_rows = conn.execute(
        "SELECT duration_seconds FROM sleep WHERE date BETWEEN ? AND ?",
        (week_ago, today),
    ).fetchall()
    if sleep_rows:
        sleep_avg_h = sum(r["duration_seconds"] for r in sleep_rows) / len(sleep_rows) / 3600
        sleep_debt = max(0.0, (8.0 - sleep_avg_h) * len(sleep_rows))
    else:
        sleep_avg_h = 7.5
        sleep_debt = 0.0

    # HRV trend
    hrv_row = conn.execute(
        "SELECT last_night_avg, weekly_avg FROM hrv WHERE date=?", (today,)
    ).fetchone()
    hrv_trend = None
    if hrv_row and hrv_row["weekly_avg"] and hrv_row["last_night_avg"]:
        hrv_trend = (hrv_row["last_night_avg"] - hrv_row["weekly_avg"]) / hrv_row["weekly_avg"]

    # RHR trend (today vs 30-day avg)
    rhr_row = conn.execute(
        "SELECT AVG(resting_hr) as avg30 FROM daily_stats WHERE date BETWEEN ? AND ?",
        ((date.today() - timedelta(days=30)).isoformat(), today),
    ).fetchone()
    today_rhr = conn.execute(
        "SELECT resting_hr FROM daily_stats WHERE date=?", (today,)
    ).fetchone()
    rhr_trend = None
    if rhr_row and rhr_row["avg30"] and today_rhr and today_rhr["resting_hr"]:
        rhr_trend = (today_rhr["resting_hr"] - rhr_row["avg30"]) / rhr_row["avg30"]

    # Monotony index from daily TSS
    tss_rows = conn.execute(
        "SELECT daily_tss FROM training_load_daily WHERE sport='combined' AND date BETWEEN ? AND ?",
        (week_ago, today),
    ).fetchall()
    daily_loads = [r["daily_tss"] for r in tss_rows if r["daily_tss"] is not None]

    # Aviation fatigue from Load Index — fuses duty load + timezone penalty + sleep debt
    load_rows = conn.execute(
        "SELECT fatigue_score, duty_load, timezone_penalty, sleep_debt FROM load_index "
        "WHERE date BETWEEN ? AND ? ORDER BY date DESC LIMIT 7",
        (week_ago, today),
    ).fetchall()
    aviation_fatigue_bonus = 0.0
    if load_rows:
        avg_fatigue = sum(r["fatigue_score"] or 0 for r in load_rows) / len(load_rows)
        avg_duty = sum(r["duty_load"] or 0 for r in load_rows) / len(load_rows)
        avg_tz = sum(r["timezone_penalty"] or 0 for r in load_rows) / len(load_rows)
        # Convert composite fatigue score (0-100) into extra sleep debt equivalent
        # High duty/TZ load (>40/100 pts) is treated as 1-2 extra hours of sleep debt
        aviation_fatigue_bonus = (avg_duty + avg_tz) / 25.0  # 0-2h extra sleep debt
        sleep_debt = sleep_debt + aviation_fatigue_bonus

    return WeekData(
        compliance_score=compliance,
        avg_rpe=avg_rpe,
        planned_vs_actual_rpe=planned_vs_actual,
        sleep_hours_avg=sleep_avg_h,
        sleep_debt=sleep_debt,
        hrv_trend=hrv_trend,
        rhr_trend=rhr_trend,
        monotony_index=0.0,  # Computed internally by RiskAssessment using daily_loads
    ), daily_loads
