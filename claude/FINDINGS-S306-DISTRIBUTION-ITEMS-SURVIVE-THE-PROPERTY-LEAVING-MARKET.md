# FINDINGS S306: distribution items stay actionable after the property leaves the market

Date: 2026-08-29
Method: single Supabase read joining distribution_run_items to properties on run.property_id,
filtered to prop_status in (leased, off_market, paused) and item publish_status in
(queued, needs_operator, submitting, live).

## What came back

Twelve items across four orgs. Two of them are on real customer properties.

| org | property | prop status | channel | item status | mode | item |
|---|---|---|---|---|---|---|
| Abbas Husain | 50 Glenrose Unit 5 | **leased** | kijiji | queued | concierge | f343e973 |
| Agile | 833 Pillette Unit 30 | **off_market** | facebook | queued | concierge | bf8c8821 |
| Growth Test | 350 City Hall Sq W | off_market | kijiji | needs_operator | concierge | 4dc42e36 |
| Growth Test | 350 City Hall Sq W | off_market | kijiji | needs_operator | concierge | e8d80187 |
| Growth Test | 350 City Hall Sq W | off_market | kijiji | needs_operator | concierge | 6407dcac |
| Growth Test | 350 City Hall Sq W | off_market | rentfaster | needs_operator | concierge | 9cbff38e |
| Growth Test | 350 City Hall Sq W | off_market | viewit | needs_operator | concierge | 9f41e229 |

Plus five `vacantless` channel items at `live` on leased or off-market properties
(Abbas fb1384c9, Agile 54c65c7a, Growth Test 407b25ae and 12f8ce5f, North Star 53aa20a4).

## Why the first two matter

A `queued` concierge item is an instruction to post an ad. On 50 Glenrose Unit 5 the property
is `leased`. On 833 Pillette Unit 30 the property is `off_market`, and Narayan confirmed in
writing on 2026-08-18 that Unit 30 is rented. Noam took the Unit 30 ad down by hand. The
distribution item was never closed with it.

Nothing has fired these, because the concierge lane requires an operator approval that nobody
gave. But the safety here is an accident of the approval gate, not a rule the system enforces.
An item queued against a leased unit should not be waiting for approval at all. It should be
cancelled when the property leaves the market.

## The Growth Test five are the approval-queue starvation from earlier this session

`claim.ts` orders approved candidates by `operator_submit_approved_at` ascending and breaks on
the first passing account check. Five stale items on a fake-address off-market test property
sat at the head of that queue. Two were revoked during S306; the rest are still there. Worth
closing on their own merits, not just as queue hygiene.

## The `vacantless` live rows are a separate question, not asserted here

Five properties that are leased or off market still carry a `live` item on the `vacantless`
channel, which is the `/r` public landing page. That may be deliberate (a landing page that
says "no longer available" is better than a dead link) or it may be a leak. This finding does
not claim which. It flags it for someone to decide, once.

## The pattern this belongs to

Same shape as the stale `available_date` that stalled the Zumper wizard. A fact changes on the
property row and nothing downstream notices:

- property goes leased -> distribution items stay queued
- availability date passes -> ads keep advertising it, and the Zumper runner stalls on it
- listing_posts goes expired -> the item still reads `live` (50 Glenrose Unit 4, item 90b3a0ee
  is `live` against post 65e28bc8 which is `expired`, and the freshness cron has recorded
  `stale` on it **337 times**, most recently 2026-08-29)

The distribution lane has no reconciliation pass. Every one of these is the same missing idea:
when a property's state changes, the things advertising it should be brought into line, or at
minimum surfaced to an operator. The freshness cron is the closest thing that exists, and all
it can do is write `stale` into an attempt row that nobody reads.

## Suggested action, none taken

Nothing was mutated. The cancellations are DB writes on customer data and belong to Noam. The
durable fix is an app-side reconciliation: on property status change to leased, off_market or
paused, cancel open distribution items for that property and tell the operator what was
cancelled. That is a Codex ticket, not a one-off cleanup.
