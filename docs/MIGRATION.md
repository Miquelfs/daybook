# Raspberry Pi 3 Migration Guide

**Status: TODO — placeholder. Complete after Phase 1 is used daily for two weeks.**

This document will track the steps to migrate Daybook from Mac (development + production) to a Raspberry Pi 3 as a permanently-on home server accessible via Tailscale.

---

## Prerequisites (before starting)

- [ ] Phase 1 is stable and used daily for at least two weeks
- [ ] Raspberry Pi 3 running Raspberry Pi OS Lite (64-bit if possible, else 32-bit ARMv7)
- [ ] Pi is on home LAN, has a static IP or mDNS hostname
- [ ] Tailscale installed on both Pi and phone
- [ ] SSH key-based access to Pi from Mac

---

## Migration checklist

### 1. Prepare the Pi

- [ ] `sudo apt update && sudo apt upgrade -y`
- [ ] Install Python 3.11+ (`deadsnakes` PPA or compile from source if needed)
- [ ] Install Node.js 20+ (via `nvm` or NodeSource repo)
- [ ] Install Docker + Docker Compose (for future containerisation)
- [ ] Install Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh`

### 2. Copy the data

- [ ] `rsync -avz daybook/ pi@raspberrypi.local:~/daybook/` (exclude `.venv`, `node_modules`, `.next`)
- [ ] Verify `infrastructure/db/daybook.db` and `locations.db` arrived intact
- [ ] Verify `data/raw/garmin/` raw payloads arrived

### 3. Re-bootstrap on Pi

- [ ] `make setup` — creates venv, installs Python deps, installs npm deps
- [ ] `make db-init` — verifies schema is intact
- [ ] `make verify` — confirms row counts match Mac

### 4. Configure Garmin sync

- [ ] Copy `data/raw/garmin_session/` tokenstore to Pi
- [ ] Test: `make sync-garmin`
- [ ] Add crontab entry on Pi: `0 7 * * * cd ~/daybook && ./infrastructure/scripts/daily_sync.sh`

### 5. Configure servers as services

- [ ] Create `systemd` unit for FastAPI (`infrastructure/docker/daybook-api.service`)
- [ ] Create `systemd` unit for Next.js (`infrastructure/docker/daybook-web.service`)
- [ ] OR write a `docker-compose.yml` in `infrastructure/docker/` and run via Docker

### 6. Tailscale remote access

- [ ] Confirm Pi appears in Tailscale admin at `https://login.tailscale.com/admin/machines`
- [ ] On phone: install Tailscale, add to same network
- [ ] Set `NEXT_PUBLIC_API_URL` to `http://<tailscale-ip>:8000` in `.env.local`
- [ ] Access `http://<tailscale-ip>:3000` from phone browser
- [ ] Test PWA install (Phase 3)

### 7. Backup

- [ ] Configure `make backup` cron on Pi: `0 2 * * * cd ~/daybook && make backup`
- [ ] Test restore from backup

---

## Notes

- The Pi 3 has 1 GB RAM. Next.js `npm run build` requires ~512 MB — build on Mac and copy `.next/` to Pi, or use `npm run start` after building.
- SQLite WAL mode is already enabled in `connection.py`.
- If the Pi 3 is too slow for Next.js SSR, consider serving a static export (`next export`) and running only the FastAPI backend on Pi.
- All raw payloads are in `data/raw/` — if the Pi runs out of space, move them to an external drive and symlink.

---

## References

- Tailscale docs: https://tailscale.com/kb/
- Raspberry Pi headless setup: https://www.raspberrypi.com/documentation/computers/configuration.html
- systemd service files: https://www.freedesktop.org/software/systemd/man/systemd.service.html
