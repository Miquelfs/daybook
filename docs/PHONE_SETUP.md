# Phone Setup Guide

How to use Daybook on your iPhone — checking health data, filling the questionnaire, adding expenses, viewing the heatmap — as a full first-class experience without App Store or native code.

---

## The approach: Tailscale + PWA

Daybook runs on your Mac. Your phone connects to it over **Tailscale** — an encrypted peer-to-peer VPN that makes your Mac reachable from your phone no matter where you are (on the plane, abroad, in a café), as long as both devices are online.

The web app is then added to your iPhone home screen as a **PWA** (Progressive Web App), which gives it a native-app feel: full-screen, no browser chrome, its own icon.

There are no subscriptions, no cloud servers, no App Store review.

```
iPhone  ──[Tailscale VPN]──  Mac (always-on or just running)
                              └── FastAPI :8000
                              └── Next.js :3000
```

---

## Step 1: Install Tailscale on both devices

### On your Mac

```bash
brew install tailscale
sudo tailscale up
```

Or download the Mac app from [tailscale.com/download](https://tailscale.com/download). Sign in with Google or GitHub — create a free account if you don't have one.

### On your iPhone

Download **Tailscale** from the App Store (free). Open it, sign in with the same account. Grant VPN permission when prompted.

### Verify the connection

On your Mac, run:

```bash
tailscale ip -4
```

This gives you your Mac's Tailscale IP, e.g. `100.x.x.x`. On your iPhone, open Safari and navigate to `http://100.x.x.x:3000` — you should see Daybook's Today view.

---

## Step 2: Make the Mac accessible over Tailscale

The Next.js dev server already binds to all interfaces (`0.0.0.0:3000`) when started with `make dev`. The FastAPI server similarly binds to `0.0.0.0:8000`.

The Next.js app needs to know the API URL from the phone's perspective. Create (or update) `infrastructure/web/.env.local`:

```bash
# Replace 100.x.x.x with your Mac's actual Tailscale IP from `tailscale ip -4`
NEXT_PUBLIC_API_URL=http://100.x.x.x:8000
```

Restart `make dev` after changing this.

> **Note:** The `100.x.x.x` Tailscale IP is stable — it doesn't change when you switch networks or reboot, so you only need to set this once.

---

## Step 3: Add Daybook to your iPhone home screen

1. On your iPhone, open **Safari** (must be Safari for PWA install on iOS)
2. Navigate to `http://100.x.x.x:3000`
3. Tap the **Share** button (the box with an arrow)
4. Scroll down and tap **Add to Home Screen**
5. Name it **Daybook** → tap **Add**

A Daybook icon now appears on your home screen. Tap it — it opens full-screen with no browser chrome, behaving like a native app.

---

## Step 4: Keep the Mac running (or start servers quickly)

Tailscale works for as long as your Mac is on. Options:

### Option A: Manual (simplest)
Run `make dev` when you want to use Daybook on your phone. Stop it when done.

### Option B: Auto-start on login (recommended for daily use)
Create a Launch Agent so servers start automatically when your Mac wakes or you log in:

```bash
# Create the plist file
cat > ~/Library/LaunchAgents/com.daybook.dev.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.daybook.dev</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>cd /Users/miquelfarre/Desktop/daybook && make dev >> /tmp/daybook.log 2>&1</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/daybook.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/daybook-error.log</string>
</dict>
</plist>
EOF

# Load it
launchctl load ~/Library/LaunchAgents/com.daybook.dev.plist
```

To stop: `launchctl unload ~/Library/LaunchAgents/com.daybook.dev.plist`  
To check logs: `tail -f /tmp/daybook.log`

### Option C: Raspberry Pi (future — Phase 4)
See `docs/MIGRATION.md` for the Pi migration plan. Once on a Pi, the server runs 24/7 with zero Mac dependency.

---

## Step 5: Configure Overland for live location (optional)

Overland is a free iOS app that sends your live GPS location to Daybook in the background. This powers the day-view map and heatmap in real time.

1. Download **Overland** from the App Store (free, open source)
2. Open Settings in Overland:
   - **URL**: `http://100.x.x.x:8000/locations/ingest/overland`
   - **Token**: `milolikesbirds` (or whatever is in your `.env` `OVERLAND_TOKEN`)
3. Enable **Background Location** in iOS Settings → Privacy → Location Services → Overland → Always

Overland will batch-send your location every few minutes. Each batch is processed into GPS tracks and appears on your day map.

---

## What works on the phone

| Feature | Works offline? | Notes |
|---------|---------------|-------|
| View today's health data | ❌ | Needs Tailscale connection to Mac |
| Fill evening questionnaire | ❌ | Needs connection (auto-saves on blur) |
| Add an expense | ❌ | Needs connection; appears instantly on save |
| View /money budget page | ❌ | Needs connection |
| View day maps | ❌ | Needs connection |
| View heatmap (/explore) | ❌ | Needs connection |
| Browse timeline | ❌ | Needs connection |

Everything requires the Mac to be running. This is intentional — Daybook is a local-first system, not a cloud service. The phone is a thin client to your own server.

> **Future (Phase 3):** Add offline expense queueing — expenses entered while offline are stored in `localStorage` and synced when reconnected. This is the highest-value offline feature since it's the most time-critical.

---

## Expense entry flow on the phone (the 8-second path)

1. Open Daybook from home screen → Today view
2. Scroll down to **Money** section
3. Tap **+ Add** (top right of the Money section)
4. Bottom sheet slides up:
   - Type amount on numeric keyboard (e.g. `12.50`)
   - Tap **Next →**
   - Tap the category pill (e.g. 🍴 Restaurant)
   - Type merchant name — autocomplete suggests from your history
   - Tap **Save expense**
5. Sheet closes. Expense appears in today's list immediately.

Total: ~8 seconds once practiced. Category defaults to last used. Merchant autocomplete kicks in after 1 character.

---

## Finance reports on the phone

Navigate to the **Money** tab (Wallet icon in the day header nav):

- **Overview cards**: Spent this month / Budget / Remaining
- **Velocity bars**: % of time elapsed vs % of budget spent (side-by-side visual)
- **Category breakdown**: each category with a colored progress bar
  - Blue = on pace or under
  - Amber = slightly over pace
  - Red = over budget
- **Recent transactions**: last 30, with emoji + merchant name + date + amount

---

## Troubleshooting

**"Can't connect from phone"**
- Check `tailscale status` on your Mac — is the phone listed?
- Make sure `make dev` is running on the Mac
- Confirm the IP in `.env.local` matches `tailscale ip -4`

**"Today view loads but shows no data"**
- The API is reachable but Garmin hasn't synced today yet
- Run `make sync-garmin` on the Mac, then refresh

**"Add expense works but disappears after refresh"**
- The expense was saved locally but the query cache refreshed — shouldn't happen with TanStack Query invalidation. Restart `make dev` and try again.

**"Overland location data not appearing on the map"**
- Check the Overland app → tap the dot count to see recent sends
- Test the endpoint: `curl -X POST http://100.x.x.x:8000/locations/ingest/overland -H "Authorization: Bearer milolikesbirds" -H "Content-Type: application/json" -d '{"locations":[]}'` — should return `{"result":"ok","saved":0,"skipped":0}`

---

## Security note

Tailscale connections are end-to-end encrypted. Your Mac's Tailscale IP is only reachable by devices logged into your Tailscale account — it's not accessible from the open internet. No firewall changes or port forwarding needed.

The `OVERLAND_TOKEN` provides basic auth for the ingest endpoint. This is sufficient for a personal, Tailscale-only deployment.
