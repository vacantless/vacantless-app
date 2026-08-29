# FINDINGS S307: attribution died on 2026-07-15 when the ad CTA lost its tracking parameter

Written 2026-08-29. [verified 2026-08-29 via execute_sql on leads, and by reading
lib/lead-attribution.ts, app/r/[propertyId]/actions.ts and AGILE-SHARED-CONSTANTS.json]

## Correction to this session's own first hypothesis

S307 first proposed that attribution was flag-gated and off. **That is wrong and the data
disproves it.** `LEAD_ATTRIBUTION_REFERRER_ENABLED` is ON in production: 23 Agile leads
carry a `ref:` source_detail (`ref:facebook.com` 14, `ref:m.facebook.com` 5,
`ref:l.facebook.com` 3, `ref:com.google.android.googlequicksearchbox` 1). The referrer path
fires and works. Do not go looking for a switch to flip.

## The actual timeline, from the rows

Every Agile lead up to and including 2026-07-15 is attributed. Every one after is not.

| period | leads | attributed | what source says |
|---|---|---|---|
| 2026-05-01 to 2026-07-15 | 87 | all attributed by one of 3 paths | Facebook Marketplace |
| 2026-07-15 to 2026-08-28 | 115 | 0 | `website`, source_detail NULL |

The last tracked lead and the first untracked lead are **the same day**, 2026-07-15. There
is no ramp and no partial period. It is a clean cutover.

## Three attribution paths, all proven to have worked

1. **Per-post tracked link.** `?p=<listing_post_id>` on the `/r` URL
   (`actions.ts:634`). 7 leads, 2026-07-01 to 2026-07-15, all carrying FB post
   `cf272aa1` as `source_detail`.
2. **Manual campaign tag.** 5 leads, 2026-05-29 to 2026-06-19, `source_detail`
   `fb-pillette`, `fb-pillette-A`, `fb-pillette-B`.
3. **Referrer host.** 23 leads, still firing today, for renters who click an actual link.

Path 3 still works but catches little, because a Facebook Marketplace rental ad has no
clickable link. The renter reads the URL out of the ad body and types it, which sends no
referrer. Paths 1 and 2 are the ones that covered Marketplace, and both stopped on
2026-07-15.

## The standing spec now guarantees the blindness continues

`AGILE-SHARED-CONSTANTS.json` line 132, `listing_rules.primary_cta_note`, written S662:

> every listing ad CTA is the unit's own `https://app.vacantless.com/r/<property_id>` link.
> **That link is what makes a lead attributable**

That sentence is false, and it is the operative instruction for every ad written since.
A bare `/r/<property_id>` is precisely the URL shape that produces `source = "website"`
and `source_detail = NULL`. Attribution comes from the `?p=<listing_post_id>` suffix, or
from a `utm_source`, neither of which the constant mentions.

So whatever caused the 2026-07-15 cutover, the documented CTA standard currently
reproduces it on every new ad.

## Why this outranks the Kijiji spend decision

Open item 6 is whether the worker may spend on Kijiji. That is a cost-per-lead question.
Today 115 of Agile's 202 leads, and 100 of 100 August leads, carry no channel. The spend
decision cannot be made on evidence until the CTA carries a tag again. Attribution is
upstream of the money.

## The fix is operational, not a build

Nothing needs to be written. The tracked-link mechanism exists, is deployed, and is proven
by 7 real leads. What is needed is:

1. Correct `primary_cta_note` in `AGILE-SHARED-CONSTANTS.json` so the standard stops
   specifying an untrackable link.
2. Put the tracked form of the CTA into the four live Facebook ads. This is the wrap's
   existing open item 2.
3. Confirm whether `LEAD_ATTRIBUTION_TRACKED_COPY_ENABLED` is set in production. It gates
   whether the dashboard offers the tracked link for copying
   (`app/dashboard/properties/[id]/page.tsx:1401`). If it is off, the operator has no
   supported way to obtain the right URL, which would explain the hand-made `fb-pillette`
   tags. NOT verified this session: Vercel env is baked at build and was not read.

## Standing rule this produces

A constants file that asserts a mechanism works is not evidence that it works. This one
asserted attributability for the exact URL shape that destroys it, and it was believed for
six weeks across 115 leads. Check a claim like that against the rows, not the note.

## ADDENDUM, same session: Facebook is HARDCODED out of tracked links

Item 3 above asked whether `LEAD_ATTRIBUTION_TRACKED_COPY_ENABLED` is on in production.
That question turns out to be largely moot for Agile, and the reason is worse.

`app/dashboard/properties/[id]/page.tsx`, inside the `trackedUrlByPortal` builder:

```
if (portal === "facebook") {
  // Marketplace renters usually retype the link, so keep Facebook copy on
  // the short bare URL. Slice A covers its referrer signal.
  return [];
}
```

**Even with the flag ON, Facebook copy never receives a tracked link.** It is excluded by
name, deliberately, with a stated rationale. Introduced in `8ee823b`, "S654 Slice B: add
tracked copy links", dated 2026-08-14.

Facebook Marketplace is the ONLY live channel on every available Agile unit. So the one
channel that produces all the leads is the one channel excluded from the mechanism that
would identify them.

### The stated rationale is falsified by the rows

The comment argues renters retype the link, so a tracked URL would not survive, and the
referrer signal covers it instead. Both halves cannot be true at once:

- A renter who **retypes** the URL sends **no referrer**. The fallback cannot fire.
- A renter who **clicks** would have carried the tracked link fine.

The data agrees with the second reading. The referrer path has produced **23** attributed
leads across all of Agile's history. In the same window the bare-link path produced **115**
leads with nothing at all. The referrer signal does not cover Marketplace. It barely
touches it.

### The 115 are real renters, not noise

115 leads, **89 distinct emails**, 85 distinct phones, **0 with no contact details**,
spread over three units: Pillette 20 (40), Assumption D (39), Pillette 22 (36). These are
real people who enquired and cannot be traced to an ad.

## What is still NOT explained

The Facebook exclusion is dated 2026-08-14. The attribution break is 2026-07-15, a month
earlier. **So the exclusion entrenches the gap but did not cause it.** The July 15 cause is
still unidentified.

The likeliest explanation, NOT yet proven: 2026-07-15 is also the day of the "Legacy import
2026-07-15" lead migration and the period when Tally was retired as the intake path. The
Unit 20 ad, post `cf272aa1`, is still `live` and was created 2026-07-01, so the ad itself
did not expire. Something changed the CTA inside it.

**The cheap way to settle it:** read the current ad text of the live Unit 20 Marketplace ad
and look at what URL it actually carries. Read the text only. Do NOT open the `/r` link,
which registers a click and pollutes attribution (KI1108).

## ADDENDUM 2: the July 15 break was NOT a code change

Checked `git log --since=2026-07-05 --until=2026-07-25` across every file in the CTA and
listing-copy path: `lib/listing-distribution.ts`, `lib/copilot-sidecar.ts`,
`lib/extension-kit.ts`, `lib/listing-copy.ts`, `app/dashboard/properties/[id]/page.tsx`.
**Zero commits.** The code that builds ad copy did not move in that window.

So the 2026-07-15 cutover was operational, not a deploy. Either the live ad text was
edited that day, or the leads began arriving from ads that never carried a tag.

The lead split supports the second reading more than the first: the 115 untracked leads
are spread across Pillette 20 (40), Assumption D (39) and Pillette 22 (36), while the 7
tracked leads all point at ONE post, `cf272aa1`, Unit 20's Facebook ad. Only Unit 20 ever
had a tagged link. When Assumption D and Pillette 22 went up, they were posted with bare
links, and Unit 20's own share drifted untagged as renters retyped rather than clicked.

**Attempted and blocked:** reading the live Unit 20 ad text. Chrome on the Mac is signed in
under a Facebook PAGE profile, and every Marketplace item URL redirects to
`/marketplace/ineligible/` with "Pages can't use Marketplace". This is the standing
constraint already recorded from S670. Settling it needs Noam's personal profile.

**Judgement: this forensic question is now optional.** Whatever happened on 2026-07-15, the
remedy is identical: put a tagged link in the ads, and stop the code excluding Facebook
from generating one. Do not spend a person's time on the July question before doing the
fix.
