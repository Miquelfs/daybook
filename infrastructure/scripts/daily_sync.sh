#!/usr/bin/env bash
# daily_sync.sh — run via cron every morning to pull the previous day's Garmin data.
#
# Suggested crontab entry (edit with: crontab -e):
#   0 7 * * * cd /Users/miquelfarre/Desktop/daybook && ./infrastructure/scripts/daily_sync.sh
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

# Garmin: yesterday only (today's data often incomplete until morning)
log "Syncing Garmin (yesterday)..."
cd "$ROOT"
python -m domains.health.garmin.garmin_sync \
  --start-date "$(date -v-1d '+%Y-%m-%d' 2>/dev/null || date -d 'yesterday' '+%Y-%m-%d')" \
  --end-date "$(date -v-1d '+%Y-%m-%d' 2>/dev/null || date -d 'yesterday' '+%Y-%m-%d')" \
  >> "$LOG_FILE" 2>&1

log "=== daily_sync done ==="
