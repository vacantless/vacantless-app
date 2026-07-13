# CODEX QA HANDOFF — S482 Browser Co-Pilot Transport (first-class distribution)

**Range:** Noam supplies the S482 commit range when running Codex (the co-pilot
commit only; the S480b channel-setup Settings slice is a SEPARATE prior commit —
do NOT re-review it here, and do NOT reopen S475–S481, all Codex-CLOSED).

## What shipped
The honest **`browser_copilot`** transport from the S480 capability matrix.
Vacantless CANNOT post to Facebook / Kijiji / Viewit for the operator — no
supported long-term-rental posting API and their ToS forbid silent automation —
so it acts as a **co-pilot**: prepares channel-fit copy + the tracked inquiry
link, hands the operator a step-by-step script, and STOPS at every human gate
(login / payment / CAPTCHA / final review). The operator posts the ad themselves,
then pastes the **live ad URL as proof**; only then does the channel go live.

**No migration.** Rides entirely on the S480 substrate (0141) + existing
listing_posts attribution. No credentials are collected or stored.

## Files
- `lib/distribution-copilot.ts` (NEW, pure) — `buildCopilotScript()` composes the
  guided script (channel-fit copy via `buildListingCopy`, tracked link, ordered
  steps, stop-gates, honesty notes); returns `null` for any non-`browser_copilot`
  channel (automatic / feed_partner / broker / custom). `isCopilotChannel()`,
  `canMarkCopilotLive()` (the pure "never live without a real URL" guard),
  `stopGateLabel/Note`. No DOM/env/IO.
- `scripts/test-distribution-copilot.ts` (NEW) — **57/0**.
- `app/dashboard/properties/distribution-actions.ts` — adds `completeCopilotPost`.
- `app/dashboard/properties/[id]/copilot-panel.tsx` (NEW, client) — the guided UI
  (copy buttons, stop-gate callouts, portal link, completion form).
- `app/dashboard/properties/[id]/page.tsx` — computes `copilotScript` per
  copilot run item from in-scope listing facts + `linkIsLive` + tracked link.
- `app/dashboard/properties/[id]/launch-run-panel.tsx` — renders `<CopilotPanel>`
  for copilot items (hides the flat step list for them). NOTE: this file also
  carries the S480b "Channel setup" header hunks, which belong to the SEPARATE
  S480b commit; only the co-pilot body/type hunks are S482.

## Highest-value review areas
1. **`completeCopilotPost` authZ + org stamping (KI748/KI744).** `requireCapability("manage_properties")`; the run item + run are read under RLS; property + org come from the RUN, never the client; proof/attempt/listing_posts org is stamped from the RESOURCE's own org (`run_item.organization_id`, fallback `run.organization_id`), never `getCurrentOrg()`. Confirm no client-supplied id is trusted.
2. **Never live without proof.** `canMarkCopilotLive(url)` = `isWebUrl(url)`; a missing/invalid URL redirects back (`copilot_needsurl`) with NO state change. The completion form marks the URL required. Confirm there is no path to `publish_status='live'` / a live `listing_posts` row without a real web URL.
3. **Reserve/record-first, terminal-flip-last (S479 model).** Order in `completeCopilotPost`: (1) `recordVerificationAndAttempt` writes the durable `distribution_verifications` (external_url / verified_live) + append-only `distribution_publish_attempts` (actor `browser_copilot`) and the verification pointers; (2) create/refresh the tracked `listing_posts` row; (3) terminal flip of the run item to live/done LAST; then the run-completion check. Confirm the ordering + that a failure mid-way can't leave "live" without proof.
4. **listing_posts reuse (no duplicate).** Same "reuse the most-recent non-removed post for this property+portal, else insert" logic as `updateRunItem`; portal via `normalizePortal(channel)` gated by `isPortalKey` + `validateListingPost({status:'live', url})`. For a non-portal copilot channel there is none today (all copilot channels are portals).
5. **Honesty invariants.** `buildCopilotScript` returns `null` for automatic/feed/broker/custom (only fb/kijiji/viewit get a script). Stop-gates derived from capability (`requiresLogin` → login, `requiresPayment` → payment; captcha + final_review always). No credentials are ever collected or persisted. The UI never auto-submits the portal.
6. **Attribution caveat (known, matches concierge).** The tracked `?p=` link is created at MARK-LIVE (the `listing_posts` row is created in `completeCopilotPost`). Pre-post, the co-pilot embeds the plain public `/r/[id]` URL; per-channel `?p=` attribution starts at go-live. Field hint says as much. Not a bug — the documented S474 limitation.

## Gates (on-device, Cowork)
- `tsc --noEmit -p tsconfig.json` — clean (full project).
- `next lint` on the four changed/new co-pilot files — clean.
- Distribution suites (esbuild→node): copilot **57/0**, publish 36/0, run 44/0,
  accounts 40/0, verification 23/0.
- `next build` — NOT runnable on device; the DEPLOY script runs it on the Mac
  before commit (authoritative gate).

## Live QA plan (North Star Rentals QA, like S481)
On a bookable property with the public page live: start a Publish run including
Kijiji → the run item shows the "Guided posting (co-pilot)" panel → copy the
title/body/link → the login/final-review steps render as amber "you do this"
stop-gates → paste a live URL + mark live → confirm: run item `publish_status`
live, a `distribution_verifications` row (external_url/verified_live, actor
browser_copilot), a tracked `listing_posts` row, the verification chip = Verified
live, and the proof link renders. Then confirm marking live with an EMPTY URL is
refused (no state change). Viewit adds a payment stop-gate; automatic/feed/broker
channels show NO co-pilot panel.
