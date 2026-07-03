"""
Builds structured prompts from Daybook data for Ollama.
Each builder function takes raw data dicts and returns a plain-text prompt string.
"""

from typing import Optional


def _fmt_duration(seconds: Optional[int]) -> str:
    if not seconds:
        return "unknown"
    h, m = divmod(seconds // 60, 60)
    return f"{h}h {m}m"


def _fmt_pct(part: Optional[int], total: Optional[int]) -> str:
    if not part or not total or total == 0:
        return "unknown"
    return f"{round(part / total * 100)}%"


def morning_brief(
    today: str,
    yesterday: dict,
    sleep: dict,
    daily_stats: dict,
    hrv: dict,
    load_index: dict,
    weather_today: dict,
    week_summary: dict,
    last_intention: Optional[str],
) -> str:
    """
    Builds the 6am morning brief prompt.
    yesterday/sleep/daily_stats/hrv/load_index are dicts with nullable fields.
    week_summary is {avg_energy, avg_mood, total_spend, activity_count, prev_avg_energy, prev_avg_mood}.
    """
    sleep_dur = _fmt_duration(sleep.get("duration_seconds"))
    deep_pct = _fmt_pct(sleep.get("deep_seconds"), sleep.get("duration_seconds"))
    rem_pct = _fmt_pct(sleep.get("rem_seconds"), sleep.get("duration_seconds"))
    sleep_score = sleep.get("score") or "unknown"

    hrv_val = round(hrv.get("last_night_avg") or 0) or "unknown"
    hrv_weekly = round(hrv.get("weekly_avg") or 0) or "unknown"
    resting_hr = daily_stats.get("resting_hr") or "unknown"
    steps = daily_stats.get("steps") or "unknown"
    body_battery = (
        f"{daily_stats.get('body_battery_low')}–{daily_stats.get('body_battery_high')}"
        if daily_stats.get("body_battery_high") else "unknown"
    )

    fatigue = round(load_index.get("fatigue_score") or 0) or "unknown"
    recovery = load_index.get("recovery_status") or "unknown"

    energy_yd = yesterday.get("energy") or "unknown"
    mood_yd = yesterday.get("mood") or "unknown"

    weather_desc = weather_today.get("condition") or "unknown"
    temp_min = weather_today.get("temp_min") or "?"
    temp_max = weather_today.get("temp_max") or "?"

    avg_energy = week_summary.get("avg_energy") or "unknown"
    avg_mood = week_summary.get("avg_mood") or "unknown"
    total_spend = week_summary.get("total_spend")
    activity_count = week_summary.get("activity_count") or 0
    prev_energy = week_summary.get("prev_avg_energy")
    energy_trend = ""
    if avg_energy != "unknown" and prev_energy:
        diff = round(float(avg_energy) - float(prev_energy), 1)
        energy_trend = f" ({'+' if diff >= 0 else ''}{diff} vs last week)"

    intention_line = f"\nLast night's intention: {last_intention}" if last_intention else ""

    return f"""You are a concise personal daily assistant. Write a warm, grounded morning brief in 3-4 sentences using the data below.
Mention the most notable numbers, flag anything worth attention (low HRV, poor sleep, high fatigue), and end with one actionable suggestion for the day.
Do not start with "Good morning". Do not repeat all numbers — pick the most meaningful ones.

Today: {today}
Weather: {weather_desc}, {temp_min}–{temp_max}°C

Yesterday: energy {energy_yd}/10, mood {mood_yd}/10
Sleep last night: {sleep_dur}, score {sleep_score}/100, deep {deep_pct}, REM {rem_pct}
HRV: {hrv_val}ms (weekly avg {hrv_weekly}ms)
Resting HR: {resting_hr}bpm | Steps: {steps} | Body battery: {body_battery}
Load index: {fatigue}/100 ({recovery})

This week: avg energy {avg_energy}/10{energy_trend}, avg mood {avg_mood}/10, {activity_count} workouts{f', spent €{round(total_spend, 2)}' if total_spend else ''}{intention_line}

Write the brief now:"""


def health_narrative(topic: str, data: dict) -> str:
    """
    Builds a health narrative prompt for a given topic.
    topic: sleep | hrv | training | load
    data: relevant aggregated metrics dict
    """
    if topic == "sleep":
        return f"""You are a concise sleep coach. Analyse the following sleep data and write 4-5 sentences covering:
1. The recent trend (getting better or worse?)
2. Stage composition (deep and REM adequacy — healthy is deep >18%, REM >20%)
3. The most notable correlation or pattern
4. One specific, actionable recommendation

Sleep data (last {data.get('days', 14)} days):
- Average duration: {_fmt_duration(data.get('avg_duration_seconds'))}
- Average score: {data.get('avg_score') or 'unknown'}/100
- Average deep sleep: {data.get('avg_deep_pct') or 'unknown'}%
- Average REM sleep: {data.get('avg_rem_pct') or 'unknown'}%
- Average awake time: {data.get('avg_awake_pct') or 'unknown'}%
- Sleep consistency (stdev hours): {data.get('consistency_stdev_hours') or 'unknown'}h
- Nights below deep threshold (<18%): {data.get('nights_below_deep') or 0}
- Nights below REM threshold (<20%): {data.get('nights_below_rem') or 0}
- Avg SpO2: {data.get('avg_spo2') or 'unknown'}%
- Sleep debt (cumulative vs 8h target): {_fmt_duration(data.get('sleep_debt_seconds'))}
- Correlation sleep duration → next-day energy: r={data.get('r_sleep_energy') or 'unknown'}

Write the analysis now:"""

    if topic == "hrv":
        return f"""You are a concise HRV and recovery expert. Analyse the following HRV data and write 4-5 sentences covering:
1. The current trend vs the weekly baseline
2. What is likely driving the change (training load, sleep, stress)
3. What the HRV status means for today's readiness
4. One specific recommendation

HRV data (last {data.get('days', 14)} days):
- Recent avg HRV: {data.get('recent_avg_hrv') or 'unknown'}ms
- Weekly baseline HRV: {data.get('weekly_avg_hrv') or 'unknown'}ms
- HRV status: {data.get('hrv_status') or 'unknown'}
- 14-day trend: {data.get('trend_direction') or 'unknown'}
- Load index fatigue: {data.get('fatigue_score') or 'unknown'}/100
- Recovery status: {data.get('recovery_status') or 'unknown'}
- Recent sleep avg: {_fmt_duration(data.get('avg_sleep_seconds'))}
- Recent training load (ATL): {data.get('atl') or 'unknown'}

Write the analysis now:"""

    if topic == "training":
        return f"""You are a concise endurance training coach. Analyse the following training load data and write 4-5 sentences covering:
1. Current fitness (CTL) and fatigue (ATL) status
2. Form (TSB) — are they ready to perform or need recovery?
3. Ramp rate — is training load increasing too fast (>7 CTL/week is injury risk)?
4. One specific recommendation for the next 3-5 days

Training load data (combined sports):
- CTL (fitness, 42d): {data.get('ctl') or 'unknown'}
- ATL (fatigue, 7d): {data.get('atl') or 'unknown'}
- TSB (form = CTL - ATL): {data.get('tsb') or 'unknown'}
- Ramp rate (CTL change/week): {data.get('ramp_rate') or 'unknown'}
- Last 7 days TSS: {data.get('weekly_tss') or 'unknown'}
- Last 7 days workouts: {data.get('weekly_workouts') or 'unknown'}
- Sports this week: {data.get('sports_this_week') or 'unknown'}

Write the analysis now:"""

    if topic == "load":
        return f"""You are a concise fatigue and recovery expert. Analyse the following load index data and write 4-5 sentences covering:
1. The current fatigue level and what is driving it most
2. How each component (HRV, sleep, training, timezone) is contributing
3. Whether the trend is improving or worsening
4. A specific recovery prescription (sleep target, rest day recommendation, etc.)

Load index data (last {data.get('days', 7)} days):
- Fatigue score: {data.get('fatigue_score') or 'unknown'}/100
- Recovery status: {data.get('recovery_status') or 'unknown'}
- HRV load component: {data.get('hrv_load') or 'unknown'}/25
- Sleep debt component: {data.get('sleep_debt') or 'unknown'}/25
- Training stress component: {data.get('tss_load') or 'unknown'}/25
- Timezone penalty: {data.get('timezone_penalty') or 'unknown'}/25
- Duty load: {data.get('duty_load') or 'unknown'}/25
- 7-day trend: {data.get('trend') or 'unknown'}

Write the analysis now:"""

    return f"Summarise the following personal health data in 3-4 sentences: {data}"


def weekly_expense_summary(week_start: str, data: dict) -> str:
    """
    Builds a weekly expense summary prompt.
    data keys: total_spent, total_budget, budget_pct, by_category [{category, spent, budget}],
               top_transaction {description, amount}, vs_last_week_pct.
    """
    by_cat = data.get("by_category", [])
    cat_lines = "\n".join(
        f"  - {c['category']}: €{c['spent']:.2f} / €{c['budget']:.2f} budget"
        for c in sorted(by_cat, key=lambda x: x.get("spent", 0), reverse=True)[:6]
    ) or "  (no category breakdown available)"

    top_tx = data.get("top_transaction")
    top_tx_line = f"- Largest single transaction: {top_tx['description']} €{top_tx['amount']:.2f}" if top_tx else ""
    vs_last = data.get("vs_last_week_pct")
    vs_last_line = f"- vs last week: {'+' if vs_last and vs_last >= 0 else ''}{vs_last:.0f}%" if vs_last is not None else ""

    return f"""You are a concise personal finance coach. Summarise the following weekly spending in 3-4 sentences.
Mention whether the person is on track for the month, flag any overspent categories, and give one practical tip.
Do not list all categories — pick the most notable ones. Be direct and use euros.

Week of {week_start}:
- Total spent: €{data.get('total_spent', 0):.2f} / €{data.get('total_budget', 0):.2f} weekly budget ({data.get('budget_pct', 0):.0f}% of budget)
{vs_last_line}
{top_tx_line}
By category:
{cat_lines}

Write the summary now:"""
