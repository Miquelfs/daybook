# Claude Code Prompt — PWA Hardening Readiness Audit

> This is a **Phase 0 audit**: analysis and a written report only. No implementation, no dependency installs, no code changes.

---

## PROMPT

You are auditing the Daybook codebase to assess what "PWA hardening" would actually require **given the real code**, before any build decision is made. This is an analysis task. **Do not write, modify, or install anything.** Produce a single design-audit document and nothing else.

### Context to load first
Read these before assessing anything, and base every claim on what's actually in the files — not on assumptions about a typical Next.js setup:
- `docs/NORTH_STAR.md` (esp. "Sequencing & Guardrails" and the Sunday question)
- `docs/DAYBOOK_COMPLETE_CONTEXT.md` (current stack, what's built)
- `infrastructure/web/` — the entire Next.js frontend: `package.json`, `next.config.*`, the pages/app structure, any existing `manifest`, `sw.js`/service-worker, and the data-fetching layer (how it calls the API, where state lives, caching behaviour)
- `infrastructure/api/main.py` — the FastAPI endpoints the frontend depends on
- `scripts/garmin-sync.py` and the crontab/sync orchestration — because any push notification is triggered server-side off this job, not client-side

### What to assess
The goal recommendation under audit is: *harden the existing PWA (proper install, service worker caching, IndexedDB offline queue, Web Push) rather than build a native iOS app.* For each of the four pillars below, report **current state → gap → what's required → dependencies → rough effort (hours/days)**:

1. **Installable PWA** — Is there a valid web app manifest, icons, and is the app genuinely installable to the iOS home screen today, or is it just a bookmark/direct-access shortcut? What's missing.
2. **Service worker caching** — Does one exist? What's the current static-export vs SSR setup (`next.config`)? What caching strategy fits Daybook's mostly-read, date-indexed data, and what breaks offline today.
3. **IndexedDB offline queue** — Identify every write path in the frontend (evening questionnaire, native expense entry, any tag/mood input). For each, what happens today with no connection? What would an offline queue that syncs to the Pi over Tailscale require, and where are the idempotency/conflict risks against the existing API?
4. **Web Push** — Trace where a "poor sleep" or "post-hard-session" alert would originate: which metric, computed where (Garmin sync job?), and what server-side push infrastructure the Pi currently lacks. Note iOS Web Push constraints honestly (home-screen-install requirement, reliability/background limits vs native APNs). Be explicit that native does **not** grant more ownership of the notification — the trigger logic lives on the Pi either way.

### Two diagnostic questions to answer with evidence, not assumption
- **Is the reported sluggishness a caching problem or a Pi-latency problem?** Inspect the data-fetching pattern and payload sizes. Estimate how much is fixable by caching the app shell + data vs. how much is round-trip latency to the Pi over Tailscale (which a native app would *not* fix). State your reasoning.
- **What is the minimum viable hardening** that resolves sluggishness + offline + basic alerts, and what is genuinely native-only (e.g. home-screen widgets, richer push)?

### Constraints
- Analysis only. If you're tempted to write implementation code, stop and describe it instead.
- Where you're inferring rather than confirming from a file, label it `ASSUMPTION:` so it can be verified.
- Keep scope honest: flag anything that looks like it would expand into a native-rewrite-scale effort (the OMYRA failure mode) rather than a bounded PWA improvement.

### Output
Write the findings to `docs/PWA_HARDENING_AUDIT.md` with these sections:
1. **Current PWA state** (one-paragraph verdict: bookmark, partial PWA, or real PWA)
2. **Pillar-by-pillar assessment** (the four above, in the state→gap→required→deps→effort format)
3. **Sluggishness diagnosis** (caching vs latency, with evidence)
4. **Open questions / things I couldn't determine from the code**
5. **Recommended ordering** (smallest-effort, highest-impact first) and an explicit **minimum viable vs. native-only** split
6. **Risks** (scope creep, iOS Web Push reliability, offline sync conflicts)

End by listing the exact files you read so the audit is reproducible. Do not begin any implementation.
