# CODEX PROMPT — Get-online Instagram Lane 2b (Graph content publish) — S624

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-06
**Branch:** `codex/s624-instagram-graph-publish`
**Baseline:** prod `0436e72` (Lane 2a Facebook Page POST is LIVE — mirror it, do NOT touch it)
**Migration:** NONE · **Flag:** `IG_CHANNEL_ENABLED` (already read in code; stays OFF in Vercel — dark until App Review approves `instagram_content_publish`)

Build the Instagram one-tap Graph publish that the get-online Simple ladder currently stubs as "Instagram later." This is an **exact structural mirror of `postFacebookPageNow` / `lib/facebook-page-graph.ts`** (the shipped FB Page lane), with three Instagram-specific deltas: (1) publishing is a **two-step** container→publish flow, (2) it **requires a public image** (fail-closed when the listing has no photo), (3) the permalink is **read back** from the API. Everything else — the fail-closed reserve/guard/proof-first/terminal-flip spine — is identical to FB.

Most of the IG plumbing already exists in prod; DO NOT rebuild it:
- `lib/facebook-page-oauth.ts` already: exports `INSTAGRAM_CHANNEL = "instagram"` and `igChannelEnabled()`; requests `instagram_basic` + `instagram_content_publish` scopes when IG is enabled; and `finalizeFacebookPageConnection` already **upserts the `instagram` `distribution_channel_accounts` row** and **writes an `instagram` channel session** containing `{ page_id, page_access_token, ig_user_id, ig_username }`.
- `lib/listing-distribution.ts` already lists `"instagram"` as a valid `PortalKey` (label "Instagram") → **no PORTALS migration.**
- `app/dashboard/properties/[id]/page.tsx` already computes `instagramGraphEnabled = facebookOAuthConfigured() && fbPageChannelEnabled() && IG_CHANNEL_ENABLED==="true"` and builds an `instagramAccount: InstagramAccountView` for each channel card.
- `app/dashboard/properties/[id]/distribute-tab.tsx` already has `InstagramAccountView`, `card.instagramAccount`, and the Advanced-tab IG rendering.

---

## Files to change (keep changes file-scoped)

### 1. NEW `lib/instagram-graph.ts` — mirror `lib/facebook-page-graph.ts`
Do NOT import private helpers from `facebook-page-graph.ts` (they're not exported) and do NOT modify that file. **Reuse only its exported `classifyFacebookGraphError`** (Graph error shape is identical). Duplicate the tiny pure label helpers locally.

```ts
import { fbGraphVersion } from "@/lib/facebook-page-oauth";
import { classifyFacebookGraphError } from "@/lib/facebook-page-graph";

export type InstagramFeedListing = {
  address: string | null;
  beds: number | null;
  baths: number | null;
  rentCents: number | null;
  publicUrl: string; // the tracked /r link — goes in the caption AS PLAIN TEXT
};

export type InstagramPostResult =
  | { ok: true; mediaId: string; permalink: string }
  | { ok: false; error: string; code?: number; isAuthError: boolean };
```

- `buildInstagramCaption(listing: InstagramFeedListing): string` — PURE. Same content as `buildPageFeedMessage`: headline `For rent: {address}` (fallback `Rental listing now available`), a facts line `{beds}, {baths} | ${rent}/mo` (omit empties), then `View details and inquire: {publicUrl}`. IG captions do NOT render clickable links — the URL is literal text. Keep local `cleanText`/`bedBathLabel`/`moneyLabel` copies (identical to the FB file). Unit-tested.
- `async function fetchInstagramPermalink(mediaId, accessToken)` — `GET graph.facebook.com/{ver}/{mediaId}?fields=permalink&access_token=…`; return the `permalink` string or `null`.
- `async function postToInstagram(args: { igUserId: string; pageAccessToken: string; imageUrl: string; caption: string }): Promise<InstagramPostResult>`:
  1. Guard: `igUserId` + `pageAccessToken` + `imageUrl` all non-empty, else `{ ok:false, isAuthError:true|false, error }` (missing token ⇒ `isAuthError:true`, missing image ⇒ `isAuthError:false`).
  2. **Create container:** `POST graph.facebook.com/{ver}/{igUserId}/media` with a `URLSearchParams` body `{ image_url, caption, access_token }` (token in BODY). Parse JSON; if `!res.ok` → `{ ok:false, ...classifyFacebookGraphError(payload) }`. `creationId = payload.id` (string) else error.
  3. **Bounded readiness check:** up to 3 iterations, `GET /{creationId}?fields=status_code&access_token=…`; break on `FINISHED`; return error on `ERROR`/`EXPIRED`; small delay between tries (e.g. 1000ms). If still not finished after the loop, return `{ ok:false, isAuthError:false, error:"Instagram media was not ready to publish." }`. (Images are usually immediate; this avoids a publish race.)
  4. **Publish:** `POST /{igUserId}/media_publish` body `{ creation_id, access_token }`. `mediaId = payload.id` else error; classify on `!res.ok`.
  5. **Permalink:** `fetchInstagramPermalink(mediaId, pageAccessToken)`; if null, fall back to `https://www.instagram.com/` + a note — but PREFER returning error `"Instagram did not return a permalink."` so we never mark live without a real proof URL. (Match FB's "never live without a returned id" invariant — here proof = permalink.)
  6. Wrap every `fetch` in try/catch → `{ ok:false, isAuthError:false, error }`. Egress is `graph.facebook.com` ONLY.

### 2. `app/dashboard/properties/distribution-actions.ts` — add `postInstagramNow(formData)`
Copy `postFacebookPageNow` verbatim and adapt. Add imports: `INSTAGRAM_CHANNEL, igChannelEnabled` from `@/lib/facebook-page-oauth`; `buildInstagramCaption, postToInstagram` from `@/lib/instagram-graph`. Deltas from the FB copy:
- Env gate: `if (!facebookOAuthConfigured() || !igChannelEnabled()) redirect("/dashboard/properties?ig=error&reason=disabled")`.
- Every `FACEBOOK_FEED_CHANNEL` → `INSTAGRAM_CHANNEL`; every `backTo`/redirect reason `fb_*` → `ig_*` (`ig_badchannel`, `ig_run_closed`, `ig_concierge`, `ig_connectfirst`, `ig_authorizefirst`, `ig_already`, `ig_config`, `ig_reconnect`, `ig_needsphoto`, `ig_postfail`, `ig_prooffail`, `ig_trackerfail`). Success redirect: `?ig=posted#distribute-header`.
- Session read: `readChannelSession<{ ig_user_id?: unknown; page_access_token?: unknown }>({ organizationId: orgId, channel: INSTAGRAM_CHANNEL, admin })`. Require `ig_user_id` + `page_access_token` (both trimmed non-empty) else `releaseReservation()` + `backTo(propertyId, "ig_reconnect")`.
- **NEW — resolve the public image (this is the only structural addition):** after loading the property, get the cover photo the same way the public page does: `const { data: pub } = await supabase.rpc("get_public_listing", { <same arg get_public_listing takes in app/r/[propertyId]/page.tsx line ~158> })`; `const imageUrl = Array.isArray(pub?.photos) ? pub.photos.find((x) => typeof x === "string" && x.trim()) : null`. If no `imageUrl` → `releaseReservation()` + `backTo(propertyId, "ig_needsphoto")`. (Photos come pre-ordered cover-first from that RPC and are already public URLs.)
- Caption: `buildInstagramCaption({ address, beds, baths, rentCents: rent_cents, publicUrl: trackedUrl })` where `trackedUrl` is the SAME `/r/{propertyId}` + `buildTrackedLink(publicUrl, listingPostId)` the FB action builds.
- Publish: `const graph = await postToInstagram({ igUserId, pageAccessToken, imageUrl, caption })`. On `!graph.ok`: `releaseReservation()`; if `graph.isAuthError` demote the **INSTAGRAM_CHANNEL** account (`account_status:"needs_login"`, clear `automation_authorized*`) then `backTo(propertyId,"ig_reconnect")`; else `backTo(propertyId,"ig_postfail")`.
- Proof-first `recordVerificationAndAttempt`: `channel: INSTAGRAM_CHANNEL`, `verificationType:"external_url"`, `result:"verified_live"`, `externalUrl: graph.permalink`, `actorType:"operator"` (**do NOT invent a new actor — closed union + DB CHECK, KI1002**), `metadata:{ via:"graph_api_instagram", media_id: graph.mediaId }`, `matchedFields:{ graphMediaId:true, operatorAuthorized:true }`. On null verId → `ig_prooffail`.
- `validateListingPost({ portal: normalizePortal(INSTAGRAM_CHANNEL), status:"live", url: graph.permalink })`; upsert `listing_posts` with `portal: normalizePortal(INSTAGRAM_CHANNEL)` (= `"instagram"`); terminal flip the run item (`status:"done"`, `publish_status:"live"`, `external_url`/`proof_url` = `graph.permalink`); run-completion sweep — all identical to FB. Success `redirect(.../${propertyId}?ig=posted#distribute-header)`.

### 3. `app/dashboard/properties/[id]/distribute-tab.tsx` — real Simple-ladder IG row
Import `postInstagramNow`. Replace the "Instagram later" stub in the Simple "Connect once" area with a state machine mirroring the FB Page row, driven by `card.instagramAccount` (`InstagramAccountView`) + the IG run item:
- Render the row only when `instagramAccount?.enabled`.
- **not connected** (`accountStatus !== "connected"`): the SAME Connect entry FB uses (one OAuth connects both). If `hasLinkedBusinessAccount === false`, show the existing Advanced-tab copy ("the connected Facebook Page has no linked Instagram Business account").
- **connected, not authorized:** "Connected · Review & authorize" — reuse the SAME per-channel authorize action the FB row uses, targeting the `instagram` channel account (see Verify #3).
- **authorized + IG run item `needs_operator` + has photo:** `<form action={postInstagramNow}>` + hidden `item_id` → button "Review & post to Instagram".
- **authorized + no photo:** "Add a photo to post to Instagram" linking to the Photos tab (mirror the Lane 1 photo nudge).
- **live:** "Posted to Instagram" + the permalink.
- Handle `?ig=posted` and `?ig=error&reason=…` toasts, mirroring the `fb=posted`/`fb=error` handling.

### 4. `app/dashboard/properties/[id]/page.tsx` — thread the IG run item into the Simple card
It already builds `card.instagramAccount` + gates on `IG_CHANNEL_ENABLED`. Mirror the FB run-item threading so the Simple ladder knows the IG run item's id + `publish_status` + `external_url` (needed for the needs_operator/live states) — exactly how the FB Page run item is surfaced. Change ONLY what's missing; do not widen shared selects (KI985 — do not add columns to a shared `ORG_COLUMNS`-style const).

### 5. NEW `scripts/test-instagram-graph.ts` (pure, no network)
- `buildInstagramCaption`: facts + literal tracked link; address-missing fallback; empty beds/baths/rent omitted.
- error classification passthrough (reuses `classifyFacebookGraphError`).
- any pure body/URL builders you factor out.
Report the pass count.

---

## Guardrails / DO-NOTs
- **DO NOT modify `lib/facebook-page-graph.ts` or `postFacebookPageNow`** — Lane 2a is LIVE (prod 0436e72). Add alongside; never edit in place.
- **`actorType` MUST be `"operator"`** + `metadata.via="graph_api_instagram"` (KI1002). `AttemptActorType` is a closed union backed by a DB CHECK on `distribution_publish_attempts.actor_type` (widened only by migration 0177) — a new actor value is an out-of-scope migration.
- **NO migration.** `"instagram"` is already a valid `PortalKey`; reuse `distribution_channel_accounts` / `distribution_run_items` / `listing_posts` / `distribution_publish_attempts` / `property_photos`. Next free migration stays 0210.
- **Do NOT add scopes/OAuth code.** `facebookPageScopes()` already includes `instagram_basic`/`instagram_content_publish` when `igChannelEnabled()`, and the connect flow already persists the `instagram` account + session. Reuse them.
- **Keep `IG_CHANNEL_ENABLED` OFF** (do not set the Vercel env; do not default it true). Dark until App Review.
- **Fail-closed everywhere:** `releaseReservation()` on every failure path; never mark live without `graph.mediaId` AND `graph.permalink`; demote to `needs_login` only on `isAuthError`.
- **Egress `graph.facebook.com` only.** No tenant/renter PII to Instagram — only the public listing facts, the public cover photo URL, and the tracked link.

## Gates (report all)
- `npx tsc --noEmit` = 0 errors.
- `next lint` clean (known job-page `<img>` advisory only).
- `next build` succeeds.
- `git diff --check` clean.
- Test counts: new `test-instagram-graph` + unchanged regressions (facebook-page-graph, distribution-run/-worker/-publish/-concierge, listing-feed, share-readiness).

## Verify before finishing (call out any that don't hold)
1. `readChannelSession({ channel: "instagram" })` returns `{ page_id, page_access_token, ig_user_id, ig_username }` (confirm field names against `finalizeFacebookPageConnection`).
2. `get_public_listing`'s argument name (from `app/r/[propertyId]/page.tsx` ~line 158) and that its returned `photos` are public URLs, cover-first.
3. The per-channel **authorize** action used by the FB "Review & authorize" row can target the `instagram` channel account; if it's hardcoded to `facebook_feed`, parameterize by channel (file-scoped) rather than duplicating.
4. `normalizePortal("instagram") === "instagram"` and `validateListingPost` accepts `portal:"instagram"`.

Codex builds; Cowork warm-verifies the real diff vs prod HEAD; Noam file-scoped commits + merges + pushes. Do not auto-push.
