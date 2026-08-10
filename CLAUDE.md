# Daybook — Claude Guidelines

## Pi Deployment Workflow

Claude cannot SSH to the Pi directly. Always provide commands for the user to run in their terminal.

**Build the frontend on the Mac, never on the Pi.** The Pi (1 CPU, ~384 MB heap cap) cannot build Next.js — an on-Pi `npm run build` OOM-thrashes it into unresponsiveness (SSH times out, needs a physical power-cycle). The `daybook-web` systemd service just runs `next start`, which serves a prebuilt `.next/`. So we build locally and ship the built `.next/`; the Pi only restarts.

**Prefer passwordless SSH-key auth (set up once).** The Pi accepts an ed25519 key, so `rsync`/`scp`/`ssh` run with no password prompt. This is the fix for the intermittent deploy drops (`Connection closed by port 22`, rsync `connection unexpectedly closed`) — those happen when a password is typed too slowly and the Pi closes the auth window. One-time on the Mac:
```bash
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -C "daybook-mac"
```
```bash
ssh-copy-id pi@daybook-pi
```
```bash
ssh pi@daybook-pi "echo connected — no password"
```
(If `ssh-copy-id` is missing: `cat ~/.ssh/id_ed25519.pub | ssh pi@daybook-pi "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"`.) Once the key is in place the deploy is prompt-free; the "one block at a time / password" caution below only applies if key auth isn't set up.

When deployment is needed, output these commands for the user to run **one block at a time** (without a key, each of the last four prompts for the Pi password — pasting several at once can let a password prompt swallow the next line; with key auth there are no prompts). Do **not** include `#` comment lines in the blocks the user pastes — their interactive zsh does not treat `#` as a comment and it throws errors.

1. Build the frontend on the Mac (no password):
```bash
cd infrastructure/web && npm run build && cd ../..
```

2. Sync code to the Pi (excludes `.next` — shipped in step 4):
```bash
rsync -av --delete --exclude='.git' --exclude='.next' --exclude='node_modules' --exclude='__pycache__' --exclude='*.pyc' --exclude='.venv' --exclude='data/' --exclude='infrastructure/db/*.db' --exclude='infrastructure/db/*.db-wal' --exclude='infrastructure/db/*.db-shm' --exclude='infrastructure/scripts/logs/' --exclude='nohup.out' --exclude='.env' . pi@daybook-pi:~/daybook/
```

3. Copy the web env:
```bash
scp infrastructure/web/.env.local pi@daybook-pi:~/daybook/infrastructure/web/.env.local
```

4. Ship the prebuilt frontend (`-z --partial` so it resumes if the link hiccups):
```bash
rsync -avz --partial --timeout=120 infrastructure/web/.next/ pi@daybook-pi:~/daybook/infrastructure/web/.next/
```

5. Restart services on the Pi (no build — serves the new `.next` and applies API startup migrations):
```bash
ssh pi@daybook-pi "sudo systemctl restart daybook-api daybook-web"
```

- **No `npm install` / no build on the Pi.** The Pi already has `node_modules` for `next start`. Only when web *dependencies* change, run a one-time `ssh pi@daybook-pi "cd ~/daybook/infrastructure/web && npm install --omit=dev"`.
- If step 4's rsync drops with "connection unexpectedly closed", a stuck build is hogging RAM — clear it: `ssh pi@daybook-pi "pkill -f 'next build'; pkill -f 'npm run build'"`, then re-run step 4. If SSH itself times out, the Pi needs a physical power-cycle (services + Tailscale auto-start on boot).

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
