#!/usr/bin/env bash
# backup.sh — snapshot all SQLite databases to data/backups/ with a timestamp.
# Keeps the last 7 backups per database; deletes older ones automatically.
# Skips the backup when free disk is low — a full SD card takes the whole app
# down (SQLite can't open its WAL files), which is worse than a missed backup.
#
# Usage:
#   bash infrastructure/scripts/backup.sh
#   make backup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DB_DIR="$ROOT/infrastructure/db"
BACKUP_DIR="$ROOT/data/backups"
KEEP=7
MIN_FREE_MB=1500
STAMP="$(date +%Y-%m-%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

free_mb=$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')
if (( free_mb < MIN_FREE_MB )); then
  echo "==> Skipping backup: only ${free_mb} MB free (need ${MIN_FREE_MB} MB)" >&2
  exit 1
fi

echo "==> Backing up databases (stamp: $STAMP)..."

count=0
for db in "$DB_DIR"/*.db; do
  [[ -f "$db" ]] || continue
  name="$(basename "$db" .db)"
  dest="$BACKUP_DIR/${name}_${STAMP}.db.gz"
  gzip -c "$db" > "$dest"
  size=$(du -h "$dest" | cut -f1)
  echo "    $name → $(basename "$dest") ($size)"
  count=$((count + 1))
done

if [[ $count -eq 0 ]]; then
  echo "    No .db files found in $DB_DIR"
  exit 0
fi

# Prune: keep only the $KEEP most recent backups per database name
for db in "$DB_DIR"/*.db; do
  [[ -f "$db" ]] || continue
  name="$(basename "$db" .db)"
  ls -t "$BACKUP_DIR/${name}_"*.db.gz 2>/dev/null \
    | tail -n +$((KEEP + 1)) \
    | while IFS= read -r f; do
        rm -f "$f"
        echo "    Pruned: $(basename "$f")"
      done
done

echo "==> Backup complete ($count databases)"
