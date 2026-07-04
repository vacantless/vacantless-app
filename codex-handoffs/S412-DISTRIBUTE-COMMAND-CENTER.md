# S412 - Distribute command center (Slice 1)

Date: 2026-07-04
Repo: `vacantless-app` on `main`
Review target: the S412 commit (this note is committed in it).
Type: NEW feature, presentation + one pure lib. No migration, no env, no new
server action, no data-model change.

## What this is

First slice of the "best-in-class listing syndication" plan
(`VACANTLESS_LISTING_SYNDICATION_BEST_IN_CLASS_PLAN_2026-07-04.md`). It
consolidates the app's already-shipped, but scattered, distribution pieces
(per-channel copy, fill sheets, guardrails, the org XML feed, and the
where-posted tracker) into ONE rental-level **Distribute** tab of channel cards.
No new partner integrations. Honest by design: assisted-manual only, never
claims automated posting.

## Scope decision (Noam's call, this session)

- New **Distribute** tab as first-class nav on the rental detail page.
- **Photos & marketing** keeps Marketing Kit / Listing Copy / Fill Sheet /
  photos / share-readiness (the "Where this is posted" card was renamed
  **Posting reference** and now holds only BeforeYouPost + FillSheetCard, plus a
  "Ready to publish? -> Distribute" bridge).
- The old **Where posted** tracker (the `listing_posts` list + add/edit/remove
  forms) was **moved into** the channel cards, not duplicated.

## Files

- `lib/distribution-channels.ts` - **new, pure** (no DOM/env/IO). The channel
  matrix (`DISTRIBUTION_CHANNELS`: facebook, kijiji, rentals_ca, zumper, viewit,
  realtor_ca - `other` is intentionally NOT in the matrix, it is the free-form
  catch-all) + `computeChannelStatus()` (a reducer over a channel's
  `listing_posts` + share-readiness blockers + org-tz today) returning
  `not_started | ready | posted | needs_refresh | problem` with blockers,
  liveUrl, lastPostedOn, inquiryCount. Repost/refresh threshold
  `DEFAULT_REFRESH_DAYS = 14`. Reuses the existing `PortalKey` /
  `ListingPostStatus` / `CopyPortalKey` types so it lines up with an existing
  `listing_posts` row and the copy channels - no new keys invented.
- `scripts/test-distribution-channels.ts` - **new**, 79/0. Matrix coherence
  (modes/urls/blurbs, realtor_ca is broker + has no self-serve copy, feed
  eligibility) + every status-precedence branch (fresh/stale/no-date/no-url live,
  expired/removed, draft-only, no-posts with/without blockers, most-recent-live
  pick, inquiry summing, Set-Live blocker injection + de-dup) + `daysBetween`
  boundaries (>= threshold inclusive).
- `app/dashboard/properties/[id]/distribute-tab.tsx` - **new** server component.
  Renders the header (readiness signal + channels-posted count), one
  `ChannelCard` per matrix row, and an "Other channels" card. Each channel card:
  mode chip + status chip, blurb, live-ad link + "Posted <date>", refresh/problem
  banners, "Before you post here" blockers, a feed note (feed-eligible channels),
  "Open <portal>" + "Copy this channel's wording" (via the existing
  `CopyTextButton`) + a deep-link to the full copy/fill sheet, and this channel's
  tracked posts with `CopyLink` + inline edit/remove + a "Track a post / mark as
  posted" add form. **Reuses the existing `addListingPost` / `updateListingPost`
  / `removeListingPost` server actions unchanged** - the per-channel forms just
  pin `portal` via a hidden input.
- `app/dashboard/properties/[id]/page.tsx` - builds the channel-card data
  (`distributeChannelCards`, `distributeOtherPosts`) from `postRows` / `postCounts`
  / `copyTabs` / `readiness` / `marketingFeedStatus` / the org-tz `detectorToday`;
  adds the `TabPanel tabId="distribute"`; renamed the Posting-reference card and
  added the bridge; **removed the moved tracker block** and the now-unused imports
  (`addListingPost`/`updateListingPost`/`removeListingPost`, `PORTALS`,
  `LISTING_POST_STATUSES`, `portalLabel`, `listingPostStatusLabel`).

## Intentional-by-design (please don't "fix")

- **Server component renders `<form action={serverAction}>`** and imports the
  actions directly from `../actions` - matches the app's redirect-based action
  pattern; the two interactive bits (`CopyLink`, `CopyTextButton`) are the
  existing client islands.
- **Blockers are listing-level (channel-agnostic) in Slice 1** - derived once
  from share-readiness (photos/rent/beds+baths/address); the "Set this rental
  Live" blocker is injected by `computeChannelStatus` itself and de-duplicated.
  Per-channel blockers (Facebook unique-photos, feed required fields) are a later
  slice.
- **A live post wins over unmet blockers** (status = posted/needs_refresh) but the
  blockers still surface as warnings - the operator may have posted anyway.
- **`feed` note is informational only** (shown for rentals_ca/zumper when the
  marketing entitlement produced a feed signal). Real partner acceptance /
  onboarding is a later slice (S413) - this slice makes no partner claim.
- **The refresh-age sentence** uses the same org-tz `today` passed into the tab as
  the status decision (no separate clock).

## Verification (here)

- `npx tsc --noEmit` - clean (exit 0).
- `npx next lint` on `distribute-tab.tsx`, `page.tsx`, `lib/distribution-channels.ts`
  - no warnings or errors.
- `scripts/test-distribution-channels.ts` - 79/0.
- Regressions: `test-listing-distribution` 66/0, `test-listing-marketing` 26/0,
  `test-booking` 40/0.
- Live smoke on North Star QA: PENDING (fill in after deploy).

## Not in this slice (sequenced later, per the plan)

`distribution_runs` persistence + a guided step-by-step launch run (S412/next);
feed-partner onboarding cards + acceptance/rejection tracking (S413);
Facebook/Kijiji QR + reply-snippet tooling + saved-progress launch (S414);
post-publish QA checker; channel export packages; a real external partner proof
(S415).
