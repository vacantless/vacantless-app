# FINDINGS S306: the Zumper dark run stopped at the wizard step cap, not at a selector

Date: 2026-08-28 (verified 2026-08-29)
Attempt: 7a7801e9 (dark), Agile item 35dceeeb, 833 Pillette Unit 20
Source: distribution_publish_attempts.metadata, vacantless-worker/src/phase-b-submit-zumper.ts, mappings/zumper.json

## What the run reported

    reached_form: true      challenge: "none"      outcome: "review_not_reached"
    steps_taken: 14         filled_count: 13/20    reached_review: false
    photos_found: 10        photos_downloaded: 10  photos_attached: 0
    final_url:  .../manage/create-property/listing/location
    review_url: .../manage/create-property/listing/lease-details/65213174

## What is actually true

The session re-warm worked. `challenge: "none"` where the same item returned
`sign_in_required` ninety minutes earlier is the whole answer to the session question.
Zumper accepted the stored storageState and rendered the create wizard.

The run then stopped because it ran out of loop iterations, not because a selector broke.

`MAX_WIZARD_STEPS = Number(process.env.ZUMPER_MAX_STEPS ?? 14)`
(phase-b-submit-zumper.ts:77). `steps_taken: 14` is that cap exactly. The loop exits
three ways: a Publish button appears (reached_review), no Next button is present, or the
counter runs out. Publish never appeared and Next was still present on every pass, so it
was the counter.

That single fact explains all three things that looked like separate defects:

1. `zumper-rent` not_found on `[aria-label="Monthly rent"]`. Monthly rent is a LATER step
   than lease-details. The run never rendered that step. The selector was never wrong.
2. `photos_attached: 0` of 10. Photos are attached only when the Photos step's file input
   is present (phase-b-submit-zumper.ts:299). Photos is later than Monthly rent. The run
   never rendered that step either. The 10 photos downloaded fine.
3. `outcome: review_not_reached`. Review is the last step. Same cause.

`final_url` is the entry URL captured right after goto, not where the run ended.
`review_url` is `page.url()` after the loop, so lease-details is where it stopped.

## The two things that are real

A. The loop is burning iterations without advancing. Fourteen Next clicks should have
   carried it past a wizard the source itself describes as about ten pages (Address,
   Listing details, Description, In-unit amenities, Building amenities, Pet policy,
   Lease details, Monthly rent, Photos, Review). It reached page seven. So either the
   wizard has grown, or some Next clicks are being rejected (a required field left empty
   blocks the step) and the loop cannot tell, because it never compares the URL before
   and after the click. There is no stall detection and no per-step URL in the metadata,
   so the run cannot say which of the two it is. Raising the cap alone would just burn
   more iterations against the same wall if it is a stall.

B. `zumper-move-in` genuinely was not found on the step it lives on. The runner filled
   `zumper-lease-term` ("1 year") on lease-details, then looked for
   `[aria-label="Available on"]` on that same step and reported "no available-on input;
   no 'Set to' button and no visible date input". Fields are filled in mapping order and
   lease-term comes first, so the most likely cause is that the date control renders only
   after the lease-term selection settles and fillForm re-probes nothing. This is the one
   fill defect in the run.

## What is NOT a defect

- `missing: ["zumper-property-type(fallback:apartment)"]` is a compose-side note that a
  fallback value was used. The fill result for that field is `filled` (select value=4).
- Five amenity checkboxes at `skipped:no_value`. The property has no value for furnished,
  balcony, in-unit laundry, assigned parking, garage parking. Correct behaviour.
- 13 filled + 5 skipped + 2 not_found = 20. Every field on every step the run reached was
  handled.

## Side effect worth knowing

Every run navigates to `config.zumperCreateUrl` (phase-b-submit-zumper.ts:259), which
mints a NEW draft listing. `65213174` is a fresh draft on Agile's real Zumper account and
is not the tracked `external_url` listing `64945958`. Each dark run leaves one more
abandoned draft there. Nothing is published and no approval is consumed
(`approval_consumed: false`, the item is released back to needs_operator), but the drafts
accumulate and should be cleared by hand periodically.

The listing_posts tracker does NOT accumulate: reserveTracker reuses the existing row for
property+portal.

## The cheap next diagnostic

`ZUMPER_MAX_STEPS` is an environment variable. A dark run with `ZUMPER_MAX_STEPS=24` and
no code change at all distinguishes A's two branches: if it reaches Review, the wizard is
simply longer than 14 and the default is stale. If it stops at lease-details again with
steps_taken 24, a Next click is being rejected and the loop is spinning.

## Standing rule this reinforces

A field reported not_found on a step the run never rendered is not evidence about the
selector. Read the loop exit before reading the field results.

## Addendum: 14 steps WAS enough on 2026-07-24

Every Zumper attempt on record (distribution_publish_attempts, channel=zumper):

| attempt  | date       | live  | outcome            | listing id reached |
|----------|------------|-------|--------------------|--------------------|
| 9216dac7 | 2026-07-24 | false | review_not_reached | 64945742 (listing-details) |
| d3bfde6a | 2026-07-24 | false | submit_ready       | 64945917 (review-and-publish) |
| af34fbb8 | 2026-07-24 | true  | published          | 64945958 (review-and-publish) |
| 0a0d1e1a | 2026-08-28 | false | needs_login        | none (session expired) |
| 7a7801e9 | 2026-08-29 | false | review_not_reached | 65213174 (lease-details) |

On 2026-07-24 the same code with the same default of 14 reached review-and-publish twice
and published once. So 14 was sufficient five weeks ago. That shifts the odds toward the
wizard having GROWN or a step having started rejecting Next, and away from "the default
was always too low". It also means a `ZUMPER_MAX_STEPS=24` run that reaches Review is
still worth treating as a symptom fix, not a diagnosis: something about the wizard changed
between July 24 and August 29 and the step trace is what will say what.

Note that 9216dac7 on that same July day also died at listing-details, so the wizard was
already inconsistent then. It was not a clean regression from a clean baseline.

## Draft inventory on Agile's real Zumper account

Derived from the review_url of every attempt above. Four listing ids exist:

- 64945742 - abandoned draft from 2026-07-24, never published
- 64945917 - abandoned draft from 2026-07-24, dark run reached review, never published
- 64945958 - the REAL published ad from 2026-07-24. listing_posts row 0231044f, status
  expired. This is the tracked listing. Do not delete it as cleanup.
- 65213174 - abandoned draft from 2026-08-29, run #1 of S306

Three abandoned drafts, one real listing. The worker has no Zumper takedown path
(takedown-kijiji.ts and takedown-leaseup.ts cover kijiji and facebook_feed only), so
draft cleanup is a manual job in the Zumper dashboard.

## RESOLVED 2026-08-29: the cause is a stale available_date, not a step budget

Run #2 (attempt 9bb31baa) with `ZUMPER_MAX_STEPS=24`:

    steps_taken: 24    reached_review: false    filled_count: 13    photos_attached: 0
    review_url: .../create-property/listing/lease-details/65213477

Ten extra iterations produced ZERO extra filled fields and did not move off
lease-details. That settles it: the wizard is not longer than 14. A Next click on the
lease-details step is being rejected and the loop spins in place until the counter runs
out. Raising the cap was the right diagnostic and the wrong fix.

Then the July comparison named the mechanism. Same field, every attempt on record:

| attempt  | date       | zumper-move-in | detail |
|----------|------------|----------------|--------|
| 9216dac7 | 2026-07-24 | not_found      | exact date unreachable |
| d3bfde6a | 2026-07-24 | filled         | picked exact date August 1, 2026 |
| af34fbb8 | 2026-07-24 | filled         | picked exact date August 1, 2026 |
| 7a7801e9 | 2026-08-29 | not_found      | exact date unreachable |
| 9bb31baa | 2026-08-29 | not_found      | exact date unreachable |

The property (ff465273, 833 Pillette Unit 20) has `available_date = 2026-08-01`.
Today is 2026-08-29.

mappings/zumper.json says it plainly, in a note captured live on 2026-07-24:
"Past-date tiles are disabled; if the exact date is unreachable it FALLS BACK to the old
datebutton behavior (the 'Set to <date>' quick button)."

On 2026-07-24 August 1 was in the future, the calendar tile was enabled, the runner
clicked it, lease-details validated, Next advanced, the run reached review-and-publish and
published. Today August 1 is 28 days in the past, the tile is disabled, the 'Set to'
fallback is not present either, the required field stays empty, lease-details refuses to
advance, and the loop spins.

Nothing about Zumper's DOM changed. Nothing about the worker changed. The listing data
went stale underneath a runner that cannot say so.

## What this actually is

Two failures stacked, and only the second is a code defect.

1. DATA. A listing advertised as available on a date that has already passed. That is
   wrong on the ad as much as it is wrong for the runner. The fix is to set a real
   availability date on the property, which is an app-side edit by the operator.

2. CODE. The runner composes a date, fails to place it, and then burns its entire step
   budget in silence. It never checks whether the composed date is in the past, never
   notices that Next did not advance, and reports `review_not_reached` with a field-level
   `not_found` that reads like a selector problem. Two runs and a good deal of reasoning
   went into rediscovering a fact the runner had in hand before it opened the browser.

## The wider lesson

This is very likely not Zumper-specific. Any channel whose form validates a move-in or
availability date will fail the same way once a listing's date goes past, and every one of
them will report it as some other field's problem. Worth a sweep: which properties with
active distribution items carry an `available_date` in the past.
