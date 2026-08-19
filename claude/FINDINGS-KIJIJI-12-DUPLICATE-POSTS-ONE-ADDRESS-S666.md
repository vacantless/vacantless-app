> ## PARTIALLY INVALIDATED 2026-08-18 (same session, at wrap). Read this first.
> **The "Kijiji swept the account for duplicate posting" inference below is WITHDRAWN.**
> The project's own records already explained the deletions and were not consulted:
> - `350 City Hall Square West` is a **FAKE placeholder test address** (property `092591ea`).
> - Ad `1742007773` was **deliberately deleted by Noam on 2026-08-14** after a real renter
>   (James Wonnacott) inquired on the fake address. SESSION_LOG S653 + **KI1069**.
> - S656 records the two 2026-08-12 Growth Test ads were **swept by us** as well.
> - **The single shared Kijiji account `admin@vacantless.com` holding both the test ad and
>   Agile's Pillette ads was ALREADY recorded in KI1069.** It is not a new finding.
> - Most of the 12 ads were **deliberate Relist Radar proof runs** across S648-S653, since deleted.
>
> **What still stands:** the duplicate-post code defect is real and independent (10 ads from ONE
> run item, `4dc42e36`), and is fixed by `codex/s666-duplicate-post-guard`. Agile's Unit 20 ad
> `1739552585` remains genuinely unexplained: Agile has 202 Kijiji attempts and ZERO that ever
> produced a live_url, so this system never posted it, and only one delete was ever performed.
> **What dies:** the enforcement inference and the "a QA loop took out two paying customers'
> ads" claim built on it.

# FINDINGS - The QA lane posted ONE address to Kijiji 12 times in 3 days, and every ad on the account is now gone (S666)

_2026-08-18. All figures are Supabase reads plus the signed-in Kijiji account. This supersedes both the "the radar deleted them" inference and the "each new post evicted the previous" hypothesis. Neither survived._

## The numbers, all directly from the database

`distribution_publish_attempts`, channel `kijiji`, joined to the run's property:

| Org | Attempts | First | Last | Attempts with a `live_url` |
|---|---|---|---|---|
| **Agile Real Estate Group** | **202** | 2026-07-24 | 2026-08-14 | **0** |
| **Growth Test** | 46 | 2026-08-08 | 2026-08-14 | **12** |
| North Star Rentals QA | 2 | 2026-07-13 | 2026-07-13 | 0 |
| Abbas Husain | 1 | 2026-08-18 | 2026-08-18 | 0 |

**All 12 posted ads are the same property: `350 City Hall Square West`. Twelve distinct ad ids,
inside 63 hours:**

`1741882288` (08-11 20:34), `1741884538` (21:19), `1741886683` (22:05), `1741911387` (08-12 13:01),
`1741915100` (14:37), `1741928659` (19:03), `1741932319` (20:21), `1741943272` (08-13 01:02),
`1741945214` (02:05), `1741945806` (02:27), `1741956439` (12:25), `1742007773` (08-14 12:18).

**Across the entire history of the system, exactly ONE Kijiji delete was ever confirmed**
(`distribution_run_items`: 3 items carry a `relist_radar_backup`, 1 has `delete_confirmed_at`,
1 has `repost_confirmed_at`, 2 failed at preflight). That single delete removed `1741956439`,
Growth Test's own previous ad. **The other eleven were never cleaned up by us.**

## What this rules out

**The relist radar did not delete Agile's ad.** Agile has 202 Kijiji attempts and **zero** ever
produced a `live_url`, so this system never successfully posted a Kijiji ad for Agile at all. Unit
20's ad `1739552585` was created outside this pipeline, by hand or by the legacy stack. And with only
one delete ever performed, against a Growth Test ad, the worker never touched it either. This
matches the code gate found earlier: `deleteKijijiAdFromMyAds` has one caller, hard-gated to the
Growth Test org id in source (`vacantless-worker/src/phase-b-submit.ts:1578`, enforced `:2350`).

**The eviction chain is dead too.** It required repeated deletes clearing the slot for each new post.
There was one delete. Eleven ads went up with nothing removed to make room.

## The most probable explanation, labelled as inference

**Proven facts:** twelve separate ads for one address from one account in under three days; only one
cleaned up; `My Ads` on `admin@vacantless.com` now reads **Active 0, Inactive 0**; the ads are absent
from the Inactive tab, which Kijiji's own copy says is where expired ads live, so they were deleted
rather than left to expire; no policy notice or warning anywhere in the account or its inbox.

**Inference, not proof:** this is the shape of Kijiji's duplicate-posting enforcement. Twelve
near-identical listings for a single Windsor address inside 63 hours is the pattern their anti-spam
exists to catch, and a sweep of the account's ads is the usual consequence. It fits every observed
fact including the ones that puzzled us: why `1742007773` died four days after a **confirmed
successful** repost with eight weeks left on its clock, and why Agile's hand-posted ad died despite
no code path being able to touch it.

**If that is right, the collateral damage is the real story: a test property's posting loop took out
two paying customers' live ads** - Agile Unit 20 `1739552585` and Abbas 50 Glenrose `1740198922` -
on a shared account neither of them knew they were sharing.

## The structural problem underneath

**One Kijiji account, `admin@vacantless.com`, serves every org.** Growth Test, Agile and Abbas all
posted through it. The account's own plan cards, captured in the 2026-08-14 preflight, read
**"You've reached the free ad"** with all six options at $29.95, so free posting is rationed at the
account level.

`listing_posts` models none of this. It happily held three `live` kijiji rows for three different
customers at once, and there is no unique index or per-account accounting anywhere. Every
listing-health signal built on that table will keep reporting Kijiji ads as live when the account
they live on has been swept.

**Whatever else changes, a QA org must not post to a production channel account.** The org gate in
the worker protects Agile from *deletes*; it does nothing to stop a Growth Test posting loop from
burning the shared account's standing.

## Open, and worth answering before Kijiji is used again

1. Why did the same property get posted twelve times? Nine of the twelve ended `needs_operator`
   rather than `live`, so the loop appears to have retried on non-confirmation while still leaving a
   real ad behind each time. **That retry path is the bug, and the S666 duplicate-post guard prompt
   (`CODEX-PROMPT-DUPLICATE-POST-GUARD-S666.md`) is the fix.**
2. Is the account actually restricted now, or merely emptied? It still offers "Post ad", but the only
   way to know is to post once and watch, which is a decision, not a diagnostic.
3. Does each org need its own Kijiji account, or does Kijiji become a paid-only channel? See
   `DECISION-KIJIJI-SHARED-ACCOUNT-OPTIONS-S666.md`.

## Housekeeping note

The `distribution_freshness_cron` flipped Abbas's kijiji attempt `live -> stale` at 2026-08-18 13:28
UTC. That is the cron observing reality, not a new post. Benign.
