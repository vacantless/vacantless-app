# CODEX PROMPT - Lease-up take-down: automated FB dispatch sweep (S575e, DARK)

**Status: DISPATCH-READY. Authored s576 (2026-07-26). The fast-follow that closes the one gap S575b intentionally left open. Hand to Codex when idle. Worker is NOT git - device_commit_files IS the apply; app changes (if any) land NATIVELY on the Mac (Noam pushes; bridge git push = 403).**
**Standing constraints (do not violate): keep everything DARK behind the existing flags; prove a side-effectful action by the OBJECT'S OWN status row, never a success response (rule 16 - markTakenDown only after Graph DELETE then GET-404); do NOT duplicate the delete/confirm logic - reuse it; tsc clean (worker on-device, tsx does NOT run over the bridge - Noam runs the smoke); every pure-logic change ships a unit test; a claim/guard so the sweep can never race the manual command or a second sweep into a double-delete.**

## Context - the gap this closes
S575 built the lease-up take-down lifecycle and S575b isolated it from the publish cron (take-down run items now carry `transport='takedown'`, invisible to the publish worker) and wired the operator-task notify. But S575b deliberately deferred the AUTOMATED dispatcher: for a connected + automation-authorized `facebook_feed` account, `handleLeaseupAdLifecycle` enqueues a take-down run item as `status='pending', publish_status='queued', transport='takedown'` and then NOTHING runs it. The only runner is the manual worker command `npm run takedown:leaseup` keyed by a single `TAKEDOWN_ITEM_ID`. So in v1 an "automated" FB take-down is not automated at all, and (by design) it emits no operator notification either - the ad just lingers until a human runs the command by item id. This prompt makes the automated branch actually run, hands-off, while keeping the exact verified delete+confirm path.

## The architecture constraint (read before choosing an approach)
The Graph DELETE + GET-404 confirm + `markTakenDown` path lives in the WORKER (`vacantless-worker/src/takedown-leaseup.ts` + `tracker.ts::markTakenDown` + `facebook-graph.ts` `deletePageFeedPost`/`postReturns404`/`graphErrorMeansObjectGone`). It is not in the app. So the dispatcher must reuse the worker path, not reimplement a Graph delete in the app.

**Chosen approach (A, preferred): add a SWEEP mode to the worker take-down runner.** Extend `takedown-leaseup.ts` so that, in addition to the existing single-item `TAKEDOWN_ITEM_ID` mode, it can run WITHOUT an item id and instead SELECT every eligible queued take-down item for the target org and process each through the SAME per-item function. This reuses the verified delete/confirm/`markTakenDown` code with zero duplication. Scheduling is via the worker host (same place `autopilot` runs), NOT a Vercel cron - because the Graph delete lives in the worker. Do NOT build an app-side Graph delete.

(Alternative B, only if Noam explicitly wants Vercel-cron hands-off without the worker host: a thin `app/api/cron/leaseup-takedown/route.ts` that decrypts the page token via the existing `lib/distribution-session-crypto.ts` and does the Graph DELETE + GET-404 in the app, mirroring - not copying - the worker helpers. More surface, duplicates the delete shape across the boundary. Default to A unless told otherwise; state which you built at the top of the file.)

## v1 build scope (approach A)
1. **Eligibility selection (PURE + unit-tested).** Factor the "is this item an eligible automated take-down?" decision into a pure function, e.g. `selectSweepEligible(rows)`, that keeps ONLY rows where `transport==='takedown'` AND `publish_status==='queued'` AND `channel==='facebook_feed'`. Everything else (browser channels, `needs_operator` items, non-takedown transport) is excluded. Unit-test: a takedown/queued/facebook_feed row is eligible; a `needs_operator` takedown row is not; a `transport='concierge'` row is not; a `channel='kijiji'` takedown row is not.
2. **Sweep entry point.** When `TAKEDOWN_ITEM_ID` is absent, query `distribution_run_items` for the target org's eligible rows (apply the pure filter server-side as a `.eq(...)` set + then the pure guard), cap the batch (e.g. 25), and for EACH run the existing per-item take-down function. When `TAKEDOWN_ITEM_ID` IS present, behavior is unchanged (single item). Add `npm run takedown:leaseup:sweep` (and keep `takedown:leaseup` working exactly as today).
3. **Per-item claim/guard (no double-delete).** Before deleting, atomically claim the item (guarded CAS: flip `publish_status` 'queued' -> a transient in-progress marker only if still 'queued', same posture as the publish worker's `WORKER_CLAIM_ID`). A second sweep or the manual command loses the race and skips. Only the claim winner calls the Graph delete. `markTakenDown` still flips `listing_posts.status='removed'` ONLY after DELETE + GET-404 (rule 16, unchanged - do not touch that function's proof logic).
4. **Failure routing.** If the Graph delete throws, or the GET-404 confirm does not confirm gone (uses the S575b `graphErrorMeansObjectGone` = raw 404 OR code 100/subcode 33), leave the ad in place and route the item to the operator: set it to `needs_operator` (approval/attribution preserved, `listing_posts` row untouched so nothing is falsely 'removed'). It is fine for the app-side operator-notify to fire on that transition, but do NOT emit a live-Graph notification from the worker; keep the worker's job the delete + record.
5. **Dark gates (unchanged posture).** No Graph delete unless `WORKER_ENABLED` + `LEASEUP_TAKEDOWN_ENABLED` (or the worker's take-down flag if it has its own) + `FB_PAGE_CHANNEL_ENABLED` + the account is `connected` + `automation_authorized` + a decryptable token. Any one missing = the sweep processes nothing (a dark run prints what it WOULD delete: item ids, page id, post ids - sends no Graph call).

## Reuse map (READ FIRST - do not invent shapes)
- `vacantless-worker/src/takedown-leaseup.ts` - the existing single-item runner. Refactor its per-item body into a reusable function the sweep calls in a loop; keep the `TAKEDOWN_ITEM_ID` path calling that same function.
- `vacantless-worker/src/tracker.ts::markTakenDown` - the proof-gated recorder. REUSE, do not modify its DELETE+404 logic.
- `vacantless-worker/src/facebook-graph.ts` - `deletePageFeedPost`, `postReturns404`, `graphErrorMeansObjectGone` (all S575/S575b-verified). REUSE.
- `vacantless-worker/src/claim.ts` - the claim/CAS + `releaseToNeedsOperator` posture to mirror for the per-item claim and the failure route.
- `vacantless-worker/src/config.ts` - reuse `workerEnabled`/`fbPageChannelEnabled`/`sessionEncKey`/`targetOrgId`; add a sweep batch-size const if needed. Read the `.env` `TARGET_ORG_ID` VALUE and confirm seed org == run org before any live sweep (rule 24).
- `app/api/cron/distribution-worker/route.ts` - the publish worker's guarded-CAS claim + transient `WORKER_CLAIM_ID` is the pattern to mirror for the take-down claim.
- `lib/leaseup-takedown.ts` - the enqueue site (context only; the automated branch is what produces the rows this sweep consumes). Do not change the enqueue.

## Gates / definition of done
- The sweep processes ONLY `transport='takedown'` + `publish_status='queued'` + `channel='facebook_feed'` items; the pure selector is unit-tested with the four cases above.
- A claimed item cannot be deleted twice: a second sweep / the manual command loses the CAS and skips (assert the claim guard in a unit or a targeted test).
- Rule 16 preserved: `listing_posts.status` reaches `'removed'` ONLY via the untouched `markTakenDown` after DELETE + GET-404; a 200-delete-without-404-confirm routes to operator, never to 'removed'.
- Everything DARK: no Graph delete with any gate off; dark run prints the would-delete plan and sends nothing.
- The manual `takedown:leaseup` by `TAKEDOWN_ITEM_ID` still works unchanged.
- Worker `tsc --noEmit` clean on-device; new pure logic unit-tested; Noam runs the tsx smoke.
- Do NOT push, apply migrations, or run a live Graph delete. Leave existing untracked scratch/prompt files alone.

## Out of scope (S575e)
- Browser-channel take-down (rentals.ca / zumper / kijiji) - stays an operator task.
- Any change to the decision ladder, the `/r` sibling/waitlist surface, the attribution model, or `markTakenDown`'s proof logic.
- Instagram take-down (a later slice once IG publish is proven-live).
- The Vercel-cron approach (B) unless Noam asks for it.
