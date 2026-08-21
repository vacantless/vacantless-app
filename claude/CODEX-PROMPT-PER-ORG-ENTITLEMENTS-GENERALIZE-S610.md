# CODEX PROMPT — Generalize per-org feature entitlements + cross-org admin toggle (S610)

**Base = main (prod HEAD 046b251). Ships DARK: a new admin surface behind the existing admin gate; every existing org keeps its current plan behavior until an override is set. Likely NO migration (the table already exists). Do not `git push` — Noam reviews and pushes.**

Wave 1 / Lane 1 of the S610 backlog build. File-disjoint from the smart-lock, receipt-vault, and spend-analysis lanes.

## WARM-VERIFY FIRST — grep, and STOP if already built
The per-org feature-flag INFRA already exists — do NOT rebuild it. Confirm before extending:
- `supabase/migrations/0199_organization_feature_flags.sql` — the `organization_feature_flags(organization_id, feature_key, enabled, ...)` table with per-org RLS + service_role grants. Reuse as-is; do NOT create a parallel table.
- `lib/feature-entitlements.ts` — `isFeatureEnabledForOrg()`, `loadOrganizationFeatureFlags()`, `loadOrganizationFeatureFlagsByOrg()`, `planDefaultForFeature()`, `envMasterForFeature()`, and the `ORG_FEATURE_KEYS` list (today a fixed 4: `ai_reply`, `landlord_campaign`, `incident_intake`, `incident_dispatch`).
- `app/dashboard/settings/page.tsx` + `app/dashboard/settings/actions.ts` `updateOrganizationFeatureFlag` — the SELF-serve per-own-org toggle (owner toggling their own org).

If a cross-org admin feature-toggle surface already exists under `app/dashboard/admin/`, STOP and report — this is that gap.

## WHAT THIS IS
Two extensions to the existing entitlement system so Noam can SELL/enable any built feature per client:

1. **Generalize the flag set.** `ORG_FEATURE_KEYS` is currently a hardcoded 4-item list. Extend it to cover every plan-gated, sellable feature. Read the canonical entitlement keys from `lib/billing.ts` `PLAN_ENTITLEMENTS` / `PlanEntitlements` (e.g. accounting, market_rent, listing_marketing, incident_intake, incident_dispatch, repair_sms, compliance_calendar, and any others present) and make each one per-org overridable. For each key, `planDefaultForFeature()` must return the SAME value the plan would grant today (derive it from `PLAN_ENTITLEMENTS`), so an org with no override row behaves EXACTLY as it does now. This is a pure default-preserving generalization — no behavior changes until someone sets an override.

2. **Cross-org admin toggle.** A new admin-only surface where Noam (operating his book) can turn a feature ON or OFF for a SPECIFIC client org, and see the current resolved state per org. This is the "enable maintenance for David / enable market-rent for Paul" lever.

## REUSE (import; do NOT modify the source modules' contracts)
- `lib/feature-entitlements.ts` — extend `ORG_FEATURE_KEYS`; wire `planDefaultForFeature` to `PLAN_ENTITLEMENTS`. Keep every existing exported signature.
- `lib/billing.ts` — `PLAN_ENTITLEMENTS`, `hasEntitlement`, `PlanEntitlements` (source of truth for keys + plan defaults).
- `app/dashboard/admin/actions.ts` + `app/dashboard/admin/page.tsx` — the existing admin surface + its owner/admin auth gate; add the toggle action + UI here.
- `lib/supabase/admin.ts` — the service-role client for the cross-org write (an agent-admin writing another org's flag row).
- `loadOrganizationFeatureFlagsByOrg` already supports multi-org reads — use it to render current state across the book.

## FILES — exact scope
- EDIT `lib/feature-entitlements.ts` — generalized `ORG_FEATURE_KEYS` + `PLAN_ENTITLEMENTS`-derived `planDefaultForFeature`. No signature changes.
- EDIT `app/dashboard/admin/actions.ts` — a new `setOrgFeatureFlagAsAdmin(orgId, featureKey, enabled|clear)` server action, admin-gated server-side (reuse the page's existing auth requirement), service-role upsert/delete on `organization_feature_flags`, idempotent.
- EDIT `app/dashboard/admin/page.tsx` (or a new co-located `admin/feature-flags/` sub-route + component) — a per-org × per-feature matrix with on / off / plan-default (clear) controls. Server-gate identically to the rest of admin.
- NEW `scripts/test-feature-entitlements-generalized.ts` — extend/mirror the existing `scripts/test-feature-entitlements.ts`.
- Migration: only if a column is genuinely missing. The 0199 table already covers this — prefer NO migration.

## CONSTRAINTS / INVARIANTS
- **Default-preserving:** with zero override rows, `hasEntitlement`/`isFeatureEnabledForOrg` must return exactly today's values for every org and every key. Prove this in the test.
- **Gate server-side** on admin auth at the new action (never UI-only); a non-admin caller is rejected.
- Env master switches (`envMasterForFeature`) stay as the hard kill — an env-off feature can't be turned on per-org.
- Pure logic (default resolution) stays in `lib/feature-entitlements.ts` and is unit-tested with `npx tsx`. No DB in the pure path.
- esbuild-syntax-check every edited/created `.tsx`: `cat <file> | npx esbuild --loader=tsx --format=esm >/dev/null`.
- Additive only; if any column is added it is RLS org-scoped with a `service_role` grant. Do NOT git push.

## VERIFICATION (Cowork re-runs)
- `scripts/test-feature-entitlements-generalized.ts` passes under cloud `npx tsx`: (a) no-override resolution == plan default for every key; (b) an ON override enables a plan-off feature; (c) an OFF override disables a plan-on feature; (d) env-master-off beats any per-org ON.
- Prove the admin gate: a non-admin caller to `setOrgFeatureFlagAsAdmin` is rejected.
- `git diff --check` clean; diff confined to the files above.

## OUT OF SCOPE
Cohort / all-orgs bulk apply (later). Billing/Stripe changes. Any change to what a feature DOES — this only governs whether it's on for an org.
