#!/usr/bin/env bash
# Run the Daybook API in development mode.
# Activate the venv first, then launch uvicorn with --reload.
# Always run from the daybook/ root directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$ROOT"

if [[ ! -f ".venv/bin/activate" ]]; then
  echo "ERROR: .venv not found — run: python3 -m venv .venv && pip install -r requirements.txt" >&2
  exit 1
fi

source .venv/bin/activate

exec uvicorn infrastructure.api.main:app \
  --host 127.0.0.1 \
  --port 8000 \
  --reload \
  --reload-dir infrastructure/api \
  --reload-dir domains \
  --reload-dir infrastructure/db
