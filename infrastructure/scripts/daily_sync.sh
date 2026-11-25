#!/usr/bin/env bash
# daily_sync.sh — run via cron every morning to pull the previous day's Garmin data.
#
# Suggested crontab entry (edit with: crontab -e):
#   0 7 * * * cd ~/daybook && ./infrastructure/scripts/daily_sync.sh
#
# To install: make the script executable once:
#   chmod +x infrastructure/scripts/daily_sync.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
DATE="$(date +%Y-%m-%d)"
HOUR="$(date +%H)"
YESTERDAY="$(date -d 'yesterday' +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)"
LOG_FILE="$LOG_DIR/daily_sync_${DATE}.log"
ERROR_LOG="$LOG_DIR/errors.log"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# One run at a time. The cron fires hourly; on the Pi's single CPU a slow run used to
# overlap the next one, and the pile-up held the databases busy (the app lagged, saves 500'd)
# and never reached the morning brief. A run that finds the previous one still going leaves.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOG_DIR/.daily_sync.lock"
  if ! flock -n 9; then
    log "previous daily_sync still running — skipping this hour"
    exit 0
  fi
fi

# No single job may hold the run up: each step is stopped after STEP_LIMIT (exit 124 →
# recorded as a failure, so /status names it).
STEP_LIMIT="${STEP_LIMIT:-15m}"
TIMEOUT=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT="timeout $STEP_LIMIT"; fi

# step <job-name> <command...> — run one job, never abort the whole sync on its
# failure (set -e would otherwise stop every later job silently), and record the
# outcome in daybook.db → job_runs so the app's System status can show it.
step() {
  local name="$1"; shift
  local start rc
  start=$(date +%s)
  if $TIMEOUT "$@" >> "$LOG_FILE" 2>&1; then rc=0; else rc=$?; fi
  if [[ $rc -eq 124 ]]; then echo "$name: stopped after $STEP_LIMIT (exit 124)" >> "$LOG_FILE"; fi
  python3 "$ROOT/infrastructure/scripts/job_status.py" record "$name" "$rc" "$(( $(date +%s) - start ))" \
    "$(tail -n 4 "$LOG_FILE" | tr '\n' ' ' | cut -c1-400)" >/dev/null 2>&1 || true
  if [[ $rc -ne 0 ]]; then log "WARN: $name failed (exit $rc)"; fi
  return 0
}

on_error() {
  local msg="[$DATE] daily_sync.sh failed at line $1"
  echo "$msg" | tee -a "$ERROR_LOG" >&2
  log "ERROR: $msg"
}

trap 'on_error $LINENO' ERR

log "=== daily_sync start ==="
log "Root: $ROOT"

# Activate venv
VENV="$ROOT/.venv"
if [[ ! -f "$VENV/bin/activate" ]]; then
  log "ERROR: venv not found at $VENV — run: make setup"
  exit 1
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

cd "$ROOT"

# Run on YOUR clock (where you are — reported by your phone/browser), not the
# Pi's Spanish one: DATE / HOUR / YESTERDAY, the morning-brief window, day
# finalisation and every python job below (date.today()) follow it.
export TZ="$(python3 "$ROOT/infrastructure/db/usertime.py" 2>/dev/null || echo Europe/Madrid)"
DATE="$(date +%Y-%m-%d)"
HOUR="$(date +%H)"
YESTERDAY="$(date -d 'yesterday' +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)"
log "Timezone: $TZ (local $DATE ${HOUR}h)"

# Load .env so STRAVA_CLIENT_ID and other vars are available in cron environment
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Garmin: auto-detect start from last synced date so gaps are filled automatically.
# On a normal day this picks up yesterday; after a gap it catches up.
log "Syncing Garmin (auto catch-up, with streams)..."
step garmin_sync python -m domains.health.garmin.garmin_sync --streams

# GPS, once a night (the first run from 03:00 on your clock): what's left of finished days →
# tracks, then trips and vehicle drives (the heavy part). Doing all of it every hour, and on
# every Overland upload, kept the Pi's one CPU busy all day.
GPS_STAMP="$LOG_DIR/.gps_nightly_$DATE"
if [[ "$HOUR" -ge 3 && ! -f "$GPS_STAMP" ]]; then
  log "Processing GPS (nightly)..."
  step overland_process python -m domains.locations.overland_process --before "$DATE"
  # Trips: re-detect trips over the last 120 days (Plan B.2, nights-based).
  step trip_detection python -m domains.locations.trip_detection
  step vehicle_routes python -m domains.vehicles.routes
  # Planned trips that have now happened hand their name + companions to the detected trip.
  step planned_trips python -m domains.plans.planned_trips
  touch "$GPS_STAMP"
  find "$LOG_DIR" -name '.gps_nightly_*' ! -name ".gps_nightly_$DATE" -delete 2>/dev/null || true
fi
# Today, every hour: only the points that came in since the last run → stops, places (named once,
# only new ones), passing. Small and cheap; the latest stretch not processed yet still shows as a
# plain line on the day map.
step overland_process:today python -m domains.locations.overland_process "$DATE"
step vehicle_reminders python -m domains.vehicles.reminders

# Warm the expensive explore caches so the page is never cold (6h TTL,
# hourly cron keeps them fresh).
log "Warming explore caches..."
curl -s -m 60 -o /dev/null "http://localhost:8000/locations/world-coverage" || true
curl -s -m 60 -o /dev/null "http://localhost:8000/locations/fun-facts" || true

# Notion sync removed — money data now entered via iOS app directly.

# Strava sync retired (2026-11): its API now refuses the token (403) and Garmin already
# provides everything Daybook uses. Past Strava-sourced activities stay in the DB.

# Weather: fetch last 3 days so today + yesterday are always covered.
log "Syncing weather (last 3 days)..."
step weather_sync python -m domains.weather.weather_sync "$YESTERDAY" "$DATE"

# Intraday HR: fetch continuous heart rate readings for yesterday, then refresh
# today (partial day, --force) so the current-day timeline stays live.
log "Syncing intraday heart rate..."
step intraday_hr_sync python -m domains.health.garmin.intraday_hr_sync
step intraday_hr_sync:today python -m domains.health.garmin.intraday_hr_sync --date "$DATE" --force

# All-day wellness (CIRQA): intraday stress, Body Battery, respiration, SpO2 —
# yesterday, then today (partial, --force) so stress/energy show for the day so far.
log "Syncing all-day wellness..."
step wellness_sync python -m domains.health.garmin.wellness_sync
step wellness_sync:today python -m domains.health.garmin.wellness_sync --date "$DATE" --force

# Finalize the completed previous day. Once past midnight, Garmin holds the full
# 00:00–23:59 of yesterday's intraday stress / Body Battery / HR — including the
# late-evening hours that were logged after the last same-day sync. The regular
# syncs above SKIP a day whose row already exists, so without this force the tail
# of yesterday would never be pulled and the graph would stay short. Run it in
# the early-morning window. Gated to < 08:00 so it fires whether the cron runs
# hourly (00–07) or as a single morning run around 07:00; it's idempotent
# (INSERT OR REPLACE) so repeats within the window are harmless.
if [[ "$HOUR" -lt 8 ]]; then
  log "Finalizing yesterday's completed day (forced re-sync)..."
  step wellness_sync:finalize python -m domains.health.garmin.wellness_sync --date "$YESTERDAY" --force
  step intraday_hr_sync:finalize python -m domains.health.garmin.intraday_hr_sync --date "$YESTERDAY" --force
fi

# AI: morning brief (requires Ollama at OLLAMA_HOST; skips gracefully otherwise).
# Right after Garmin + weather + wellness — everything it reads — so the slower jobs below
# can't push it past its window.
# The cron runs hourly — attempt across the 05–11h window so the brief lands
# once around 6am and can be regenerated once Garmin uploads last night's sleep
# (often after 6am). The brief itself is self-gating: it skips cheaply when
# today's brief already includes sleep, and only re-calls the LLM when sleep has
# just landed for a brief that was written without it.
if [[ "$HOUR" -ge 5 && "$HOUR" -le 11 ]]; then
  log "Generating AI morning brief..."
  step morning_brief python -m domains.ai.morning_brief --date "$DATE"
else
  log "Skipping morning brief (outside 05-11h window)"
fi

# Flight physio + stress-by-context: snapshot yesterday & today so the takeoff/
# landing spikes and "what stresses you" roll up across all of life.
log "Snapshotting flight physio + stress contexts..."
for D in "$YESTERDAY" "$DATE"; do
  step flight_physio python -m domains.health.flight_physio --date "$D"
  step stress_context python -m domains.health.stress_context --date "$D"
done

# METARs for recent takeoffs/landings (Iowa Mesonet archive) → weather × stress.
# Logbook: provable repairs only (missing ICAO from IATA, date rollovers, night ≤ block).
step logbook_integrity python -m domains.aviation.integrity --fix
# Loadsheet / FMC imports saved before their flight was logged → attach now.
step loadsheets python -m domains.aviation.flight_import
step metar python -m domains.aviation.metar --days 30
# Landing runways: ADS-B track (OpenSky, last ~29 days) or METAR wind; crosswind at landing.
step runways python -m domains.aviation.runways

# Load Index: compute fatigue composite for yesterday (Horizon 1).
log "Computing Load Index..."
step compute_load_index python -m domains.health.compute_load_index

# Roster tags: auto-apply flew/standby/ground_duty tags from the duty roster.
log "Syncing roster tags..."
step roster_tag_sync python -m domains.aviation.roster_tag_sync

# Training plan: start goals whose plan begins today, then re-place this and
# future weeks' sessions around the roster, layovers and detected trips.
log "Re-placing training sessions around roster/travel..."
step reflow python -m domains.training.reflow

# AI coach: on Sat/Sun, have next week's review waiting for the planning ritual.
step coach python -m domains.training.coach --auto

# Garmin: send the next ~9 days of sessions as structured workouts (trainer =
# ERG watts, outdoor = HR), re-sending anything the re-plan moved or changed.
step garmin_workout_push python -m domains.health.garmin.workout_push
# Trainer sessions → Intervals.icu → MyWhoosh calendar (skips itself without INTERVALS_API_KEY).
step mywhoosh_workout_push python -m domains.health.intervals_push

# Activity detail sync: fetch splits, Garmin TE, physio metrics for new activities.
log "Syncing Garmin activity details + physio (last 7 days)..."
step garmin_activity_detail_sync python -m domains.health.garmin.garmin_activity_detail_sync --days 7 --fetch-streams

# Compute per-activity metrics: NP, IF, EF, decoupling, MMP curves.
log "Computing per-activity metrics (last 7 days)..."
step compute_activity_metrics python -m domains.health.compute_activity_metrics --days 7
step coll_review python -m domains.coll.review
step coll_weather python -m domains.coll.weather
step activity_analysis python -m domains.health.activity_analysis --days 7
# Cols climbed (OpenStreetMap passes along new rides/runs/hikes) — retries next night if OSM is down.
step cols_sync python -m domains.locations.cols
step climbs_sync python -m domains.locations.climbs

# CTL/ATL/TSB: update fitness & freshness for all sports.
log "Computing training load (CTL/ATL/TSB)..."
step compute_training_load python -m domains.health.compute_training_load
# Back from a tour/camp: size its recovery week on the real load (no-op otherwise).
step tour_recovery python -m domains.training.blocks --settle

# Correlations: recompute snapshot so the Discover tab stays fresh.
log "Computing correlation snapshot..."
step compute_correlations python -m domains.insights.compute_correlations --both --if-stale 20

# Weekly life review: Sunday, once — patterns + actions for the coming week.
step life_review python -m domains.insights.life_review --auto

# Portfolio prices: yesterday's closes (yfinance), once a night — the first run from 03:00 on
# your clock, when every market's close is in. A close doesn't change, so the other hours skip it.
PRICE_STAMP="$LOG_DIR/.prices_nightly_$DATE"
if [[ "$HOUR" -ge 3 && ! -f "$PRICE_STAMP" ]]; then
  log "Syncing portfolio prices (nightly)..."
  step price_sync python -m domains.money.price_sync
  touch "$PRICE_STAMP"
  find "$LOG_DIR" -name '.prices_nightly_*' ! -name ".prices_nightly_$DATE" -delete 2>/dev/null || true
fi

# Recurring investment plans (DCA): execute any plans whose next date has arrived.
# Uses today's cached price. Idempotent — safe to run repeatedly.
log "Executing due investment plans..."
step plan_executor python -m domains.money.plan_executor

# Grocery tickets: generic names for products not labelled yet (store comparison).
# Only calls Claude when there's something new — usually a no-op.
step grocery_labels python -m domains.money.grocery_labels

log "=== daily_sync done ==="
