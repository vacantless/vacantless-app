# DESIGN — Lane 2: OAuth "Connect once → automatic" for Instagram + Facebook Page (S621)

**Status:** design pass, warm-verified against prod code 2026-08-03/04. Decisions + Meta-review critical path to resolve with Noam before a Codex prompt. Follows Lane 1 (get-online one-click reframe, LIVE prod 6915240).

## Headline (KI949): the OAuth CONNECT already exists — Lane 2 is NOT greenfield OAuth.
Warm-verify found a real, working Meta OAuth connect flow. The net-new work is the **publish POST** + **surfacing it in Simple mode**; the real blocker is **Meta App Review**.

### Already built (REUSE — do not rebuild)
- `/api/integrations/facebook/connect` (OAuth start; `lib/stage1-link-portals.ts` + Advanced distribute-tab.tsx:2256/2295 already link to it) → Meta OAuth.
- `/api/integrations/facebook/callback` — real Graph calls: short→long-lived user token exchange (`/oauth/access_token`, `fb_exchange_token`), Page discovery incl. business-managed Pages, `instagram_business_account{id,username}` discovery. Hands a signed 10-min cookie of candidate Pages to the picker.
- `/dashboard/facebook-connect` — Page picker UI; persists the selected Page token + marks `distribution_channel_accounts.account_status='connected'`.
- Data model: `distribution_channel_accounts` (0141) + social channels (0176) + **`automation_authorized`/`_at`/`_by`** per-channel autopilot gate (0177) + service-role grant (0178).
- Publish model (`distribution-publish.ts:497`): IG/FB-Page already route `not-connected → needs_login`, `connected → needs_operator` ("Authorize autopilot only after reviewing the prepared post; Live still requires the returned Instagram media id / Graph API proof").
- Env gate: `isFacebookOAuthConfigured()` = `FB_APP_ID && FB_APP_SECRET` (`lib/facebook-page-oauth.ts:86`). Unset today → feature dormant → why the Lane 1 ladder honestly says "Connect coming soon".

### NET-NEW (the Lane 2 build)
1. **Autopilot Graph POST + proof capture (the real engineering).** No `method:"POST"` to graph.facebook.com exists anywhere in the repo today — the connect stores a token but nothing publishes.
   - **Facebook Page feed:** `POST /{page-id}/feed` with the tracked-link message → capture returned post id → mark channel live with proof.
   - **Instagram:** two-step `POST /{ig-user-id}/media` (image_url + caption) → `POST /{ig-user-id}/media_publish` (creation_id) → capture media id as proof. Requires a public image URL (a listing photo) + a linked IG Business account.
   - Gate on `automation_authorized` (0177) + keep `human_confirmed` posture: operator reviews the prepared post, then one-tap authorize — never silent (matches the honesty architecture; not a browser_copilot ToS issue, but keep review-before-publish).
   - Token-at-rest: verify/encrypt the stored Page token (check `lib/distribution-session-crypto.ts`); long-lived Page tokens are ~60d — handle expiry/refresh + a re-connect prompt on 190/OAuthException.
2. **Surface Connect in the Simple-mode automation ladder (small, Lane-1-style presentation).** Replace the "Connect coming soon" chips (distribute-tab.tsx SimpleGetOnline "Connect once" column) with a real **Connect** CTA → `/api/integrations/facebook/connect?propertyId=...`, and reflect the true per-channel state from `distribution_channel_accounts`: not-connected → "Connect", connected → "On (auto-posts with publish)" / "Review & authorize", posted → proof link. Read the state that already feeds the Advanced tab.

### OPS / EXTERNAL — the real critical path (Noam)
- **Meta app is ALREADY wired in prod [verified 2026-08-04 via live connect-route probe].** `FB_APP_ID`/`FB_APP_SECRET` are set in Vercel — the connect route redirected to Meta's real OAuth dialog: **app `client_id=1570549797986951`**, redirect_uri `https://app.vacantless.com/api/integrations/facebook/callback`, scopes **`pages_show_list, pages_read_engagement, pages_manage_posts, business_management`**. So env config is DONE and the Facebook-Page permission set is already requested. Do NOT re-create the app or re-set env.
- **Meta dashboard status [verified 2026-08-04 via Chrome, app "Vacantless Distribution"]:**
  1. **App is UNPUBLISHED = Development mode** (Publish nav shows "Unpublished" badge). Page posting therefore works **only for app admins/testers/roles** (Noam's own Page) — NOT the public. **This is the go-live gate.** → Build + dogfood the Graph POST NOW against Noam's own Page (dev mode is enough); public go-live is a separate step.
  2. The **"Manage everything on your Page" use case is configured** (green check) — the bundle that includes `pages_manage_posts` (matches the live connect scopes). Good.
  3. To publish for the public: **"Become a Tech Provider" + access/business verification** (surfaced on the dashboard) + App Review. Long pole, start when ready to expose beyond Noam.
  4. **Instagram content publishing is NOT wired yet** — connect doesn't request `instagram_basic` / `instagram_content_publish`; IG discovery reads the Page's linked IG account but publishing needs those two scopes + a new use case + stricter review. FB Page is the near-ready path; IG is scope + review work.
- **Meta App Review (weeks-long, gating for public go-live):** for `pages_manage_posts` (Page) and, later, `instagram_content_publish` (IG). Requires business verification, privacy-policy URL, screencast demo, use-case justification. Build/test against the app in dev mode (Noam's own Page as admin) now; flip to public when approved.

## Sequencing within Lane 2
1. Kick off Meta App Review immediately (long pole; parallel to build).
2. Build the FB-Page POST path first (simpler: link post, no image dependency) → dev-mode test on Noam's own Page.
3. Add Instagram (needs image URL + linked IG Business account) second.
4. Surface Connect + states in the Simple ladder (ship dark/gated on `isFacebookOAuthConfigured` so it stays dormant until env is set + review passes).

## OPEN DECISIONS (resolve before the Codex prompt)
1. **Scope v1: Facebook Page only, or Page + Instagram together?** Reco: **Page first** (no image dependency, simpler review surface), Instagram as a fast-follow. IG's `instagram_content_publish` review is stricter and needs a photo on every listing (ties to the Lane 1 photo nudge).
2. **Publish trigger:** auto-post the instant `publishProperty` succeeds (for authorized channels), or a one-tap "Review & post" on the connected card? Reco: **one-tap review-then-post** (keeps the human_confirmed posture the model already encodes; avoids surprise posts). Auto-on-publish can be a later per-org opt-in via `automation_authorized`.
3. **Who owns the Page/IG?** For the operator's own reach they connect their Page. For Agile/managed orgs, confirm whose Page. (Connect is per-org via `distribution_channel_accounts.organization_id`.)
4. **Meta app: new dedicated app vs. reuse an existing Vacantless Meta app?** Determines review timeline + which business verification applies.

## Reference
Lane 1 shipped: prod 6915240, DESIGN/CODEX-PROMPT-GETONLINE-ONECLICK-REFRAME-S621. Touch points for Lane 2: app/api/integrations/facebook/* , app/dashboard/facebook-connect/* , lib/facebook-page-oauth.ts, lib/distribution-publish.ts (:497 IG/FB branch), lib/distribution-worker*.ts, distribute-tab.tsx (SimpleGetOnline "Connect once" column), migrations 0141/0176/0177/0178.
