# CODEX PROMPT — "Get it live" Slice 1: Publish-everywhere as default + front-loaded preflight gate (S636)

Grounded on `vacantless-app` main @ 7032761 (verify `git rev-parse --short HEAD`). Design of record: `claude/DESIGN-PUBLISH-GET-IT-LIVE-CURTAIN-S636.md`.

WORKING-TREE NOTE: main currently carries an UNCOMMITTED S629 change (3 files: `lib/org.ts`, `app/dashboard/settings/actions.ts`, `app/dashboard/leasing/screening/page.tsx` — the `inquiry_require_phone` Settings toggle). Commit that on its OWN branch first (or stash it). Do NOT fold it into this Slice-1 branch.

## Goal
Make the Distribute tab feel like the calm "Publish everywhere" mockup: the existing `PublishEverywhere` surface becomes the DEFAULT, the dense per-channel detail is tucked behind an "Advanced / More options" disclosure, and the preflight confirm becomes a single FRONT-LOADED gate that gathers the only two human decisions up front — sign-in and payment — with paid channels OFF by default. No new posting path, no new server action, no migration. Flag-gated, ships dark.

## Persona / rule (do not violate)
Anyone (elderly / ESL / busy) gets a listing live without seeing mechanism. The person is asked for exactly TWO things — sign-in and pay — and nothing else (no channels, modes, statuses, settings). The curtain hides mechanism, never consent. Keep every existing honesty invariant (below).

## Scope — build exactly this
1. FLAG. Add `PUBLISH_SIMPLE_DEFAULT_ENABLED` (default OFF), read where the Distribute tab composes its sections. Flag OFF ⇒ the tab renders exactly as today.

2. DEFAULT = CALM. In `app/dashboard/properties/[id]/distribute-tab.tsx` (`DistributeTab` L384; already renders `<PublishEverywhere>` ~L555, `<LaunchRunPanel>`, `<ChannelPublishRail>`, plus channel cards / posts & attribution / reply inputs / run notices): when the flag is ON, render `PublishEverywhere` as the primary default surface and move ALL other sections into one collapsible "Advanced / More options" block, DEFAULT COLLAPSED. Preserve every existing prop and behavior — this is a visibility reorg, not a rewrite. Delete nothing.

3. FRONT-LOADED PREFLIGHT. Upgrade `ConfirmModal` in `app/dashboard/properties/[id]/publish-everywhere.tsx` (L808, "the mandatory preflight gate") from a plain confirm into the front-loaded gate:
   - Add a NEW pure, unit-tested helper in `lib/publish-everywhere.ts` that, from the already-resolved rows, derives:
     - `signInNeeded` = for_you channels (modes `copilot_fill` + `paid_optin`).
     - `feeChannels` = `paid_optin` channels, each with a fee label.
   - Render, in plain minimal ESL-simple language: "X sites go live instantly · Y need a quick sign-in · Z cost a fee." List the sign-in sites (logo + name). List paid sites as OPT-IN checkboxes, DEFAULT UNCHECKED, each showing its fee; show the running total of checked fees. Unchecked paid sites are simply left out (no charge, re-addable later).
   - Fee label source: use a fixed listing fee if the app exposes one (search `lib/distribution-channels.ts` / channel config / billing). Where the fee is CONDITIONAL or unknown app-side (e.g. Kijiji charges only on a REPOST — first post is free), show honest "a site fee may apply" — never invent a number.
   - Primary action UNCHANGED: the existing `publishProperty` server action (actions.ts:1098; page-live + authorized-instant autofire). Do not add or change server actions. The for-you handoff stays the existing `ForYouHandoff` / `openGuidedPosting` (actions.ts:2545) / `requestConciergePublish` (actions.ts:4676) path.
   - Sign-in note stays "we never see your password."

## Out of scope — do NOT build here (later slices)
- Auto-capturing the posted URL / removing paste-back (Slice 2).
- Per-channel session-freshness detection (Slice 3) — Slice 1 lists sign-in sites by MODE, not live session state.
- Background/walk-away run + notification (Slice 4); dashboard "Relist" entry on stale ads (Slice 5); one-button take-down mirror (Slice 6).
- Any change to `resolvePublishMode` semantics, the honesty invariants, or posting mechanics.

## Honesty invariants (must still hold)
Nothing posts before the preflight confirm (KI999). "Instant" only for connected/authorized/accepted; "we post it for you" only for copilot-capable. Reach "included" = instant + for_you, never the raw channel count. Extension/desk never posts, signs in, or pays for the landlord.

## Gate (all must pass)
- `npx tsc --noEmit` clean.
- `npm run lint` (only the known unrelated `app/job/[token]/page.tsx` <img> warning is acceptable).
- `npm run build` green.
- Extend the publish-everywhere unit test (`scripts/test-publish-everywhere.ts`) with cases for the new `signInNeeded` / `feeChannels` helper, including paid-default-off.
- With the flag OFF, the Distribute tab renders byte-identically to today (no visual/behavior change).
- `git diff --check` clean.

## Deliver
A branch + PR. Report the flag name, files touched, and gate output. Do NOT flip the flag in prod — Noam turns it on after review.
