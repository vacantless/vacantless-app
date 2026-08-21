# CODEX PROMPT — Lane 2a: Facebook Page Graph POST + proof capture + Simple-ladder Connect (S622)

**Repo:** vacantless-app · **Base:** prod `main` @ 6915240 · **Design:** claude/DESIGN-GETONLINE-OAUTH-CONNECT-LANE2-S621.md
**Scope this lane:** Facebook **Page** only (Instagram is a separate fast-follow lane — do NOT build IG publish here). One-tap **"Review & post"** (human-confirmed; never auto/silent). Dev-mode testable now against Noam's own Page.

Ship behind the EXISTING env gates (`facebookOAuthConfigured()` + `FB_PAGE_CHANNEL_ENABLED==="true"`) so the path stays dormant until Meta review + public go-live. No new feature flag. No new migration (all needed columns/tables already exist — verify, do not add).

---

## 0. Warm-verified starting facts (do NOT re-discover or rebuild these)

The OAuth connect + storage already work end to end. What's MISSING is only the publish POST and its Simple-mode surfacing. Confirmed at HEAD 6915240:

- **Connect start:** `app/api/integrations/facebook/connect/route.ts` — 404s unless `fbPageChannelEnabled()`; redirects to Meta OAuth with scopes `pages_show_list,pages_read_engagement,pages_manage_posts,business_management`.
- **Callback:** `app/api/integrations/facebook/callback/route.ts` — short→long token exchange, Page discovery (incl. business-managed via `/me/businesses`), IG discovery (only when `igChannelEnabled()`). Uses `graphGet<T>(path, params)` against `https://graph.facebook.com/${fbGraphVersion()}`.
- **Persist:** `finalizeFacebookPageConnection()` in `lib/facebook-page-oauth.ts` writes the Page token via `writeChannelSession({channel:"facebook_feed", storageStateJson: JSON.stringify({page_id, page_name, page_access_token, scopes, ...})})` (AES-256-GCM, `distribution_channel_sessions`) and upserts `distribution_channel_accounts` (channel `facebook_feed`, `account_status:"connected"`, `posting_policy:"human_confirmed"`, `capabilities.page_id`, `supports_live_verification:true`).
- **Publish plan already routes it (lib/distribution-publish.ts ~L497):** `facebook_feed` connected → `needs_operator` ("Facebook Page is connected. Authorize autopilot only after reviewing the prepared post; Live still requires Graph API proof."); not-connected → `needs_login`. The run UI (`lib/distribution-run.ts` `automationStatusForItem`) renders `needs_operator` as **"One tap to post" / actionLabel "Review & post"**. This is the hook — you are giving that button a real backing action.
- **Disconnect:** `disconnectFacebookPage()` in `app/dashboard/properties/distribution-actions.ts` (deletes session, pauses account, clears `automation_authorized`). Mirror its org-resolution + admin-client pattern.
- **Autopilot gate:** `distribution_channel_accounts.automation_authorized` / `_at` / `_by` (migration 0177) — already defaulted false on connect.
- **Env gates:** `facebookOAuthConfigured()` = `FB_APP_ID && FB_APP_SECRET` (set in prod). `fbPageChannelEnabled()` = `FB_PAGE_CHANNEL_ENABLED==="true"`. `igChannelEnabled()` = `IG_CHANNEL_ENABLED==="true"` (leave IG untouched).

**THE REAL GAP #1 — no app-side decrypt.** `lib/distribution-session-crypto.ts` has `encryptSessionState` / `writeChannelSession` / `deleteChannelSession` only. There is **no read/decrypt** for `distribution_channel_sessions` in the app (the standalone worker decrypts with the same `SESSION_ENC_KEY`; `lib/crypto.ts` decrypt is a different table/key — Rotessa). You must add a reader.

**THE REAL GAP #2 — no Graph POST anywhere.** The only `graph.facebook.com` call in the repo is `graphGet` in the callback (token exchange/discovery). Nothing publishes.

---

## 1. Files you may touch (file-scoped lane)

1. `lib/distribution-session-crypto.ts` — ADD `decryptSessionState()` + `readChannelSession({organizationId, channel, admin})` (returns the parsed token blob or null).
2. `lib/facebook-page-graph.ts` — **NEW** pure-ish Graph POST client for the Page feed (mirrors the callback's `graphGet` style; exports a `postToFacebookPageFeed()` + a pure message/permalink helper that unit-tests without network).
3. `app/dashboard/properties/distribution-actions.ts` — ADD `postFacebookPageNow(formData)` server action (the "Review & post" backing action) modeled on `completeCopilotPost`'s fail-closed sequence. Do NOT alter `completeCopilotPost`.
4. `app/dashboard/properties/[id]/distribute-tab.tsx` — SimpleGetOnline "Connect once" column: replace the "Connect coming soon" chip for Facebook Page with the real per-channel state (Connect / Connected / Review & post / Posted-with-proof link), reading the `facebook_feed` account + run-item state already available to the Advanced tab. Presentation only — reuse existing state, add no new data fetch shape if the parent already has it.
5. `scripts/test-facebook-page-graph.ts` — **NEW** pure unit tests for the message builder, permalink derivation, and Graph error classification. Register it the same way sibling `scripts/test-*.ts` are run.
6. (If a barrel/index or the property page must thread one prop for the new column state) `app/dashboard/properties/[id]/page.tsx` — minimal, only if strictly required to pass existing `facebook_feed` state into SimpleGetOnline.

**Do NOT touch:** any migration, `lib/distribution-worker*.ts`, the IG branch of `finalizeFacebookPageConnection`, the concierge/copilot completion path, or Marketplace (`facebook`).

---

## 2. Task A — app-side session decrypt (`lib/distribution-session-crypto.ts`)

Add the inverse of `encryptSessionState`:

- `decryptSessionState(env: {ciphertext:Buffer; iv:Buffer; authTag:Buffer}, encKey = parseSessionEncKey()): string` — AES-256-GCM open; set auth tag before `final()`; throw on tamper.
- `readChannelSession({organizationId, channel, admin?}): Promise<Record<string, unknown> | null>` — SELECT `encrypted_state, iv, auth_tag, expires_at` from `distribution_channel_sessions` for (org, channel); the columns are pg `bytea` stored as `\x…` hex by `bufToPgHex` — decode hex back to `Buffer` (strip a leading `\x`; handle both `\x…` string and Buffer-ish returns from supabase-js). Return `JSON.parse(decrypted)` or `null` if no row. Do NOT log token contents.

Keep `parseSessionEncKey` reuse (same `SESSION_ENC_KEY`, 32-byte base64). Add a focused note that this reader matches the worker's envelope.

## 3. Task B — Graph POST client (`lib/facebook-page-graph.ts`)

- `buildPageFeedMessage(listing): string` — PURE. Compose the Page post text from the tracked renter link + a short honest listing line (address, beds/baths, rent if >0). Reuse the tracked public URL the run already builds (the same link Lane 1's "You're online" card copies) — pass it in; do not re-derive routing here. No em dashes, no invented facts (match the worker compose guardrails).
- `facebookPagePermalink(pageId: string, postId: string): string` — PURE. Graph returns `id` as `"{page-id}_{post-id}"`; derive `https://www.facebook.com/{postId-or-composite}` permalink deterministically (unit-test the exact shape).
- `postToFacebookPageFeed({pageId, pageAccessToken, message, link?}): Promise<{ok:true, postId:string, permalink:string} | {ok:false, error:string, code?:number, isAuthError:boolean}>` — `POST https://graph.facebook.com/${fbGraphVersion()}/${pageId}/feed` with `message` (+ `link` if provided) and `access_token=pageAccessToken`, `cache:"no-store"`. Classify Graph errors; set `isAuthError` for OAuthException / code 190 / subcode token-expired so the caller can prompt re-connect. Never throw raw; return the discriminated union.

Import `fbGraphVersion` from `lib/facebook-page-oauth.ts`. This file does network I/O in `postToFacebookPageFeed` only; the two helpers above are pure and are what the tests cover.

## 4. Task C — `postFacebookPageNow(formData)` server action

**This is the "Review & post" button's action. Model it EXACTLY on `completeCopilotPost`'s invariants** (S482b) — the difference is the proof comes from a Graph POST we perform, not an operator-pasted URL.

Sequence (fail-closed at every step):
1. `requireCapability("manage_properties", FORBIDDEN)`. Read `item_id`; load the `distribution_run_items` row + its `distribution_runs` (property_id, organization_id, status) — same reads as `completeCopilotPost`. Stamp org from the **resource's own org** (KI748), never `getCurrentOrg`.
2. Guard: channel must be `facebook_feed`; run `status==="active"`; reject `mode==="concierge"`. Require the account row `account_status==="connected"` AND `automation_authorized===true` (operator has reviewed + authorized). If not connected → send back with a "connect first" reason; if connected but not authorized → back with "authorize first" (the button should only render when authorized — belt-and-suspenders here).
3. **CAS reserve:** flip `publish_status → "submitting"` only from a non-live/non-submitting state (same conditional UPDATE as `completeCopilotPost`). Loser aborts with no side effect. Define `releaseReservation()` identically.
4. **Perform the Graph POST:** `readChannelSession({channel:"facebook_feed"})` → `{page_id, page_access_token}`. If missing/expired → release + back with `fb_reconnect`. Build the message via `buildPageFeedMessage` (tracked link in). Call `postToFacebookPageFeed`. On `isAuthError` → release, set account back toward needs-reconnect (do not silently keep "connected"), back with `fb_reconnect`. On other failure → release + back with `fb_postfail`. **Never go live without a returned post id.**
5. **Record durable proof + attempt FIRST** via the existing `recordVerificationAndAttempt(...)` with `verificationType:"external_url"`, `result:"verified_live"`, `externalUrl: permalink`, `transport:"automatic"`. **`actorType` MUST be an existing `AttemptActorType` value — use `"operator"`** (the operator reviewed, authorized, and one-tap triggered the post; it is honestly operator-initiated). Do NOT invent `"graph_api"`/`"automatic"`: `AttemptActorType` is a closed union `["system","operator","concierge","browser_copilot","broker","agent"]` backed by a DB CHECK constraint on `distribution_publish_attempts.actor_type` (widened only via migration, e.g. 0177) — adding a value here is OUT OF SCOPE (no migration this lane). Record the automatic/Graph nature in the attempt `metadata` (e.g. `{ via: "graph_api_page", post_id }`), not the actor. (`"agent"` is wrong — it is defined as the worker that NEVER sets live.) Fail-closed: proof write fails → release + back.
6. **Tracked `listing_posts` row:** reuse the `completeCopilotPost` tracker pattern. **RESOLVED: `facebook_feed` IS a valid `PortalKey`** (it's in `PORTALS` in `lib/listing-distribution.ts`; `isPortalKey("facebook_feed")===true`; `validateListingPost({portal:"facebook_feed", status:"live", url: permalink})` returns `{ok:true}` — it only special-cases rentfaster/realtor_ca URL shapes). So WRITE the tracked row: `portal:"facebook_feed"`, `status:"live"`, `url: permalink`, upsert-or-insert exactly as `completeCopilotPost` does (dedupe on existing non-removed row first). Do NOT skip it and do NOT use the Marketplace `facebook` portal (distinct key).
7. **Terminal flip LAST**, gated on still holding the reservation: `status:"done", publish_status:"live", external_url: permalink, listing_post_id (if written), last_verified_at`. Then the same "complete the run when all items resolved" tail as `completeCopilotPost`.
8. `revalidatePath` + redirect back to the property with an `fb=posted` (or reuse an existing success reason) anchor.

Autopilot posture: this is **one-tap** — the operator authorizes (sets `automation_authorized`) after reviewing, then taps Review & post which calls this action. Do NOT auto-fire on `publishProperty`. (Auto-on-publish stays a future per-org opt-in.)

## 5. Task D — Simple-ladder Connect surfacing (`distribute-tab.tsx`)

In `SimpleGetOnline`'s "Connect once" column, for Facebook Page replace the static "Connect coming soon" chip with real state derived from the `facebook_feed` account row + its run item (both already computed for the Advanced tab — thread them in, don't add a new fetch shape):

- not-connected → **Connect** CTA → `/api/integrations/facebook/connect?propertyId=…` (the existing start route).
- connected, not authorized → "Connected · Review & authorize" → the existing authorize control.
- connected + authorized, item `needs_operator` → **Review & post** → `postFacebookPageNow` (item_id).
- posted/live → "Posted to your Page" + permalink proof link.

Gate the whole real-Connect treatment on `facebookOAuthConfigured() && fbPageChannelEnabled()` (server-passed boolean prop); when off, keep the honest "coming soon" copy. Presentation only — no business logic in the component. Instagram column stays "coming soon" untouched.

---

## 6. Invariants / guardrails (must hold)

- **No silent posting.** A post happens only via the operator's Review & post tap on an authorized channel. No auto-post on publish. (Human-confirmed posture — matches `posting_policy:"human_confirmed"` and the audit copy.)
- **Never live without Graph proof.** No returned post id ⇒ no live, no `listing_posts` live row (fail-closed, mirror `completeCopilotPost`).
- **No duplicate posts / no double-live.** The CAS reservation is the single-writer guarantee — do not weaken it.
- **Org from the resource** (run item / run), never the client session.
- **Token never logged.** Decrypt in memory only.
- **IG untouched.** No `instagram_content_publish`, no IG media two-step, no scope changes.
- **No migration, no new flag.** Reuse existing columns + env gates. If you believe a column is missing, STOP and report — do not add a migration in this lane.
- **Dormant when gated off.** With `FB_PAGE_CHANNEL_ENABLED` unset the connect route already 404s and the Simple column shows "coming soon"; the new action must also no-op/deny cleanly.

## 7. Gates (run + paste output)

- `npx tsc --noEmit` → 0 errors.
- `npm run lint` → clean (the known `app/job/[token]/page.tsx` `<img>` warning is pre-existing/allowed; no new warnings).
- `npm run build` → succeeds.
- New `scripts/test-facebook-page-graph.ts` passes; re-run the existing distribution suites and confirm no regression: `test-distribution-run`, `test-distribution-worker`, `test-distribution-publish`, `test-distribution-concierge`, `listing-feed`, `share-readiness`.
- `git diff --check` + staged clean.

## 8. Report back (for warm-verify)

Return: the diff summary per file; confirmation you wrote the `listing_posts` row with `portal:"facebook_feed"` (C-6, pre-resolved) and used `actorType:"operator"` with the automatic nature in `metadata` (C-5, pre-resolved); confirmation that `readChannelSession` round-trips a blob written by `writeChannelSession` (add a tiny test or note the manual check); and the full gate output. Do NOT deploy, migrate, or push — Cowork warm-verifies against a prod clone, then Noam file-scoped pushes.
