# DESIGN — Get-online one-click reframe + automation ladder (S621)

**Status:** design pass, warm-verified against prod code 2026-08-03/04. ONE open decision (pricing framing) before the Lane 1 Codex prompt. Author: Cowork (S621).

## Why
Noam: "the get online is still weak — make it as simple as possible, make Get-online the key strategy at the forefront over and above the guided route, best UI, feel like one click" + "make all the account connections we have automated as opposed to guided."

## Key warm-verify findings (the reframe is mostly presentation, not new engine)
1. **The one-click primitive already exists and already syndicates.** `publishProperty` (actions.ts:1005) flips status→`available`, which (a) makes the Vacantless public page live (shareable, tracked, captures inquiries) and (b) auto-includes the listing in the org XML feed (`FEED_LISTABLE_STATUS = "available"`, listing-feed.ts:36). No extra step. That IS "online in one click."
2. **The framing actively undercuts it.** SimpleGetOnline (distribute-tab.tsx:1031) is a 6-step chore list; the hero says **"Nothing posts automatically"**; "Set Live" is step 3 of 6.
3. **The win state never fires for the Vacantless page alone.** `postedWithProof = linkIsLive && liveChannels > 0` (line 1062) — the "You're live" card waits until the operator ALSO posted to an external site and pasted a proof URL. Going live on Vacantless (a real, shareable, inquiry-capturing page) is treated as "not done."
4. **The honest ceiling is deliberate and load-bearing (KI998 + capability matrix).** FB Marketplace, Kijiji, Viewit, LinkedIn = `browser_copilot`: their ToS forbid silent automation; the system NEVER crosses login/payment/CAPTCHA/final-submit gates. Do NOT fake auto-posting for these.
5. **A "done-for-you" concierge already exists (S553).** `requestConciergePublish` + `distribution-worker`/`distribution-worker-ai`: the worker composes the ad (Anthropic Haiku) and drives the job to the first human gate, then stops. It's surfaced in the ADVANCED command center ("Done-for-you" slate card, line 1666), NOT in Simple mode.
6. **Concierge is PAID + plan-gated (billing.ts:375-388).** `conciergeMonthlyIncluded`: Growth 2 / Premium 6 / Managed 20 / Pilot 99; $49 per 3-pack overage; requires `canUseListingMarketing(plan)` → **Free = 0**. Allowance is currently DISPLAY-ONLY (S538 — no Stripe hook/hard cap yet). The FREE self-serve path for browser_copilot channels is the **co-pilot/sidecar** (compose + script + paste proof).

## The automation ladder (honest per-channel ceiling)
| Rung | Channels | What "automated" means | Plan |
|---|---|---|---|
| Automatic (one click) | Vacantless page, org_feed | fires on publish, no account | all (incl. Free) |
| Connect once → automatic | Instagram, Facebook Page | one-time OAuth, then posts on publish | needs OAuth build (Lane 2) |
| Feed partner → automatic | Zumper, Rentals.ca, RentFaster | automatic once partner accepts the feed | needs partner acceptance (Lane 3) |
| Done-for-you (paid) | FB Marketplace, Kijiji, … | concierge worker preps + drives to human gate; you approve login/submit | Growth+ (paid rung) |
| Co-pilot (free) | FB Marketplace, Kijiji, … | app composes + scripts; you post + paste proof | all (Free path) |

## Lane order (Noam: "all of it, follow your order")
- **Lane 1 (first) — reframe + wire the existing concierge.** Lowest risk, no external dependency, delivers the whole felt experience. Presentation + wiring; likely NO migration (same class as S617/S620).
- **Lane 2 — OAuth "Connect once" for Instagram + Facebook Page.** Self-contained engineering (OAuth flow, token storage in distribution_channel_accounts). Own lane + design pass.
- **Lane 3 — feed-partner acceptance (Zumper/Rentals.ca/RentFaster).** Depends on partners accepting the feed; longest/least-controllable. Start outreach early, lands last.

## Lane 1 spec (the build)
Rewrite `SimpleGetOnline` from a 6-step list into an outcome-first flow:

1. **Hero = one primary action.** "Put {address} online" → `publishProperty`. If `canSetLive` and basics ready, it's literally one click. If a single blocker exists (basics/photos), the button reveals the ONE inline resolver (reuse the existing inline basics form + photo upload already in the component) — never a 6-step wall. Kill the "Nothing posts automatically" line.
2. **Redefine "online".** Show the celebratory "You're online" state the instant `linkIsLive` is true (drop the `&& liveChannels > 0` gate). Win card = shareable link + Copy + QR + Text/Email/Preview + inquiry count. External posts become additive, not the definition of done.
3. **Automation ladder below the hero**, in three demoted groups: Automatic (page + feed, always on) · Connect-once (IG/FB Page — "Connect" stub until Lane 2; show as coming/greyed honestly) · Done-for-you / Co-pilot for FB Marketplace + Kijiji.
4. **FB/Kijiji = done-for-you first (Noam's pick), honestly.** Surface `requestConciergePublish` as the front-line "We post it for you — you approve one sign-in." **Plan-gate it:** on Free (`canUseListingMarketing`=false) show it as an **upgrade** ("Want us to post these for you? → upgrade"), with the free **co-pilot** as the available path. On Growth+ show remaining allowance (`conciergeUsageLabel`). Guided steps become a buried "post it yourself" fallback link.
5. **Reuse, don't rebuild:** publishProperty, the org feed, LaunchRunPanel, requestConciergePublish, the co-pilot/sidecar, conciergeUsageLabel/conciergeMonthlyIncluded, HiddenPreservedPropertyFields. Simple mode only; Advanced command center untouched. No new server action expected; no migration expected.

## RESOLVED DECISION (Noam, S621): (A) Upsell in place — sequenced so it never taxes the free win.
Rules that make it non-coercive and campaign-aligned:
- **The free one-click win lands first and unconditional.** "You're online" (Vacantless page + feed) is never gated, interrupted, or preceded by any upsell. This is the hook + stickiness.
- **Done-for-you appears only at the "reach more" step, as additive convenience — not access.** The free **co-pilot** stays available directly underneath, so a Free operator is NEVER blocked from FB/Kijiji; concierge sells *removal of effort*, not the outcome.
- **Plan-gate via the value already computed:** `conciergeDeskEnabled` (page.tsx = `hasEntitlement(plan,"listing_marketing")`, false on Free) → true: show "we'll post for you" + `conciergeUsageLabel(conciergeUsage)` remaining; false (Free): show the **upgrade** card ("Want us to post Facebook & Kijiji for you? → Upgrade to Growth") with co-pilot underneath.
- **Nudge with the vacancy-cost line already computed:** `conciergeDailyLostLabel` ("every day vacant costs ~$X") on the upsell card — honest, specific, reframes the subscription as cheaper than a vacant week.
Data note: `conciergeDeskEnabled` / `conciergeUsage` / `conciergeDailyLostLabel` already ride on `launchRun` (Advanced card consumes them at distribute-tab.tsx:572-578); Lane 1 only threads them into SimpleGetOnline. No migration, no new server action, no new computation.

## Deferred (C) note
Giving Free a 1-taste done-for-you is a later billing move; allowance is display-only today (S538). Not in Lane 1.

## Reference
Mockup: get-online-reframe-mockup.html (Cowork S621). Touch points: app/dashboard/properties/[id]/distribute-tab.tsx (SimpleGetOnline + LaunchRunPanel + concierge card), page.tsx (data plumbing: linkIsLive, launchRun, liveChannels, replyInputs, plan/usage), lib/billing.ts (concierge entitlement), lib/distribution-copilot.ts + copilot-sidecar.ts (free path).
