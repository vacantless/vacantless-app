# FINDINGS S306: lead attribution is built end to end and has never been used once in production

Written 2026-08-28 (Session 306), after the S306 distribution result, while asking whether finishing the Kijiji ladder is worth it.

## The number that matters

Agile Real Estate Group, last 30 days [verified 2026-08-28 from `leads`]:

| measure | value |
|---|---|
| leads | 105 |
| carrying `listing_post_id` | **0** |
| carrying any `source_detail` | 23 |
| `source = 'website'`, detail NULL | 82 |

**Zero of 105.** Not a low number. Not a partial rollout. The per-post tracked link has never once been used in production.

Agile is 105 of the product's 106 leads in that window, so this is not a corner case. It is the whole live funnel.

## The machinery is complete. Every layer of it.

This is the KI949 pattern again. I was about to write a Codex ticket to build attribution. It exists:

- **Link builder:** `lib/listing-distribution.ts:143` `buildTrackedLink(publicUrl, postId)` returns `/r/<propertyId>?p=<listing_post_id>`.
- **Public page reads it:** `app/r/[propertyId]/page.tsx:236` takes `searchParams.p`, plus `searchParams.src` and `searchParams.utm_source`.
- **Form carries it:** `app/r/[propertyId]/actions.ts:635` reads `listing_post_id` from the form and `:685` passes `p_listing_post_id`.
- **RPC accepts it:** migration `0214_lead_attribution_referrer_fallback.sql` declares `p_listing_post_id`, `p_source_hint`, `p_referrer_host`, `p_utm_source`, and defaults `v_source := 'website'` when nothing better arrives.
- **The referrer fallback demonstrably works:** last 30 days shows `ref:facebook.com` 14, `ref:m.facebook.com` 5, `ref:l.facebook.com` 3. That is the whole of the 23 attributed leads, and it is the fallback firing, not the tracked link.

Nothing needs building. **Do not open a Codex lane for this.**

## So why is it unused

The tracked link is offered only in one place and only conditionally. `app/dashboard/properties/[id]/page.tsx:2145`:

```ts
linkIsLive && r.listing_post_id
  ? buildTrackedLink(publicUrl, r.listing_post_id)
  : ...
```

Meanwhile the prominent "Copy link" box on the Get online card copies `publicUrl`, the **bare** `/r/<propertyId>`. That is the link an operator naturally grabs when posting an ad by hand, and every one of Agile's live Facebook ads was posted by hand.

So the default path produces an unattributed ad, and the attributed path is a conditional secondary control. The feature is not broken; it is not the default.

**This is not yet proven to be the only cause.** A referrer-stripped in-app browser would also land as bare `website`. But `listing_post_id = 0/105` is decisive on its own: whatever else is true, **no ad in circulation carries a tracked link.**

## What it costs

We cannot answer "what is any channel worth" for the one customer generating the leads. Concretely, S306 was one gate away from spending proof-ladder rungs 4 through 8 automating Kijiji, while:

- Agile's Kijiji post on Unit 20 is `expired`, posted 2026-07-24.
- Its rentals_ca post is `expired`, posted 2026-07-25.
- Its zumper post is `expired`, posted 2026-07-24.
- Unit 3 has a kijiji `draft` and nothing else.
- Facebook is the only `live` portal on any Agile unit.

Three channels lapsed 35 days ago on a live, available unit, nothing surfaced it, and **we have no attribution data to say whether they were ever producing anything.** Finishing the ladder on that basis is a bet with the scoreboard switched off.

## The fix is two operator-sized actions, not a build

1. **Make the tracked link the default copy.** The Get online card's primary "Copy link" should hand back `buildTrackedLink(...)` when a live post row exists for the channel being posted to, and say plainly why. Small, uses existing code, no migration.
2. **Re-point the four live Facebook ads at tracked links.** Operator action on Facebook. Attribution starts the moment the links change; no backfill is possible or needed.

Sequenced before either: nothing. This is cheaper than any roadmap item currently queued and it is the precondition for judging the rest of them.

## A second, separate defect surfaced by the same query

**Nothing surfaces a lapsed channel.** Three portals on Unit 20 went `expired` on 2026-07-24/25 and the product has been silent for five weeks while the unit stayed `available`. This is the twin of the S670 rule: S670 stopped the UI saying `live` without proof; nothing yet makes the UI say **"this went dark"**. Same honesty family, opposite direction. Worth its own ticket.

## Lead facts recorded, no interpretation offered

Agile's four available units, all `live` on Facebook [verified 2026-08-28]:

| unit | rent | FB posted | leads, 30d |
|---|---|---|---|
| 1551 Assumption St Unit D | $995 | 2026-08-17 | 54 |
| 833 Pillette Unit 20 | $1,195 | 2026-05-12 | 30 |
| 833 Pillette Unit 3 | $1,275 | 2026-08-17 | 0 |
| 833 Pillette Unit 33 | $1,225 | 2026-08-18 | 0 |

Units 3 and 33 went live the same week as Assumption D, same seller, same channel, same city, and have produced nothing in eleven days.

**Pricing is Narayan and Aaliyah's. This table is reported to them as fact and carries no recommendation.** Do not draft a price. See the standing rule.

---

# CORRECTION 2026-08-29: the title of this file is wrong. Attribution WAS used, then it stopped.

Caught during the S306 wrap preflight, by counting instead of carrying the earlier claim forward.

    Agile leads, lifetime:                    202
    Agile leads carrying a listing_post_id:     7
    [verified 2026-08-29 via execute_sql]

All seven are 833 Pillette **Unit 20**, all `source = 'Facebook Marketplace'` with
`source_detail` = the Marketplace item URL `1535405094643346`, all pointing at listing_post
**`cf272aa1`**, which is exactly the tracked post id in `AGILE-TRACKED-LINKS-2026-08-28.md`.

Their dates: **2026-07-01, 07-04, 07-05, 07-06, 07-08, 07-14, 07-15**. Then nothing.

    Agile leads after 2026-07-15 15:00 UTC:   140
    of those, attributed:                       0
    [verified 2026-08-29 via execute_sql]

So the machinery is not unproven. It ran, correctly, end to end, for two weeks, and produced seven
properly attributed Facebook leads. It stopped on 2026-07-15 and has produced none in the 140
leads since.

## What this changes

The earlier framing, "built end to end and never used once", was wrong and it mattered: it made
this look like an adoption problem when it is a **regression**. Something changed on or about
2026-07-15. The most likely candidate is that the Unit 20 Facebook ad's link was edited and the
`?p=` parameter was dropped, since that ad is the only one that ever carried a tracked link and
Unit 20 is the only property that ever attributed. That is checkable by reading the live ad's
body, which is a browser read on Noam's machine.

## What does NOT change

The action is the same and is still the highest return per minute open: paste the four tracked
links into the four live Facebook ads. What changes is the expectation. This is restoring
something that worked, not switching something on for the first time, so if it does not start
attributing within a day of the paste, there is a second defect underneath and it should be
chased rather than assumed to be adoption.

## The rule, for the third time today

Count it this session or do not state it. Two of this file's original claims and one whole
Kijiji recommendation came from carrying a prior session's number forward without recounting.
