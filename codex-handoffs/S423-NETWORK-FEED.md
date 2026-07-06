# S423 - Cross-org aggregate (network) listing feed + description-length hardening

> **CODEX-ACCEPTED 2026-07-06.** Reviewed `36cbbf6..3e1751d` + migration `0110`.
> No P1/P2. Security/dark-path review passed (revoke PUBLIC/anon/authenticated +
> grant service_role only; token gate -> 404, missing service role -> 404, RPC
> error -> 503, success is `private, no-store`). Checks: `git diff --check`,
> both feed test suites via `node -r sucrase/register`, lint, `tsc --noEmit`.
> ONE P3 (non-blocking) FOLDED this session: the route coerced an unexpected
> non-array RPC success to `[]` (a misleading empty 200); it now returns `503`
> for any non-array success shape, while a legitimate empty array still serves a
> valid 200. Route-only change, no migration, tsc clean. Loop CLOSED (fold-in
> commit pending Noam's deploy).

**Review target:** the single S423 code commit on `main`, range `36cbbf6..3e1751d`
(prod head `3e1751d`, Vercel READY), plus migration `0110_network_listing_feed.sql`
(already applied to prod via the Supabase connector, ref `nvhvdyxpyogvadpjlvij`).

**Review prompt:** "review commit `3e1751d`; context in
codex-handoffs/S423-NETWORK-FEED.md".

## Why

The per-org feed (`0043 get_org_listing_feed`, anon-callable, one org) lets a
single landlord hand a portal their own units. But the big portals gate on
VOLUME (Zumper custom feed = 50+ properties, verified 2026-07-06; Rentsync leans
multifamily), which no single small landlord clears. The platform lever is to
present EVERY customer's active listings as ONE feed. This ships that, plus a
verified description-length gate.

## What shipped (7 files, 443/-13)

1. **`supabase/migrations/0110_network_listing_feed.sql` (new, APPLIED to prod).**
   `get_network_listing_feed()` returns a jsonb ARRAY of the SAME per-org payload
   shape `0043` already produces (`{org:{…}, listings:[…]}`), one element per org
   with >=1 `status='available'` listing. `language sql stable security definer
   set search_path = public`, mirroring `get_org_listing_feed`.
   - **SECURITY:** this returns every customer's inventory in one call, so it is
     NOT anon-callable. `create or replace` defaults execute to PUBLIC, so the
     migration explicitly `revoke all ... from public, anon, authenticated` and
     `grant execute ... to service_role`. **Verified live post-apply:**
     `has_function_privilege` -> anon=false, authenticated=false,
     service_role=true; a sample call returns 7 providers / 15 listings.

2. **`app/api/feed/network/route.ts` (new).** `GET /api/feed/network?token=...`
   - **Dark by default:** if `process.env.NETWORK_FEED_TOKEN` is unset/empty ->
     `404`. If `?token` is absent or does not match -> `404` (indistinguishable
     from "no such route"). The feature does not exist to the outside world until
     a partner is handed the URL + token.
   - Token compare is length-checked + constant-time-ish XOR (belt-and-suspenders
     on short config strings).
   - Reads via `createAdminClient()` (service-role; the RPC is service_role-only,
     so the public anon key cannot dump the network feed even if the path is
     guessed). Null admin client (missing service key) -> `404` (don't reveal the
     route). RPC error -> `503`.
   - `Cache-Control: private, no-store` so a CDN never caches a token-authed body.

3. **`lib/listing-feed.ts`.**
   - `buildContactBlockXml(org, indent)` EXTRACTED from `buildListingFeedXml` and
     shared by the single-org feed and each network `<provider>` block (they
     can't drift). `buildListingFeedXml` refactored to use it - output unchanged
     (existing 83 feed assertions still green).
   - `buildProviderBlockXml` + `buildNetworkFeedXml`: wrap each org's READY
     listings (via the SAME `summarizeFeed` + `buildListingItemXml`) in a
     `<provider provider_id name count>` block carrying that org's own
     `<contact>`. Empty providers (0 ready) are OMITTED. Header carries
     `provider_count` + total `count`. Provider name/id flow through
     `escapeXmlAttr` (injection test added).
   - `MIN_DESCRIPTION_CHARS = 50` (Zumper's verified floor). New readiness reason
     `description_short`: a present-but-<50-char description is held back as
     `description_short` (distinct from a wholly missing `description`), so the
     operator is told to lengthen it rather than the aggregator silently dropping
     it. `FeedMissingField` union widened.

4. **`app/dashboard/settings/page.tsx` + `lib/rental-readiness.ts`.** Friendly
   labels for the new `description_short` reason (the settings map is
   `Record<FeedMissingField,...>` so tsc enforced the new key; rental-readiness
   uses `Record<string,...>` with a `?? m` fallback, label added for polish).

## Points worth a close look

- The `revoke/grant` block on the SECURITY DEFINER function (the whole privacy
  guarantee rides on it + the route token gate). Confirm nothing else grants it.
- The route's dark-by-default logic: every non-happy path returns `404`/`503`,
  never partial data.
- `buildProviderBlockXml` returning `""` for a zero-ready org and
  `buildNetworkFeedXml` skipping it (so `provider_count` reflects only non-empty
  providers). Note `buildNetworkFeedXml` calls `summarizeFeed` a second time for
  the count after the block is built - correct but slightly redundant; flag if you
  want it de-duped.

## Safety envelope

Dark by default (no token = 404). No billing/entitlement/Stripe/Rotessa change,
never moves money, no tenant PII (this feeds only public listing fields the
per-org feed already exposes). The description gate can hold back a <50-char
listing, but that listing was Zumper-rejected anyway and the operator now sees
exactly why.

## Verification (this session)

- `tsc --noEmit` clean and `next lint` clean on the changed files - **both re-run
  on Noam's Mac at deploy time** (the paste ran tsc + eslint before commit).
- Full unit suite **104/104 green** in the sandbox, incl. `test-listing-feed`
  **133/0** (new network + provider-block + `description_short` + injection cases)
  and `test-rental-readiness` **44/0**. (Tests were run in the Linux sandbox via
  `npx tsx`; Noam's local `npx tsx` hit an esbuild platform mismatch, since
  resolved by `npm install` - unrelated to the code.)
- Migration `0110` applied to prod + grants verified live (see item 1).
- No NEW em dashes in code comments.
