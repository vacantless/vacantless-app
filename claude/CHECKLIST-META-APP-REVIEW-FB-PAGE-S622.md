> # STALE 2026-08-14 (S655) - READ THE CURRENT STATE FIRST
>
> This S622 checklist predates the work that closed most of it. Current audited state lives in the claude.ai project doc `FINDINGS-META-ACCESS-VERIFICATION-BLOCKER-S655.md` and in `00-NEXT-SESSION.md` (S655 CLOSE block).
>
> - **Business verification is DONE - it is VERIFIED**, not a pending long-pole [verified 2026-08-14 via Chrome].
> - **Settings/Basic is fully green**: privacy, terms and data-deletion URLs all resolve 200 and are configured; icon, category and app domain set.
> - **All six target scopes are already added to App Review at "Ready for testing".**
> - **The real remaining gate was ACCESS VERIFICATION (Tech Provider)**, which this checklist does not mention at all. It had never been started, carried a 2026-10-13 app-restriction deadline, and was SUBMITTED 2026-08-14 (now In review).
> - **Next action: dogfood the IG publish path in dev mode** - `instagram_basic` and `instagram_content_publish` are both at 0 API calls, so the screencast has no real IG post to show.
> - `FB_PAGE_CHANNEL_ENABLED=true` is long since set; the dogfood item below is done for Facebook.
>
> Kept for the historical record and for the still-valid Noam-hands mechanics further down.

# CHECKLIST — Meta App Review / publish for Facebook Page posting (S622, Noam-hands)

**Goal:** move the Meta app "Vacantless Distribution" (`client_id=1570549797986951`) from **Development mode** to **Live** so the Page feed POST works for *any* operator's Page, not just app admins/testers. This is the public go-live gate; it runs in **parallel** to building/dogfooding the POST (build works NOW in dev mode against your own Page).

**Verified 2026-08-04:** app is wired in prod (`FB_APP_ID`/`FB_APP_SECRET` set), scopes `pages_show_list, pages_read_engagement, pages_manage_posts, business_management` requested, "Manage everything on your Page" use case configured (green), app **Unpublished = Dev mode**. IG publishing is NOT in scope for this lane.

This is weeks-long and gated on business verification — start it now so it isn't the thing blocking launch later.

## What works TODAY without any review (do this in parallel with the build)
- [ ] Confirm your own Facebook **Page** is usable as the dev-mode test target (you are an app Admin, so posting to a Page you admin works while Unpublished).
- [ ] Confirm `FB_PAGE_CHANNEL_ENABLED=true` in Vercel (Prod) — the connect route 404s without it. If unset, that's the one env flip to dogfood the connect+post path. (Value-typing is Noam's per KI988.)
- [ ] Dogfood: connect your Page → authorize → Review & post on a QA listing → verify the post appears on your Page + the permalink is captured. (Cowork drives once the build lands.)

## The review long-pole (needed for PUBLIC / other operators' Pages)

### 1. Business verification (usually the slowest step)
- [ ] In Meta Business Settings → Security Center / Business Verification, start verification for the business that owns the app.
- [ ] Have ready: legal business name, business address, business phone, and a verifiable public presence (website/domain) + a verification document (articles of incorporation / business licence / utility bill in the business name). Vacantless Inc. details.
- [ ] Confirm the app is owned by that verified Business (App Dashboard → Settings → Basic → Business Account).

### 2. App readiness (App Dashboard → Settings → Basic)
- [ ] Privacy Policy URL (public, reachable) — required for review. Ensure it covers Page data + posting on the operator's behalf.
- [ ] App icon (1024×1024), category, app domain, and a valid Data Deletion / Data Deletion Instructions URL.
- [ ] Terms of Service URL.

### 3. "Become a Tech Provider" / advanced access
- [ ] Complete the Tech Provider step surfaced on the dashboard (this is what unlocks other businesses connecting their Pages through your app).

### 4. Permissions / App Review submission
- [ ] Request **Advanced Access** for `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `business_management` (Advanced Access = usable beyond app roles).
- [ ] Provide a **screencast** demoing the exact flow: operator connects their Page in Vacantless → reviews the prepared post → taps Review & post → the post appears on the Page. Reviewers must see your real UI performing the permission's use.
- [ ] Write the **use-case justification**: "Property managers connect their own Facebook Business Page so Vacantless can publish their rental listing to that Page's feed, only after the operator reviews and one-tap authorizes each post. No silent posting."
- [ ] Submit for review. Track status under App Review → Requests.

### 5. Publish / go-live
- [ ] Once approved, flip the app **Live** (Publish toggle) — dev-mode restriction lifts and any connected operator Page can post.
- [ ] Only then surface Connect broadly (the build already gates the Simple-ladder Connect on `facebookOAuthConfigured() && FB_PAGE_CHANNEL_ENABLED`).

## Sequencing reminder
1. Kick off business verification NOW (slow, external).
2. Build + dogfood the Page POST in dev mode against your own Page (no review needed) — Codex prompt: CODEX-PROMPT-GETONLINE-LANE2-FB-PAGE-GRAPH-POST-S622.md.
3. Submit App Review with the real UI screencast once the build is dogfooded.
4. Publish app → public. Instagram is a separate later lane (needs `instagram_content_publish` + stricter review + a photo per listing).

## Notes / gotchas
- Reuse the EXISTING app `1570549797986951` — do NOT create a new Meta app (resets verification + review timeline).
- Business verification is the long pole; everything else is hours, not weeks.
- Dev mode is genuinely enough to prove the whole engineering path on your own Page — public exposure is the only thing review unlocks.
