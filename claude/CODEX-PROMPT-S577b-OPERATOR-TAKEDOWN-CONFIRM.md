# CODEX PROMPT — S577b: operator "mark ad removed" confirm for lease-up take-down tasks

Implement this end to end in `vacantless-app`, following every standing constraint
below. **Do not `git push`** — land natively; Noam pushes.

## Why

S577 proved the automated lease-up take-down live for `facebook_feed`: on a
property's `status -> leased` transition the worker does a real Graph DELETE +
GET-gone confirm + marks the listing_post `removed`. But that automated path only
exists for `facebook_feed`. For every other live channel (`rentals_ca`, `kijiji`,
`zumper`) and for paid / unconnected ads, `lib/leaseup-takedown.ts`
(`enqueueLeaseupTakedownItem`, non-automated branch) instead files a
`distribution_run_items` row with `publish_status='needs_operator'`,
`transport='takedown'`, `mode='concierge'`, a `blockers` line ("Take down the
leased unit's {label} ad, then record removal proof."), and `operator_action_url`
= the ad url, and fires the `leasing.distribution_takedown_needed` notification
with an "Open Distribute" action.

The gap: there is **no in-app action for the operator to CLOSE that task**. They
open the ad and remove it by hand, but nothing records it — so the
`listing_posts` row stays `status='live'`, the run item stays `needs_operator`
forever, and the DB diverges from reality. This slice gives the operator a
one-click "Mark ad removed" confirm that records an operator-attested removal,
mirroring the DB effects of the worker's `markTakenDown` (worker `src/tracker.ts`)
but without a Graph proof.

## Scope

1. **Server action / lib** — add `lib/leaseup-takedown-confirm.ts` exporting a
   server function `confirmLeaseupTakedownRemoved({ supabase, org, runItemId })`
   that, for a run item with `transport='takedown'` and
   `publish_status IN ('needs_operator','queued')` belonging to `org.id`:
   - writes a `distribution_verifications` row: `result='removed'` (0187 already
     allows it — no new migration), `verification_type='external_url'`,
     `external_url` = the item's `operator_action_url`/`external_url`,
     `metadata` = `{ source: 'operator_takedown_confirm', confirmed_by: <user id>,
     listing_post_id, channel }`. This is the operator-attested analogue of the
     worker's Graph-proof row.
   - flips the linked `listing_posts` row to `status='removed'` (row + id survive
     — attribution preserved, tracked link keeps resolving; same invariant the
     worker honours, rule 16 — here the proof is the operator's attestation, which
     is legitimate for channels we cannot delete via API).
   - sets the run item `publish_status='removed'`, `status='done'`, clears
     `concierge_claimed_by`, stamps `audit_message`.
   - is idempotent: if the listing_post is already `removed`, return ok without a
     duplicate verification.
   - Check the **real** shapes before writing (KI926): the worker
     `markTakenDown` in `vacantless-worker/src/tracker.ts` for the exact columns
     it sets, and `lib/leaseup-takedown.ts` for the item/verification shape it
     already writes. Match them; do not invent columns.

2. **Distribute UI** — in the property Distribute surface
   (`app/dashboard/properties/[id]/distribute-tab.tsx` + `page.tsx`), for a
   take-down operator task (`transport='takedown'`,
   `publish_status='needs_operator'`): render the `blockers` line + a link to
   `operator_action_url` ("Open the ad") **and** a "Mark ad removed" button wired
   to the new action. First verify whether these take-down items already render in
   that tab; if they do, add only the button; if not, surface them too. After a
   successful confirm, the item leaves the needs-operator state and shows as
   removed.

3. **Gating** — gate the button/action behind the same `LEASEUP_TAKEDOWN_ENABLED`
   flag the enqueue uses, so the whole lifecycle stays dark together. No behaviour
   for any org until the flag is on.

4. **Test** — a tsx test asserting: (a) confirm on a `transport='takedown'`
   needs_operator item writes exactly one `result='removed'` verification, flips
   the listing_post to `removed`, and marks the item done; (b) a second confirm is
   idempotent (no duplicate verification); (c) it refuses an item that is not a
   take-down task or belongs to another org.

## Standing constraints

- Land natively on the Mac; **do not `git push`** (bridge push = 403).
- **No new migration** — 0187 already added `result='removed'`. Do not add DDL.
- Everything DARK behind `LEASEUP_TAKEDOWN_ENABLED`; nothing activates on deploy.
- Reuse the real `markTakenDown` / enqueue shapes (KI926) — verify signatures, do
  not code against an illustration.
- Preserve attribution: never delete the `listing_posts` row or its id; only flip
  `status`. Only the object's own status proves state (rule 16); here the operator
  attestation is that proof for non-API channels.
- tsc clean; run the tsx test natively (tsx does not run over the bridge).

## Definition of done

- New `lib/leaseup-takedown-confirm.ts` + Distribute UI button, dark-gated.
- Operator can close a take-down task; listing_post flips to `removed` with an
  operator-attested `result='removed'` verification; item marked done; idempotent.
- Tests pass natively; `tsc` clean. Report back the file list for warm-verify.
