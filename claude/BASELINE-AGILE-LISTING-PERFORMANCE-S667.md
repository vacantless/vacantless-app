# BASELINE - Agile listing performance, frozen 2026-08-19 (S667)

_Purpose: two ads have produced zero leads. Two days is not enough data to act on. This file
freezes the numbers so the Friday re-check is a comparison, not a fresh guess. Every figure is a
Supabase read or a screen read, taken 2026-08-19 ~07:45 UTC / 03:45 EDT._

## The four available Agile units

| Unit | property_id | Rent | FB item | Posted | Leads lifetime | Leads 7d | Last lead |
|---|---|---|---|---|---|---|---|
| 1551 Assumption D | `af6b0aae-d714-4ddf-9c09-cac2b272a922` | $995 | `1915331599118623` | 2026-08-17 | 6 | 6 | 2026-08-19 07:41 UTC |
| 833 Pillette 20 | `ff465273-fb18-4add-8d9e-9160bd804146` | $1,195 | `1535405094643346` | 2026-05-12 | 82 | 11 | 2026-08-18 23:10 UTC |
| 833 Pillette 33 | `3208db02-39cd-4e80-bb76-31cc724793ac` | $1,225 | `1384693680275876` | 2026-08-18 | **0** | **0** | never |
| 833 Pillette 3 | `ab3a44a0-9959-4ee2-9774-0dbbc896ab16` | $1,275 | `2351921432302721` | 2026-08-17 | **0** | **0** | never |

Unit 32 (`3bedc363-47a4-4efb-86e6-1b1ccea47c51`, $1,225) is deliberately `paused` and has no ad.
Do not restore it without Noam.

## What has ALREADY been ruled out

- **Not a broken CTA.** Unit 3's live ad body was read on 2026-08-19 and carries the correct link,
  `https://app.vacantless.com/r/ab3a44a0-9959-4ee2-9774-0dbbc896ab16`, plus ext 103 and CA$1,275.
  Do not re-check this unless the ad has been edited since.
- **Not a missing `listing_posts` row.** All four now have a live facebook row. Assumption D's was
  missing entirely and was backfilled in S667 as `31c1ed5d-609c-4c08-9c6f-c228f5e3e408`.
- **Not stale rent.** Narayan confirmed all four figures in writing on 2026-08-18.

## CORRECTION carried by this file: FB "clicks on listing" is a ROLLING 7-DAY WINDOW

S665 recorded Unit 20 as "751 clicks" as though it were a lifetime counter. It read **711** on
2026-08-19. A counter that decreases is not cumulative. **`facebook.com/marketplace/you/insights`
is explicitly headed "Last 7 days"**, and the per-listing figures on the Selling page come from the
same window. Never compare a click figure to one recorded on a different date as if it were growth.

Click figures on 2026-08-19, last 7 days:

- Account-wide: **1,369** clicks, 31 saves, 1 share, 0 followers.
- Unit 20 ($1,195): **711**
- Assumption D ($995): **261** (the ad still reads "Listed on 5/12" because it was restored from
  Rented rather than reposted, so its listing date is the ORIGINAL one, not 8/17)
- The $2,150 listing: 4. The fire pit: 52. The hoodie: 0.

**Units 3 and 33 could not be read.** The Selling page still caps at 5 rows against **11 active
listings**, and the documented `?order=CREATION_TIMESTAMP&state=LIVE&status[0]=IN_STOCK` workaround
did NOT beat the cap on 2026-08-19. The five visible rows account for 1,028 of the 1,369, leaving
**about 341 clicks spread across six unseen listings**, of which Units 3 and 33 are two. That is a
BOUND, not an attribution. Do not report it as "Units 3 and 33 got 341 clicks."

## The question the re-check has to answer

**Are Units 3 and 33 getting clicks that do not convert, or getting no clicks at all?** The answer
decides the action and the two are opposite:

- **Clicks but no leads** -> the ad is being seen and the offer is not landing. Price, photos, or
  the first description line. A price conversation with Narayan.
- **No clicks** -> the ad is not being surfaced. Freshness, category, or FB throttling a seller with
  11 near-identical listings. A distribution problem, not a pricing one.

Getting the per-listing number for those two is the ONE hard part of the re-check. Options, in order
of preference: the Selling page search box (`?title_search=`, known to also cap at 5, so try it but
do not trust an absence); scrolling the Selling page after the lazy-load stalls; or opening each item
as the seller and looking for an insights control on the item itself.

## Decision rule for the re-check

Unit 3 goes 5 full days from its 2026-08-17 post with confirmed reach and still zero leads -> take
it to Narayan as a pricing question, with Assumption D at $995 pulling 6 leads in 2 days and Unit 20
at $1,195 pulling 11 a week as the comparison. **Do not raise it before that.** Two days of silence
on a new ad is normal and Narayan confirmed these rents in writing on 2026-08-18; going back to him
inside a week on two days of data spends credibility for nothing.

---

# RE-CHECK RESULT, 2026-08-21 (S670)

Run at 2026-08-21 10:24 EDT / 14:24 UTC. Read-only: SELECT queries and one
read-only browser attempt. No ad posted, edited or deleted. No lead worked.

**The scheduled task `trig_01N9qXeXaas23L1FbV1tmQxD` fired at 08:01 EDT and wrote
NOTHING.** It is recorded as `run_once_fired`, and this file sat unchanged at its
2026-08-19 timestamp for two and a half hours afterwards. That silence is a defect
in its own right, separate from whether it was blocked: a run that cannot answer
must still append an explicit unable-to-answer note. This entry is written by hand
to close that gap.

## Lead counts: SETTLED. Two units moved, two did not.

| unit | rent | baseline 08-19 (lifetime / 7d) | now (lifetime / 7d) | change since 08-19 |
|---|---|---|---|---|
| 1551 Assumption D | $995 | 6 / 6 | **19 / 19** | **+13** |
| 833 Pillette 20 | $1,195 | 82 / 11 | **83 / 12** | +1 |
| 833 Pillette 33 | $1,225 | 0 / 0 | **0 / 0** | none, ever |
| 833 Pillette 3 | $1,275 | 0 / 0 | **0 / 0** | none, ever |

Newest lead: Assumption D 2026-08-21 09:01 UTC, Unit 20 2026-08-21 14:06 UTC.
Units 3 and 33 have `max(created_at) = null`. Not "none recently". None ever.

## Ad state, read from listing_posts

| unit | portal | status | posted_on | days live |
|---|---|---|---|---|
| Assumption D | facebook | live | 2026-08-17 | 4 |
| Pillette 20 | facebook | live | 2026-05-12 | 101 |
| Pillette 3 | facebook | live | 2026-08-17 | 4 |
| Pillette 33 | facebook | live | 2026-08-18 | 3 |

Unit 20 additionally carries kijiji `expired`, kijiji `draft`, rentals_ca
`expired` and zumper `expired`. Unit 3 carries a kijiji `draft`. Those are
history, not reach. **Facebook is the only live channel on all four.**

CAUTION on those `live` values: S670 proved a facebook row can sit at `live` long
after the ad is gone, because nothing probes the portal (see
`FINDINGS-GLENROSE-4-FACEBOOK-STUCK-LIVE-S670.md`). These four are recent enough
that staleness is unlikely, but `live` here still means "an operator said so",
not "verified up".

## THE FINDING: a same-day controlled comparison the baseline did not anticipate

**Assumption D and Unit 3 were posted on the SAME DAY, 2026-08-17, to the SAME
channel, from the SAME seller account, and have each been live 4 days.**

- Assumption D, **$995** -> **19 leads**
- Unit 3, **$1,275** -> **0 leads**

And within 833 Pillette itself, holding address and seller constant:

- Unit 20, **$1,195** -> 12 leads in 7 days, 83 lifetime
- Unit 33, **$1,225** -> 0
- Unit 3, **$1,275** -> 0

So the Pillette address is not wholesale throttled: Unit 20 lives there and pulls
about 12 a week. The break sits between $1,195 and $1,225.

## Click data: UNAVAILABLE, and NOT for the reason expected

The baseline predicted the Facebook Selling-page 5-row cap. **That is not what
blocked this run.** `facebook.com/marketplace/you/insights` redirected to
`facebook.com/marketplace/ineligible/` with:

> "Pages can't use Marketplace. Try logging out and back in, or switching to your
> personal profile to continue."

Chrome is authenticated as a **Facebook Page**, not the personal profile that owns
the Marketplace listings. No per-listing click number could be read for any unit,
including the two that worked. Switching profile is an account-context change on a
live account and was not done unilaterally.

**Consequence:** the clicks-versus-conversion question is still formally open. We
cannot yet distinguish "Units 3 and 33 are not being surfaced" from "they are
surfaced and the price is not landing".

## Per-unit conclusion

- **833 Pillette Unit 3 ($1,275): click data unavailable.** Zero leads ever, 4 days live.
- **833 Pillette Unit 33 ($1,225): click data unavailable.** Zero leads ever, 3 days live.
- **1551 Assumption D ($995): leads changed, sharply.** 6 -> 19 in two days.
- **833 Pillette Unit 20 ($1,195): leads changed, slightly.** 82 -> 83.

## Unit 3: is the pricing question to Narayan supported?

**Not yet by the letter of the rule, and the gap is one day plus the missing click
data.** The rule required 5 full days from the 2026-08-17 post AND confirmed reach.
Today is 2026-08-21, so Unit 3 is at **4 days**. Five full days completes
**2026-08-22**. Reach is unconfirmed because of the Page-context block above.

**But the evidence is now materially stronger than the rule anticipated.** The rule
was written to prevent going to Narayan on two days of silence from a single ad.
What exists instead is a same-day, same-channel, same-account control showing 19
versus 0, plus a within-building comparison putting the break between $1,195 and
$1,225. That is not thin.

**Recommendation: hold one more day, then raise it.** Re-read the counts on
2026-08-22. If Units 3 and 33 are still at zero, the 5-day condition is met and the
comparison is strong enough to take to Narayan as a pricing question even without
click data, stating plainly that reach was never confirmed. Going today buys almost
nothing and spends the credibility the rule was written to protect.

**What remains unknowable until the Facebook profile context is fixed:** whether
Units 3 and 33 are getting clicks that do not convert, or no clicks at all. Those
imply opposite fixes. Price is the leading hypothesis on the lead evidence, but it
is a hypothesis, not a measurement.
