# Daybook — Strava Analytics Adaptation

**Purpose:** Reverse-engineer Strava's training analytics and visualization layer, feature by feature, and specify how to rebuild each on Daybook's date-spine using Garmin data. The deliverable is a build spec for Claude Code, ending in a numbered prompt sequence.

**Relationship to existing docs:**
- `docs/GARMIN_STRAVA_INTEGRATION.md` already defines the ingestion pipeline, the CTL/ATL/TSB engine (hrTSS), the best-efforts sliding window, the heatmap, and the year calendar. **This document does not redefine those.** It assumes them and specifies the *analytics and chart layer that sits on top.*
- `NORTH_STAR.md` Horizon 1 (Personal Load Model) is the long-range destination. The multisport load and race-readiness sections here are the concrete, near-term floor of that horizon.

**Last updated:** June 2026

---

## 0. Framing — what to copy, what to fix, what to skip

Three honest decisions up front, because they change the build.

**What's worth copying.** Strava's analytics are good at one thing: turning a raw activity stream into legible, comparable, time-aware visuals. The mean-maximal power curve, the time-in-zone distributions, the Fitness & Freshness chart, the training-log bubble calendar, and the progress/date-range comparison are all genuinely useful and all reproducible from Garmin streams. These are the targets.

**What to fix.** Several Strava methods are confounded in ways that matter specifically for an Ironman base build:
- **Relative Effort over-weights intensity and under-counts long Z2.** Its TRIMP-style coefficients are tuned so a 20-minute interval session ≈ a 3-hour easy ride. For Ironman, your long aerobic volume *is the point*, and RE will systematically tell you those days were "easy." Use RE as a comparison metric if you want, but **do not let it drive the load model.** Use power/pace-based TSS for bike/run and a duration×intensity estimate for swim.
- **Fitness & Freshness on HR-only data is just a rolling Relative Effort.** It inherits the same intensity bias. The model is only as good as the per-activity stress score you feed it — so the per-activity layer (Section 3) must be right before the trend layer (Section 4) means anything.
- **GAP ignores terrain technicality and surface.** Fine for road, lies on trail. Store it, don't trust it on technical ground.
- **Strava has no aerobic-durability metric.** The single most predictive Ironman number — aerobic decoupling (Pw:HR / Pa:HR drift across a long effort) — Strava doesn't surface at all. This is the highest-value thing in the whole spec and it's a value-add, not a copy (Section 3.7).

**What to skip.** The social graph — kudos, segments leaderboards, KOM/QOM, clubs, following. Per `NORTH_STAR.md` this is the one layer that is *not* rebuildable, and it's also the one you explicitly don't want. Segments *as a personal device* (repeatable course, compare your own efforts over time) are worth a lightweight version (Section 4.6); segments as a *competitive leaderboard* are out.

---

## 1. Source data inventory (what Garmin gives you to feed all of this)

Everything below is reachable through `python-garminconnect`. **Raw-first principle holds: store the full JSON payload of each call before parsing.** Re-parsing is free; a lost stream is not.

**Per-activity (the new ingestion work):**
- `get_activities(start, limit)` — activity list with summary stats (type, distance, moving/elapsed time, avg/max HR, avg/max speed, avg/max power, elevation, calories, avg cadence).
- `get_activity_details(activity_id)` — the **time-series streams**: this is the unlock. Returns `metricDescriptors` + `activityDetailMetrics` arrays. Typical channels: timestamp, distance, HR, speed/pace, power (if power meter / Stryd / cycling), cadence, altitude, grade, temperature, GPS lat/lng.
- `get_activity_splits(id)` / `get_activity_split_summaries(id)` — auto and manual laps with per-split stats.
- `get_activity_hr_in_timezones(id)` — Garmin's own time-in-HR-zone breakdown (use to validate your own bucketing).
- `get_activity_weather(id)` — conditions, for fair comparisons over time.

**Daily / physiological (already syncing in Phase 1):**
- HR (all-day), HRV, sleep stages, stress, Body Battery, resting HR, steps.

**Garmin's own pre-computed training metrics (ingest these too — don't only recompute):**
- `get_training_status` — Garmin's acute load (7-day EPOC sum), chronic load, **acute:chronic workload ratio**, load focus (anaerobic/high-aerobic/low-aerobic), training status label.
- `get_max_metrics` — **VO2max** (run and bike, tracked over time).
- `get_training_readiness` — composite readiness score with its sub-factors (sleep, recovery time, HRV status, acute load).
- Race predictors (5k/10k/half/marathon time estimates) where exposed.

**Design consequence:** Daybook stores *three layers* per activity — (1) raw payload, (2) your own computed metrics, (3) Garmin's native metrics. When your model and Garmin's disagree, that disagreement is itself a signal worth logging. This is the raw-first principle applied to derived data.

---

## 2. Schema additions (consolidated)

All new tables join to `days(date)` by an activity's local start date, preserving the spine. Streams are stored compactly; do not explode every sample into a row.

```sql
-- One row per activity. Joins to days by start_date.
CREATE TABLE activity_detail (
    activity_id        TEXT PRIMARY KEY,     -- Garmin activityId
    date               TEXT NOT NULL,        -- local start date -> days(date)
    sport              TEXT NOT NULL,        -- run | ride | swim | other
    sub_sport          TEXT,                 -- e.g. lap_swimming, trail_running
    start_time_local   TEXT,
    distance_m         REAL,
    moving_time_s      INTEGER,
    elapsed_time_s     INTEGER,
    elevation_gain_m   REAL,
    avg_hr             INTEGER,
    max_hr             INTEGER,
    avg_power_w        REAL,                 -- run (Stryd/native) or bike
    max_power_w        REAL,
    normalized_power_w REAL,                 -- computed (3.4)
    avg_pace_s_per_km  REAL,
    avg_speed_mps      REAL,
    avg_cadence        REAL,
    -- computed load + analysis (this doc)
    tss                REAL,                 -- power/pace-based where possible
    hr_tss             REAL,                 -- fallback (existing engine)
    relative_effort    REAL,                 -- TRIMP-style, for comparison only
    intensity_factor   REAL,                 -- NP/FTP or GAP-pace/threshold
    variability_index  REAL,                 -- NP/avg_power
    efficiency_factor  REAL,                 -- NP/avgHR or speed/HR (3.7)
    decoupling_pct     REAL,                 -- aerobic decoupling (3.7)
    -- garmin native (ingested, not recomputed)
    garmin_training_effect_aerobic   REAL,
    garmin_training_effect_anaerobic REAL,
    garmin_activity_load             REAL,
    raw_summary_json   TEXT NOT NULL,        -- full payload
    FOREIGN KEY (date) REFERENCES days(date)
);

-- Time-series streams stored as compressed JSON arrays, not row-per-sample.
CREATE TABLE activity_stream (
    activity_id  TEXT PRIMARY KEY,
    channels     TEXT NOT NULL,   -- JSON: {"t":[...],"hr":[...],"power":[...],"pace":[...],"alt":[...],"dist":[...]}
    sample_rate_s INTEGER,
    raw_detail_json TEXT NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activity_detail(activity_id)
);

-- Laps / splits.
CREATE TABLE activity_split (
    activity_id TEXT NOT NULL,
    split_index INTEGER NOT NULL,
    type        TEXT,        -- auto_km | auto_mile | manual_lap | interval
    distance_m  REAL, time_s REAL,
    avg_pace_s_per_km REAL, gap_s_per_km REAL,
    avg_hr INTEGER, avg_power_w REAL, avg_cadence REAL,
    elev_gain_m REAL, avg_grade REAL,
    PRIMARY KEY (activity_id, split_index)
);

-- Mean-maximal / best-effort curve points, one row per (activity, channel, duration|distance bucket).
CREATE TABLE best_effort (
    activity_id TEXT NOT NULL,
    date        TEXT NOT NULL,
    sport       TEXT NOT NULL,
    channel     TEXT NOT NULL,   -- power | pace | hr
    bucket      INTEGER NOT NULL,-- seconds (power/hr) OR metres (pace)
    value       REAL NOT NULL,   -- watts | s_per_km | bpm
    PRIMARY KEY (activity_id, channel, bucket),
    FOREIGN KEY (date) REFERENCES days(date)
);

-- The daily training-load series the trend charts read from.
-- (CTL/ATL/TSB engine already exists in GARMIN_STRAVA_INTEGRATION.md;
--  this is its persisted output, extended to per-sport + combined.)
CREATE TABLE training_load_daily (
    date   TEXT NOT NULL,
    sport  TEXT NOT NULL,        -- run | ride | swim | combined
    daily_tss REAL DEFAULT 0,
    ctl    REAL,                 -- fitness, 42d EWMA
    atl    REAL,                 -- fatigue, 7d EWMA
    tsb    REAL,                 -- form = ctl(yesterday) - atl(yesterday)
    ramp_rate REAL,              -- weekly ΔCTL
    PRIMARY KEY (date, sport),
    FOREIGN KEY (date) REFERENCES days(date)
);

-- Athlete reference values, versioned so historical recalcs are reproducible.
CREATE TABLE athlete_zones (
    valid_from TEXT NOT NULL,
    sport      TEXT NOT NULL,
    max_hr     INTEGER, threshold_hr INTEGER,
    ftp_w      REAL,                 -- bike
    threshold_pace_s_per_km REAL,    -- run
    css_pace_s_per_100m REAL,        -- swim critical swim speed
    zones_json TEXT NOT NULL,        -- zone boundaries
    PRIMARY KEY (valid_from, sport)
);

-- Goals with teeth (ties to NORTH_STAR Horizon 3).
CREATE TABLE training_goal (
    id INTEGER PRIMARY KEY,
    sport TEXT, metric TEXT,        -- distance | time | tss | sessions
    period TEXT,                    -- week | month | year
    target REAL, period_start TEXT,
    created_at TEXT
);
```

**Note on `athlete_zones` versioning:** Strava recalculates history only the *first* time you set zones, then freezes. That's a data-integrity bug for a 20-year archive. Versioning zones by `valid_from` lets Daybook recompute any historical activity against the zones that were true *on that date* — closer to correct, and reproducible. Boring-tech win.

---

## 3. Per-activity analysis (the foundation — build this first)

Strava's per-activity page is the atomic unit. Every trend chart is an aggregate of these. Get this layer right or nothing above it means anything.

### 3.1 Splits & laps / Workout Analysis
**Strava:** bar chart of pace (or HR/power) per split, toggle splits ↔ laps ↔ smoothed, shaded by pace zone. Auto-split every km/mile; honors device laps for interval work.
**Garmin source:** `get_activity_splits` + `activity_stream` for the smoothed view.
**Daybook:** `activity_split` table → bar chart (recharts `BarChart`), color by pace/HR zone. Toggle splits/laps/smoothed. Click a bar to highlight that segment on the route map (react-leaflet) and show its stats.
**Ironman relevance:** interval execution check — did you actually hit prescribed splits? Feeds plan-vs-actual compliance (OMYRA loop).

### 3.2 Pace analysis + pace zones + GAP
**Strava:** GAP normalizes pace for gradient via an energy-cost-of-running model (Minetti/Davies); pace zones bucket GAP time into 6 zones derived from a recent race/threshold.
**Garmin source:** pace + altitude/grade streams.
**Daybook:** compute GAP per sample: `gap_pace = pace × f(grade)`, where `f` is the energy-cost curve (steeper uphill → faster-equivalent flat pace; downhill adjustment peaks ~ −10% grade then eases). Store `gap_s_per_km` on splits. Pace-zone distribution = stacked bar / horizontal time-in-zone bar.
**Fix:** label GAP explicitly as road-only-trustworthy; on trail (`sub_sport=trail_running`) show raw pace as primary.

### 3.3 Heart-rate zone distribution
**Strava:** % time in 5 zones from max HR, overlaid on elevation.
**Garmin source:** HR stream + `athlete_zones`; validate against `get_activity_hr_in_timezones`.
**Daybook:** bucket HR samples into your versioned zones → horizontal stacked bar + per-zone minutes. This is the input to Relative Effort (3.6) and the HR side of efficiency (3.7).

### 3.4 Power analysis + Normalized Power + power curve
**Strava:** power curve = mean-maximal power (MMP) — your best average power for every duration window in the ride, overlaid against historical best; W and W/kg toggle.
**Garmin source:** power stream (bike power meter; run power via Stryd/native).
**Daybook math:**
- **Normalized Power (NP):** 30 s rolling average of power → raise to 4th power → mean → 4th root. Store `normalized_power_w`.
- **Intensity Factor (IF):** `NP / FTP`.
- **Variability Index (VI):** `NP / avg_power` (pacing smoothness; for IM bike you want VI near 1.0).
- **TSS (power):** `(moving_time_s × NP × IF) / (FTP × 3600) × 100`.
- **MMP curve:** for each duration bucket d ∈ {1,5,10,15,30,60,120,300,600,1200,1800,3600,5400 s}, sliding-window max average power → write to `best_effort(channel='power', bucket=d)`. All-time curve = `MAX(value) GROUP BY bucket`.
**Daybook viz:** log-x line chart (recharts), this-activity curve vs 90-day best vs all-time best.
**Ironman relevance:** the 3–5 h bucket of the bike power curve is your IM-distance ceiling; VI and IF on the long ride are the pacing-discipline metrics that make or break the marathon.

### 3.5 Best efforts (run) + the progression chart
**Strava:** fastest time over standard distances (400 m, ½ mi, 1 k, 1 mi, 2 mi, 5 k, 10 k, 15 k, 10 mi, 20 k, half, 30 k, marathon); PR/2nd/3rd medals; **annual best efforts** and progression over time.
**Garmin source:** distance + time streams (your existing sliding-window best-efforts code).
**Daybook:** write each per-activity best into `best_effort(channel='pace', bucket=metres)`. The chart Strava under-delivers on and you should over-deliver on: **best-effort progression** — for a chosen distance, plot every effort as a point over time with the PR line stepping down. Same structure as the power curve but time-on-x. (Strava only got annual best efforts in 2026; you can have full-history from day one.)

### 3.6 Relative Effort (per activity) — build it, label it honestly
**Strava:** TRIMP-style score = Σ (minutes in zone × increasing zone coefficient), personalized to max HR, weighting intensity over duration, normalized across sports so a hard 10 k ≈ a hard ride.
**Garmin source:** HR-zone minutes (3.3).
**Daybook:** compute and store `relative_effort` as a **comparison metric only** — useful for "how hard was this *for me*" across sports, and for the weekly RE band (4.2). **Not the load-model input** (see Section 0). Where HR is missing, allow a manual RPE 1–10 → effort estimate, exactly as Strava falls back to Perceived Exertion.

### 3.7 Aerobic decoupling + efficiency factor — *value-add, Ironman-critical*
**Strava:** does not have this. This is the gap.
**The metric:**
- **Efficiency Factor (EF):** `NP / avgHR` (bike) or `(1/GAP-pace) / avgHR` (run). Rising EF at equal/declining HR = aerobic fitness improving. This is the cleanest single trend for IM base, and it's *free of the intensity bias* that wrecks Relative Effort.
- **Aerobic decoupling (Pw:HR / Pa:HR):** split a steady aerobic effort in half; `decoupling = (EF_first_half − EF_second_half) / EF_first_half × 100`. **< 5%** on a long Z2 effort = you have the durability to hold pace late. This *is* the answer to "am I IM-ready," far more than any single VO2max number.
**Garmin source:** power (or GAP-pace) + HR streams; compute on efforts ≥ ~60 min in Z1–Z2.
**Daybook viz:** EF as a long-run trend line; decoupling % badge per long session + its own trend. Surface both on the Day Detail view and the race-readiness panel (Section 5.3).
**Why it matters here:** this is exactly the "thing no product can build because no product has the data" framing from `NORTH_STAR.md` Horizon 1, applied to training. It's the single most defensible feature in this document.

---

## 4. Cross-activity trends & comparisons (the layer you're really after)

### 4.1 Fitness & Freshness (CTL / ATL / TSB)
**Strava:** impulse-response model (Banister 1975 → Coggan). Fitness = 42-day exponentially weighted average of daily training stress; Fatigue = 7-day EWMA; Form = Fitness − Fatigue. Plotted as three lines over a selectable range; click a day to see contributing activities.
**Daybook:** the CTL/ATL/TSB engine already exists (`GARMIN_STRAVA_INTEGRATION.md`). This section specifies its **chart and its load input**:
- **Load input:** per-sport `daily_tss` = sum of that day's activity TSS (power/pace-based per 3.4/3.5; hrTSS fallback; RE *not* used here).
- **EWMA recurrence:** `today = yesterday + (daily_tss − yesterday) × (1 − e^(−1/τ))`, τ=42 (CTL), τ=7 (ATL). `TSB(today) = CTL(yesterday) − ATL(yesterday)`.
- **Chart:** three lines + a TSB-shaded band (positive=fresh/green, negative=fatigued/red), range selector (6w/3m/6m/1y/all), click-a-day → contributing activities list. recharts `ComposedChart`.
- **Ramp-rate guard:** weekly ΔCTL > ~5–8 flags injury/overtraining risk — surface it (Strava doesn't).

### 4.2 Weekly Relative Effort + 3-week range band
**Strava:** cumulative RE for the current week vs a personalized band derived from your 3-week rolling average → "below / within / above range."
**Daybook:** weekly RE sum, with the band = 3-week mean ± a deviation. Simple bar-with-band. Keep it as the *subjective intensity* companion to the *objective load* of 4.1 — two honest lenses, not one blended number.

### 4.3 Training Log (bubble calendar)
**Strava:** calendar of activities as color-coded, size-scaled bubbles (size = distance or Relative Effort, color = sport), weekly totals on the side, infinite scroll. Built with D3.
**Daybook:** week-row calendar, one bubble per activity. Encode **size = TSS** (not RE — keep it honest), **color = sport**, ring = workout type (long/race/recovery via tags). Weekly totals column (distance, time, TSS). This is the single best "is my training consistent" visual Strava has — high priority. recharts won't do this cleanly; use a small custom SVG/D3 layout (the existing year-calendar code is a starting point).

### 4.4 Progress summary + date-range comparison
**Strava:** per-sport progress over a chosen window; "Compare Date Range" overlays the current period against a historical one (e.g. this build vs same block last year).
**Daybook:** for a sport + metric (distance / time / TSS / sessions), a bar or line over weeks, with a **second overlaid series for a comparison range**. This is the "compare over time" you specifically asked for — and the comparison-range overlay is the part Strava does best. Drives the Year-over-Year view a serious IM build needs.

### 4.5 Activity-history volume bars
**Strava:** weekly/monthly bars; choose Y-axis = time | distance | elevation; click a bar → that period's activities.
**Daybook:** straightforward `BarChart`, week/month toggle, metric selector, click-through to the day/period. Cheap, high-value, build early.

### 4.6 Personal segments (no leaderboard)
**Strava:** segments + KOM/QOM leaderboards. **Skip the leaderboard** (Section 0).
**Daybook (optional, later):** "repeated efforts" — when you run/ride the same stretch (matched by GPS corridor), group those efforts and show *your own* times over time. A private segment for self-comparison, none of the social layer. Defer until the core charts are used.

### 4.7 Custom goals
**Strava:** weekly/monthly/annual/distance/time/segment/power goals.
**Daybook:** `training_goal` table; weekly/monthly/annual targets per sport+metric; progress ring on Today. Connects directly to `NORTH_STAR.md` Horizon 3 "goals with teeth" and the Sunday review — a goal here should be *more* likely completed than one set anywhere else, because the weekly review resurfaces it with data attached.

---

## 5. The multisport / Ironman layer (where this beats Strava for your case)

Strava treats sports mostly in parallel. For Ironman the disciplines share one body and one recovery budget — so the load model must combine them.

### 5.1 Combined multisport load
Maintain `training_load_daily` rows for `run`, `ride`, `swim`, **and `combined`**. Combined CTL/ATL/TSB sums all-sport daily TSS into one impulse-response series. **Form for race readiness is read off `combined`, never a single discipline** — a fresh run-TSB means nothing if the bike block buried you. This is the core thing Strava's per-sport view obscures and you need.

### 5.2 Discipline balance & weekly volume
Stacked weekly bar: swim/bike/run share of time and of TSS. Surfaces the classic IM error (run-heavy because it's cheapest to log, swim-neglected). Target ratios configurable per training phase.

### 5.3 Race-readiness panel (the Horizon-1 floor)
A single Day-Detail / dashboard panel combining, for the target race date:
- **Combined TSB trending toward a taper window** (positive form into race day).
- **Aerobic decoupling on recent long efforts** (< 5% = durability achieved) — Section 3.7.
- **EF trend** (rising = base working).
- **VO2max + Garmin race predictor** (ingested), shown as corroboration, not gospel.
- **Plan-vs-actual compliance** (OMYRA loop) — prescribed vs executed long-session load.
This is the concrete near-term version of `NORTH_STAR.md` Horizon 1's "predict a bad week / a ready race before it happens." When duty-day and timezone load (existing Load Index) feed the *same* combined series, the aviation-aware fatigue model and the race-readiness model become one object — which is the whole thesis.

---

## 6. Year in Sport (ties to the archival principle)
**Strava:** end-of-year personalized recap (totals, top efforts, streaks, standout activities).
**Daybook:** you already have a "Year in Review artifact" mandate in `NORTH_STAR.md`. Fold the training recap into it — annual totals per sport, best-effort PRs set that year, CTL peak, biggest week, longest session, EF improvement. Generated each January from the same data, no separate service. This is also the once-a-year "should Daybook be a product?" checkpoint's evidence base.

---

## 7. FastAPI endpoints (consolidated)
```
GET  /activity/{id}                 -> activity_detail + splits + zone distributions
GET  /activity/{id}/stream          -> decoded streams (downsampled for charting)
GET  /activity/{id}/curve?channel=  -> this-activity MMP/pace curve + historical best
GET  /trends/load?sport=&range=     -> CTL/ATL/TSB series (4.1)
GET  /trends/relative-effort?range= -> weekly RE + band (4.2)
GET  /trends/log?range=             -> training-log bubbles (4.3)
GET  /trends/progress?sport=&metric=&range=&compare= -> progress + date-range overlay (4.4)
GET  /trends/volume?period=&metric= -> history bars (4.5)
GET  /curve/best?sport=&channel=&bucket= -> all-time/90d best-effort progression (3.4/3.5)
GET  /readiness?race_date=          -> race-readiness panel payload (5.3)
GET  /goals  /  POST /goals         -> custom goals (4.7)
GET  /year-in-sport/{year}          -> annual recap (6)
```
All read-only over SQLite except `/goals`. All filter by date to stay on the spine.

---

## 8. Frontend (Next.js PWA, recharts + react-leaflet)
Reuse existing component patterns. New components:
- `ActivityDetail` — splits bar, zone distributions, route map, curve chart, EF/decoupling badges.
- `FitnessFreshnessChart` — 3-line ComposedChart + TSB band + day-focus.
- `TrainingLogCalendar` — custom SVG bubble grid (not recharts).
- `ProgressChart` — bars/lines + comparison-range overlay.
- `BestEffortCurve` — log-x MMP / progression line.
- `RaceReadinessPanel` — composite dashboard (5.3).
- `VolumeBars`, `WeeklyEffortBand`, `GoalRings`.
Build against the `frontend-design` skill's tokens for consistency with the existing app.

---

## 9. Phase 0 audit (answer before building)
1. **Power data reality:** do you have a bike power meter and/or run power (Stryd/native)? This decides whether TSS is power-based (best) or pace/hrTSS-based for each sport. If no bike power, the bike load model leans on hrTSS — acceptable but note the intensity bias.
2. **Stream availability:** confirm `get_activity_details` returns power/HR/pace/altitude for *your* historical activities, not just recent ones. Sample 5 activities across 2019–2026.
3. **Zone source of truth:** Garmin Connect zones vs. your own threshold tests — which populates `athlete_zones`, and from what date are they valid?
4. **Swim load:** lap-swimming HR is unreliable; decide the swim TSS proxy (CSS-pace-based sTSS, or duration×RPE) before computing combined load.
5. **Existing engine reuse:** confirm exactly what `GARMIN_STRAVA_INTEGRATION.md`'s CTL/ATL/TSB code already persists, so `training_load_daily` extends rather than duplicates it.

---

## 10. Claude Code prompt sequence
Self-contained, ordered, verify between each. Reference this file and `GARMIN_STRAVA_INTEGRATION.md` by path in every prompt.

1. **Phase 0 audit script** — probe `get_activity_details` across a date sample; report which channels exist per sport per year; dump one raw payload. Output a short findings file; do not build yet.
2. **Schema migration** — create the Section 2 tables; backfill `athlete_zones` first version; verify foreign keys to `days`.
3. **Activity-detail ingestion** — extend the Garmin sync to pull `get_activity_details`/`splits` for new + backfilled activities; store raw + parsed into `activity_detail`, `activity_stream`, `activity_split`. Idempotent. Verify counts.
4. **Per-activity computed metrics** — NP, IF, VI, TSS, hrTSS, relative_effort, HR/pace-zone distributions, GAP. Write back to `activity_detail`/`activity_split`. Unit-test NP against a known activity.
5. **Best-effort / MMP curves** — sliding-window max for power (durations) and pace (distances); populate `best_effort`; expose `/curve/best` + `/activity/{id}/curve`.
6. **Efficiency Factor + aerobic decoupling** — compute on eligible long aerobic efforts; store; verify on a known steady run. *(Highest-value step — do not skip or defer.)*
7. **Training-load engine extension** — persist per-sport + `combined` CTL/ATL/TSB into `training_load_daily`; add ramp-rate; reconcile with existing engine output (no double counting).
8. **Trend endpoints** — implement `/trends/*`, `/readiness`, `/year-in-sport`. Return chart-ready, downsampled payloads.
9. **ActivityDetail view** — splits bar, zone distributions, route map, curve, EF/decoupling badges.
10. **FitnessFreshnessChart + WeeklyEffortBand** — wire to `/trends/load` and `/trends/relative-effort`.
11. **TrainingLogCalendar** — custom SVG bubble grid from `/trends/log`; size=TSS, color=sport.
12. **ProgressChart + VolumeBars** — including the date-range comparison overlay.
13. **BestEffortCurve view** — log-x MMP + progression-over-time.
14. **RaceReadinessPanel + GoalRings** — composite dashboard; goals CRUD.
15. **Year-in-Sport recap** — fold into the existing Year in Review artifact generator.
16. **Use-it check** — wire the key panels into Today / Day Detail; confirm the Sunday review surfaces goals + readiness. Then stop building and use it for two weeks before extending.

---

## 11. Guardrails (what NOT to build)
- **No social/leaderboard layer.** Per `NORTH_STAR.md` it's the one non-rebuildable thing and you don't want it.
- **No blended single "score."** Keep objective load (TSS/TSB) and subjective effort (RE/RPE) as separate honest lenses.
- **No metric you can't recompute from raw.** If Garmin deprecates a field, the stream must still let you derive it.
- **The Pi test:** every chart here runs on SQLite + a static Next.js build on a Pi. Nothing added needs a GPU or a cloud service.
- **The Sunday question stays supreme:** if you're not opening the readiness panel weekly, fix friction before building anything above it.
