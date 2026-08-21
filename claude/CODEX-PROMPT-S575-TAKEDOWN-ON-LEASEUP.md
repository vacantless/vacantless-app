# CODEX PROMPT - Lease-up ad lifecycle: repoint-or-take-down (v1, DARK)

**Status: DISPATCH-READY. Authored s574 (2026-07-26); the three policy decisions were confirmed by Noam s574 (see "Resolved decisions"). Hand to Codex ONLY when it is idle. Land in `vacantless-app/claude/` so Codex finds it.**
**Standing constraints (do not violate): land app changes NATIVELY on the Mac (Noam pushes; bridge git push = 403); the worker is NOT git - device_commit_files IS the apply; build dark behind a flag; prove a side-effectful action by the OBJECT'S OWN status row, never a success response (rule 16); tsc clean; every pure-logic change ships a unit test.**

## Context
The syndication chain is publish -> record -> watch -> capture -> **close out on lease-up**. Everything up to capture is live; the lease-up step is missing. Today a unit that goes `leased` keeps its ads up and the tracked `/r/<id>?p=<post>` link dead-ends at "not available" (`resolveTrackedLink` -> `page_not_bookable`), so a leased unit's ad produces DEAD clicks. But an inquiry on a just-leased unit is not automatically waste - it can be steered to a pooled open unit or captured to the waiting list (which then re-notifies the renter when any matching unit opens). So the goal is NOT "delete the ad" - it is to keep the ad working as demand capture and only hard-remove it when marketing is genuinely done.

## Policy ladder (RESOLVED - see bottom)
On `property.status -> leased`, for each LIVE `listing_posts` row of that property, decide in this order:
1. **PAID ad** (paid Kijiji, any paid placement) -> `skip_paid`: never auto-pull; let it expire, cross-attribute after lease (`feedback_paid_ad_lifecycle_policy`).
2. **Org has another `available` unit of a compatible type** (the pool case, `feedback_lead_ad_pool_steering`) -> `steer_to_pool`: KEEP the ad up. v1 does NOT rewrite the ad link; the `/r` page surfaces the open sibling(s) + waitlist (see decision 2). Log the outcome.
3. **No open sibling, waitlist enabled for the org** (DEFAULT) -> `repoint_to_waitlist`: keep the ad up but the `/r` page shows a "join the waiting list" CTA instead of a dead "not available". The existing `matchesVacancy` loop re-notifies that renter when any matching unit opens. This turns a leased-unit ad into demand capture.
4. **Marketing done / org has waitlist turned OFF** -> `takedown`: flip `listing_posts.status='removed'`; for `facebook_feed` do the Graph delete + 404-confirm (rule 16); for browser channels raise an operator take-down task.
Attribution ALWAYS survives: never delete a `listing_posts` row or its `id`; a late lead still attributes via `submit_public_lead`.

## Reuse map (READ THESE FIRST - do not invent shapes)
- `vacantless-app/lib/waitlist.ts` - the waitlist is BUILT (S457): public join form, operator manage surface, and `matchesVacancy()/matchingEntries()` that re-notify waiters when a property becomes `available` (org-wide entries with `property_id=null` are supported - exactly the pool/lease-up case). `repoint_to_waitlist` REUSES this; do not build a new capture. Entry statuses: active/converted/removed.
- `vacantless-app/app/r/[propertyId]/page.tsx` - the tracked renter page. VERIFY whether it already renders a waitlist join CTA when the property is not `available`; if yes, `repoint_to_waitlist` is just "keep the ad up" (the link already lands on the waitlist form). If no, add the not-available -> (open-siblings list + waitlist-CTA) mode here, reusing the existing public join form.
- `vacantless-worker/src/tracker.ts` - `markPublishedLive()` is the write-for-write model. Add a sibling `markTakenDown()` ONLY for the `takedown` branch: flip `listing_posts.status='removed'` (that status exists - `reserveTracker` filters it), write a `distribution_verifications` row (`verification_type='external_url'`, add `result='removed'`, `metadata.source='vacantless_worker'` + proof), resolve the run item to a terminal state, same `WORKER_CLAIM_ID` guard. Channel keys + `isTrackablePortal` + `STALE_DAYS` live here.
- `vacantless-worker/src/record-live.ts` - the claim/CAS/read-first shape for a worker command acting on one run item by env id. The take-down command mirrors it.
- `vacantless-worker/src/facebook-graph.ts` + `phase-b-submit-facebook.ts` - Graph client + where the FB post id/permalink is persisted. FB take-down = `DELETE /{post-id}` then `GET /{post-id}` must 404 before `markTakenDown` (rule 16). LOCATE the stored FB post id (verification metadata `external_listing_id` and/or the item); do not guess.
- App trigger point: where `properties.status` flips to `leased` (CONFIRM by reading `lib/rental-lifecycle.ts` + `lib/listing-state.ts`). On that transition, run the decision ladder and ENQUEUE any `takedown` work the SAME way publish work is enqueued (`distribution_runs`/`distribution_run_items`); `repoint_to_waitlist` + `steer_to_pool` need no worker run (they are app-side link/page state).
- `lib/notifications.ts` - register the operator take-down task as a `NotificationEvent` (audience operator, sendMode notify), like the compliance landlord items. No hand-written email.

## v1 build scope
1. Pure `src/leaseup-decision.ts` (worker) + a mirror in app if the app needs it - NO I/O - unit-tested (`scripts/test-leaseup-decision.ts`): inputs (property status, channel, is_paid, sibling_available_count, waitlist_enabled) -> `{ action: 'skip_paid'|'steer_to_pool'|'repoint_to_waitlist'|'takedown', reason }`. Test every branch.
2. App: the `/r` not-available -> (open-siblings + waitlist CTA) mode (if not already present), reusing the join form + waitlist.ts.
3. Worker: `markTakenDown()` + a `takedown:leaseup` command (mirrors record-live) for the `takedown` branch only; FB Graph delete + 404-confirm; browser channels -> operator task.
4. App-side enqueue on the leased transition (dark).
5. Dark behind a new `LEASEUP_TAKEDOWN_ENABLED` flag (default off) AND per-channel `automation_authorized` - both true for any real delete. `repoint_to_waitlist`/`steer_to_pool` ride the org's existing waitlist-enabled setting.

## Gates / definition of done
- Dark: no delete unless `LEASEUP_TAKEDOWN_ENABLED=true` AND channel `automation_authorized`. The hard-`takedown` branch fires ONLY when the org's waitlist is OFF (otherwise `repoint_to_waitlist`), so an irreversible delete is never the silent default.
- Rule 16: an FB post is `removed` ONLY after `GET /{post-id}` 404s; a 200 DELETE is a claim, not proof.
- Attribution preserved: `listing_posts` flipped to `removed`, never deleted; the tracked link keeps resolving.
- Waitlist path: a leased unit's `/r` link lands on a working waitlist join; a submission creates an `active` waitlist entry that `matchesVacancy` will later notify. Prove with an actual join.
- `tsc` clean; decision unit test green (all 4 branches); worker tsc on-device.
- Sandbox proof (Growth Test 8ea1da48, rule 24 - seed org == worker `.env` TARGET_ORG_ID): (a) leased + no sibling + waitlist on -> `/r` shows waitlist CTA, a test join lands an active entry; (b) leased + sibling available -> `steer_to_pool`, ad kept, `/r` surfaces the sibling; (c) leased + waitlist off -> `takedown`: FB post 404s, `listing_posts.status='removed'`, a `distribution_verifications result='removed'` row; (d) paid ad -> `skip_paid`, untouched.

## Out of scope (v1)
- Headless browser take-down for rentals.ca / zumper / kijiji (operator task instead).
- Active per-sibling link rewrite for `steer_to_pool` (v1 keeps the ad + lets `/r` surface options; link-repoint is v2).
- Take-down of human-posted (record-live) ads with no worker session/token (operator task).

## Resolved decisions (Noam, s574 - do not re-litigate)
1. `repoint_to_waitlist` IS the default for a leased unit with no open sibling (vs hard take-down). Hard take-down is the explicit "waitlist off / done marketing" case only.
2. `steer_to_pool` in v1 KEEPS the ad + the `/r` page surfaces the open sibling(s) + waitlist; it does NOT actively rewrite the ad's link (that is v2).
3. Trigger is AUTOMATIC-but-DARK on the leased transition (gated by `LEASEUP_TAKEDOWN_ENABLED` + `automation_authorized`); the irreversible hard-delete sub-branch only fires when the org's waitlist is off.
