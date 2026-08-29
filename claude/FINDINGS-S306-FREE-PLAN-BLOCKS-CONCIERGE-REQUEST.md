# FINDINGS S306: the concierge request path is unreachable on the `free` plan, and the test org was on `free`

Written 2026-08-28 (Session 306). Fourth member of the S305 "unreachable consent control" family.

## The shape

S305 established that three consent controls are unreachable from the shipped UI: Kijiji automation, the submit approval, and both commercial channels. All three gate on `mode === "api_automatic"`.

This is a fourth, with a different mechanism and the same symptom: a control that never errors, renders a plausible alternative, and therefore produces no signal that anything is wrong.

## The gate

`app/dashboard/properties/actions.ts:4815`, inside `requestConciergePublish`:

```ts
if (!hasEntitlement(runOrgPlan, "listing_marketing")) {
  redirect(`/dashboard/properties/${propertyId}?run=conciergeupgrade#distribute-header`);
}
```

`lib/billing.ts:218`:

```ts
free: { ...noEntitlements(), rent_collection: true },
```

So `listing_marketing` is `false` on `free`. **Growth Test, the designated headless test org, was on plan `free`** [verified 2026-08-28 from the row].

There is a second wall behind it. `conciergeMonthlyCap` (`lib/billing.ts:397`) opens with `if (!canUseListingMarketing(plan)) return 0`, so even past the entitlement check a `free` org has a cap of zero and `claim_concierge_leaseup` would refuse, redirecting to `?run=conciergeatcap`.

## Why S305 did not see it

S305 avoided `requestConciergePublish` and mirrored the worker's own `releaseToQueued` field set by hand. It recorded the reason as:

> `requestConciergePublish` runs `claim_concierge_leaseup` against a monthly cap, and Growth Test has never had a claim row.

The claim row observation was correct. **The named cause was the wrong gate.** The entitlement check fires earlier and would have redirected before the RPC was ever reached. Reading the action top to bottom, rather than reasoning from the symptom, is what surfaced it.

## What it cost

Every prior session that reasoned about the concierge request path on Growth Test was reasoning about a path that could not execute there. The button renders. The click succeeds. The redirect looks like navigation. Nothing writes.

## The fix taken in S306

`organizations 8ea1da48` (`Growth Test`) `plan: free -> growth`, one column, `concierge_leaseup_cap_override` deliberately untouched so the tier's included allowance applies rather than an override. Revert written to disk BEFORE the forward write, guarded on `plan = 'growth'` so it no-ops if the row moved.

Blast radius checked before and after: 4 properties (2 unarchived), 1 member, 0 tenancies, 0 leads, 0 future scheduled showings. The `growth` tier also switches on `serve_notice`, `applications`, `sms`, `capture_email_in`, `market_rent` and `waitlist` for that org; there is nothing in it for any of those to act on. `renter_sms` was already true on `free`.

Result, read back from the rows:

- `0640c0aa` (Growth Test, 833 Pillette Unit 3, kijiji): `browser_copilot`/`needs_login` -> `concierge`/`queued`, `concierge_requested_at` 2026-08-28 16:16:33.757 UTC, `relist_radar_backup` and `last_attempt_id` both still null.
- `concierge_leaseup_claims`: Growth Test's **first row ever**, period `2026-08`, 16:16:33.712 UTC. `CONCIERGE_DESK_ENABLED` is therefore `true` in production and `claim_concierge_leaseup` executed and allowed for this org for the first time.
- Redirect came back `?run=concierge`, the success branch, not `conciergeupgrade` and not `conciergeatcap`.

## Open question, not a task

Whether `free` SHOULD block the concierge request is a product decision, not obviously a bug: concierge is a paid done-for-you feature and gating it on a paid tier is defensible. The finding is narrower and is about testing, not pricing: **the org used to exercise the headless lane was provisioned on a tier that cannot reach the lane's entry point.** Any future QA org needs a tier that matches the surface under test, or the test proves nothing.

## Watch item

`5a1e0c7d` is Growth Test's copy of `833 Pillette Rd, Unit 3, Windsor` and Agile's real Unit 3 in org `921f7c08` carries the same address string. Dark mode posts nothing so the S306 run is safe. If this item ever reaches a live tick, that collision is live. Select on `organizations.name`, never on the address.

## OUTCOME, verified the same day

The unblocked path ran end to end. After the plan change, `0640c0aa` completed the full approved lane:

- `proof:b` 18:42:03 UTC, 20 fields, reached the live Kijiji post-ad form
- operator approved 18:44:38 UTC
- the five-minute timer claimed it unaided at 18:55:45 UTC
- dark submit finished 19:01:20 UTC: `phase_b_submit_dark`, `worker_lane` NULL, re-filled 20 fields, Post button present, **stopped before submit**

`external_url` stayed NULL throughout. Nothing was posted and no payment was touched. This is the first Kijiji concierge item in the system's history to reach the normal submit path rather than the Relist Radar branch.

One further gate was needed between the approval and the claim, and it is filed separately: `FINDINGS-S306-APPROVAL-QUEUE-STARVATION.md`.
