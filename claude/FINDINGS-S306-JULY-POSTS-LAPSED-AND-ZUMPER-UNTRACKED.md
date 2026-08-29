# FINDINGS S306: headless distribution already posted live in July, then lapsed silently

Written 2026-08-28 (Session 306). This corrects a claim I made earlier the same session.

## The correction first

Earlier in S306 I reported `ever_submitted = 0` across every channel and concluded the worker had never posted anywhere. **That was wrong.** The query looked for `metadata->>'submitted' = 'true'`, a field these runners do not write. I measured the wrong thing and published a zero.

The rows say the opposite:

**Zumper, item `35dceeeb`, 2026-07-24**
```
publish_status: live
external_url:   https://www.zumper.com/manage/properties/listing/64945958
audit:          "Zumper submit (live): outcome=published,
                 url=https://www.zumper.com/manage/properties/listing/64945958;
                 boostDeclined=true."
```

**Rentals.ca, item `5855f8c6`, 2026-07-25**
```
publish_status: live
external_url:   https://rentals.ca/windsor-on/833-pillette-road-6
audit:          "Worker posted to rentals_ca and verified it live: s567: the listing's own
                 manage card read Active after Enable, and a cold public fetch with no
                 session returned the real ad at 1195, 1 bed, 1 bath, 550 sqft"
```

A cold, unauthenticated public fetch returning the real ad is **proof-ladder rung 5**, not rung 3. Headless distribution to two channels was achieved and verified five weeks ago.

**Rule: a zero from a query you wrote is a claim, not a fact. Confirm the field exists and is written before reporting an absence.** Same family as `feedback_verify_before_asserting_absence`, applied to my own instrumentation rather than to the world.

## What actually happened since

Both ads lapsed and nothing said so.

- `listing_posts d05d6a39` (rentals_ca, Unit 20) reads `expired`, posted 2026-07-25.
- Fetched 2026-08-28: `https://rentals.ca/windsor-on/833-pillette-road-6` no longer serves the listing. It falls back to a Windsor search page with 650 results. **It does not 404.** Identical to the S670 lesson that a `facebook.com/share/...` URL never 404s: the link loading is not evidence the ad exists.
- Both run items still read `publish_status = 'live'` today.

So the month's story is not "we could not get further." It is **"we got there in July, lost it silently, and spent the month re-proving a different channel."**

## The zumper item is untracked, which is why nothing caught it

`35dceeeb` has **`listing_post_id = NULL`**. It posted live, recorded an `external_url`, and was never linked to a `listing_posts` tracker row.

Consequences:
- The portal freshness sweep works from tracker rows, so zumper was never a candidate. `last_verified_at` is still 2026-07-24.
- Rentals.ca, which DOES have a tracker row, was caught: `verification_status = 'stale'`, re-checked 2026-08-28.

**One of the two lapses was detectable and detected; the other was structurally invisible.** The S670 freshness work is functioning. It just cannot see a live post with no tracker.

Ticket shape: a submit that records an `external_url` must reserve or create a `listing_posts` row and link it, the way the browser-copilot path already does via `reserveTracker`. Until then, "is this channel still live" has a blind spot exactly where the worker succeeded.

## Why this matters more than the Kijiji ladder

Kijiji is paid-only by the S667 decision, and Agile's own Kijiji item sits at `needs_payment` with the desk reading "Worker reached the Kijiji package/checkout wall and stopped." The free Kijiji lane proven on Growth Test in S306 may not exist for Agile at all.

Rentals.ca and Zumper are free, already posted successfully, and already have warmed sessions for Agile (2026-07-25 and 2026-07-24). **`account_status = 'needs_setup'` on those rows is a stale operator label, not a computed state.** The runner never reads it; it reads `distribution_channel_sessions`, and those rows exist.

The shortest path to Agile being live on a second channel is re-running what already worked, not finishing what has not.

## Open, in order

1. `submit:r:dark` on `5855f8c6` to confirm the 2026-07-25 session still authenticates. Handover written: `S306-RENTALS-DARK-HANDOVER.sh`, four gates, proven against five failure states.
2. If the session holds, the live re-post gate.
3. Link zumper's live posts to tracker rows so the freshness sweep can see them.
4. Stop treating `account_status` as a blocker. It is a label nothing computes.
