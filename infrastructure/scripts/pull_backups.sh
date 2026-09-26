#!/usr/bin/env bash
# pull_backups.sh — runs on the Mac: pulls the Pi's DB snapshots (data/backups/)
# into a local folder, so a dead SD card doesn't take the backups with it.
#
# The Pi keeps only its last 3 snapshots per database; the Mac keeps the history:
#   - the newest $KEEP_RECENT per database, plus
#   - the first snapshot of every month, forever.
#
# Scheduled nightly by launchd (make backup-pull-install); run by hand with
#   make backup-pull
#
# Restoring is a deliberate, manual act — never sync these back to the Pi as
# part of a deploy (see CLAUDE.md: the Pi is the source of truth).

set -euo pipefail

PI_HOST="${DAYBOOK_PI_HOST:-pi@daybook-pi}"
PI_DIR="${DAYBOOK_PI_BACKUP_DIR:-daybook/data/backups/}"
DEST="${DAYBOOK_BACKUP_DIR:-$HOME/Backups/daybook}"
KEEP_RECENT=30
STALE_DAYS=3

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

notify() {
  osascript -e "display notification \"$1\" with title \"Daybook backup\"" 2>/dev/null || true
}

fail() {
  log "ERROR: $1"
  notify "$1"
  exit 1
}

mkdir -p "$DEST"
log "Pulling $PI_HOST:$PI_DIR → $DEST"

# Snapshots are immutable (timestamped names), so never re-copy an existing one.
# Skip in-progress files (.part, hidden temp snapshots) the Pi may be writing.
pulled="$(rsync -a --ignore-existing --partial --timeout=120 \
  --exclude='.*' --exclude='*.part' --out-format='%n' \
  -e "ssh -o BatchMode=yes -o ConnectTimeout=20" \
  "$PI_HOST:$PI_DIR" "$DEST/")" \
  || fail "Could not pull backups from the Pi (is it reachable over Tailscale?)"

# Check every newly pulled snapshot is a complete gzip.
while IFS= read -r f; do
  [[ "$f" == *.db.gz ]] || continue
  if gzip -t "$DEST/$f" 2>/dev/null; then
    log "    Pulled: $f"
  else
    log "    Corrupt snapshot, removing: $f"
    rm -f "$DEST/$f"
  fi
done <<< "$pulled"

# Retention + staleness check.
status=0
/usr/bin/python3 - "$DEST" "$KEEP_RECENT" "$STALE_DAYS" <<'PY' || status=$?
import re, sys, time
from collections import defaultdict
from pathlib import Path

dest, keep_recent, stale_days = Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
pat = re.compile(r"^(?P<name>.+)_(?P<stamp>\d{4}-\d{2}-\d{2}_\d{6})\.db\.gz$")

by_db = defaultdict(list)
for f in dest.glob("*.db.gz"):
    m = pat.match(f.name)
    if m:
        by_db[m["name"]].append((m["stamp"], f))

newest_overall = None
for name, snaps in sorted(by_db.items()):
    snaps.sort()  # stamps sort chronologically
    keep = {f for _, f in snaps[-keep_recent:]}
    seen_months = set()
    for stamp, f in snaps:
        if stamp[:7] not in seen_months:
            seen_months.add(stamp[:7])
            keep.add(f)
    for _, f in snaps:
        if f not in keep:
            f.unlink()
            print(f"    Pruned: {f.name}")
    stamp, newest = snaps[-1]
    size_mb = sum(f.stat().st_size for f in keep) / 1e6
    print(f"    {name}: {len(keep)} snapshots, newest {stamp}, {size_mb:.0f} MB")
    newest_overall = max(newest_overall or stamp, stamp)

if newest_overall is None:
    print("STALE: no snapshots found")
    sys.exit(2)
age_days = (time.time() - time.mktime(time.strptime(newest_overall, "%Y-%m-%d_%H%M%S"))) / 86400
if age_days > stale_days:
    print(f"STALE: newest snapshot is {age_days:.1f} days old")
    sys.exit(2)
PY
if (( status == 2 )); then
  fail "The Pi hasn't made a new backup in over $STALE_DAYS days — check its backup cron."
elif (( status != 0 )); then
  fail "Backup retention step failed (exit $status) — see the log."
fi

log "Done."
