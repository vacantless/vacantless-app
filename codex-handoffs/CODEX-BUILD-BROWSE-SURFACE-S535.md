# CODEX BUILD - Walled-garden browse surface (S535 Slice A)

Base: `main` at `be8a2fb` (or current HEAD; rebase forward, never backward).
Design: `claude/DESIGN-WALLED-GARDEN-LISTING-SURFACE-S535.md` (project + `codex-handoffs/`) - read it first.
Additive only. ONE additive migration. Ships DARK (`/rentals*` 404s until `BROWSE_SURFACE_ENABLED=true`).

## 0. What this is

vacantless.com's own public rental browse surface - `/rentals` and `/rentals/[city]` - listing
every customer's active, feed-ready units and routing every click into the existing
`/r/[propertyId]` detail + inquiry page. The walled-garden leg of the S534/S535 distribution
doctrine: works with zero ILS partner acceptances. SEO kit (metadata on `/r`, sitemap, robots,
`src=network` attribution) is Slice B, NOT this ticket.

## 1. Review note first

Before building, reply with a short review note: confirm the file scope below is complete and
correct against the current tree, flag anything that would force a scope change, then build.

## 2. Scope - exactly 5 files

**2a. NEW migration `supabase/migrations/0168_public_browse_listings.sql`** (next free number;
renumber if taken). `get_public_browse_listings()`: SECURITY DEFINER, `language sql`, `stable`,
`set search_path = public`. Returns a jsonb array shaped like `0110_network_listing_feed`
minus contacts: one element per org with >= 1 `status='available'` listing, each
`{ org: { name }, listings: [...] }` where each listing carries ONLY: `id, address,
rent_cents, beds, baths, sqft, floor, laundry, parking, air_conditioning, balcony, furnished,
pet_friendly, pets_cats, pets_dogs, pets_dog_size, heat_included, hydro_included,
water_included, available_date, description, photos`. NO org slug, NO contact_phone, NO
contact_email, no per-listing tokens. Same WHERE/ordering discipline as 0110. Grant execute to
`anon` + `authenticated` (this is ad content the operator already publishes on portals; the
readiness gate below keeps half-filled listings off the surface). Revoke from public if the
house pattern does so elsewhere - mirror 0110's grant block style.

**2b. NEW pure `lib/browse-surface.ts`.** No DOM / env / IO. Exports:

- `BrowseListing` / `BrowseProvider` input types mirroring the RPC payload (snake_case,
  nullable-tolerant like `FeedListingInput`).
- `browseReady(listing, orgName)` - reuses `listingFeedReadiness` from `lib/listing-feed`
  for the listing-level floor (price, >= 1 photo, >= `MIN_DESCRIPTION_CHARS` description).
  The org contact-phone leg of feed readiness does NOT apply here (the surface never shows
  contacts); document that in a comment rather than inventing a second readiness type.
- `parseCityFromAddress(address)` - pure parse of the free-text address against a fixed
  Ontario-first allowlist (Toronto, Ottawa, Mississauga, Brampton, Hamilton, London,
  Markham, Vaughan, Kitchener, Windsor, Richmond Hill, Oakville, Burlington, Oshawa,
  Barrie, Guelph, Cambridge, Waterloo, St. Catharines, Kingston + easy to extend). Case-
  insensitive match on a comma-delimited or trailing token; no match -> `null`.
- `citySlug(city)` / `cityFromSlug(slug, allowlist)` - lowercase-hyphen slugs, exact
  round-trip, junk slug -> `null`.
- `buildBrowseIndex(providers)` - filters to browse-ready listings, shapes cards
  `{ id, address, rentCents, specLine, availability, city, citySlug, coverPhoto, orgName }`
  using `buildSpecLine` + `formatAvailability` from `lib/property-features`, groups by city
  (unparseable -> "Ontario" group last), sorts cities by listing count desc then name, and
  returns `{ cities: [...], totalCount }`. Deterministic for identical input.
- `detailHref(id)` -> `/r/<id>?src=network` (the `src` param is inert until Slice B wires
  attribution; harmless today - `/r` ignores unknown params).

**2c. NEW `app/rentals/page.tsx`.** Server component, `export const revalidate = 900`.
Gate first: `process.env.BROWSE_SURFACE_ENABLED !== "true"` -> `notFound()`. Then anon
Supabase server client -> `get_public_browse_listings` -> `buildBrowseIndex` -> render: page
header ("Rentals on Vacantless" + honest one-liner), city sections with cards, each card an
`<a>` to `detailHref`. Zero listings -> friendly empty state (no fake content) with a
`robots: { index: false }` metadata object. `generateMetadata` (static title/description) is
in scope for THIS page (it is new); the `/r` metadata work is Slice B.

**2d. NEW `app/rentals/[city]/page.tsx`.** Same gate + revalidate. `cityFromSlug` miss OR
zero browse-ready listings in that city -> `notFound()`. Renders that city's cards with a
city-specific `generateMetadata` title ("Apartments for rent in <City> | Vacantless").

**2e. NEW `scripts/test-browse-surface.ts`.** tsx assert suite over the pure lib:
readiness reuse (a listing failing the feed floor never surfaces; org contact phone absence
does NOT block browse); city parser hits for allowlisted cities in real-shaped addresses
("506 Manning Ave, Toronto, ON M6G 2V9"), returns null on junk; slug round-trip + junk slug
null; index groups/sorts deterministically, unparseable city lands in the trailing "Ontario"
group; cover photo = first photo; `detailHref` shape; empty providers -> `{ cities: [],
totalCount: 0 }`, never throws on missing optional fields.

## 3. Don't touch

`lib/listing-feed.ts`, `lib/property-features.ts`, `app/r/[propertyId]/*`,
`app/api/feed/*`, `supabase/migrations/0110_network_listing_feed.sql`, `app/page.tsx`,
`middleware.ts`, `statements.ts`, `reminders.ts`, billing, `vercel.json`, workflows. Import
from libs; never modify them. (`/r` edits and the homepage Browse link are Slice B, gated on
count > 0.)

## 4. Invariants (audit against every one)

- Ships dark: env unset -> `/rentals` and `/rentals/[city]` 404 (via notFound), nothing links
  to them, sitemap/robots do not exist yet (Slice B).
- The new RPC never returns org slug/phone/email or any token; `get_network_listing_feed`'s
  service-role-only grant is untouched.
- One readiness rule: browse eligibility = feed readiness minus the org-phone leg, via
  `listingFeedReadiness` reuse - no second quality bar.
- Read-only end to end: no writes anywhere in this slice.
- Thin-page honesty: zero-listing city -> 404; zero-listing index -> noindex empty state.
- Pure lib has zero IO; env/DB work lives only in the pages.

## 5. Process

1. Deliver the review note.
2. Build 2a-2e.
3. `npx tsx scripts/test-browse-surface.ts` green; existing suites still green
   (`test-listing-feed`, siblings); `npx tsc --noEmit`; `npm run lint`; `npm run build`;
   `git diff --check` - all green.
4. Commit + push to `main`; reply with the commit SHA, file-by-file diffstat, and the review
   note. Do NOT apply the migration - flag it for Noam/Cowork to apply via Supabase MCP on
   his go (additive, no existing-table change, no backfill).

## 6. Verification (Cowork, after push)

Clone the PUBLIC repo `vacantless/vacantless-app` into the cloud; `npm install`; exact 5-file
scope + no don't-touch changes + `git diff --check` clean; independent
`npx tsx scripts/test-browse-surface.ts`; audit RPC grants (anon+authenticated, no contacts in
payload) + dark gate + readiness reuse + read-only invariant; apply mig 0168 via Supabase MCP
on Noam's go (PROMPTLY once the deploy lands, per KI814); Vercel READY on the new SHA; prod
smoke: `/rentals` 404s while `BROWSE_SURFACE_ENABLED` unset (dark confirmed).
