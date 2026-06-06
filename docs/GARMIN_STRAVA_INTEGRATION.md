# Garmin + Strava Integration — Vision & Architecture

## Why this exists

Strava charges roughly 60€/year for features that are, at their core, visualizations of data I already generate. Garmin owns my watch data and 
exposes most of it via an unofficial API. The plan is to converge both 
sources into Daybook so:

1. I stop paying Strava Premium.
2. My activity data lives on the Pi, owned by me, forever.
3. Activity data joins the days spine — meaning I can ask questions no 
   single app can answer ("how does my pace correlate with HRV the morning 
   after a duty day?").
4. Strava continues to feed segment data as a secondary enrichment layer, 
   not a source of truth.

## Principles for this integration

These extend the existing Daybook principles, they do not replace them.

1. **Garmin is the primary source.** Every activity, every wellness 
   metric, every GPS track lands in Daybook from Garmin first. Strava is 
   enrichment only.

2. **Raw before parsed.** Every API response is stored as JSON in a 
   `raw_payload` column before any parsing. The schema can change. The 
   data cannot be re-fetched if Garmin breaks the API.

3. **Idempotent syncs.** Running a sync script twice must produce the 
   same database state as running it once. Activities are deduped by 
   their source-provided id.

4. **Activity ID prefixing.** Activities are keyed as 
   `{source}_{native_id}` (e.g. `garmin_19284756`, `strava_8472635`). 
   When the same activity exists in both, the Garmin row is canonical 
   and gets a `strava_id` cross-reference column.

5. **Sync should fail loudly.** Silent sync failures are the worst-case 
   outcome. Every sync writes a heartbeat to a `sync_status` table that 
   the Today view surfaces.

6. **No Strava write-back.** Daybook never writes to Strava. One-way 
   read only. This means activities recorded only in Daybook (manual 
   entries) never appear in Strava — that is fine and intentional.

## Data sources and what each provides

### Garmin Connect (primary, via python-garminconnect)

- Daily wellness: sleep stages, HRV, stress, body battery, resting HR, 
  steps, calories, floors climbed
- Activities: every recorded activity with full GPS, heart rate, 
  cadence, power, elevation streams
- Training metrics: training load, recovery time, VO2max, race predictions
- Sleep detail: per-night breakdown, sleep score components

### Strava (enrichment, via stravalib + official API)

- Segment efforts: time on community-defined segment routes
- Segment metadata: name, distance, elevation, KOM time
- Activity cross-references: links Garmin activities to their Strava 
  counterparts so segment data can be looked up

### Manual import (fallback, FIT/GPX files)

- Historical activities predating Garmin Connect account
- Activities from devices that didn't sync to Garmin
- One-off imports from other platforms (Wahoo, Polar, etc.)

## What we want to be able to do

These are the user-facing capabilities the integration must enable. Each 
one should be testable end-to-end on real data.

### Day View capabilities

- See every activity recorded on a given day, with start time, type, 
  duration, distance, and a small map thumbnail.
- Click an activity to open a detail view with full GPS map, elevation 
  profile, heart rate chart, pace/speed chart.
- See wellness metrics for the day alongside the activities: sleep score, 
  HRV, stress, body battery — and how each compares to the trailing 
  7-day average.

### Timeline / scrub capabilities

- Move backwards through any date and see the same Day View for that day.
- A calendar heatmap showing activity volume per day across the year.
- "On this day N years ago" — surface activities from the same date in 
  prior years.

### Map capabilities

- Personal heatmap: every GPS track I have ever recorded, rendered at 
  low opacity over OpenStreetMap tiles. Routes I ride often visually 
  accumulate into bright lines.
- Activity map: single-activity view with the GPS track, kilometer 
  markers, and elevation-colored polyline.
- Filter by activity type (run, ride, hike, swim) and date range.

### Segment capabilities (the Strava Premium replacement)

- Define a segment by drawing a polyline on a map, or by extracting one 
  from an existing activity.
- For every new activity, match against all defined segments and store 
  any efforts.
- Per-segment history: list of all my attempts, best time, recent times, 
  HR for each effort.
- Personal records surfaced on the Today view when a PR is set.

### Training intelligence

- Training load curve: CTL (42-day chronic load), ATL (7-day acute load), 
  TSB (form). This is the most important Strava Premium feature and is 
  pure math on activity stress scores.
- Weekly and monthly distance / duration / elevation totals by activity 
  type.
- Anomaly detection: surface activities where HR-for-effort was unusual, 
  which often predicts illness or fatigue.

### Cross-domain insights (the part Strava cannot do)

- Correlate sleep quality with next-day pace.
- Correlate HRV with weekly training load.
- Overlay duty days (from aviation domain) on the training load curve to 
  see how flying affects fitness.
- "Best workout days" — which subjective questionnaire patterns precede 
  my fastest efforts.

## Architecture summary
External APIs              Sync Layer                 SQLite               API/UI
─────────────              ──────────                 ──────               ──────
Garmin Connect    ─┐                        ┌── activities ──┐
├──> Python sync ──────> ├── activity_streams ──┐
Strava API        ─┤    scripts (cron)      ├── segments ──────────├──> FastAPI ──> Next.js
│                        ├── segment_efforts ───┤
FIT/GPX files     ─┘                        ├── health ────────────┘
└── days (spine, joined by date)

## Schema additions (full DDL)

These extend the existing `daybook.db`. The `health` table from the 
existing schema is unchanged — it continues to hold daily wellness. 
What's new is everything around activities and segments.

```sql
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,                -- e.g. "garmin_19284756"
    date TEXT NOT NULL,                  -- ISO date, joins to days.date
    source TEXT NOT NULL,                -- 'garmin' | 'strava' | 'manual'
    strava_id TEXT,                      -- cross-reference if matched
    activity_type TEXT,                  -- run, ride, hike, swim, walk, etc.
    start_time TEXT,                     -- ISO 8601 with timezone
    duration_seconds INTEGER,
    moving_time_seconds INTEGER,
    distance_meters REAL,
    elevation_gain_meters REAL,
    avg_heart_rate INTEGER,
    max_heart_rate INTEGER,
    avg_speed_mps REAL,
    avg_power_watts INTEGER,
    calories INTEGER,
    training_stress_score REAL,
    polyline TEXT,                       -- encoded GPS path
    start_lat REAL,
    start_lng REAL,
    raw_payload TEXT NOT NULL,           -- full JSON from source
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (date) REFERENCES days(date)
);

CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_source ON activities(source);

CREATE TABLE IF NOT EXISTS activity_streams (
    activity_id TEXT NOT NULL,
    stream_type TEXT NOT NULL,           -- heart_rate, altitude, velocity, etc.
    data_json TEXT NOT NULL,             -- array of per-second values
    PRIMARY KEY (activity_id, stream_type),
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    activity_type TEXT,                  -- run, ride
    polyline TEXT NOT NULL,
    distance_meters REAL,
    elevation_gain_meters REAL,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL,                -- 'manual' | 'strava'
    strava_segment_id TEXT               -- nullable
);

CREATE TABLE IF NOT EXISTS segment_efforts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id INTEGER NOT NULL,
    activity_id TEXT NOT NULL,
    date TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    avg_heart_rate INTEGER,
    avg_power_watts INTEGER,
    is_personal_record INTEGER DEFAULT 0,
    FOREIGN KEY (segment_id) REFERENCES segments(id),
    FOREIGN KEY (activity_id) REFERENCES activities(id),
    FOREIGN KEY (date) REFERENCES days(date)
);

CREATE INDEX IF NOT EXISTS idx_segment_efforts_segment ON segment_efforts(segment_id);
CREATE INDEX IF NOT EXISTS idx_segment_efforts_date ON segment_efforts(date);

CREATE TABLE IF NOT EXISTS sync_status (
    source TEXT PRIMARY KEY,             -- 'garmin' | 'strava'
    last_attempt_at TEXT NOT NULL,
    last_success_at TEXT,
    last_error TEXT,
    records_synced INTEGER DEFAULT 0
);
```

## Build order (the only correct order)

Each phase produces something testable. Do not skip ahead.

**Phase A: Plumbing (no UI yet)**
1. Schema migration applied to existing daybook.db
2. Garmin auth working, manually run a one-activity test fetch
3. Garmin backfill script — pulls full history into activities + 
   activity_streams + health
4. Garmin daily incremental sync, wired to cron
5. sync_status writes on every run

**Phase B: API and basic UI**
6. FastAPI endpoints: /activities, /activities/{id}, /day/{date} 
   (extended to include activities)
7. Next.js Day View shows activities as a list with summary stats
8. Activity detail page with map + elevation + HR charts

**Phase C: Maps**
9. Personal heatmap view (all polylines, filterable by type and year)
10. Calendar heatmap view (activity volume per day)

**Phase D: Strava enrichment**
11. Strava OAuth flow, store refresh token
12. Strava activity cross-reference sync (match by start_time within 
    a tolerance window)
13. Segment effort pull for matched activities
14. Per-segment history view

**Phase E: Training intelligence**
15. TSS calculation for activities that don't have it from source
16. CTL/ATL/TSB curve computation as a daily batch job
17. Training load chart on Day View and Timeline
18. Anomaly detection (HR-for-effort outliers)

**Phase F: Cross-domain (this is where Daybook becomes irreplaceable)**
19. Correlation queries joining activities + days.questionnaire fields
20. Insights view surfacing the strongest correlations
21. Duty day overlay on training load (once aviation domain has data)

## Out of scope for this integration

- Live activity recording in the browser (Garmin watch handles this).
- Writing activities back to Strava or Garmin.
- Real-time GPS streaming from a phone (future scope).
- Public sharing of activities or segments.
- Notification systems (email, push).

## Risks and mitigations

- **Garmin API breakage**: python-garminconnect is unofficial. Mitigation: 
  store raw_payload for everything; abstract the sync into a thin 
  `GarminClient` class so swapping libraries means editing one file; 
  keep Garmin Connect exports as a manual fallback.
  
- **Strava rate limits**: 100 requests per 15 minutes, 1000 per day. 
  Mitigation: segment sync runs in batches, prioritizes recent activities, 
  uses local cache aggressively. The daily cron should never hit the limit.

- **Storage growth**: activity_streams JSON per activity is ~100-500 KB. 
  Over years this matters on a 16GB SD card. Mitigation: streams older 
  than 2 years can be moved to compressed parquet files on the SD card 
  or external drive — not yet, but the path is clear.

- **Polyline rendering performance on Pi**: rendering 500+ polylines for 
  a yearly heatmap in the browser can be slow. Mitigation: pre-compute 
  simplified polylines (Douglas-Peucker) at sync time, store both full 
  and simplified versions.

## Definition of done

The integration is "done" when:

1. Every morning the previous day's activities and wellness data appear 
   in Daybook without me doing anything.
2. I can open Daybook on my phone via Tailscale and see today's data, 
   any past day's data, and a yearly heatmap of my routes.
3. I have cancelled Strava Premium and do not miss it.
4. I can answer at least one question about my life that no app could 
   previously answer (e.g. "what's my average pace on weeks following 
   a multi-night layover?").