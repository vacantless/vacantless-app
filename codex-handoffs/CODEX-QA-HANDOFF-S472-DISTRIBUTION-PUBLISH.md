# Codex QA handoff — S472: one-click publish run (Distribute tab)

## Provenance (read first)
This was an in-flight WIP that got tangled with the S471 arrival-phone batch: the S471b
deploy accidentally swept the page.tsx integration into a commit WITHOUT the untracked
`lib/distribution-publish.ts`, breaking the Vercel build (fixed by S471c, which reverted
page.tsx to arrival-phone-only). Cowork then re-integrated this feature cleanly, RENUMBERED
its migration `0136 -> 0137` (0136 was taken by showing_arrival_phone), applied 0137, and
shipped it deploy-ready as S472. **It has NOT had a prior Codex pass — review as new.**

## What it does
A "one-click publish run" on the Distribute tab, built on the S412 distribution_runs /
distribution_run_items primitives. Publishes across selected channels while keeping channel
truth honest: `publish_status='live'` ONLY when the public page or a tracked external URL is
actually live; feed/API channels are `submitted` (never fake-`live`); Facebook/Kijiji stay
browser-copilot / concierge (no fake automation).

## Files
- `supabase/migrations/0137_distribution_publish_run_fields.sql` — APPLIED to prod + verified
  (9 additive columns on distribution_run_items: publish_status, mode, blockers jsonb '[]',
  last_attempted_at, last_verified_at, error_code, error_message, operator_action_url,
  audit_message; widened channel CHECK; publish_status/mode/blockers-array CHECKs). Existing
  rows were only facebook/kijiji so the channel-CHECK swap was safe.
- `lib/distribution-publish.ts` — pure adapter: PublishChannelKey/Mode/Status models +
  normalizers, publishChannelMeta, preparePublishChannel(context)->plan, verifyChannel,
  unpublishChannel, legacy<->publish status mapping.
- `lib/distribution-run.ts` — + runProgress() pure aggregator.
- `app/dashboard/properties/actions.ts` — the publish server action(s) + helpers
  (readinessBlockers, canPublishFromStatus, livePostForChannel, publishItemResolved). Real
  side effect: publishing the Vacantless page sets properties.status='available' + revalidates.
- `app/dashboard/properties/[id]/page.tsx` — integration: plan-cap (listingCapForPlan) +
  other-live-listing count, blocker labels, publishContextForChannel, publish start channels.
- `app/dashboard/properties/[id]/launch-run-panel.tsx`, `distribute-tab.tsx` — UI.
- `scripts/test-distribution-publish.ts`, `scripts/test-distribution-run.ts` — unit tests.

## Review focus (priority order)
1. **Publish side effect + authorization.** The action sets properties.status='available'.
   Confirm it is org-scoped (RLS / requireCapability / ownership) so an operator can't publish
   a property they don't own, is guarded by canPublishFromStatus (draft/paused/off_market only;
   leased must be explicitly relisted), and enforces the plan live-rental cap
   (listingCapForPlan vs otherLiveListingCount) BEFORE flipping status.
2. **Honesty invariant.** preparePublishChannel/verifyChannel must never report `live` unless
   the public page or a tracked external URL is genuinely live; feed=submitted; FB/Kijiji=
   copilot/concierge. No channel should claim automation it doesn't perform.
3. **Migration 0137** — additive/backward-compat; the CHECK swaps; blockers jsonb-array invariant;
   nothing depends on the new columns being non-null.
4. **distribution_run_items writes** — publish_status/mode/blockers persistence + org-scoping;
   legacy `status` column still works for older rows/code (per the migration's intent).
5. **page.tsx** — the extra plan-cap COUNT query (head:true) + blocker derivation; correctness
   and no accidental N+1 on the run render.
6. **Tests** — coverage of preparePublishChannel across channels/contexts + runProgress.

## Not in scope
Arrival phone (S471/S471b/S471c) reviewed separately (CODEX-QA-HANDOFF-S471-ARRIVAL-PHONE.md).
