# CODEX PROMPT — "Get it live" step-clarity on the live/relist state (S639)

> Mirror of the on-disk handoff at `vacantless-app/claude/CODEX-PROMPT-GET-IT-LIVE-STEP-CLARITY-S639.md` (rule 36). Extends: `claude/DESIGN-GET-IT-LIVE-FLOW-FRICTION-S638.md` (curtain principle) and the just-merged publish-polish (PR #13, "Polish simple publish flow"). Noam approved this cut in S639 after a live look at the polished page.

**Ground on `vacantless-app` `main` AFTER PR #13 (`codex/s638-publish-flow-polish`, commit 68813d5) is merged** — this cut builds directly on #13's reworked hero + reordered rail. Branch from `main` once #13 is in; if #13 is NOT yet merged, branch from `codex/s638-publish-flow-polish` instead. Verify `git rev-parse --short HEAD`. All line numbers below are against the post-#13 tree — treat them as anchors, not guarantees, and re-verify.

## Why (the gap this fixes)
On a live walk of the polished page (2419 Mercer, already Live on 2 channels), the explicit "what do I do first / second / third" is missing exactly on the already-live / relist path — the one Noam originally flagged as high-friction. Root cause + three contradictory signals, all verified in source:

1. **The numbered 1-2-3 hero only renders pre-live.** `publish-everywhere.tsx` splits on `linkIsLive`: the `!linkIsLive` branch (L293-370) shows the numbered **1 Tap Publish -> 2 Sign in if asked -> 3 Confirm the live link** hero; the `linkIsLive` branch (L264-291) shows only "Live on {N} channels" + a lone "Sync updates / re-publish" button. So the moment a listing is live, the step sequence disappears and the user faces several parallel CTAs (Sync/re-publish + "Start this site" x N) with no "do this next."
2. **Header tells you to click a button that isn't there.** `distribute-tab.tsx:735` header says "Click **Publish everywhere**." In the live state there is no "Publish everywhere" button — the button is "Sync updates / re-publish" (`publish-everywhere.tsx:286-291`). ("Publish everywhere" exists only in the pre-live branch L336-345 and inside `ConfirmModal` L982.)
3. **"0 sites posted" next to "Live on 2 channels."** `distribute-tab.tsx:748-750` renders `{liveChannels} {…} posted`; on a listing that is live via connected/instant channels this reads "0 sites posted" beside the body's "Live on 2 channels."
4. **"Set this property Live" while you're online.** The `NextActionCard` (`next-action-card.tsx`) driven by `lib/rental-next-action.ts:225-227` renders "Set this property Live — Still needs you: Add at least one photo" ABOVE the "You're online" block when a live listing merely lacks a photo. Reads as: am I live or not?

A first-timer on a NEW listing is fine (the 1-2-3 fires). A landlord on an ALREADY-live listing is not told what their single next move is. This cut gives every state one obvious next step and removes the contradictions — same calm, honest voice as the pre-live hero.

## Honesty rule (unchanged — do not violate)
The person is ever asked for exactly two things — **sign-in** and **pay** — nothing else. Nothing posts before the preflight `ConfirmModal` confirm (KI999). A channel is "Live" only after the real ad link is saved. "Connected/included" is never rendered as a raw "posted" count. No new server action, no auto-post, no auto-mark-live.

---

## THE CUT — one clear "next step" in every state (flag `STEP_CLARITY_LIVE_ENABLED`, default OFF, dark)

### Scope — build exactly this
1. **FLAG.** Add `STEP_CLARITY_LIVE_ENABLED` (default OFF). Thread it server -> prop the same way the sibling publish flags are threaded (e.g. how `PUBLISH_SIMPLE_DEFAULT_ENABLED` reaches `distribute-tab.tsx` / `publish-everywhere.tsx`). **Flag OFF => byte-identical to today.** No migration, no new server action.

2. **Live-state next step** (`publish-everywhere.tsx`, `linkIsLive` branch ~L264-291). When `linkIsLive` AND flag ON, render ONE compact "Your next step" element, derived from state, in the same voice as the pre-live 1-2-3:
   - If any for-you channel still needs sign-in/post (a `forYou` row not yet live): next step = "**Finish {first channel}** — sign in and post" wired to the SAME action already used in `ForYouHandoff` ("Start this site" -> the co-pilot item / `openGuidedPosting`). Surface the single primary channel's action inline (or a "Finish {channel}" button that scrolls to its `ForYouHandoff` row). Keep it ONE action, not a list.
   - Else (nothing outstanding): next step = a calm "**You're all set** — re-publish only when you change the listing."
   - Keep "Sync updates / re-publish" available but DEMOTED to a secondary link/button — never the lone primary. Reuse the existing `setConfirmOpen(true)` handler; do not add a server action.

3. **Header label matches the on-page button** (`distribute-tab.tsx:734-736`). Make the header line state-aware so it never names a button that isn't present:
   - pre-live: keep "Click Publish everywhere. We turn on the connected channels…"
   - live: e.g. "Your listing is live. Finish any site that still needs your sign-in — then you're done." (match whatever the live primary CTA says.)

4. **Header chip honesty** (`distribute-tab.tsx:747-751`, the `{liveChannels} … posted` span). When `linkIsLive`, do not show a bare "0 … posted" beside a live listing. Either show "Live on {reach.instant}/{connected count} {sites}" language or drop the chip when it would read 0 while live. Never a raw post count that reads zero on a live page. (`readinessLabel` at L476-486 already handles the other chip; keep it.)

5. **Kill the live-vs-photo contradiction** (`lib/rental-next-action.ts:~225` "Set this property Live" step + `next-action-card.tsx`). When the listing is already live, the `NextActionCard` must NOT title itself "Set this property Live." Suppress that step when live, OR reframe it to a non-contradictory "Strengthen your live ad — add a photo." Keep the photo nudge; change only the framing so the top card and the "You're online" block agree. Gate this reframing behind the same `STEP_CLARITY_LIVE_ENABLED` flag so flag-OFF is unchanged.

6. **(Optional, only if cheap) De-dup the double channel list.** The same channels show in both "Finish these sites" (left `ForYouHandoff`, `publish-everywhere.tsx:548`) and the right "Needs your sign-in" rail — reads as double the work. If trivial, make the right rail entries read as a summary (non-actionable labels) while the left holds the actions, or add a one-line "these are the same sites, summarized" cue. If not trivial, SKIP and say so in the PR — do not force it.

### Out of scope
No change to `publishProperty`, `requestConciergePublish`, `completeCopilotPost`, `openGuidedPosting`, `resolvePublishMode`, `derivePublishPreflight`, or the `ConfirmModal` gate semantics. No migration. No new server action. No new posting path. Do not flip the flag in prod — Noam flips after review + native lint/build (KI1030: `next lint`/`next build` do NOT run in the on-device Linux VM; only `npx tsc --noEmit` does).

### Gate
`npx tsc --noEmit` clean · `npm run lint` (only the known `app/job/[token]/page.tsx` `<img>` warning) · `npm run build` green · **flag OFF renders byte-identical** · with flag ON on a LIVE listing: exactly one primary "next step" is shown, the header text matches the on-page button, no "0 sites posted" appears beside a live listing, and the top card no longer says "Set this property Live" while live · `git diff --check` clean.

### Deliver
Branch + PR. Report: flag name, files touched, gate output, and whether the optional de-dup (step 6) shipped.

---

## SEPARATE tiny fix — refresh a stale billing comment (own commit or own PR; keep logically distinct from the UX cut)
In `lib/billing.ts`, the comment above `CONCIERGE_INCLUDED_GROWTH/PREMIUM/MANAGED/PILOT` (L375-376) reads: *"Soft included monthly concierge posting allowance. This is DISPLAY ONLY for S538: no cap, Stripe hook, overage charge, or claim function reads this value."* — that is **now stale**. `requestConciergePublish` (`app/dashboard/properties/actions.ts:~4792`) computes `conciergeMonthlyCap(plan, { overrideCap, packs })` and the `claim_concierge_leaseup(p_org, p_period, p_property, p_cap)` RPC (migration `supabase/migrations/0172_concierge_enforcement.sql`, `security definer`, writes only through it) ENFORCES it per-org / per-UTC-month / per distinct property. Update the comment to state the allowance IS enforced server-side via that claim RPC (cap = plan included + purchased packs, admin-override-able; `used` = distinct properties with `distribution_run_items.concierge_requested_at` in the month). Comment-only — zero behavior change.

## Reference — how syndications are metered per subscription (context for the above, not a task)
Metered unit = a **done-for-you (concierge) lease-up per calendar month, counted per distinct property** (not per channel; self-serve + guided "you post it" publishing is unlimited and uncounted). Included/month: Growth 2, Premium 6, Managed 20, founder Pilot 99, Free/trial 0 (`CONCIERGE_INCLUDED_*`), plus add-on packs ($49 / 3, `concierge_pack_purchases.quantity` by `period` YYYY-MM) and an optional per-org override (`organizations.concierge_leaseup_cap_override`). Enforced by `claim_concierge_leaseup`.
