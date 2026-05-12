# Raspberry Pi 3 Migration Guide

**Status: Ready to execute** — Phase 1 complete, Pi has Phase 0 (Docker, Tailscale, Pi-hole, Unbound) already running.

Architecture after migration: iPhone/Mac → Tailscale → Pi (FastAPI :8000 + Next.js :3000 + SQLite) — Mac no longer needs to be on.

---

## Prerequisites

- [x] Phase 1 stable on Mac
- [x] Pi running Pi OS Lite 64-bit (Bookworm) with Docker + Tailscale (Phase 0 complete)
- [x] SSH key-based access to Pi from Mac
- [ ] Pi's Tailscale IP noted: run `ssh pi@daybook-pi.local tailscale ip -4`

---

## Phase A — Prepare Pi (~15 min, one-time)

```bash
ssh pi@daybook-pi.local

# Verify Python 3.11+ (Bookworm ships with it):
python3 --version

# Install Node.js 20+ via NodeSource:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify:
node --version   # expect v20+
npm --version
```

---

## Phase B — Build on Mac, rsync to Pi

```bash
# On Mac — build Next.js first (Pi doesn't have enough RAM for npm run build):
cd /Users/miquelfarre/Desktop/daybook/infrastructure/web
npm run build

# Rsync code (exclude platform-specific and gitignored dirs):
rsync -avz --progress \
  --exclude='.venv' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='data/raw/garmin/' \
  --exclude='data/backups/' \
  /Users/miquelfarre/Desktop/daybook/ \
  pi@daybook-pi.local:~/daybook/

# Copy Garmin tokenstore (avoids re-login on Pi):
rsync -avz \
  /Users/miquelfarre/Desktop/daybook/data/raw/garmin_session/ \
  pi@daybook-pi.local:~/daybook/data/raw/garmin_session/

# Copy databases:
rsync -avz \
  /Users/miquelfarre/Desktop/daybook/infrastructure/db/daybook.db \
  /Users/miquelfarre/Desktop/daybook/infrastructure/db/locations.db \
  /Users/miquelfarre/Desktop/daybook/infrastructure/db/money.db \
  pi@daybook-pi.local:~/daybook/infrastructure/db/
```

---

## Phase C — Bootstrap on Pi

```bash
ssh pi@daybook-pi.local
cd ~/daybook

# Python virtual environment + deps:
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Node deps — fresh ARM64 install (do NOT copy Mac's node_modules):
cd infrastructure/web && npm install --production && cd ../..

# Create .env from example, then edit:
cp .env.example .env
nano .env
# Set these values (replace 100.x.x.x with Pi's actual Tailscale IP):
#   CORS_ORIGINS=http://localhost:3000,http://100.x.x.x:3000
#   NEXT_PUBLIC_API_URL=http://100.x.x.x:8000

# Verify databases arrived intact:
make verify
```

---

## Phase D — systemd services (auto-start on boot)

```bash
sudo cp ~/daybook/infrastructure/systemd/daybook-api.service /etc/systemd/system/
sudo cp ~/daybook/infrastructure/systemd/daybook-web.service /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable daybook-api daybook-web
sudo systemctl start daybook-api daybook-web

# Check status:
sudo systemctl status daybook-api
sudo systemctl status daybook-web

# Smoke test:
curl http://localhost:8000/    # → {"status":"ok"}
curl -I http://localhost:3000/ # → HTTP 200
```

**Log access:**
```bash
journalctl -u daybook-api -f    # API logs
journalctl -u daybook-web -f    # Web logs
```

---

## Phase E — Cron jobs

```bash
crontab -e
# Add:
0 7 * * * cd /home/pi/daybook && ./infrastructure/scripts/daily_sync.sh
0 2 * * * cd /home/pi/daybook && make backup
```

---

## Phase F — Phone access

1. iPhone: open Tailscale and verify it's connected.
2. Safari → `http://100.x.x.x:3000` (Pi's Tailscale IP) → Today view should load.
3. Share → Add to Home Screen → install as PWA.
4. Test: submit questionnaire, add expense, verify Garmin data shows.

---

## Phase G — Ongoing updates (Mac → Pi)

When you change code on the Mac:

```bash
# On Mac: rebuild frontend if any web/ files changed:
cd infrastructure/web && npm run build && cd ../..

# Push to Pi:
rsync -avz --progress \
  --exclude='.venv' --exclude='node_modules' --exclude='.git' \
  --exclude='data/' \
  /Users/miquelfarre/Desktop/daybook/ \
  pi@daybook-pi.local:~/daybook/

# On Pi: restart services:
ssh pi@daybook-pi.local "sudo systemctl restart daybook-api daybook-web"
```

---

## Notes

- **Next.js build on Mac**: Pi 3 has 1 GB RAM; `npm run build` needs ~512 MB. Always build on Mac and copy `.next/`.
- **SQLite WAL mode**: already enabled in `connection.py` — concurrent reads during sync are safe.
- **Raw garmin payloads** (`data/raw/garmin/`): 38 MB of JSON, excluded from rsync to save time. If Pi runs out of space these can stay on Mac or go to an external drive + symlink.
- **Updating databases**: for large data migrations, copy the `.db` files manually. For daily data, systemd + cron handles it automatically.
- **Static export fallback**: if Pi 3 struggles with Next.js SSR, run `npm run build && npm run export` on Mac, copy `out/` to Pi, and serve with `python3 -m http.server 3000`. FastAPI stays the same.
