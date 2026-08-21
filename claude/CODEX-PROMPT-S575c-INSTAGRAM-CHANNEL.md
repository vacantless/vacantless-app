# CODEX PROMPT - Instagram Business channel via Graph API (v1, DARK)

**Status: DISPATCH-READY. Authored s575 (2026-07-26). The fast-follow to facebook_feed named in DESIGN-FB-GRAPH-API-PAGE-CHANNEL. Hand to Codex when idle. Land app changes NATIVELY on the Mac (Noam pushes; bridge git push = 403); worker is NOT git - device_commit_files IS the apply.**
**Standing constraints: build DARK behind flags; prove Live only by the OBJECT'S OWN status (rule 16 - the returned media id IS the object here); tsc clean; every pure-logic change ships a unit test; reuse the facebook_feed substrate, do NOT fork it; never assert a DB constraint's contents without reading the live constraint first.**

## Context
`facebook_feed` (FB Business Page, Graph API) is PROVEN LIVE (s573) and the business-portfolio connect path shipped s574. Instagram is the committed fast-follow (channel key `instagram`, already in the distribution-channel enums via migration 0176). This adds Instagram Business publishing through the SAME Graph token and the SAME worker/app substrate. Do NOT touch `facebook_feed` or the Marketplace `facebook` channel.

## The ways Instagram genuinely DIFFERS from facebook_feed (do not copy blindly)
1. **No link post.** Instagram has no "post a link and let OG tags render a card" path. Every IG feed post is an IMAGE (or video/carousel) plus a caption. So v1 IG = a SINGLE-IMAGE post whose caption carries the facts + the tracked `/r` link (IG captions are not clickable, but the link is present and the account bio link can point at the org). This means v1 IG REQUIRES a resolvable public image; facebook_feed did not. This is the core difference - budget for it.
2. **Two-step container publish, not one POST.** IG publishing is: (a) `POST /{ig-user-id}/media` with `image_url` + `caption` -> returns a creation_id (container); (b) `POST /{ig-user-id}/media_publish` with `creation_id` -> returns the published media id. Optionally poll `GET /{creation_id}?fields=status_code` until `FINISHED` before publish (Meta fetches the image async). The published MEDIA ID is the object-state proof (rule 16).
3. **image_url must be publicly fetchable by Meta.** IG's server fetches `image_url` itself; it cannot see a private Supabase object. Resolve the property's lead photo to a public (or long-enough-lived signed) URL. LOCATE how `get_public_listing` / the `/r` page already exposes `photos[]` publicly and REUSE that exact resolution - do not invent a new bucket policy. If no public photo can be resolved, the channel releases to needs_operator with a clear reason (never post a broken/blank image).
4. **The IG account is discovered FROM the connected Page.** An IG Business/Creator account is linked to a FB Page. Given the stored Page token, fetch the IG user id via `GET /{page-id}?fields=instagram_business_account{id,username}`. No separate IG login. If the Page has no linked IG business account, the connect step records that and the channel stays unprovisioned (surface it, do not error out).
5. **Scopes.** IG publishing needs `instagram_basic` + `instagram_content_publish` (plus the existing `pages_show_list` / page connection) ADDED to the Meta app use case. Like the s573/s574 FB perms, these must be manually added (app -> Use cases -> Permissions); in DEV mode "added" = Ready for testing = grantable by an app admin/dev/tester with NO App Review. This is Noam's manual step - name it in the DoD, do not attempt it in code.

## Reuse map (READ FIRST - these are the real shapes)
- `vacantless-worker/src/facebook-graph.ts` - the Graph client + `GraphError`. ADD `createInstagramMediaContainer()`, `publishInstagramMedia()`, and (optional) `getInstagramContainerStatus()` here, in the same style as `publishPageFeedLink`/`getPostPermalink`. Reuse `GraphError`/`graphJson`.
- `vacantless-worker/src/phase-b-submit-facebook.ts` - the submitter to MIRROR into a new `phase-b-submit-instagram.ts`: same claim (`claimApprovedJob`), same session read (`readSession` from `distribution_channel_sessions`, channel `instagram`), same `reserveTracker` -> compose -> dark-gate (`WORKER_SUBMIT_LIVE`) -> attempt audit (`recordAgentAttempt`) -> `markPublishedLive` with the media id as `externalListingId` and proof string. The DIFFERENCES vs FB: build an image_url (item 3), run the 2-step container publish (item 2), and use the IG user id (item 4) instead of the page id. Keep `buildMessage`-style caption building (reuse or lift the helper).
- `vacantless-worker/src/tracker.ts` - `LISTING_POST_PORTALS` and `STALE_DAYS` do NOT currently include `instagram`. ADD `instagram` to both (pick a STALE window - 14 days is the FB default; use that unless Noam says otherwise). `markPublishedLive` already refuses a non-trackable portal, so this is required or every IG record fails `portal_not_trackable`.
- `vacantless-app/app/api/integrations/facebook/callback/route.ts` + `lib/facebook-page-oauth.ts` - the Page connect that stores the encrypted token and sets `distribution_channel_accounts.account_status='connected'`. EXTEND it (behind the flag) so that when the connected Page has a linked `instagram_business_account`, it ALSO provisions an `instagram` channel account row and stores the ig user id where the worker can read it (same encrypted session envelope, or an accounts column - match whatever `facebook_feed` did for page_id). One consent, both channels. Add `instagram_basic`/`instagram_content_publish` to `FACEBOOK_PAGE_SCOPES` (guarded so it does not break the FB-only connect if IG scopes are not yet granted).
- `vacantless-worker/src/config.ts` - reuse `fbPageChannelEnabled`/`fbGraphVersion`/`sessionEncKey`. ADD an `IG_CHANNEL_ENABLED` flag (default off) so IG can be dark-toggled independently of FB.
- `vacantless-app/lib/distribution-channels.ts` - confirm/register the `instagram` channel's label + metadata for the Distribute tab (Connect/Disconnect surface, mirroring facebook_feed). `channelByKey('instagram')` must resolve a label.

## Migrations
- **listing_posts.portal CHECK:** CONFIRM the LIVE constraint first (do NOT trust a single old migration - tracker.ts notes it is 0014's list + rentfaster from 0145). If `instagram` is absent, add a migration that widens the `listing_posts.portal` CHECK to include `instagram`. The distribution-channel tables already accept `instagram` (0176); `listing_posts` is a SEPARATE table and is the one that will reject the tracker insert.
- No new verifications result value is needed (IG uses `verified_live`, same as FB).

## v1 build scope
1. Worker Graph helpers: `createInstagramMediaContainer` + `publishInstagramMedia` (+ optional status poll) in `facebook-graph.ts`.
2. Worker submitter `phase-b-submit-instagram.ts` + `npm run submit:ig:dark` / `submit:ig:live` scripts, mirroring the FB pair. Dark run composes the caption + resolves the image_url + prints, sends NO Graph call.
3. `tracker.ts`: add `instagram` to `LISTING_POST_PORTALS` + `STALE_DAYS`.
4. App connect extension: provision the `instagram` channel account + store the ig user id during the existing FB connect when an IG business account is linked; add the two IG scopes (guarded).
5. `listing_posts.portal` migration (if the live constraint lacks `instagram`).
6. Config `IG_CHANNEL_ENABLED` flag; Distribute-tab label/metadata for `instagram`.
7. Pure-logic unit test for any new pure helper (caption builder, image_url resolver decision, container-status parsing).

## Gates / definition of done
- DARK: no Graph call unless `WORKER_ENABLED` + `IG_CHANNEL_ENABLED` + `FB_PAGE_CHANNEL_ENABLED` (shared OAuth) + channel account `connected` + `automation_authorized` + decryptable token + `WORKER_SUBMIT_LIVE`. Any one missing = no post (dark run prints the composed caption + resolved image_url + would-be ig user id).
- Rule 16: IG item marked live ONLY from the returned published media id (object-state). A container creation_id alone is NOT proof of a live post; publish must succeed and return a media id.
- No blank/broken post: if no public image_url resolves, release to needs_operator with reason `no_public_image` - never publish a caption-only or broken-image IG post.
- Attribution: the tracked `/r?p=<listing_post_id>` link is in the caption so `submit_public_lead` still attributes an IG-sourced lead.
- tsc clean (app + worker); new pure logic unit-tested; worker tsc on-device.
- Sandbox proof (Growth Test 8ea1da48, rule 24 - seed org == worker `.env` TARGET_ORG_ID) once Noam has: (a) added `instagram_basic`+`instagram_content_publish` to the Meta app use case, and (b) connected a Page that has a linked IG Business account. Prove: dark run composes caption+image; live run returns a published media id; the post renders on the IG account; `listing_posts` row live with `posted_on`; a `distribution_verifications result='verified_live'` row.

## Noam's manual prerequisites (name them, do not attempt in code)
- Add `instagram_basic` + `instagram_content_publish` to the Meta app 'Vacantless Distribution' (App ID 1570549797986951) use case (Ready for testing in DEV mode).
- Have (or create) an Instagram Business/Creator account LINKED to the FB Page being connected (IG publishing does not work on a personal IG account).
- Real-customer LIVE posting on others' accounts still needs App Review + Business Verification + incorporation (deferred), exactly as facebook_feed.

## Out of scope (v1)
- Carousel / multi-image and video/Reels (single image only in v1).
- Stories.
- A standalone IG-only OAuth flow (v1 rides the FB Page connect).
- Auto-managing the IG bio link.
