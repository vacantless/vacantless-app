# CODEX PROMPT - Lease-up take-down: dispatch isolation + operator notify + Graph-gone shape (S575b, DARK)

**Status: DISPATCH-READY. Authored s575 (2026-07-26). Fast-follow to the S575 lease-up ad lifecycle build (already on disk, dark). Hand to Codex ONLY when idle. Land in `vacantless-app/claude/` so Codex finds it.**
**Standing constraints (do not violate): land app changes NATIVELY on the Mac (Noam pushes; bridge git push = 403); the worker is NOT git - device_commit_files IS the apply; keep everything DARK behind the existing flags; prove a side-effectful action by the OBJECT'S OWN status row, never a success response (rule 16); tsc clean; every pure-logic change ships a unit test.**

## Context
S575 shipped the lease-up ad lifecycle (decision ladder -> steer/repoint/skip/takedown) dark behind `LEASEUP_TAKEDOWN_ENABLED`. It was warm-verified: dark gates correct, rule 16 honored (`markTakenDown` runs only after Graph DELETE + GET-404), attribution preserved (`listing_posts.status='removed'`, row/id never deleted). Three seams were found that do NOT block the dark commit but must be closed before the flags go live in prod. This prompt closes all three. Nothing here changes the decision ladder or the attribution model.

## Seam 1 (correctness, before-flags-live): the auto-delete item collides with the publish cron
`handleLeaseupAdLifecycle` (`vacantless-app/lib/leaseup-takedown.ts`) enqueues the automated FB take-down item as `mode='concierge', publish_status='queued'`. That is EXACTLY the claim filter of the existing publish cron `app/api/cron/distribution-worker/route.ts` (`.eq('mode','concierge').eq('publish_status','queued').is('concierge_claimed_by', null)`). With `DISTRIBUTION_WORKER_ENABLED=true`, that cron will claim the take-down item and treat it as a NEW publish: it composes an ad for the just-leased unit and gates it "review and submit the post". The real take-down runner (`vacantless-worker` `npm run takedown:leaseup`, keyed by `TAKEDOWN_ITEM_ID`) is a manual command, not cron-wired, so nothing correctly auto-runs the delete.

**Fix (pick the lower-churn option; option A preferred):**
- **A. Distinct marker so the publish cron never sees take-down items.** Give take-down run items a distinct discriminator the publish cron excludes. Read the real columns first: `distribution_run_items` already carries `mode` and `transport`. Set take-down items to `transport='takedown'` (or a new `mode='takedown'` if `mode` is what the cron keys on - CONFIRM by reading the cron's exact filter and `workerJobEligible`) and add the matching exclusion to the cron candidate query (`.neq(...)`) AND to `workerJobEligible`. Do NOT broaden the publish cron to "handle" take-downs.
- Then wire an actual dispatcher for the automated branch so it does not depend on a human running `takedown:leaseup` by hand: EITHER a tiny cron `app/api/cron/leaseup-takedown/route.ts` that finds take-down-discriminated `publish_status='queued'` items for authorized FB accounts and invokes the same code path as `takedown:leaseup` (reuse `markTakenDown` + the Graph helpers; do NOT duplicate the delete logic), OR document explicitly that v1 automated take-down is manual-by-item-id and keep the item OUT of the publish cron's reach (still requires the Seam-1 marker). State which you chose at the top of the file.
- The manual `takedown:leaseup` command MUST keep working by `TAKEDOWN_ITEM_ID`.

## Seam 2 (wiring gap): `leasing.distribution_takedown_needed` is registered but never emitted
The event is registered in `lib/notifications.ts` and lane-mapped, but no `sendOrgNotification` call ever fires it. The operator-task branch of `handleLeaseupAdLifecycle` only parks a `publish_status='needs_operator'` run item; the publish cron only emits its own `distribution_job_needs_action` for items IT gates (and it claims only `'queued'`, so it never touches these). Result: an operator take-down task pushes no notification.

**Fix:** in the operator-task branch of `handleLeaseupAdLifecycle` (the non-automated `takedown` path), emit the event. Mirror the exact shape the publish cron uses at `app/api/cron/distribution-worker/route.ts` line ~386:
```
await sendOrgNotification({ /* org, supabase per that call site */
  eventKey: "leasing.distribution_takedown_needed",
  context: { channel_label, external_url, reason, dashboard_url },
});
```
Import from `@/lib/notifications-server`. Reuse the registered tokens (`channel_label`, `external_url`, `reason`, `dashboard_url`) - they already exist on the event. Build `dashboard_url` the same way the cron does (the property Distribute tab). No hand-written email. Fire it ONLY on the operator-task branch (not on `automatedDelete`, not on steer/repoint/skip). Keep it inside the `LEASEUP_TAKEDOWN_ENABLED` gate so it stays dark.

## Seam 3 (rule-16 edge, low risk): Graph "object gone" is not always a raw HTTP 404
`vacantless-worker/src/facebook-graph.ts` `postReturns404` treats ONLY `res.status === 404` as gone. A deleted Graph object usually reads back as HTTP 400 with `error.code=100` and (commonly) `error.error_subcode=33` / message "does not exist". Today that throws `GraphError` -> the take-down routes to operator instead of self-confirming. This fails SAFE (never a false `removed`), but the automated confirm may never succeed in practice.

**Fix:** in `postReturns404`, ALSO return `true` when the error payload is the object-gone shape: `error.code === 100` AND (`error.error_subcode === 33` OR the message matches `/does not exist|cannot be loaded|unsupported get request/i`). Parse `error_subcode` (add it to the `GraphErrorPayload` type). Keep the strict default: any OTHER non-ok/error response still throws so `markTakenDown` is never reached without proof. Add/extend a small pure unit test asserting: raw 404 -> gone; code 100/subcode 33 -> gone; a live object (200 with an `id`) -> not gone; an unrelated error still throws.

## Reuse map (READ FIRST - do not invent shapes)
- `app/api/cron/distribution-worker/route.ts` - the publish cron whose claim filter collides (Seam 1) and whose `sendOrgNotification` call at ~line 386 is the emit template (Seam 2).
- `lib/leaseup-takedown.ts` - `handleLeaseupAdLifecycle` (enqueue site for Seam 1; add the Seam-2 emit in the operator-task branch).
- `vacantless-worker/src/takedown-leaseup.ts` + `tracker.ts` `markTakenDown` - the delete/confirm/record path any auto-dispatcher must REUSE, not duplicate.
- `vacantless-worker/src/facebook-graph.ts` - `postReturns404` + `GraphError`/`GraphErrorPayload` (Seam 3).
- `lib/notifications.ts` - the registered `leasing.distribution_takedown_needed` event + tokens (already present; do not re-register).
- Migration 0105 `distribution_runs.sql` - the `unique (run_id, channel)` on `distribution_run_items` (why the enqueue upserts on that key).

## Gates / definition of done
- Publish cron proven to NOT claim a take-down item: a discriminated take-down item is invisible to the cron's candidate query and to `workerJobEligible`. Add a unit assertion.
- `leasing.distribution_takedown_needed` actually fires on the operator-task branch (and only there) - assert via `test-notifications.ts` style or a targeted test that the emit is reached.
- `postReturns404` treats code 100/subcode 33 (and the "does not exist" message) as gone; strict-throw preserved otherwise; unit test green.
- Everything still DARK: no behavior when `LEASEUP_TAKEDOWN_ENABLED` is off; no real delete without `WORKER_ENABLED` + `FB_PAGE_CHANNEL_ENABLED` + authorized+connected account + decryptable token.
- `tsc` clean (app + worker); all new/changed pure logic unit-tested. Land app changes natively on the Mac; worker changes via device_commit_files.
- Do NOT push, stage, apply migrations, or run a live Graph delete. Leave the existing untracked scratch/prompt files alone.

## Out of scope (S575b)
- Any change to the decision ladder, the `/r` sibling/waitlist surface, or the attribution model.
- Headless browser take-down for rentals.ca / zumper / kijiji (still operator task).
- Multi-photo / Instagram / link-repoint for `steer_to_pool` (still v2).
