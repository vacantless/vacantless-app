# DESIGN — Get-online Instagram Lane 2b (Graph content publish) — S624 (2026-08-06)

**Author:** Cowork · **Owner:** Noam · **Baseline:** prod SHA `0436e72` (Lane 2a FB Page POST LIVE)
**Pattern:** exact mirror of the shipped Facebook Page lane (S622). This is **"add the Graph publish + surface it,"** NOT greenfield — most of the IG scaffolding already exists in prod.

---

## TL;DR

Instagram is already modeled end-to-end in prod *except* the actual publish. The connect/OAuth flow already captures the linked Instagram Business account; the `instagram` channel, the `IG_CHANNEL_ENABLED` flag, the channel-account row, and the Advanced-tab UI all exist. The Simple ladder currently stubs *"Instagram later."* This lane fills the one real gap: a two-step IG Graph publish (`lib/instagram-graph.ts`), a one-tap `postInstagramNow` action (mirroring `postFacebookPageNow` line-for-line), and the Simple-ladder "Review & post to Instagram" surface. **No migration.** The one genuinely new dependency vs. FB Page: IG *requires a public image per post* — satisfiable from the existing cover photo, with a fail-closed "add a photo" nudge when there isn't one.

Go-live is gated on the **same** Meta App Review already in flight for FB Page — IG just adds `instagram_content_publish` (+ `instagram_basic`) to that one submission. So building this now means it ships the moment Meta clears, with FB.

---

## What ALREADY exists in prod (verified 2026-08-06 against SHA 0436e72)

- **`instagram` is a defined channel** — `lib/distribution-channels.ts`: `integrationStatus: "live"`, `connectKind: "oauth"`, `mode: "api_automatic"`, `copyKey: "instagram"`, `hasFillSheet`, `hasGuardrails`, `feedEligible: false`, blurb already describes *"a single-image post to a linked Instagram Business account after you approve that item. Captions include the tracked inquiry link; Stories, Reels, and carousels stay separate."*
- **`"instagram"` is a valid `PortalKey`** — `lib/listing-distribution.ts` line 13 (label "Instagram"). **No PORTALS migration needed** (contrast: this was a non-issue for FB too — `facebook_feed` was already valid).
- **OAuth already captures the IG Business account** — `app/api/integrations/facebook/callback/route.ts` requests `instagram_business_account{id,username}` per Page and normalizes it. The link exists at connect time.
- **The `IG_CHANNEL_ENABLED` flag is already read** — `[id]/page.tsx`: `instagramGraphEnabled = facebookOAuthConfigured() && fbPageChannelEnabled() && process.env.IG_CHANNEL_ENABLED === "true"`. (Currently unset in Vercel = dark, correct.)
- **An `instagram` channel-account row already flows to the UI** — `page.tsx` builds an `InstagramAccountView` from `channelAccountByKey.get("instagram")` with `capabilities.page_name` + `capabilities.linked_ig_business_account`.
- **Advanced-tab IG UI already renders** — `distribute-tab.tsx` shows connected/label/pageName and a `hasLinkedBusinessAccount === false` warning ("The connected Facebook Page does not have a linked Instagram…").
- **Public image URLs exist** — `property_photos` + `supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)`; the public `/r/{propertyId}` page already derives a `coverPhoto` from `listing.photos`.
- **The FB lane to mirror** — `lib/facebook-page-graph.ts` (`buildPageFeedMessage`, `facebookPagePermalink`, `classifyFacebookGraphError`, `postToFacebookPageFeed`; egress = `graph.facebook.com` only, token in POST body) and `postFacebookPageNow` in `app/dashboard/properties/distribution-actions.ts` (the fail-closed sequence).

**The gap = the publish itself + the Simple surface.** Nothing else.

---

## The 4 net-new pieces

### 1. `lib/instagram-graph.ts` (NEW) — mirror `facebook-page-graph.ts`
- `buildInstagramCaption(listing)` — pure. Same facts as the FB message (address / beds, baths / `$X/mo`) **plus** the tracked inquiry link **as plain text** (IG captions do **not** render clickable links — include the URL literally; the channel blurb already promises this). Optionally a small hashtag set. Keep it a pure function with unit tests, exactly like `buildPageFeedMessage`.
- `instagramPermalink(mediaId)` — IG has no id→shortcode formula, so the permalink must be **read back** from the API: `GET /{ig-media-id}?fields=permalink`. (Unlike FB, where the permalink is composable.) Return the Graph-provided `permalink`.
- `postToInstagram({ igUserId, pageAccessToken, imageUrl, caption })` — the **two-step** publish:
  1. `POST graph.facebook.com/{ver}/{ig-user-id}/media` with `image_url`, `caption`, `access_token` (in body) → `{ id: creationId }`.
  2. (Robustness) optionally `GET /{creationId}?fields=status_code` once with a short backoff; proceed when `FINISHED` (images are usually immediate, but this avoids a race).
  3. `POST graph.facebook.com/{ver}/{ig-user-id}/media_publish` with `creation_id`, `access_token` → `{ id: mediaId }`.
  4. `GET /{mediaId}?fields=permalink` → permalink.
  - Return shape mirrors `FacebookPagePostResult`: `{ ok:true, mediaId, permalink }` | `{ ok:false, error, code?, isAuthError }`. **Reuse `classifyFacebookGraphError`** (Graph errors are identical shape; `OAuthException`/190/subcodes ⇒ `isAuthError`). Egress boundary stays `graph.facebook.com` only.

### 2. `postInstagramNow(formData)` in `distribution-actions.ts` — mirror `postFacebookPageNow` exactly
Same fail-closed spine, channel = `"instagram"`:
- `requireCapability("manage_properties")`; env gate `facebookOAuthConfigured() && igChannelEnabled()`; resolve item → run → `propertyId`/`orgId` (KI748 resource-org).
- Guards: `it.channel === INSTAGRAM_CHANNEL`; run `status === "active"`; reject `mode === "concierge"`; account `account_status === "connected"` **AND** `automation_authorized === true`.
- **CAS reserve** `publish_status = "submitting"` (neq live/submitting); `releaseReservation()` on **every** downstream failure.
- `readChannelSession<InstagramSession>({ organizationId, channel: "instagram", admin })` → `{ ig_user_id, page_access_token }`. *(Build-time seam to confirm — see Open question #1.)*
- **NEW vs FB — resolve a public image:** load the property's cover/primary photo, produce its `PHOTO_BUCKET.getPublicUrl(...)`. **If none → `releaseReservation()` + `backTo(propertyId, "ig_needsphoto")`** (fail-closed; drives the "add a photo" nudge). This is the only structural addition to the FB spine.
- `buildInstagramCaption(...)` with the same `/r/{propertyId}` + `buildTrackedLink(publicUrl, listingPostId)` canonical link.
- `postToInstagram(...)`; on `!ok` + `isAuthError` demote the **instagram** account to `needs_login` + clear authorization (mirror), else `backTo(..., "ig_postfail")`.
- **Proof-first:** `recordVerificationAndAttempt({ channel:"instagram", verificationType:"external_url", result:"verified_live", externalUrl: permalink, actorType:"operator", metadata:{ via:"graph_api_instagram", media_id }, ... })` — **`actorType` stays `"operator"`** (closed union + DB CHECK; KI1002 — do NOT invent a `graph_api` actor). Then `validateListingPost({ portal:"instagram", status:"live", url: permalink })`, upsert `listing_posts` (portal `"instagram"`), and **flip the run item terminal LAST** (`status:"done"`, `publish_status:"live"`, `external_url`/`proof_url` = permalink). Never live without a returned `mediaId`.

### 3. `distribute-tab.tsx` — replace the "Instagram later" stub with the real Simple-ladder row
Thread the existing `InstagramAccountView` into the Simple "Connect once" column and render the same state machine as FB Page:
- **not-connected** → Connect (existing OAuth entry).
- **connected, not authorized** → "Connected · Review & authorize".
- **authorized + needs_operator + has photo** → `<form action={postInstagramNow}>` "Review & post to Instagram".
- **authorized + no photo** → "Add a photo to post to Instagram" nudge (links to the Photos tab; ties to the Lane 1 photo nudge).
- **live** → "Posted to Instagram" + permalink.
- **linked_ig_business_account === false** → reuse the existing Advanced-tab copy ("connect a Page that has a linked Instagram Business account").

### 4. Flag + gating (already wired — just needs turning on to go live)
`IG_CHANNEL_ENABLED` is already read in `page.tsx`. Add a matching `igChannelEnabled()` helper next to `fbPageChannelEnabled()` for the action's env gate. **To go live:** set `IG_CHANNEL_ENABLED=true` (plain, non-sensitive, Prod+Preview — KI988/rule 43) *after* App Review approves `instagram_content_publish`.

---

## Instagram-specific constraints (the real differences from FB Page)

1. **Media is mandatory.** IG cannot post text-only — every post needs a public `image_url`. Handled via cover photo + fail-closed "ig_needsphoto".
2. **Image rules:** public JPEG, ≤ 8 MB, aspect ratio **4:5 to 1.91:1**. A cover photo outside that range is rejected by IG. **v1 decision:** rely on the cover photo as-is; an out-of-range aspect is a known v1 limitation (a later slice can server-side pad/crop to 1:1). Surface IG's rejection reason rather than silently failing.
3. **Captions can't have clickable links** — the tracked link goes in as plain text. (No "link in bio" plumbing in v1.)
4. **Two-step + async container** — create → (poll `status_code`) → publish → read `permalink`. More round-trips than FB's single POST.
5. **Rate limit:** 25 API-published posts per IG account / 24h — far above per-listing need; no throttle logic required for v1.
6. **Token/identity:** publishes with the **linked Page's access token** + the `ig_user_id` from `instagram_business_account.id`. Both should already be captured at connect; confirm the session field names (Open question #1).

---

## App Review implication (folds into the in-flight FB submission)

IG adds **`instagram_content_publish`** (+ **`instagram_basic`**) to the *same* App Review request as `pages_manage_posts`. The screencast should include the IG Connect → "Review & post to Instagram" → live-post flow on Noam's own linked IG Business account (dev-mode testable today as app admin). Use-case justification (parallel to the prepped FB one): *"After the operator reviews the prepared post and taps 'Review & post to Instagram,' Vacantless publishes one image (the listing's cover photo) with a caption (address, beds/baths, rent, and a tracked link back to the public listing) to the operator's own linked Instagram Business account. No silent/automated posting; no tenant or renter personal data is sent to Instagram."* → append to `claude/AUDIT-META-APP-REVIEW-STATUS-S623.md`.

---

## No migration
Reuses `distribution_channel_accounts`, `distribution_run_items`, `listing_posts` (portal `"instagram"` already valid), `distribution_publish_attempts` (`actor_type "operator"`), and `property_photos`. Next free migration stays **0210**.

## Gates / tests (mirror S622)
- `scripts/test-instagram-graph.ts` (pure, no network): `buildInstagramCaption` (facts + literal tracked link + address-missing fallback), error classification, permalink pass-through.
- `postInstagramNow` guard coverage: bad-channel / run-closed / concierge / connect-first / authorize-first / **needs-photo** / already-live reservation.
- Regression: FB Page + distribution-run/-worker/-publish/-concierge + listing-feed + share-readiness suites unchanged.
- `tsc` 0, `lint` clean (known `<img>` advisory only), `git diff --check` clean.
- Cowork warm-verify: diff every line vs prod HEAD; then live dogfood on the **Growth Test** org (8ea1da48) that holds the connected Page/IG token (KI1003) — create a throwaway listing **with a photo**, connect once, authorize, "Review & post to Instagram", confirm the real post + permalink + `listing_posts portal=instagram` + attempt `actor_type=operator via=graph_api_instagram`, then clean up (delete post, archive listing, revert authorization).

---

## Open questions for the build (confirm at Codex-prompt time)
1. **`ig_user_id` + `page_access_token` location.** The callback fetches `instagram_business_account.id`; confirm it (and the publishing Page token) are persisted in the **`instagram`** channel session readable via `readChannelSession`, vs. living in `capabilities`/the `facebook_feed` session. This dictates the `InstagramSession` type. *(Most likely already in the instagram channel session — verify before writing the action.)*
2. **Cover-photo selection.** Confirm the canonical "primary photo" ordering used by `/r/{propertyId}` (sort/`is_primary`) so the IG image matches the public page's hero.
3. **Aspect-ratio handling** — ship v1 as "cover photo as-is, surface IG rejection," or add a 1:1 pad now? (Recommend: as-is for v1.)

---

## Recommended sequence
1. Noam reviews this design → greenlight.
2. Cowork writes the Codex prompt from it (after confirming Open question #1 against the connect/callback code).
3. Codex builds on `codex/s6xx-instagram-graph-publish`; Cowork warm-verifies GREEN.
4. Noam file-scoped commits + merges + pushes.
5. **Hold `IG_CHANNEL_ENABLED` off** until Meta App Review approves `instagram_content_publish`; dogfood in dev-mode on the linked IG Business account meanwhile.
6. On approval: submit IG scopes with the FB App Review, publish app Live, set `IG_CHANNEL_ENABLED=true`.
