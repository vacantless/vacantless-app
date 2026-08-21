# CODEX PROMPT — Get-online Simple mode: one-click reframe + automation ladder (S621, Lane 1)

**Scope:** ONE file-scoped lane, Simple-mode Get-online only. Presentation + wiring of already-existing primitives. **NO migration. NO feature flag. NO new server action. NO new data computation.** Advanced command center is UNTOUCHED. Same low-risk class as S617/S620.

Design of record: `claude/DESIGN-GETONLINE-ONECLICK-REFRAME-S621.md` (read it first). This prompt is the executable spec.

## Goal
Turn the Simple-mode Get-online view from a 6-step "nothing posts automatically" chore list into an outcome-first, one-click experience: **one click = your rental is online** (Vacantless page + rental feed, free, automatic), with everything else demoted into an honest automation ladder. Make Get-online feel like one decisive action and become the free→paid conversion surface.

## Files (expected)
- `app/dashboard/properties/[id]/distribute-tab.tsx` — rewrite `SimpleGetOnline` (currently ~line 1031) and its `SimpleGetOnline` call site (~line 535) to thread the concierge props already present on `launchRun`. `SimplePostingPlan` (~1380) may be folded in or removed if redundant.
- `app/dashboard/properties/[id]/page.tsx` — ONLY if a prop needs threading into the Simple view that isn't already on `launchRun`. Do NOT add new computation — `conciergeDeskEnabled`, `conciergeUsage {used,included}`, `conciergeDailyLostLabel`, and `marketingEnabled`/plan already exist here.

## Reuse — do NOT rebuild any of these
- `publishProperty` (properties/actions.ts) — the one-click "go online" action. Publishing sets status→available, which makes the Vacantless page live AND auto-includes the listing in the org feed (`FEED_LISTABLE_STATUS="available"`). This is the whole one-click primitive.
- `requestConciergePublish` — the done-for-you action (already imported in distribute-tab.tsx).
- `LaunchRunPanel` — the channel picker/run (keep for choosing sites / co-pilot).
- `conciergeUsageLabel`, and `launchRun.conciergeDeskEnabled` / `launchRun.conciergeUsage` / `launchRun.conciergeDailyLostLabel` (already consumed by the Advanced concierge card at distribute-tab.tsx:572-578).
- `HiddenPreservedPropertyFields`, `updateProperty`, `uploadPropertyPhotos`, `CopyLink`, the co-pilot/sidecar path.

## Behavioral spec

### 1. Hero = one primary action (kills the chore-list framing)
Replace the "Next step / Work down the steps below. Nothing posts automatically." hero with a single primary CTA: **"Put {address} online"** → submits `publishProperty`.
- If `canSetLive` and basics are ready → it is literally one click.
- If a single blocker remains, the CTA reflects the ONE thing and reveals its inline resolver right there (reuse the existing inline basics `updateProperty` form and/or the photo upload form already in SimpleGetOnline). Never present a 6-step wall. Order of the single blocker: basics missing → then (optional, non-blocking) photos nudge as a soft chip, NOT a gate (photos are not required by `publishProperty`).
- Remove the "Nothing posts automatically" copy entirely.

### 2. Redefine "online" — celebrate on `linkIsLive` alone
Change the win-state gate from `postedWithProof = linkIsLive && liveChannels > 0` to **`linkIsLive`**. The moment the Vacantless page is live, show the "You're online" success card:
- Headline: "{address} is online and taking inquiries."
- Shareable renter link (`replyInputs.bookingUrl`) with `CopyLink` + Text/Email/Preview affordances + inquiry count (`totalInquiryCount`).
- External posts (FB/Kijiji/etc.) become ADDITIVE below the win, never the definition of done.

### 3. Automation ladder below the hero (both pre- and post-publish)
Three demoted groups, honest labels:
- **Automatic (one click):** Vacantless page + rental feed — always on, no account.
- **Connect once → automatic:** Instagram + Facebook Page. Lane 2 builds the OAuth. For Lane 1, render these HONESTLY as "Connect (coming soon)" / not-yet-wired — do NOT imply they auto-post today unless an account is actually connected. Do not fabricate a connect action.
- **Reach more — FB Marketplace + Kijiji:** see #4.

### 4. FB Marketplace + Kijiji — done-for-you first, honest ceiling, plan-aware upsell (RESOLVED decision A)
These are `browser_copilot` — ToS forbid silent auto-posting. NEVER imply Vacantless posts them silently.
- **If `launchRun.conciergeDeskEnabled` is true (Growth+):** lead with done-for-you — "We post Facebook & Kijiji for you — you approve one sign-in." Show `conciergeUsageLabel(launchRun.conciergeUsage)` remaining. The action is `requestConciergePublish` for the relevant run item (same wiring as the Advanced card). Free co-pilot remains available as "post it yourself".
- **If `conciergeDeskEnabled` is false (Free):** show an **upgrade** card — "Want us to post Facebook & Kijiji for you? → Upgrade to Growth" — and, when `launchRun.conciergeDailyLostLabel` is set, the nudge "Every day vacant costs about {conciergeDailyLostLabel}." The free **co-pilot** ("we prep it, you post — paste the live link") stays available directly underneath so the operator is NEVER blocked from these channels. The upsell sells convenience, not access.
- The guided/manual posting checklist becomes a buried "Prefer to post it yourself?" fallback (`#publish-checklist`), not a numbered required step.

### 5. Sequencing rule (load-bearing)
The free one-click win must land clean: no upsell precedes, interrupts, or gates the publish CTA or the "You're online" card. The done-for-you upsell appears only in the "reach more" section, after the win.

## Honesty guardrails (do not violate)
- No claim of silent/auto posting for FB Marketplace, Kijiji, Viewit, LinkedIn (browser_copilot). Concierge = "we post it, you approve one sign-in"; co-pilot = "we prep it, you post".
- A channel is never "live" without a real proof URL (existing rule — unchanged).
- Do not widen `ORG_COLUMNS` or add plan reads in page.tsx; use the already-computed values (KI985 trap).

## Acceptance / gates (all must pass)
- `tsc` 0 errors; `eslint` clean except the known pre-existing `app/job/[token]/page.tsx` `<img>` warning.
- `next build` succeeds (static page count unchanged aside from this route).
- `git diff --check` + `--cached` clean.
- Existing distribute/property tests pass (rerun once if the sandbox `tsx listen EPERM` flake appears).
- Manual reasoning proof in the PR description: (a) a Free-plan property with basics ready shows a single "Put it online" CTA; one click → "You're online" with shareable link, no external proof required; FB/Kijiji show the upgrade card + co-pilot underneath. (b) A Growth+ property shows done-for-you with remaining allowance. (c) Advanced mode is byte-unchanged.

## Out of scope (later lanes)
- OAuth connect for IG/FB Page (Lane 2).
- Feed-partner acceptance for Zumper/Rentals.ca/RentFaster (Lane 3).
- Any billing/entitlement enforcement changes (concierge allowance stays display-only).
