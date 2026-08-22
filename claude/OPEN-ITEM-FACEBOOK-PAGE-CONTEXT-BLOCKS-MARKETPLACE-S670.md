# OPEN ITEM: Chrome is in Facebook Page context, which disables ALL Marketplace measurement

Found 2026-08-21 (S670) while running the Units 3 / 33 zero-lead re-check.
**Deliberately kept OUT of the pricing re-check** so an ops blocker does not get
mixed into a commercial question. This is the separate follow-up.

## What happens

`https://www.facebook.com/marketplace/you/insights` redirects to
`https://www.facebook.com/marketplace/ineligible/` and returns:

> **"Pages can't use Marketplace. Try logging out and back in, or switching to your
> personal profile to continue."**

Chrome is authenticated as a Facebook **Page**, not as the personal profile that
owns the Marketplace listings.

## Why it matters more than one blocked run

**Facebook Marketplace is the ONLY live channel on all four available Agile units.**
Verified 2026-08-21 from `listing_posts`: Assumption D, Pillette 3, 20 and 33 each
have exactly one `live` row and it is `facebook`. Unit 20's kijiji, rentals_ca and
zumper rows are all `expired` or `draft`; Unit 3's kijiji row is `draft`.

So while Chrome sits in Page context:

- **No per-listing click count is readable for any unit**, including the two that
  are working. This is not a Units 3 and 33 problem, it is total.
- The clicks-versus-conversion question cannot be answered at all. Those two
  diagnoses imply OPPOSITE actions: clicks without leads is a price and photos
  conversation, no clicks is a distribution problem. Guessing between them risks
  repricing a unit that was never surfaced, or reworking distribution on a unit
  that was seen and simply priced too high.
- The only reach signal the Agile lane has is silently unavailable, and nothing in
  the product surfaces that fact.

## What is NOT the problem

The 2026-08-19 attempt was blocked by the Facebook Selling-page **5-row cap**
against 11 active listings, and the documented workaround
`?order=CREATION_TIMESTAMP&state=LIVE&status[0]=IN_STOCK` did not beat it. **That
is a different, second blocker.** Fixing the profile context does NOT fix the row
cap. Expect to hit the cap again once the context is fixed, and to still need a
per-item route to the numbers.

## Why it was not fixed in place

Switching Facebook profile, or logging out and back in, is an account-context
change on a live social account that also owns the Vacantless Page and the
in-review Meta app. It was not done unilaterally during a read-only measurement
task. It needs Noam, and it needs deciding deliberately.

## Before changing anything, check the blast radius

The Meta App Review for "Vacantless Distribution" (`1570549797986951`) is IN
REVIEW, and two Meta posts are live on purpose until it returns. Confirm that
switching profile or re-authenticating in this browser cannot disturb the app's
session, the Page's posting rights, or the reviewer flow. If in doubt, do the
Marketplace read in a separate browser profile rather than changing this one.

## Suggested resolution, cheapest first

1. Read Marketplace insights from a **separate Chrome profile** signed in as the
   personal profile that owns the listings. Leaves the current session untouched
   and sidesteps the blast-radius question entirely.
2. If that is impractical, switch profile in place, take the readings, and switch
   back, having first confirmed point 4 above.
3. Either way the **5-row cap remains**. Plan for a per-item route to the numbers,
   for example opening each Marketplace item as the seller and looking for an
   insights control on the item itself.

## Status

**OPEN.** Not blocking the 2026-08-22 pricing re-check, which is designed to
proceed on lead data alone and to record this blocker verbatim if it recurs.
