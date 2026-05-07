#!/usr/bin/env bash
# backup.sh — snapshot all SQLite databases to data/backups/ with a timestamp.
# Keeps the last 30 backups; deletes older ones automatically.
#
# Usage:
#   bash infrastructure/scripts/backup.sh
#   make backup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DB_DIR="$ROOT/infrastructure/db"
BACKUP_DIR="$ROOT/data/backups"
KEEP=30
STAMP="$(date +%Y-%m-%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

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
