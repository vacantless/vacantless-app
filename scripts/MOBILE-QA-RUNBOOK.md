# Mobile QA screenshot lane — ESL nav-audit acceptance gate (S605)

**Purpose.** Capture pixel-perfect screenshots of dashboard routes at the two ESL/older-operator
acceptance breakpoints — **390×844** and **430×932** (iPhone, DPR 3) — so Slice 9 redesigns and any
responsive change can be verified before ship.

**Why the old approach failed (S604).** Resizing the desktop Chrome window below its OS minimum does
**not** shrink the rendered viewport — `window.innerWidth` stays ~1920, so the mobile CSS breakpoints
never fire and the shots are just a narrow desktop. Headless Chromium emulates an exact viewport with
no min-width floor, so it produces true mobile-layout renders: 390×844@3x → **1170×2532 px**,
430×932@3x → **1290×2796 px**. Verified S605 against a control page (3-col grid collapses to 1 col;
`@media (max-width:480px)` fires). The harness lives at `scripts/mobile-qa-shots.mjs`.

## One-time setup (dev-only; NOT added to package.json deps)
```
npm i -D playwright            # dev dependency only — QA tool, never bundled to prod
npx playwright install chromium
```

## Capturing an authenticated session (once, or when it expires)
Dashboard routes require login. Save a Playwright storage state from a real login:
```
npx playwright open --save-storage=vacantless-session.json http://localhost:3000/login
# log in in the window that opens, then close it
```
`vacantless-session.json` holds the logged-in cookies/localStorage. Keep it out of git (add to
`.gitignore`); it is a live session token.

## Run
```
npm run dev                                   # serve http://localhost:3000
BASE_URL=http://localhost:3000 \
STORAGE_STATE=./vacantless-session.json \
  node scripts/mobile-qa-shots.mjs
```
Outputs `mobile-qa-shots/<route-slug>__390x844.png` and `__430x932.png` for the 7 default ESL daily
surfaces (Today, Rentals, Renters, Viewings, Repairs, Money, Settings), plus a JSON summary listing
each route's HTTP status and observed `innerWidth` (expect 390 / 430 — the acceptance proof).

## Options
- `ROUTES=/dashboard/maintenance,/dashboard/showings` — restrict to the slice under review.
- `OUT_DIR=./shots-slice9-repairs` — separate before/after folders for a diff.
- `CHROMIUM_PATH=...` — use a specific Chromium binary instead of Playwright's bundled one.
- `PW_PROXY=http://host:port` — only if the run host needs a proxy to reach `BASE_URL`.

## Notes / boundaries
- **Runs where the app is reachable.** Point `BASE_URL` at a local `npm run dev` (recommended — no
  prod network needed) or at any host that can reach the deployed app. The Cowork **cloud** sandbox
  cannot reach `app.vacantless.com` (network allowlist), so run this **locally** (Mac) or in CI.
- Acceptance gate for a Slice 9 redesign = both breakpoints render the new layout with no clipped
  content, no horizontal scroll, and tap targets ≥ 44px. Attach the PNGs to the slice's Codex prompt.
