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
LOG_FILE="$LOG_DIR/daily_sync_${DATE}.log"
ERROR_LOG="$LOG_DIR/errors.log"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
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
python -m domains.health.garmin.garmin_sync --streams \
  >> "$LOG_FILE" 2>&1

# Overland: process any raw GPS points received since last run.
log "Processing Overland GPS points..."
python -m domains.locations.overland_process \
  >> "$LOG_FILE" 2>&1

# Notion sync removed — money data now entered via iOS app directly.

# Strava: cross-reference last 7 days of Garmin activities with Strava.
# Skips gracefully if STRAVA_CLIENT_ID is not set or tokens are missing.
if [[ -n "${STRAVA_CLIENT_ID:-}" ]]; then
  log "Syncing Strava enrichment (last 7 days)..."
  python -m domains.health.strava.strava_sync --days 7 \
    >> "$LOG_FILE" 2>&1 || log "WARN: Strava sync failed (non-fatal)"
else
  log "Skipping Strava sync (STRAVA_CLIENT_ID not set)"
fi

# Weather: fetch last 3 days so today + yesterday are always covered.
log "Syncing weather (last 3 days)..."
YESTERDAY="$(date -d 'yesterday' +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)"
python -m domains.weather.weather_sync "$YESTERDAY" "$DATE" \
  >> "$LOG_FILE" 2>&1 || log "WARN: Weather sync failed (non-fatal)"

# Intraday HR: fetch continuous heart rate readings for yesterday.
log "Syncing intraday heart rate..."
python -m domains.health.garmin.intraday_hr_sync \
  >> "$LOG_FILE" 2>&1 || log "WARN: Intraday HR sync failed (non-fatal)"

# Load Index: compute fatigue composite for yesterday (Horizon 1).
log "Computing Load Index..."
python -m domains.health.compute_load_index \
  >> "$LOG_FILE" 2>&1 || log "WARN: Load Index compute failed (non-fatal)"

# Roster tags: auto-apply flew/standby/ground_duty tags from the duty roster.
log "Syncing roster tags..."
python -m domains.aviation.roster_tag_sync \
  >> "$LOG_FILE" 2>&1 || log "WARN: Roster tag sync failed (non-fatal)"

# Activity detail sync: fetch splits, Garmin TE, physio metrics for new activities.
log "Syncing Garmin activity details + physio (last 7 days)..."
python -m domains.health.garmin.garmin_activity_detail_sync --days 7 \
  >> "$LOG_FILE" 2>&1 || log "WARN: Activity detail sync failed (non-fatal)"

# Compute per-activity metrics: NP, IF, EF, decoupling, MMP curves.
log "Computing per-activity metrics (last 7 days)..."
python -m domains.health.compute_activity_metrics --days 7 \
  >> "$LOG_FILE" 2>&1 || log "WARN: Activity metrics compute failed (non-fatal)"

# CTL/ATL/TSB: update fitness & freshness for all sports.
log "Computing training load (CTL/ATL/TSB)..."
python -m domains.health.compute_training_load \
  >> "$LOG_FILE" 2>&1 || log "WARN: Training load compute failed (non-fatal)"

# Correlations: recompute snapshot so the Discover tab stays fresh.
log "Computing correlation snapshot..."
python -m domains.insights.compute_correlations \
  >> "$LOG_FILE" 2>&1 || log "WARN: Correlation snapshot failed (non-fatal)"

# Portfolio price sync: fetch yesterday's closes for all active holdings via yfinance.
log "Syncing portfolio prices..."
python -m domains.money.price_sync \
  >> "$LOG_FILE" 2>&1 || log "WARN: Price sync failed (non-fatal)"

# Recurring investment plans (DCA): execute any plans whose next date has arrived.
# Uses today's cached price. Idempotent — safe to run repeatedly.
log "Executing due investment plans..."
python -m domains.money.plan_executor \
  >> "$LOG_FILE" 2>&1 || log "WARN: Plan executor failed (non-fatal)"

# AI: morning brief + daily health narratives (requires Ollama on HP at OLLAMA_HOST).
# Runs last so all data is fresh. Skips gracefully if Ollama is unreachable.
log "Generating AI morning brief..."
python -m domains.ai.morning_brief --date "$DATE" \
  >> "$LOG_FILE" 2>&1 || log "WARN: Morning brief generation failed (non-fatal)"

log "=== daily_sync done ==="
