# Codex prompt — per-org feature entitlement layer (S596, 2026-07-29)

**Status:** READY to dispatch (refreshed S596 post warm-verify; base = prod main HEAD `aee4e9a`). Generalizes the compliance-calendar per-org pattern so EVERY feature can be flipped per client / per cohort / all, and tied to plan. File-disjoint from the jurisdiction readiness lane.

## Why
Enablement is inconsistent today: the compliance calendar is per-org selectable (env master + `organizations.compliance_calendar_enabled` + per-event notification_settings), but AI-reply and other features are single global env flags (all-or-nothing), and the MAINTENANCE module gates per-PLAN only (see anchors). As we scale to many clients (and add jurisdiction rules), we need ONE place per client that says which features are on, so anything can be enabled for one client, a cohort, or all — and can default by plan (free vs Growth vs Premium).

## Verified code anchors (warm-verified S596 — read these first)
- `lib/billing.ts` — `PLAN_ENTITLEMENTS` map (~L219-221: growth/premium/managed rows), `hasEntitlement(plan, key)`, and the feature helpers incl. `canUseIncidentIntake` (~L268) + `canUseIncidentDispatch` (~L274). This is the plan-default source of truth.
- `organizations.compliance_calendar_enabled` (migration 0197) + per-event notification_settings — the existing per-org pattern to generalize; David Harel's org (baa9410d) is the LIVE pilot and must not break.
- `AI_REPLY_ENABLED` — a global-only env flag to retrofit into per-client selectable.
- Maintenance module (`app/dashboard/maintenance`, `app/report/[token]`, `app/repair/[token]`, `app/job/[token]`) is fully built + live and gates via `canUseIncidentIntake`/`canUseIncidentDispatch` — PLAN-only today, no env flag, no per-org override.

## Design
- Keep env vars as the GLOBAL MASTER kill-switch per feature (unchanged) for features that HAVE one.
- Add a per-org entitlement store: `organization_feature_flags` (organization_id, feature_key text, enabled boolean, updated_at) — additive migration, no backfill. One row per (org, feature); absent row = fall back to the plan default, else OFF.
- A single resolver `isFeatureEnabledForOrg(featureKey, org, { env })`: returns true only if (env master on OR the feature has no env master) AND (per-org row enabled === true, OR no row but the plan default for this feature+plan is on, read from `lib/billing.ts`). Fail-closed on unknown feature.
- Plan defaults: read from `lib/billing.ts` `hasEntitlement`/`PLAN_ENTITLEMENTS` so a feature can be "on by default for Growth, opt-in for free," without per-org rows. The resolver must reproduce today's behavior when no per-org row exists.
- Admin UI: a per-client feature toggle list (reuse the Settings→Communications toggle pattern) so an operator flips features per client. Keep the existing compliance per-org toggle working (either migrate it to read/write through this layer, or have the resolver honor the existing column — do NOT break David's live pilot).
- Retrofit these to read `isFeatureEnabledForOrg` in ADDITION to their existing gate:
  1. **AI-reply** (`AI_REPLY_ENABLED`) — env master AND per-org override → per-client selectable.
  2. **Landlord campaign** (`LANDLORD_CAMPAIGN_ENABLED`) — same.
  3. **Maintenance intake + dispatch** — make `canUseIncidentIntake`/`canUseIncidentDispatch` resolve through `isFeatureEnabledForOrg('incident_intake'|'incident_dispatch', org)` (no env master; per-org override → plan default). This is what lets Noam turn maintenance on for ONE free/Growth landlord without changing their whole plan. Preserve current behavior when no per-org row (i.e., pure plan default).

## Constraints
Build native off prod main (HEAD `aee4e9a`). Additive migration only (do not alter `organizations.compliance_calendar_enabled` semantics — David's pilot must keep working). Ship dark: no client's entitlements change on deploy; defaults reproduce today's behavior exactly. esbuild-check edited TSX (not tsc). Add a resolver unit test (env off ⇒ off; no env master ⇒ skip that clause; plan default both tiers; per-org override both directions; unknown feature ⇒ off; maintenance keys resolve to today's plan behavior when no row). Stage only the touched files (never untracked claude/ or codex-handoffs/, and never the junk "* 2.tsx" dupe files). Reply with the commit sha, file list, migration filename, and gate/test results. Noam reviews + pushes.

## Ties to
- claude/RUNBOOK-ENABLE-FEATURE-FOR-CLIENT-S596.md (the model this standardizes)
- claude/DESIGN-JURISDICTION-AWARE-RULES-ENGINE-AND-RESEARCH-PLAN-S596.md (jurisdiction rules resolve per-org the same way)
- claude/WARM-VERIFY-MAINTENANCE-MODULE-S596.md (why the maintenance keys are in the retrofit list)
