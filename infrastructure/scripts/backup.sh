#!/usr/bin/env bash
# backup.sh — snapshot all SQLite databases to data/backups/ with a timestamp.
# Uses SQLite's online backup API (not a raw file copy), so each snapshot is
# consistent even while the API or a sync is writing and includes WAL contents.
# Keeps only the last 3 per database on the Pi — the long-term history lives on
# the Mac, which pulls these nightly (see pull_backups.sh).
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
KEEP=3
MIN_FREE_MB=1500
STAMP="$(date +%Y-%m-%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"
trap 'rm -f "$BACKUP_DIR"/.*.db "$BACKUP_DIR"/*.part' EXIT

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
  tmp="$BACKUP_DIR/.${name}_${STAMP}.db"
  python3 -c 'import sqlite3, sys
src = sqlite3.connect(sys.argv[1]); dst = sqlite3.connect(sys.argv[2])
src.backup(dst); dst.close(); src.close()' "$db" "$tmp"
  gzip -c "$tmp" > "$dest.part" && mv "$dest.part" "$dest"
  rm -f "$tmp"
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
  ls -t "$BACKUP_DIR/${name}_"[0-9][0-9][0-9][0-9]-*.db.gz 2>/dev/null \
    | tail -n +$((KEEP + 1)) \
    | while IFS= read -r f; do
        rm -f "$f"
        echo "    Pruned: $(basename "$f")"
      done
done

echo "==> Backup complete ($count databases)"
