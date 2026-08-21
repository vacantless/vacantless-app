# CODEX PROMPT — CUT1 one-tap relist: two live-QA fixes (S640)

> Follow-up to PR #15 (merged, on prod fe8d301→b7f2286 with `RELIST_ONE_TAP_ENABLED=true`). Live QA on 50 Glenrose Unit 4 (app.vacantless.com, Abbas Husain org) found two defects. Branch from current `main`, one PR, flag stays as-is. No migration, no server action.

## Context — how the live "Get online" surface actually renders (verified 2026-08-10 via Chrome on prod)
With `PUBLISH_SIMPLE_DEFAULT_ENABLED` + `STEP_CLARITY_LIVE_ENABLED` ON (both GLOBAL in prod), the property "Get online" tab (panel id `tab-distribute`) renders the SIMPLE / step-clarity publish surface. The anchor ids that EXIST in that surface are: `distribute`, `distribute-header`, `for-you-facebook`, `for-you-kijiji` (the `#14` per-channel anchors). **`publish-checklist` is NOT rendered** in this config — it lives in `launch-run-panel.tsx`, which the simple/step-clarity view replaces. The deep-link opener (`section-deeplink-opener.tsx`) resolves the **hash** (on mount AND on `hashchange`) → opens the owning tab → scrolls. The `?tab=<key>` query is NOT read for tab selection.

Verified working end-to-end (cold load AND in-app soft hashchange both switch to "Get online" + scroll): `#for-you-kijiji`, `#for-you-facebook`, `#distribute`. Verified BROKEN: `#publish-checklist` (element absent → opener no-ops → stays on default tab).

## Defect 1 — CTA is invisible (white-on-transparent)
`PRIMARY_ACTION_CLASS` (components/ui.tsx:28) ships **no background by design** — its doc comment says *"pair with the brand bg (style or bg-brand)."* The working "Save changes" button pairs it with `style={{ backgroundColor: "var(--brand-color)" }}` (page.tsx ~L3271). The new Relist CTA (page.tsx ~L2396) applies `PRIMARY_ACTION_CLASS` with **no bg**, so it computes to `background: transparent; color: white` in the white header actions row = unreadable.

### Fix 1
Add `style={{ backgroundColor: "var(--brand-color)" }}` to the Relist CTA `<Link>`. The sibling **"Set Live" / "Set Live again"** button (page.tsx ~L2385-2387) has the SAME latent omission (only shows on a non-live listing, so it was never caught) — fix it in this PR too for consistency.

## Defect 2 — fallback deep-link points at a dead anchor
The CTA and the freshness digest both target `#publish-checklist`, which isn't rendered under the live flags, so the fallback (non-single-channel) case lands nowhere (stays on the default tab; `?tab=distribute` is ignored). The per-channel `#for-you-{key}` path is fine and verified — only the FALLBACK anchor is wrong.

### Fix 2
1. page.tsx: change `RELIST_ONE_TAP_FALLBACK_ANCHOR` from `"publish-checklist"` to **`"distribute"`** (verified this anchor switches to "Get online" + scrolls on both cold load and soft in-app nav). Keep the single-channel `#for-you-{key}` logic unchanged.
2. lib/listing-health.ts:179 (`distributeUrl`): change the appended hash from `#publish-checklist` to **`#distribute`**.
3. scripts/test-listing-health.ts: update the two assertions that check for `#publish-checklist` to `#distribute`.

Keep the `?tab=distribute` query prefix (inert but harmless) OR drop it — your call; the hash is what drives the opener. State which you did.

## Out of scope
No change to the S447 relist-guard routing (leased → `?relist=confirm`), the flag gate, the `#for-you-{key}` selection logic, or honesty invariants.

## Gate
- `npx tsc --noEmit` clean.
- `npx tsx scripts/test-listing-health.ts` green (updated assertions).
- Flag OFF ⇒ byte-identical.
- With flag ON: the Relist CTA renders with a visible brand-colored background; clicking it (single stale/outstanding for-you channel) lands on `#for-you-{key}`, else on `#distribute` — both switch to "Get online" and scroll. Freshness digest link carries `#distribute`.
- `git diff --check` clean. `npm run lint`/`build` via native or Vercel preview.

## Deliver
Branch + PR. Report files touched, whether you kept or dropped `?tab=distribute`, and gate output.
