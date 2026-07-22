# DESIGN - Walled-garden public listing surface (S535, 2026-07-20)

The "Plan B that is also Plan A" leg of Noam's s526 doctrine: assume NO ILS partner ever
accepts the feed and still be #1. vacantless.com becomes its own rental destination - a public
browse surface fed by the same data as the network feed, with SEO the portals cannot take away
and every inquiry landing straight in the operator's pipeline. Repo-grounded at `be8a2fb`.

**STATUS (updated 2026-07-20 end of s527): SLICES A AND B BOTH SHIPPED LIVE-DARK.** Slice A = `83acc47` (mig 0168 APPLIED); Slice B = `6b7613b` (mig 0169 APPLIED). Everything gated by BROWSE_SURFACE_ENABLED (unset in prod). Go-live = section 6 checklist; step 0 is DELETING THE TEST ORGS (the browse RPC returns them). Slice C (polish) remains future.

BD status at write time (s527): all three ILS outreaches SENT (Zumper email, Rentsync demo
form, Kijiji business form). This surface is NOT a fallback we build only if they say no; it
compounds regardless. Feed acceptances just add more 0-click channels on top.

---

## 1. What exists today (verified in repo at be8a2fb)

- **`/r/[propertyId]`** (`app/r/[propertyId]/page.tsx`, 536 lines): the public listing detail
  page. Brand-themed per org, photo gallery, spec/amenity lines, inquiry form with screening
  asks, real slot booking (`generateSlots`), waitlist, slot-taken retry via httpOnly cookie,
  tracked-post attribution (`?p=<listing_post_id>` -> lead source resolves to the channel;
  absent/foreign -> `'website'`). `force-dynamic`. A leased unit still loads to say it is gone;
  draft/paused/off-market 404.
- **NO SEO on it**: no `generateMetadata`, no JSON-LD, no `app/sitemap.ts`, no `app/robots.ts`
  anywhere in the app. The page is designed as a link DESTINATION (renters arrive from posted
  ads), not a page a search engine can find. Google effectively does not know Vacantless
  listings exist.
- **No browse surface**: nothing lists active rentals across orgs. The homepage
  (`app/page.tsx`) is landlord marketing with its own metadata.
- **`get_network_listing_feed()`** (mig `0110`): jsonb array of `{org{name, slug,
  contact_phone, contact_email}, listings[...]}`, one element per org with >= 1
  `status='available'` listing. SECURITY DEFINER, execute granted to service_role ONLY -
  correct for the partner feed (it dumps org contact details).
- **`lib/listing-feed.ts`** (492 lines, pure): readiness floor (price present, >= 1 photo,
  description >= 50 chars, property type, org contact phone), caps (50 photos cover-first,
  3,500-char description), XML escaping, per-org + network builders.
- **Attribution rails**: `buildTrackedLink` appends `?p=`; `app/r` actions preserve `p` across
  every redirect; `leads.source` column exists since mig `0002`.

## 2. Design principles (carried from the doctrine + house ethos)

1. **One readiness rule everywhere.** A listing appears on the browse surface if and only if
   it would enter the feed (reuse the `lib/listing-feed.ts` readiness check). No second
   quality bar to drift.
2. **The pipeline is the contact channel.** The browse surface NEVER prints the org's phone
   or email. Inquiries flow through the existing `/r` form into leads, screening, booking.
   That is the product's whole value and the attribution moat.
3. **Honest surface, no inflation.** With one paying customer the surface is small. Thin
   pages are not faked: zero-listing city pages 404, the index with zero listings noindexes
   itself, the homepage links to Browse only when there is something to browse.
4. **Ships dark, default-closed** (house style, same as S534's `EXTENSION_ALLOWED_ORIGIN`):
   the whole surface 404s until `BROWSE_SURFACE_ENABLED=true` is set. Flip = env + redeploy,
   on Noam's eyeball.
5. **Additive only.** No existing file's behavior changes except `/r/[propertyId]` gaining
   metadata/JSON-LD/noindex and the inquiry action learning one new source value.

## 3. The surface

### Routes

- **`/rentals`** - the index. Server component. Groups active listings by city, shows count,
  cards (cover photo, rent, spec line via `buildSpecLine`, availability via
  `formatAvailability`, org display name as "Listed by"). Card links to
  `/r/[propertyId]?src=network`.
- **`/rentals/[city]`** - city page (slug from address parsing, e.g. `toronto`). Same cards,
  city-scoped. 404 when the city has zero active listings (no thin pages).
- **`/r/[propertyId]`** - stays THE detail + inquiry page. No duplicate detail route: one
  canonical URL per listing, the browse surface is a router into it.

City derivation: addresses are free text today. V1 = a small pure parser in the new lib
(last "City, ON"-style token match against a fixed Ontario city allowlist; unparseable ->
grouped under "Ontario"). No schema change. A future per-property city column can replace the
parser without touching the pages.

### Data path - new anon-safe RPC, NOT the network RPC

`get_network_listing_feed` stays service-role only (it exposes org contact details - that
grant decision from 0110 was correct and does not loosen). New migration adds
**`get_public_browse_listings()`**: SECURITY DEFINER, `stable`, granted to `anon` +
`authenticated`, returning ONLY browse-safe fields per listing: `id, address, rent_cents,
beds, baths, sqft, laundry, parking, furnished, pet flags, utilities-included booleans,
available_date, description, photos, org display name (name only - no slug, no phone, no
email)`. Same WHERE as the feed (`status='available'`, org has feed-ready listing). The RPC
mirrors 0110's shape minus contacts so `lib` readiness code reuses cleanly.

### Rendering + caching

Browse pages use ISR (`export const revalidate = 900`). A just-leased unit lingering on the
index for <= 15 min is acceptable because the card click lands on `/r`, which is
`force-dynamic` and is the booking truth (and already handles "leased" honestly). Detail page
stays exactly as-is dynamically rendered.

### SEO kit

- `generateMetadata` on `/rentals`, `/rentals/[city]`, and **added to `/r/[propertyId]`**:
  title "2 bed 1 bath apartment - 506 Manning Ave - $2,150/mo", description from the listing
  description (truncated ~155 chars), `openGraph` image = cover photo.
- JSON-LD: `ItemList` on browse pages; on `/r` an `Apartment` (or `SingleFamilyResidence`)
  node with `offers` (price, priceCurrency CAD, availability) - emitted only when
  `status='available'`.
- **`app/robots.ts`** (allow all, point at sitemap) and **`app/sitemap.ts`** (index + city
  pages + every active `/r/[propertyId]`, `lastModified` from the listing's updated_at when
  present). Both return empty/disallow while the kill switch is off, so nothing is invited
  in before the surface exists.
- `/r` noindex rule: `robots: { index: false }` whenever the listing is not `available`
  (leased/gone page stays useful to a human with a stale link, but tells crawlers to drop
  it).

### Attribution - the operator sees the network working

Browse cards link with `?src=network`. `/r` threads `src` into the inquiry form as a hidden
field next to the existing `listing_post_id`; `submitLead` maps an allowlisted value
(`network`) to `leads.source = 'vacantless_network'`, anything else falls through to the
existing `'website'` fallback. The tracked `?p=` path is untouched and wins when both are
present (a tracked post is more specific than the surface). Zero schema change (`source` is
already free text). The leads UI already prints source labels; `'vacantless_network'` gets a
human label ("Vacantless network") in the same map the other sources use.

### Kill switch

`BROWSE_SURFACE_ENABLED` env (server-side only, read at request/build time like
`EXTENSION_ALLOWED_ORIGIN` in S534): unset/false -> `/rentals*` 404 via `notFound()`,
sitemap empty, robots disallow, homepage shows no Browse link. True -> all on. The homepage
Browse link additionally requires active listing count > 0 (honesty rule 3).

## 4. What this is NOT (fences)

- NOT a portal for non-Vacantless landlords, no external submissions, no scraping other
  sites' inventory. Only customer listings, from the same tables the feed reads.
- NOT a renter account system, saved searches, or alerts (the waitlist on `/r` already
  captures demand per property; cross-listing demand recycling is its own future design).
- NO map view, NO search box in v1. City pages + cards. Filters/search/map are polish once
  inventory justifies them.
- NO exposure of org slug, phone, or email on any browse surface or in the RPC.
- NO change to `get_network_listing_feed`, the feed routes, or feed builders.
- NO paid-listing / featured-listing mechanics. GTM is held; this is infrastructure.

## 5. Slices

- **Slice A (Codex, one ticket): the surface + kill switch.** 1 additive migration
  (`get_public_browse_listings`), NEW pure `lib/browse-surface.ts` (city parse, card shaping,
  readiness reuse, source allowlist - fully unit-testable), NEW `app/rentals/page.tsx` +
  `app/rentals/[city]/page.tsx`, NEW `scripts/test-browse-surface.ts`. Ships dark behind
  `BROWSE_SURFACE_ENABLED`.
- **Slice B (Codex): SEO kit + attribution.** `generateMetadata` + JSON-LD + noindex rule on
  `/r/[propertyId]`, `app/sitemap.ts` + `app/robots.ts`, `src=network` threading in
  `app/r/[propertyId]/{page,inquiry-form,actions}`, source label. Tests extend the browse
  suite (metadata builders pure where practical).
- **Slice C (later, on real inventory): polish.** Filters, per-city metadata copy, maybe map.
  Also the S534 Slice C fold-ins live here-ish in the roadmap; unrelated code.

Suggested order: A then B in the same session if gates stay green; they touch disjoint files
except none. Both no-risk to existing flows while dark.

## 6. Go-live checklist (Noam's go, later)

1. Slice A+B deployed, cloud gates green, Vercel READY.
2. Noam eyeballs `/rentals` on preview with `BROWSE_SURFACE_ENABLED=true` locally-scoped
   (Vercel preview env var) before prod.
3. Set `BROWSE_SURFACE_ENABLED=true` in prod + redeploy.
4. Verify robots.txt + sitemap.xml serve, spot-check one `/r` page's metadata + JSON-LD
   (Rich Results test).
5. Search Console property + sitemap submission (Noam's Google account, his action).
6. Watch `leads.source='vacantless_network'` appear - first proof the walled garden feeds
   the pipeline.
