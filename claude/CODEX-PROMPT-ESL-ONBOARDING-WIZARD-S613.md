# CODEX PROMPT — Accessible "Getting started" onboarding wizard (Wave 2 lane 3)

> Dispatch-ready. Derived from `claude/PRESPEC-ACCESSIBLE-SEED-ONBOARDING-WIZARD-S611.md`, warm-verified against prod clone `948a7242` on 2026-08-02 (S613). Open decisions D1–D5 are RESOLVED below (Noam delegated the recommendations). Follow the warm-verify loop (WORKFLOW 206): build → Cowork diff-vs-clone + tsc/pure-test → migration-before-deploy with SQL readback → file-scoped serial push. Dark by default; nothing changes for any operator until `ONBOARDING_WIZARD_ENABLED` is set.

## Goal
Add a resumable, WCAG 2.1 AA "Getting started" checklist/wizard that guides a self-serve landlord from a freshly created org to first usable state. It is **additive and gated**: with the flag off, the dashboard renders exactly as it does today.

## RESOLVED DECISIONS
- **D1 — augment, do NOT replace `/onboarding`.** `/onboarding` stays exactly as-is (org creation → `create_organization` RPC → seeds clauses + tenant templates → redirects to `/dashboard`, see `app/onboarding/actions.ts`). The new wizard is a **dashboard "Getting started" surface** shown until complete or dismissed. No auth-flow / signup-redirect churn.
- **D2 — new `organization_onboarding` table** (additive, org-scoped RLS mirroring 0203). Store only what can't be derived: `dismissed_at`, `rail_step_done_at` (the rail step is skippable, so needs an explicit "handled" marker), timestamps. **Derive** property/tenancy completion from live data (`count(*) > 0`) rather than duplicating state that can drift.
- **D3 — v1 steps = (1) add first property, (2) add first tenancy + tenant (optional/skippable), (3) set up a rent rail (CTA link-out) or skip.** The PRESPEC's "seed templates/clauses" step is DROPPED: `app/onboarding/actions.ts` already calls `seedClauseLibrary` + `seedTenantMessageTemplates` at org creation, so a seed step would be a no-op. Profile/branding is likewise already done in `/onboarding`.
- **D4 — master env flag `ONBOARDING_WIZARD_ENABLED`, default OFF.** Off → no `/dashboard/getting-started` route surfaced, no dashboard card, zero behavioral change. Use the existing `envFlagEnabled(process.env.X)` helper (same one the compliance-calendar route uses).
- **D5 — WCAG 2.1 AA.** Full a11y acceptance criteria below drive the review gate.

## Reuse — do NOT reimplement (verified @948a7242)
- **Create actions are reused via link-out, not re-embedded.** Each step is a checklist item that links to the real, existing form and detects completion on return. This keeps the create paths untouched and sidesteps their redirects + capability gates:
  - Property: `addProperty(formData)` — `app/dashboard/properties/actions.ts:185`. Requires `manage_properties` capability + `address`. Form lives at `/dashboard/properties`.
  - Tenancy: `createTenancy(formData)` — `app/dashboard/tenancies/actions.ts:197`. Requires `manage_tenancies` + `property_id`, `start_date`, tenant list. Form at `/dashboard/tenancies/new`.
  - Tenant add: `addTenant(formData)` — `app/dashboard/tenancies/actions.ts:768`.
- **Org context:** `getCurrentOrg()` — `lib/org.ts:87` (returns `Org | null`; already used everywhere with the `if (!org) redirect("/onboarding")` idiom).
- **Rail setup** is its own existing flow — link out to it as a CTA; do not build rail UI here.
- **Seeders** (`lib/org-seeds-server.ts`: `seedClauseLibrary(supabase, orgId)` @23, `seedTenantMessageTemplates(supabase, orgId)` @81) — already invoked at org creation; nothing to call here.

## Migration — `supabase/migrations/0204_organization_onboarding.sql`
Latest migration at spec time is **0203**; use **0204** (confirm it's still free at build time). Mirror the 0203 RLS pattern exactly (`organization_id in (select public.user_org_ids())` for select/insert/update; grants to `authenticated` + `service_role`).

```sql
create table if not exists public.organization_onboarding (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  dismissed_at     timestamptz,
  rail_step_done_at timestamptz,        -- explicit marker: rail configured OR skipped
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.organization_onboarding enable row level security;
-- select/insert/update policies mirroring 0203 (organization_id in (select public.user_org_ids()))
-- grant select, insert, update on ... to authenticated;  grant ... + delete to service_role;
```
No delete grant to `authenticated` (dismiss is an update, not a delete — same discipline as 0203).

## Files to build
- `supabase/migrations/0204_organization_onboarding.sql` — above.
- `lib/onboarding-wizard.ts` — **pure** module: step definitions + ordering, a `computeOnboardingState({ hasProperty, hasTenancy, railStepDoneAt, dismissedAt })` returning per-step status + `nextIncompleteStep` + `isComplete` + `shouldShowCard`. No I/O. Keep all branching here so it's unit-testable.
- `scripts/test-onboarding-wizard.ts` — pure tests for the above (fresh org → property step next; property added → tenancy next; all done or dismissed → card hidden; rail skip marks step done). Follow the existing `scripts/test-*.ts` harness style; target green/0.
- `app/dashboard/(wizard)/getting-started/page.tsx` + step components — server component reads `getCurrentOrg`, counts properties/tenancies, reads the `organization_onboarding` row, renders the wizard from the pure state. Flag-gated: if `!envFlagEnabled(process.env.ONBOARDING_WIZARD_ENABLED)` → `notFound()`.
- Server actions (thin) for: mark rail step done/skipped; dismiss card. Upsert the `organization_onboarding` row; org-scoped.
- A dashboard "Getting started" entry card (gated + dismissable), showing progress, on `app/dashboard/page.tsx`. Gate on the same flag AND `shouldShowCard`.

## Accessibility acceptance criteria (review gate — WCAG 2.1 AA)
- Each step is a labelled landmark; correct heading structure; `aria-current="step"` on the active step.
- Focus moves to the step heading on navigation; focus never trapped; visible focus ring throughout.
- Fully keyboard-operable start→finish; no pointer-only actions.
- Errors surface in a linked error summary at top of step + inline; never color-only.
- AA contrast in light AND dark (cross-check the brand/dataviz palette).

## Guardrails
- Dark-by-default proven: with the flag unset, diff shows the dashboard route/card render path is byte-unchanged (add a test or explicit reasoning that the gate returns early).
- Migration applied via Supabase MCP + SQL readback BEFORE any deploy; then file-scoped serial push (never git over the device bridge — KI980).
- Do NOT expand `SETTINGS_ORG_FEATURES` (KI985) or touch `/onboarding` auth flow.
- `tsc` clean whole-tree; pure tests green; build (all pages) green before commit.

## Warm-verify checklist for the building session
1. Re-confirm 0204 is the next free migration.
2. Re-confirm `envFlagEnabled` import path (used in `app/api/cron/compliance-calendar/route.ts`).
3. Confirm the property-count / tenancy-count queries are RLS-scoped to the caller's org.
4. Screen-reader + keyboard pass on the wizard before flipping the flag anywhere.
