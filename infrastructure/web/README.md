# Daybook Web

Next.js 16 frontend for the Daybook personal life OS.

## Running in development

The API backend must be running first:
```bash
# From daybook/ root
bash infrastructure/api/run.sh
# → http://localhost:8000
```

Then start the frontend:
```bash
cd infrastructure/web
npm run dev
# → http://localhost:3000
```

## Build

```bash
npm run build
npm start
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Daybook API base URL |

Set in `.env.local` for local overrides (gitignored).

## Routes

| Route | Description |
|---|---|
| `/` | Today — morning brief, movement, questionnaire |
| `/day/[date]` | Any day detail (YYYY-MM-DD) |
| `/timeline` | Scrollable list of all days |

## Stack

- **Next.js 16** — App Router, server components for data fetching
- **TypeScript** — strict mode
- **Tailwind CSS** — dark zinc palette, amber accent
- **TanStack Query** — client-side API caching and mutation
- **date-fns** — date formatting
- **lucide-react** — icons

## PWA (Phase 3)

PWA manifest and service worker will be added in Phase 3 for phone install via Tailscale. When ready:
1. Add `next-pwa` or a custom service worker in `public/sw.js`
2. Add `manifest.json` to `public/`
3. Configure Tailscale for remote access
