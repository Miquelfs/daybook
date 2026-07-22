# Daybook — Claude Guidelines

## Pi Deployment Workflow

Claude cannot SSH to the Pi directly. Always provide commands for the user to run in their terminal.

When deployment is needed, output the exact commands for the user to execute:

```bash
# 1. Sync code to Pi
rsync -av --delete \
  --exclude='.git' --exclude='.next' --exclude='node_modules' \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='.venv' \
  --exclude='data/' --exclude='infrastructure/db/*.db' \
  --exclude='infrastructure/db/*.db-wal' --exclude='infrastructure/db/*.db-shm' \
  --exclude='infrastructure/scripts/logs/' --exclude='nohup.out' --exclude='.env' \
  . pi@daybook-pi:~/daybook/

# 2. Copy env
scp infrastructure/web/.env.local pi@daybook-pi:~/daybook/infrastructure/web/.env.local

# 3. Build frontend and restart services on Pi
ssh pi@daybook-pi "cd ~/daybook/infrastructure/web && npm install --include=dev --silent && npm run build && sudo systemctl restart daybook-api daybook-web"
```

The user will paste back the output for Claude to review.

## Pi is the Source of Truth — Never Restore DB from Mac

The Pi holds the only copy of:
- `days` table mood/energy/notes (entered via phone questionnaire)
- `data/photos/` (uploaded from phone)
- `money.db` transactions (synced from Notion on Pi)

The rsync already excludes `*.db` files — DBs are never overwritten by normal deploys.

**Never run a DB dump from Mac → restore on Pi.** If a SQLite version mismatch occurs again, the fix is to upgrade SQLite on the Pi (`sudo apt install sqlite3`), not to restore from Mac. Restoring from Mac loses all Pi-only data (moods, photos, recent transactions).

If a schema migration is needed on Pi, write a migration script and run it on the Pi directly.

## Project Stack

- **Backend**: FastAPI (Python) on Raspberry Pi via Tailscale (100.67.252.76)
- **Frontend**: Next.js App Router + TanStack Query, served from Pi on port 3000
- **DB**: SQLite — `daybook.db` (main), `money.db`, `locations.db`
- **GPS**: Overland iOS → `/overland` endpoint → `overland_process.py`
- **Photos**: Stored in `data/photos/` on Pi, served as static files via FastAPI

## CORS & Mutations

All browser→backend mutations go through Next.js proxy routes (`/api/*`) to avoid CORS.
- Server-side fetch uses `API_INTERNAL_URL` (localhost on Pi)
- Client-side reads use `NEXT_PUBLIC_API_URL` (Tailscale IP, baked at build time)

## Tags Convention

Tags are stored in `day_tags` (join table) and managed via the TagPicker.
The legacy `days.tags` text column (`work`, `with:Name`) is still present in the DB
but tags are now the source of truth. Structured tags include:
- `work` — work day
- `candy`, `alcohol` — tracked as "negative" tags (clean streak = days without)
- All other tags (sex, nap, outdoors, social, etc.) are positive — more = better

## Key Directories

- `infrastructure/web/` — Next.js frontend
- `infrastructure/api/` — FastAPI backend
- `infrastructure/db/` — SQLite schema + migrations
- `domains/` — domain logic (Garmin sync, locations, money, etc.)
- `data/photos/` — uploaded day photos (excluded from rsync, lives on Pi)

## iOS + Web Parity Rules

The Pi API is the single contract. Both the web app (`infrastructure/web/`) and the iOS app (`~/Desktop/daybook-ios/`) are thin clients of the same API. Changes must be kept in sync across both:

**When changing the Pi API (adding/renaming a field, new endpoint):**
1. Update `infrastructure/api/models/*.py` (Pydantic model)
2. Update `infrastructure/web/lib/api.ts` (TypeScript type)
3. Update the matching Swift struct in `daybook-ios/Daybook/DaybookApp/Models/*.swift`

**When changing a write operation (PATCH/POST body):**
- `DayPatch` exists in both `lib/api.ts` and `DayModels.swift` — update both
- Swift `DayPatch` uses explicit `CodingKeys` with snake_case strings — add the key there too
- Any new field on `DaySubjective` (read) also needs to appear in `DayPatch` (write) if it's user-editable, and in `QuestionnaireView` to be writable from iOS

**Known type mappings (API → Swift):**
- `list[str]` → `[String]?` (e.g. `companions`, `cities`)
- `list[SomeModel]` → `[SomeModel]?` where Swift struct matches Pydantic fields
- Snake_case API fields → camelCase Swift properties via `keyDecodingStrategy: .convertFromSnakeCase`
- Exception: structs with explicit `CodingKeys` enums bypass the strategy — all keys must be listed manually

**The data flow is always:** iOS app → PATCH/POST → Pi API → SQLite → GET → web app (and vice versa). There is no direct iOS↔web communication. A mood logged on iOS is immediately visible on the web because both read the same DB row.

**Push always the written code into github**
