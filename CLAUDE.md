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

**Default: one command.** When deployment is needed, give the user:
```bash
make deploy
```
It builds the frontend on the Mac (type-checked — a type error stops the deploy), syncs code + `.env.local`, ships the prebuilt `.next`, restarts both services and health-checks them (prints the System status). It reuses one SSH connection, so without key auth there is a single password prompt. Backend/script-only changes: `make deploy-api` (no build, restarts the API). Web dependency changes: `make deploy-deps` once. Run `make test` before deploying (stdlib unittest, runs on the Mac).

**Fallback (manual, if `make deploy` itself fails):** output these commands for the user to run **one block at a time** (without a key, each of the last four prompts for the Pi password — pasting several at once can let a password prompt swallow the next line; with key auth there are no prompts). Do **not** include `#` comment lines in the blocks the user pastes — their interactive zsh does not treat `#` as a comment and it throws errors.

1. Build the frontend on the Mac (no password):
```bash
cd infrastructure/web && npm run build && cd ../..
```

2. Sync code to the Pi (excludes `.next` — shipped in step 4):
```bash
rsync -av --delete --exclude='.git' --exclude='.next' --exclude='node_modules' --exclude='__pycache__' --exclude='*.pyc' --exclude='.venv' --exclude='data/' --exclude='infrastructure/db/*.db' --exclude='infrastructure/db/*.db-wal' --exclude='infrastructure/db/*.db-shm' --exclude='infrastructure/scripts/logs/' --exclude='nohup.out' --exclude='.env' --exclude='infrastructure/docker/' . pi@daybook-pi:~/daybook/
```

3. Copy the web env:
```bash
scp infrastructure/web/.env.local pi@daybook-pi:~/daybook/infrastructure/web/.env.local
```

4. Ship the prebuilt frontend (`-z --partial` so it resumes if the link hiccups; `--delete` so old build chunks don't pile up and fill the SD card):
```bash
rsync -avz --partial --delete --timeout=120 infrastructure/web/.next/ pi@daybook-pi:~/daybook/infrastructure/web/.next/
```

5. Restart services on the Pi (no build — serves the new `.next` and applies API startup migrations):
```bash
ssh pi@daybook-pi "sudo systemctl restart daybook-api daybook-web"
```

- **No `npm install` / no build on the Pi.** The Pi already has `node_modules` for `next start`. Only when web *dependencies* change, run a one-time `ssh pi@daybook-pi "cd ~/daybook/infrastructure/web && npm install --omit=dev"`.
- If step 4's rsync drops with "connection unexpectedly closed", a stuck build is hogging RAM — clear it: `ssh pi@daybook-pi "pkill -f 'next build'; pkill -f 'npm run build'"`, then re-run step 4. If SSH itself times out, the Pi needs a physical power-cycle (services + Tailscale auto-start on boot).

The user will paste back the output for Claude to review.

**Nightly jobs & status:** every step in `daily_sync.sh` runs through `step <name> <cmd>` — a failing job no longer aborts the rest, and each outcome lands in `daybook.db → job_runs`. `/status` (and a banner on Today when anything is off) shows failing jobs, stale data, roster horizon, backups and disk. New nightly jobs must use `step`.

## Pi is the Source of Truth — Never Restore DB from Mac

The Pi holds the only copy of:
- `days` table mood/energy/notes (entered via phone questionnaire)
- `data/photos/` (uploaded from phone)
- `money.db` transactions (entered manually in Daybook; Notion is no longer used)

The rsync already excludes `*.db` files — DBs are never overwritten by normal deploys.

**Never run a DB dump from Mac → restore on Pi.** If a SQLite version mismatch occurs again, the fix is to upgrade SQLite on the Pi (`sudo apt install sqlite3`), not to restore from Mac. Restoring from Mac loses all Pi-only data (moods, photos, recent transactions).

If a schema migration is needed on Pi, write a migration script and run it on the Pi directly.

## Backups & Disk Space

The Pi's SD card is 15 GB. When it hits 100%, SQLite can't open its WAL files and **every** DB endpoint returns 500 (the browser shows "Failed to fetch" / "Waiting for API..."). First check: `ssh pi@daybook-pi "df -h /"`.

- **Pi** (`backup.sh`, cron 03:30 via `make backup-cron-install`): SQLite online-backup snapshots → `data/backups/`, keeps only 3 per DB, skips if <1.5 GB free.
- **Mac** (`pull_backups.sh`, launchd 10:00 via `make backup-pull-install`): pulls those into `~/Backups/daybook`, keeps the last 30 per DB + the first of every month forever, and sends a macOS notification if the pull fails or the Pi's newest snapshot is >3 days old. Re-run `make backup-pull-install` after editing `pull_backups.sh` (launchd runs an installed copy — it can't read `~/Desktop`).
- `make storage-report` on the Pi: space per table/folder, measured growth/day, and the date the card fills.

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

## UI Style

One style across Daybook: follow `infrastructure/web/DESIGN.md` and build from `components/ui/kit.tsx`
(`Panel`, `Block`, `Hero`, `Stat`/`Stats`, `Chip`, `TabBar`, `Pill`). One hero number per page (`text-4xl`),
stats `text-lg`, grey uppercase section titles, amber as the only accent; no gradients, glows or oversized
cards. Anything naming a day, place, activity or trip links to it.

## Coll (the bike computer)

Coll (`~/Desktop/ciclocomputer`) syncs with Daybook through `/coll/*` (`infrastructure/api/routers/coll.py`,
`domains/coll/`, Omyra → the round Coll badge next to Log; full-page, `/omyra?tab=coll`). Contract: `ciclocomputer/docs/DAYBOOK.md`. `domains/coll/coursepack/` is
vendored from `ciclocomputer/tools/coursepack` — change it there and copy it over (the pack format is shared with
the firmware). Course builds run in their own process (`python -m domains.coll.worker`), never in the API. Device
endpoints need `COLL_TOKEN` in the Pi's `.env` (not synced by deploy — `.env` is excluded). Rides Coll uploads
(`POST /coll/rides`, GPX or `.clg`; `domains/coll/rides.py`, `collog.py` vendored from `ciclocomputer/tools/`) become
`source='coll'` activities; when the watch recorded the same ride, the Garmin activity wins (`reconcile` runs after the
Garmin sync). Coll reports what it holds at the end of each sync (`POST /coll/device`), so the Coll tab shows each route's path: imported → converted → on Coll → ridden. `make coll-device RIDES=…` on the Mac plays the device's sync against the Pi — use it to test end to end.
After a ride, `domains/coll/review.py` compares each ride of a route (Coll's or the watch's, ≥ 70 % on its line) with the
brief as it read that day — sections, climbs, fuel presses from the `.clg` — and `brief.pace` learns from the last 5.
`weather.py` (Open-Meteo, ≤ 16 days) puts the forecast along a dated route at your ETA per km; its one-liner goes to Coll in
`/coll/sync`. Device page: sync log (`coll_sync_log`, every device request), firmware over Wi-Fi (`data/coll-firmware/`,
offered in `/coll/sync`), ride screens (`settings.screens`, same grammar as `firmware/lib/core/screens.h`). Nightly:
`coll_review`, `coll_weather` steps.

## Trips & the travel journal

Trips are detected nightly (`trips`, keyed by dates and rebuilt; a run you split by hand on the trip page stays split —
`trip_splits` holds the first night of each new trip, applied on every rebuild; split/join rebuild only that window) or planned ahead (`planned_trips`: board, day
lines, checklist). The journal (`domains/travel/`, `/travel/*`, proxy `app/api/travel/[...path]`) adds **moments**:
title, a few lines, photos (`data/photos/moments/`, 2048 px + thumbnail). Moments are keyed by **day**, never by
trip id, so the planned trip's Journal tab and the detected trip's page show the same story. Where/when fill
themselves: the photo's EXIF GPS/time, else the Overland point nearest that minute (`place.py`); a moment logged
before Overland uploads is placed on the next read. Dropped photos group into moments (≤ 60 min, ≤ 1.5 km).
`trip_stories` (cover, summary) is keyed by the first day and found by overlap. `components/trip/TripStory.tsx`
renders it; `book.py` renders the same story as a standalone HTML book (inline SVG map, no tiles/scripts) and
the export zip (index.html + photos/ + route.gpx + trip.json) — keep the export dependency-free.

## Bank statements & vehicles (money.db)

Expenses are still typed by hand — that habit is the point. A bank export (CSV / XLSX / XLS; PDF via Claude) is only a
**check**: `domains/money/statements.py` finds the header by column names (ES/EN, signed amount or debit/credit,
Revolut fee/state), stores lines per account in `statement_lines` (fingerprint-deduped, so overlapping exports are
fine) and `reconcile()` matches them to `transactions` **on every read** (same amount ±4 days, then a near amount on a
similar name) → only in bank / amount differs / only in Daybook + the balance gap at both ends. Only hand links
(`txn_id`) and ignores are stored. Page `/money/reconcile` (proxy `app/api/money/statements/[[...path]]`).
Lines carry a `kind` (card, transfer, investment, interest, dividend, cashback, fee, tax — the bank's type column, or Claude for
PDFs, which are read in page chunks in parallel). A Trade Republic PDF has its own reader, `statement_tr.py` (word positions,
no AI, checked against the statement's summary box); Claude is only the fallback for other PDFs. Closing the gap: a line logged on another account → *move it here*; *Add all*
files by kind (investment = Transfer mirrored on the matching investment account, e.g. Trade Republic Cash → Wealth) and the
rest as category `Alert`; *Settle* closes the period (`statement_settlements`): what's still off is booked as an `Alert`
expense or income (`source_id` `bankcheck:<account>:…`, recomputed when the same period is settled again; other months'
stay) and lines/entries up to that date are set aside, not listed. *Reopen* (`unsettle`) undoes the last one.
Vehicle GPS legs are built from consecutive points (Overland stores a drive as one-point segments); bump `routes.READER`
when the leg builder changes so every day is re-read (also on API startup).
Vehicles (`domains/vehicles/`, `/vehicles/*`, `/explore/vehicles` — an Explore sub-tab next to Movement): costs are ordinary Transportation expenses —
`transactions.vehicle_id`, or for history the vehicle's `subcategories`. Routes: GPS legs at vehicle speed
(`vehicle_legs`, read for every tagged day + every day of the last 45) are assigned by your pick
(`vehicle_leg_picks`, 0 = not mine) else the one vehicle whose day tag (`motorcycle` = Scooter ride, `car_drive` =
Car drive) is on the day; untagged / both-tag drives wait in "Who drove this?" (picking on an untagged day tags the
day). The day map's leg popup also lists your vehicles (`GET /vehicles/on/{date}`; a pick with `end` is a stretch —
whatever GPS touches it becomes that vehicle's drive, even if it read as walking). Odometer km between two readings go to the days used (tag or assigned legs), weighted by GPS km.
Reminders (`vehicle_reminders`, `reminders.py`): every N months / N km / a date → one open Plan task each
(daybook.db `tasks`, area `vehicles`); ticking it off in Plan starts the next cycle on sync. Nightly steps
`vehicle_routes`, `vehicle_reminders`.

## Activity days

An activity belongs to the **local** day where it started (Garmin `startTimeLocal`, Strava `start_date_local`),
never the GMT day — `domains/health/activity_dates.py`. `repair()` (API startup + after each Garmin sync) re-dates
stored rows, merges a workout recorded on two Garmin devices into the one from the device you usually use for that
sport (`activity_duplicates` keeps the dropped copy so a resync skips it), re-matches plan sessions on the changed
days (`domains/training/autolink.py`) and recomputes training load from there. Estimated ride power uses a per-ride
bike + luggage weight (`activity_gear`, default 10 kg; set per ride or per trip from the power card).

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
