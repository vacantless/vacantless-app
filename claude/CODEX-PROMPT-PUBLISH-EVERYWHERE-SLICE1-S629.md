# Codex prompt — Publish Everywhere, Slice 1 (render-only surface) — S629

**Repo:** `.../Agile Lead to Lease Engine/vacantless-app` · branch off prod `main` (= current HEAD after the S629 merge, `eae1570`).
**North-star:** artifact `publish-everywhere-north-star` (v3) + `claude/DESIGN-PUBLISH-EVERYWHERE-BUILD-SPEC-S629.md`. Read the spec first.
**Scope of THIS slice:** the NEW surface, RENDER-ONLY, behind a flag. No new posting behavior, no migration, no billing change. It renders the approved one-click layout from data that ALREADY exists on the property page. Later slices wire orchestration / co-pilot / status.

**Standing constraints (S595):** additive only; ships DARK behind a new env flag `PUBLISH_EVERYWHERE_ENABLED` (`=== "true"` idiom, like `CONCIERGE_DESK_ENABLED`/`IG_CHANNEL_ENABLED`); esbuild/tsx-check every edited TSX; add a `tsx` test; **Noam reviews + pushes**.

## Warm-verify first (grounded anchors)
- `app/dashboard/properties/[id]/page.tsx` — the Market-it surface mounts `<DistributeTab tabId="distribute" …>` (~line 3427). All channel data is already computed here: `distributeChannelCards` (per-channel key + `computeChannelStatus` result + mode/connect info via `lib/distribution-channels.ts`), `distributeFeedStatus`, `linkIsLive`, `conciergeEnabled && CONCIERGE_DESK_ENABLED`, `facebookPageEnabled`, `IG_CHANNEL_ENABLED`. **Reuse these — do not recompute.**
- `app/dashboard/properties/[id]/distribute-tab.tsx` + `get-online-view.tsx` — the current Simple/Advanced surface. Slice 1 renders the new view **instead of** the Simple hero when the flag is on; Advanced + all existing props stay untouched.
- `lib/distribution-channels.ts` — `DISTRIBUTION_CHANNELS`, `channelTileStatus`, `channelConnectChip`, `computeChannelStatus`, `ChannelMode`. The mode resolver builds on these; do not fork them.

## Build
### 1. `lib/publish-everywhere.ts` (pure, unit-tested — no DOM/IO)
Export `resolvePublishMode(input) -> { mode, bucket }` where:
- `mode ∈ { instant_auto, copilot_fill, paid_optin, needs_connection, brokerage_gated, planned }` — derived from the channel's config (`integrationStatus`/`connectKind`/`mode`) + its account state (`account_status`/`automation_authorized`) + relevant flags, reusing `channelConnectChip`/`channelTileStatus` verdicts.
  - always-on (Vacantless page, email) + connected api_automatic (FB Page/IG authorized) + accepted feed → `instant_auto`
  - `assisted_manual` no-fee (Marketplace, Kijiji) → `copilot_fill`
  - `assisted_manual`/`feed_or_assisted` paid self-serve (Viewit, RentFaster) → `paid_optin`
  - available but unconnected (IG pre-OAuth) → `needs_connection`
  - `broker` → `brokerage_gated`
  - `integrationStatus:"planned"` with no mechanism → `planned`
- `bucket ∈ { instant, for_you, after_setup }`: instant_auto→instant; copilot_fill|paid_optin→for_you; needs_connection|brokerage_gated|planned→after_setup.
- Also export `summarizeReach(cards) -> { included, instant, for_you, after_setup }`.
Add `scripts/test-publish-everywhere.ts` (mirror `scripts/test-distribution-channels.ts`): assert each channel resolves to the expected mode/bucket across representative account states, and the reach counts.

### 2. `app/dashboard/properties/[id]/publish-everywhere.tsx` (new client component)
Render the approved v3 layout from the passed-in channel cards (map the north-star artifact):
- listing summary (already on the page — reuse), reach summary (`summarizeReach`), the three buckets grouped by `bucket`, the persistent status legend.
- the dominant **Publish everywhere** CTA + the **preflight confirm modal** (shows what fires instant / for-you, the third-party-fee line = "$0.00, always shown first" for now, and the plan-allowance line from `conciergeMonthlyIncluded(plan)` — DISPLAY ONLY this slice).
- **RENDER-ONLY:** the confirm modal's primary action calls the EXISTING `publishProperty` (page-live + existing autofire) exactly as the current Simple hero already does — no new posting path, no co-pilot, no charge. The co-pilot/pay/queue wiring is a later slice; stub those affordances as visible-but-disabled with a "coming soon in this org" note, or omit.
- Reuse existing tone/components (`components/ui.tsx` ChipTone etc.); no new color system.

### 3. Mount behind the flag — `page.tsx` + `distribute-tab.tsx`
Where the Simple get-online hero renders inside the distribute tab, gate: `PUBLISH_EVERYWHERE_ENABLED === "true"` → render `<PublishEverywhere …/>` (fed the already-computed `channelCards`, `linkIsLive`, `plan`, feed/concierge flags); else the current surface unchanged. Pass the flag down from the layout the same way other flags are threaded. Advanced command-center untouched.

## Acceptance
- Flag off ⇒ property Market-it tab identical to today.
- Flag on (dev) ⇒ the new Publish Everywhere surface renders the three buckets + reach + CTA + confirm modal from real per-org channel data; the CTA still just runs the existing `publishProperty` (page-live + current autofire) — nothing new posts.
- `resolvePublishMode` unit test green; esbuild/tsx-check clean; `next build` clean. No migration, no new posting, honesty invariants intact (KI999/Meta review). Ships dark.

## Not in this slice (later)
Co-pilot extension handoff + `requestConciergePublish` queue (Slice 3); allowance consumption + packs + paid-direct fees (Slice 3); persistent `listing_posts` status panel + Rentals-list roll-up (Slice 4); planned-channel + worker flips (Slice 5+).
