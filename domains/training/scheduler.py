"""
Training plan scheduler — ported from omyra_v3.
Assigns plan template sessions to specific calendar dates based on
athlete availability and roster-blocked dates.
"""

from datetime import datetime, timedelta
from typing import List, Dict, Union, Optional, Tuple, Set


def parse_date(date_string: str) -> datetime:
    if isinstance(date_string, datetime):
        return date_string
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(date_string, fmt)
        except ValueError:
            continue
    return datetime.now()


def trim_plan(template: List[Dict], weeks_until_race: int, min_weeks: int = 6) -> List[Dict]:
    total_weeks = len(template)
    if weeks_until_race < min_weeks:
        return template[-min_weeks:]
    if weeks_until_race < total_weeks:
        return template[-weeks_until_race:]
    return template


def get_calendar_week_bounds(date: datetime) -> Tuple[datetime, datetime]:
    date_only = datetime(date.year, date.month, date.day)
    days_since_monday = date_only.weekday()
    week_start = date_only - timedelta(days=days_since_monday)
    week_end = week_start + timedelta(days=6)
    return week_start, week_end


def calculate_weeks_between_dates(start_date: datetime, goal_date: datetime) -> int:
    total_days = (goal_date.date() - start_date.date()).days + 1
    return max(1, (total_days + 6) // 7)


def get_discipline(session_type: str) -> str:
    t = session_type.lower()
    if "swim" in t:
        return "swimming"
    if "bike" in t or "cycling" in t:
        return "cycling"
    if "run" in t:
        return "running"
    if "brick" in t:
        return "brick"
    return "other"


def validate_availability(availability: List[str]) -> List[str]:
    day_mappings = {
        "monday": "Monday", "tuesday": "Tuesday", "wednesday": "Wednesday",
        "thursday": "Thursday", "friday": "Friday", "saturday": "Saturday", "sunday": "Sunday",
        "mon": "Monday", "tue": "Tuesday", "wed": "Wednesday",
        "thu": "Thursday", "fri": "Friday", "sat": "Saturday", "sun": "Sunday",
    }
    valid_days = set(day_mappings.values())
    seen = []
    for day in availability:
        if isinstance(day, str):
            normalized = day_mappings.get(day.strip().lower(), day.strip())
            if normalized in valid_days and normalized not in seen:
                seen.append(normalized)
    return seen


def check_race_day_availability(
    goal_date: datetime, availability: List[str]
) -> Tuple[bool, str, List[Dict]]:
    race_day_name = goal_date.strftime("%A")
    validated = validate_availability(availability)
    is_available = race_day_name in validated

    suggestions = []
    if not is_available:
        weekday_index = {
            "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
            "Friday": 4, "Saturday": 5, "Sunday": 6,
        }
        race_weekday = goal_date.weekday()
        for day in validated:
            avail_weekday = weekday_index[day]
            forward_dist = (avail_weekday - race_weekday) % 7
            backward_dist = (race_weekday - avail_weekday) % 7
            dist = min(forward_dist, backward_dist)
            suggested_date = goal_date + timedelta(days=(avail_weekday - race_weekday))
            suggestions.append({"day": day, "date": suggested_date.strftime("%Y-%m-%d"), "distance_days": dist})
        suggestions.sort(key=lambda x: x["distance_days"])

    return is_available, race_day_name, suggestions


def place_race_day_session(
    final_plan: List[Dict], goal_date: datetime, availability: List[str]
) -> bool:
    goal_date_str = goal_date.strftime("%Y-%m-%d")
    race_day_name = goal_date.strftime("%A")

    for week in final_plan:
        week_start = parse_date(week["starts_on"])
        week_end = parse_date(week.get("week_end", ""))
        if not week_end:
            week_end = week_start + timedelta(days=6)

        if week_start.date() <= goal_date.date() <= week_end.date():
            existing_race = any(
                "race" in s["type"].lower() or s.get("date") == goal_date_str
                for s in week["training_sessions"]
            )
            if not existing_race:
                week["training_sessions"].append({
                    "type": "Race Day",
                    "duration": 0,
                    "intensity_zone": "Z4",
                    "optional": False,
                    "day": race_day_name,
                    "date": goal_date_str,
                })
                week["scheduled_sessions"] = len(week["training_sessions"])
                return True
    return False


def schedule_week_sessions(
    week_sessions: List[Dict],
    availability: List[str],
    week_start_date: datetime,
    week_end_date: datetime,
    roster_blocked_dates: Set[str],
    current_date: Optional[datetime] = None,
    max_sessions_per_week: int = 8,
    max_double_days: int = 2,
) -> List[Dict]:
    if current_date is None:
        current_date = datetime.now()

    validated_availability = validate_availability(availability)
    if not validated_availability:
        return []

    # Build the date-to-day mapping for this week, respecting both past dates and roster blocks
    actual_week_days: Dict[str, datetime] = {}
    check = week_start_date
    while check.date() <= week_end_date.date():
        day_name = check.strftime("%A")
        date_str = check.strftime("%Y-%m-%d")
        if (
            day_name in validated_availability
            and check.date() >= current_date.date()
            and date_str not in roster_blocked_dates
        ):
            actual_week_days[day_name] = check
        check += timedelta(days=1)

    available_days = list(actual_week_days.keys())
    if not available_days:
        return []

    # Remove Tuesday if all 7 days available (standard rest-day heuristic)
    if len(available_days) == 7 and "Tuesday" in available_days:
        available_days.remove("Tuesday")
        actual_week_days.pop("Tuesday", None)

    required_sessions = [s for s in week_sessions if not s.get("optional", False)]
    optional_sessions = [s for s in week_sessions if s.get("optional", False)]

    session_schedule: Dict[str, List[Dict]] = {day: [] for day in available_days}
    double_session_days: Set[str] = set()

    weekday_index = {
        "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
        "Friday": 4, "Saturday": 5, "Sunday": 6,
    }

    def can_assign(day: str, new_session: Dict) -> bool:
        if day not in session_schedule:
            return False
        current = session_schedule[day]
        if len(current) >= 2:
            return False
        if "brick" in new_session["type"].lower():
            return len(current) == 0
        if any("brick" in s["type"].lower() for s in current):
            return False
        new_disc = get_discipline(new_session["type"])
        if any(get_discipline(s["type"]) == new_disc for s in current):
            return False
        return True

    def violates_consecutive_double(target_day: str) -> bool:
        if target_day not in weekday_index:
            return False
        idx = weekday_index[target_day]
        rev = {v: k for k, v in weekday_index.items()}
        prev_name = rev[(idx - 1) % 7]
        next_name = rev[(idx + 1) % 7]
        return prev_name in double_session_days or next_name in double_session_days

    # Spread required sessions across available days first
    spread_days = available_days[: min(len(required_sessions), len(available_days), 6)]
    for i, day in enumerate(spread_days):
        if i < len(required_sessions):
            session_schedule[day].append(required_sessions[i])

    # Place remaining required sessions as doubles or singles
    for session in required_sessions[len(spread_days):]:
        placed = False
        for day in available_days:
            if can_assign(day, session) and len(session_schedule[day]) == 1:
                if len(double_session_days) >= max_double_days or violates_consecutive_double(day):
                    continue
                session_schedule[day].append(session)
                double_session_days.add(day)
                placed = True
                break
        if not placed:
            for day in available_days:
                if can_assign(day, session) and len(session_schedule[day]) == 0:
                    session_schedule[day].append(session)
                    break

    # Place optional sessions
    scheduled_count = sum(len(v) for v in session_schedule.values())
    for session in optional_sessions:
        if scheduled_count >= max_sessions_per_week:
            break
        placed = False
        for day in available_days:
            if can_assign(day, session) and len(session_schedule[day]) == 0:
                session_schedule[day].append(session)
                scheduled_count += 1
                placed = True
                break
        if not placed:
            for day in available_days:
                if can_assign(day, session) and len(session_schedule[day]) == 1:
                    if len(double_session_days) >= max_double_days or violates_consecutive_double(day):
                        continue
                    session_schedule[day].append(session)
                    scheduled_count += 1
                    double_session_days.add(day)
                    break

    # Build final session list with actual dates
    scheduled = []
    for day_name, sessions in session_schedule.items():
        if day_name in actual_week_days:
            actual_date = actual_week_days[day_name]
            if week_start_date.date() <= actual_date.date() <= week_end_date.date():
                for session in sessions:
                    scheduled.append({
                        **session,
                        "day": day_name,
                        "date": actual_date.strftime("%Y-%m-%d"),
                    })
    return scheduled


def generate_plan(
    template: List[Dict],
    goal_date: str,
    availability: List[str],
    start_from: Optional[str] = None,
    roster_blocked_dates: Optional[Set[str]] = None,
    min_weeks: int = 6,
    focus_discipline: str = "running",
    schedule_all_weeks: bool = False,
) -> Dict:
    """
    Generate a materialized training plan from a template.

    Returns a dict with 'plan' (list of week dicts with scheduled sessions),
    plus metadata about weeks generated, warnings, etc.

    When schedule_all_weeks=True, sessions are assigned to all weeks starting
    from start_from (including weeks whose dates are in the past). This is
    used during initial plan creation so the full plan is stored in the DB,
    with past sessions marked as missed in the UI.
    """
    if roster_blocked_dates is None:
        roster_blocked_dates = set()

    goal_date_obj = parse_date(goal_date)
    today = datetime.now()

    validated_availability = validate_availability(availability)
    if not validated_availability:
        return {"plan": [], "error": "No valid training days. Need at least 3.", "success": False}

    race_available, race_day_name, race_suggestions = check_race_day_availability(
        goal_date_obj, validated_availability
    )

    start_date = parse_date(start_from) if start_from else today + timedelta(days=1)
    # When scheduling all weeks (full plan materialization), use start_date as the
    # reference point so past weeks also get date assignments.
    scheduling_reference = start_date if schedule_all_weeks else today

    weeks_until_race = calculate_weeks_between_dates(start_date, goal_date_obj)
    trimmed = trim_plan(template, weeks_until_race, min_weeks)
    rushed = weeks_until_race < len(template)

    final_plan: List[Dict] = []
    warnings: List[str] = []

    if not race_available:
        warnings.append(
            f"Race day ({race_day_name}) is not in your available training days."
        )

    current_week_start = start_date

    for i, week in enumerate(trimmed):
        week_number = i + 1
        is_first_week = week_number == 1

        if is_first_week:
            _, week_end = get_calendar_week_bounds(start_date)
        else:
            week_end = current_week_start + timedelta(days=6)

        # Cap at goal date
        if week_end.date() >= goal_date_obj.date():
            week_end = goal_date_obj
            is_goal_week = True
        else:
            is_goal_week = False

        scheduled = schedule_week_sessions(
            week["sessions"],
            validated_availability,
            week_start_date=current_week_start,
            week_end_date=week_end,
            roster_blocked_dates=roster_blocked_dates,
            current_date=scheduling_reference,
        )

        planned_count = len(week["sessions"])
        if len(scheduled) < planned_count:
            warnings.append(
                f"Week {week_number}: {len(scheduled)}/{planned_count} sessions scheduled"
            )

        final_plan.append({
            "week": week_number,
            "starts_on": current_week_start.strftime("%Y-%m-%d"),
            "week_end": week_end.strftime("%Y-%m-%d"),
            "training_sessions": scheduled,
            "planned_sessions": planned_count,
            "scheduled_sessions": len(scheduled),
        })

        if is_goal_week:
            break

        if is_first_week:
            _, first_week_end = get_calendar_week_bounds(start_date)
            current_week_start = first_week_end + timedelta(days=1)
            while current_week_start.weekday() != 0:
                current_week_start += timedelta(days=1)
        else:
            current_week_start += timedelta(days=7)

    place_race_day_session(final_plan, goal_date_obj, validated_availability)

    return {
        "plan": final_plan,
        "rushed": rushed,
        "start_date": start_date.strftime("%Y-%m-%d"),
        "goal_date": goal_date_obj.strftime("%Y-%m-%d"),
        "weeks_generated": len(final_plan),
        "race_day_available": race_available,
        "race_day_name": race_day_name,
        "race_suggestions": race_suggestions if not race_available else [],
        "warnings": warnings,
        "success": len(final_plan) > 0,
        "total_scheduled_sessions": sum(w.get("scheduled_sessions", 0) for w in final_plan),
    }
