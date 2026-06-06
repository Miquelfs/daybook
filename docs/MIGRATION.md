# Raspberry Pi Deployment Guide

**Status: ✅ LIVE** — Pi is the production server as of 2026-05-15.

Architecture: Mac (dev) → `make deploy` → Pi (FastAPI :8000 + Next.js :3000 + SQLite) ← iPhone/Mac via Tailscale

- Pi Tailscale IP: `100.67.252.76`
- App URL: `http://100.67.252.76:3000`
- API URL: `http://100.67.252.76:8000`

---

## Daily operations

### Check service status
```bash
sudo systemctl status daybook-api daybook-web --no-pager
```

### View live logs
```bash
journalctl -u daybook-api -f    # API logs
journalctl -u daybook-web -f    # Web logs
```

### Restart services (after config change)
```bash
sudo systemctl restart daybook-api daybook-web
```

### Check cron is running
```bash
crontab -l
# Should show:
# 0 * * * *  cd ~/daybook && ./infrastructure/scripts/daily_sync.sh ...
# 0 2 * * *  cd ~/daybook && make backup
```

### Manual sync
```bash
cd ~/daybook
.venv/bin/python -m domains.health.garmin.garmin_sync   # Garmin
.venv/bin/python -m domains.money.notion_sync            # Notion
```

---

## Deploying code changes (from Mac)

```bash
make deploy
```

This runs: rsync → `npm install` → `npm run build` → `sudo systemctl restart daybook-api daybook-web`

### rsync safety — what is excluded
The following Pi-only state is never overwritten:
- `.env` — Pi credentials (Notion token, Garmin password, CORS origins)
- `infrastructure/db/*.db-wal` / `*.db-shm` — SQLite WAL files
- `infrastructure/scripts/logs/` — cron log files
- `nohup.out`

### After Python-only changes (no rebuild needed)
```bash
# Just rsync + restart API — skip the frontend build
rsync -av --exclude='.git' --exclude='.venv' --exclude='node_modules' \
  --exclude='infrastructure/db/*.db' --exclude='.env' \
  /Users/miquelfarre/Desktop/daybook/ pi@daybook-pi:~/daybook/
ssh pi@daybook-pi "sudo systemctl restart daybook-api"
```

---

## Pi environment

### `.env` on Pi — required keys
```
GARMIN_EMAIL=...
GARMIN_PASSWORD=...
NOTION_TOKEN=...
NOTION_DATABASE_ID=...
OVERLAND_TOKEN=...
TZ=Europe/Madrid
CORS_ORIGINS=http://localhost:3000,http://100.67.252.76:3000
```

### `.env.local` on Pi — frontend build vars
```
NEXT_PUBLIC_API_URL=http://100.67.252.76:8000
API_INTERNAL_URL=http://localhost:8000
```

**Critical:** `NEXT_PUBLIC_API_URL` must be the Pi's Tailscale IP. It is baked into the Next.js bundle at build time. The browser accesses the app via this URL, so the origin must match for client-side API calls to work (CORS).

**Access the app consistently from `http://100.67.252.76:3000`** — accessing from a different URL (e.g. `192.168.1.20:3000` or `daybook-pi:3000`) will cause client-side fetches to fail because the browser-side URL won't match `NEXT_PUBLIC_API_URL`.

---

## Systemd services

Installed at `/etc/systemd/system/daybook-api.service` and `daybook-web.service`.

Both services:
- Start automatically on boot (`enabled`)
- Restart on crash (`Restart=on-failure`, `RestartSec=5`)
- Load `.env` as environment file
- Run as user `pi` from `~/daybook`

Passwordless sudo for restarts: `/etc/sudoers.d/daybook`

---

## First-time Pi setup (for reference / disaster recovery)

### A — Prepare Pi
```bash
ssh pi@daybook-pi

# Verify Python 3.11+:
python3 --version

# Install Node.js 20+:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### B — Rsync code + databases from Mac
```bash
# From Mac:
rsync -av --exclude='.venv' --exclude='node_modules' --exclude='.git' \
  --exclude='data/' --exclude='infrastructure/db/*.db' \
  /Users/miquelfarre/Desktop/daybook/ pi@daybook-pi:~/daybook/

# Copy databases manually:
scp infrastructure/db/daybook.db pi@daybook-pi:~/daybook/infrastructure/db/
scp infrastructure/db/locations.db pi@daybook-pi:~/daybook/infrastructure/db/
scp infrastructure/db/money.db pi@daybook-pi:~/daybook/infrastructure/db/

# Copy Garmin tokenstore:
rsync -av data/raw/garmin_session/ pi@daybook-pi:~/daybook/data/raw/garmin_session/
```

### C — Bootstrap on Pi
```bash
ssh pi@daybook-pi
cd ~/daybook

python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Create .env with all required keys (see above)
cp .env.example .env
nano .env

# Build frontend (Pi has enough RAM for Next.js 16 build):
cd infrastructure/web
npm install
cp /path/to/.env.local .env.local   # with correct Tailscale IP
npm run build
cd ../..
```

### D — Install systemd services
```bash
sudo cp ~/daybook/infrastructure/systemd/daybook-api.service /etc/systemd/system/
sudo cp ~/daybook/infrastructure/systemd/daybook-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable daybook-api daybook-web
sudo systemctl start daybook-api daybook-web

# Verify:
curl http://localhost:8000/    # → {"status":"ok"}
curl -I http://localhost:3000/ # → HTTP 200
```

### E — Install passwordless sudo for deploy
```bash
echo 'pi ALL=(ALL) NOPASSWD: /bin/systemctl restart daybook-api, /bin/systemctl restart daybook-web, /bin/systemctl restart daybook-api daybook-web, /bin/systemctl restart daybook-web daybook-api' | sudo tee /etc/sudoers.d/daybook
```

### F — Install cron
```bash
make cron-install
# Installs: 0 * * * * (hourly Garmin + Overland + Notion sync)
# Also add daily backup manually:
(crontab -l; echo "0 2 * * * cd ~/daybook && make backup") | crontab -
```

### G — Phone access
1. Open Tailscale on iPhone — verify connected
2. Safari → `http://100.67.252.76:3000` → app loads
3. Share → Add to Home Screen → PWA installed
4. See `docs/PHONE_SETUP.md` for full setup

---

## Known constraints

- **Build on Pi**: Pi 4 (4 GB RAM) can run `npm run build` fine. Pi 3 (1 GB) may need to build on Mac and scp `.next/` to Pi.
- **SQLite WAL mode**: enabled — concurrent reads during sync are safe, no locking issues.
- **Raw Garmin payloads** (`data/raw/garmin/`): ~38 MB JSON, excluded from rsync. Stays on Mac.
- **Geocoding**: background job (`make geocode-tracks`) is ~8% complete. Run overnight: `caffeinate -i make geocode-tracks`.
