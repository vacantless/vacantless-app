# CODEX PROMPT - S534 Slice A (paste-ready, self-contained)

You are building in the Vacantless app repo (Next.js App Router + Supabase). Work on `main`, base commit `6290592` (or current HEAD - rebase forward, never backward). You commit and push yourself, then reply with the commit SHA, a file-by-file diffstat, and your review note. Additive only. NO migration. Ships DARK.

## Context (all you need, no other docs required)

Vacantless is building a posting-assist Chrome extension (separate repo, NOT this ticket): a side panel that helps an operator hand-post a unit on Kijiji and Facebook Marketplace by filling the portal form fields on the operator's click. This ticket is the app-side half only: ONE read-only, session-authed, entitlement-gated JSON endpoint that returns everything the panel needs. Nothing in the existing distribute flow changes. The extension authenticates as the operator via the existing app session cookie (its host permission lets fetches carry it); CORS restricted to the exact extension origin.

Everything the payload needs already exists as pure libs - import, never duplicate:
- `lib/listing-fill-sheet.ts` -> `buildFillSheet` (ordered FillField[] per portal: id, label, value, source listing/preset/manual, guardrail)
- `lib/listing-copy.ts` -> `buildListingCopy` (per-channel title + body)
- `lib/listing-guardrails.ts` -> `guardrailsForPortal`
- `lib/distribution-copilot.ts` -> `COPILOT_STOP_GATES`, `stopGateLabel`, `stopGateNote`
- `lib/distribution-channels.ts` -> `channelByKey` (label, portalUrl, mode), `channelModeLabel`
- `lib/listing-distribution.ts` -> `buildTrackedLink`, `reservableTrackerId`
- `lib/listing-feed.ts` -> `MAX_PHOTOS`
- Gating: `requireCapability` (`lib/membership.ts`), `getCurrentOrg` (`lib/org.ts`), `hasEntitlement(plan, "listing_marketing")` (`lib/billing.ts`)
- Tracker reservation pattern to copy: `addRunChannel` in `app/dashboard/properties/actions.ts` (prefer live tracker via `reservableTrackerId`, else newest non-removed, else create a draft `listing_posts` row) - this makes the `?p=` tracked link FINAL before the operator posts
- Dark-ship + CORS posture to mirror: `app/api/feed/network/route.ts` (no env -> 404 for all methods)

## 1. Review note first

Before building, reply with a short review note: confirm the file scope below is complete and correct against the current tree, flag anything that would force a scope change, then build.

## 2. Scope - exactly 4 files

**2a. NEW pure `lib/extension-kit.ts`.** No DOM / env / IO. Exports:

- `EXTENSION_CHANNELS = ["kijiji", "facebook"] as const`; type `ExtensionChannelKey`; guard `isExtensionChannel(value): value is ExtensionChannelKey`.
- `buildExtensionKit(input): ExtensionKit` - assembles per channel:
  - `channel`: key, label, `portalUrl`, mode label (from `lib/distribution-channels`).
  - `fields`: the ordered `FillField[]` from `buildFillSheet`, passed through VERBATIM (id, label, value, source, guardrail). Do NOT re-map or rename - the extension's selector maps key off these ids.
  - `copy`: `{ title, body }` from `buildListingCopy` for the channel's copy key.
  - `trackedLink`: caller-supplied FINAL tracked URL for this (property, channel) - the kit builder takes it as input; reserving/creating the tracker row is the route's job (addRunChannel pattern).
  - `guardrails`: from `guardrailsForPortal`.
  - `stopGates`: the four `COPILOT_STOP_GATES` with `stopGateLabel` + `stopGateNote` applied.
  - `photos`: the listing's photo URLs, cover first, capped at 50 (reuse `MAX_PHOTOS`).
  - `distributeTabUrl`: `/dashboard/properties/<id>#distribute` deep link for the proof step (the Distribute TabPanel's `anchorId`).
- `ExtensionKit` carries `property: { id, address }`, `generatedAt` (caller-passed ISO string, deterministic tests), and `channels` as above.

**2b. NEW `app/api/extension/kit/route.ts`.** `GET` + `OPTIONS`, `dynamic = "force-dynamic"`, runtime nodejs. Order of gates, all before any data work:

1. `EXTENSION_ALLOWED_ORIGIN` env unset or blank -> 404 for every method (same dark posture as `app/api/feed/network`). The env value is the exact extension origin, e.g. `chrome-extension://abcdef...`.
2. CORS: if the request has an `Origin` header, it must equal `EXTENSION_ALLOWED_ORIGIN` exactly, else 403 with no CORS headers. Successful responses (and the `OPTIONS` preflight) echo `Access-Control-Allow-Origin: <that exact origin>`, `Access-Control-Allow-Credentials: true`, `Vary: Origin`, and allow method GET. Never `*`.
3. Auth: standard server Supabase client from cookies; no session -> 401 JSON `{ error: "sign_in" }`.
4. Org + capability: `getCurrentOrg`; `requireCapability("manage_properties", ...)` same as every distribution action; entitlement `listing_marketing` false -> 403 JSON `{ error: "upgrade" }`.
5. `property` query param: must be a unit the org owns (org-scoped select; the RLS-scoped client already enforces this - keep the explicit org filter anyway, both belts as in `distribution-actions`).

Then: reserve-or-create the tracked post rows for kijiji + facebook exactly the way `addRunChannel` does its reservation (prefer live tracker, else newest non-removed, else create draft) so `trackedLink` is FINAL; assemble via `buildExtensionKit`; return JSON with `Cache-Control: private, no-store`.

The route READS and, at most, creates the same draft tracker rows the in-app copilot flow already creates for the same purpose. No other write. No listing_posts status change, no run mutation, nothing marked live.

**2c. NEW `scripts/test-extension-kit.ts`.** tsx assert suite over the pure lib: channel set locked to kijiji+facebook; field ids pass through from the fill sheet untouched (assert ids equal `buildFillSheet` output for the same input); copy present for both channels; stop gates all four with non-empty labels/notes; photos cover-first and capped at 50; deterministic output for fixed `generatedAt`; `isExtensionChannel` rejects junk; kit for a listing with missing optional data (no photos, no sqft) still builds with empty arrays, never throws.

**2d. EDIT `app/dashboard/properties/[id]/distribute-tab.tsx`** - smallest possible edit: on the Kijiji and Facebook channel cards, a one-line hint "Posting by hand? The Vacantless posting assistant (Chrome) fills these fields for you." shown ONLY when the org has `listing_marketing` (no link yet; the store link lands in a later slice). If this edit risks scope creep in the current tree, drop it and say so in the review note rather than growing the diff.

## 3. Don't touch

`lib/listing-fill-sheet.ts`, `lib/listing-copy.ts`, `lib/distribution-copilot.ts`, `lib/distribution-channels.ts`, `lib/listing-distribution.ts`, `lib/listing-feed.ts`, `app/dashboard/properties/distribution-actions.ts`, `statements.ts`, `reminders.ts`, billing, `vercel.json`, workflows, any migration. Import from them; never modify.

## 4. Invariants (audit against every one)

- Ships dark: env unset -> the route does not exist to the outside world (404, all methods).
- Read-only surface except the pre-existing draft-tracker reservation pattern; never flips any status, never marks anything live or posted.
- Session + org + `manage_properties` + `listing_marketing` all enforced server-side; the org-ownership check on the property is explicit even though RLS also covers it.
- CORS is exact-origin with credentials; no wildcard anywhere; `Vary: Origin` present.
- Tracked link is FINAL before the operator ever sees it (same guarantee as copilot).
- Field ids are byte-identical to the fill sheet's (the extension mappings depend on it).
- Pure lib has zero IO; all env/cookie/DB work lives in the route.

## 5. Process

1. Deliver the review note.
2. Build 2a-2d.
3. `npx tsx scripts/test-extension-kit.ts` green; `npx tsc --noEmit`; `npm run lint`; `npm run build`; `git diff --check` - all green.
4. Commit + push to `main`; reply with the commit SHA, a file-by-file diffstat, and the review note.
