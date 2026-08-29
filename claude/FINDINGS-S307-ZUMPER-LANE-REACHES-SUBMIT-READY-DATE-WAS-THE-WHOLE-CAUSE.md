# FINDINGS S307: the Zumper lane reaches submit_ready, and the stale date was the whole cause

Written 2026-08-29 14:33 UTC / 10:33 EDT. [verified 2026-08-29 via a dark run on the box
and a read-back of distribution_publish_attempts and distribution_run_items]

Attempt `d72553f0-5397-45f1-a937-8cc1a1786388`, Agile item `35dceeeb`, 833 Pillette Unit 20.

## The loop exit, read before any field result

    steps_taken: 11    reached_review: true    outcome: submit_ready
    filled_count: 15/20    photos_attached: 10/10    challenge: none

Eleven is UNDER the default cap of 14. The run exited because the wizard ended, not because
the counter ran out. Correcting `available_date` from `2026-08-01` to `2026-09-01` was the
entire fix and it needed no code change and no raised step budget.

`zumper-move-in` reads `picked exact date September 1, 2026`, the same shape as the
successful 2026-07-24 run.

## The step budget is retired as a theory, and so is the workaround

| attempt  | date       | ZUMPER_MAX_STEPS | steps | reached_review | filled |
|----------|------------|------------------|-------|----------------|--------|
| d3bfde6a | 2026-07-24 | 14 (default)     | -     | true           | -      |
| 7a7801e9 | 2026-08-29 | 14 (default)     | 14    | false          | -      |
| 9bb31baa | 2026-08-29 | 24               | 24    | false          | 13     |
| d72553f0 | 2026-08-29 | 14 (default)     | 11    | true           | 15     |

Raising the cap to 24 bought ten wasted iterations and two fewer filled fields than the
default budget does with a valid date. **Do not run this lane at 24.** The handoff script
keeps 24 only as a second diagnostic and defaults to 14.

## Two carried Zumper defects are now disproven, not deferred

S306 correction 4 predicted this and it is now evidence rather than argument.

- **Monthly rent.** `zumper-rent` status `filled`, selector `[aria-label="Monthly rent"]`.
  There was never a selector problem. It was a step the run had not rendered.
- **Photos.** `photos_found: 10`, `photos_attached: 10`. Same story.

## 15 of 20 is full coverage, not a shortfall

The five unfilled fields are all `skipped:no_value`, meaning Vacantless holds no value to
write: `furnished`, `balconyOrDeck`, `inUnitLaundry`, `assignedParking`, `garageParking`.
Zero fields failed. Anyone reading `filled_count: 15/20` as a 75 percent fill rate will
open a defect that does not exist. The honest reading is 20 attempted, 15 written, 5 with
nothing to write, 0 failures.

If those five should carry values, that is a **listing data** question for the unit record,
not a worker or selector question.

## One real reporting defect surfaced

`metadata.missing` reads `["zumper-property-type(fallback:apartment)"]` while
`fill_results` shows the same field with status `filled`, `select value=4`. A field that
filled successfully via its fallback is being reported under a key named `missing`. That
key will be read as a failure by the next person and by any UI that surfaces it.

## `last_attempt_id` defect reconfirmed on live evidence

Attempt `d72553f0` was recorded, and `distribution_run_items.last_attempt_id` for
`35dceeeb` is still **NULL** after the run. This is the defect
`CODEX-PROMPT-S306-LAST-ATTEMPT-ID-TRACKS-NEWEST-ATTEMPT.md` already describes, now with a
fresh reproduction. It remains true that fixing it does not unblock anything.

## The item is clean and the run is repeatable

Read back after the run: `publish_status = needs_operator`, `operator_submit_approved_at`
still set, `concierge_claimed_by` NULL, `attempt_count` 0, and `external_url` still the
REAL July listing `64945958`, not the new draft. Nothing was published, no `listing_posts`
write, no spend. The approval was preserved, so the lane can be rerun as often as needed.

## Draft inventory on Agile's real Zumper account, updated

Five abandoned drafts now: `64945742`, `64945917`, `65213174`, `65213477`, **`65217544`**
(new, this run). The real published 2026-07-24 ad is **`64945958`** and its `listing_posts`
row is `0231044f`, status `expired`. **Do not delete `64945958`.**

The worker has no Zumper takedown path, so draft cleanup stays a manual job in the Zumper
dashboard.

## What this does and does not license

It proves the lane can be driven to the review-and-publish screen with a full, correct
payload and no challenge. It does **not** prove Zumper will accept a publish, and it is not
an approval to click Post. Going live is a separate gate and needs Noam to say so.

## The standing rule this reinforces

The date guard matters more than this one result. The fix here was a hand-edited date that
goes stale again on 2026-09-02. `CODEX-PROMPT-S306-ZUMPER-STEP-BUDGET-AND-MOVE-IN.md`
carries the compose-side past-date guard and is the thing that stops this recurring.
