# PRE-SPEC (warm-verified, NOT yet dispatch-ready) — Accessible seed onboarding wizard (Wave 2 lane 3)

> **Status:** warm-verified against prod clone `a70f30f` on 2026-08-01 (S611). **Do NOT dispatch as-is** — resolve the OPEN DECISIONS below, then convert to a `CODEX-PROMPT-*.md`. Named PRESPEC on purpose (KI980 discipline).

## What ALREADY exists (do not rebuild)
- **`/onboarding`** — a thin 114-line form (`app/onboarding/onboarding-form.tsx` + `actions.ts` + `page.tsx`): signup routes here, operator names the org, org is created. That's the whole current first-run.
- **"Get-online" wizard** — the distribution/send-live LISTING publication wizard (`app/agent/*`, send-live stage). This publishes a unit; it is **not** a landlord first-setup wizard. Do not conflate.
- **Org seeders** — `lib/org-seeds-server.ts`: `seedClauseLibrary`, `seedTenantMessageTemplates`. Already invoked during quick-onboard (`app/agent/agent-actions.ts`). Reuse these; don't reimplement seeding.
- **Quick-onboard** — `lib/quick-onboard.ts` (mig 0196): the agent-driven landlord+lease fast path. Different entry point (broker-assisted), but shares the seeders.

## Genuine net-new scope
A guided, **WCAG-conscious multi-step first-run wizard** for a self-serve landlord after signup, walking them from empty org → first usable state: (1) org/profile basics, (2) add first property, (3) add a tenancy + tenant (optional), (4) set up a rent rail (Rotessa/Stripe) or skip, (5) seed templates/clauses (reuse existing seeders). Accessibility is a first-class requirement: semantic step landmarks, focus management on step change, `aria-current`, keyboard-only completion, visible focus, error summaries linked to fields, no color-only signals. Progress persists so a landlord can resume.

## OPEN DECISIONS (resolve with Noam before building)
- **D1 — replace vs augment `/onboarding`:** Does the wizard REPLACE the thin `/onboarding` form, or is it a **post-onboarding "Getting started" checklist/wizard** shown on the dashboard until complete? Recommend **augment** — keep `/onboarding` (org creation) minimal, add a resumable dashboard "Getting started" wizard. Lower risk, no auth-flow churn.
- **D2 — persistence:** Track wizard progress where? Options: a new `onboarding_progress` table, or a JSONB column on `organizations`. Recommend a small **`organization_onboarding` table** (org_id PK, step flags, dismissed_at) — additive, RLS-clean.
- **D3 — steps included in v1:** Full 5 steps, or v1 = property + tenant + seed (defer the rail-setup step to a link-out)? Recommend **property + optional tenant + seed**, with rail setup as a CTA link (rail setup is its own flow).
- **D4 — dark gating:** Master env flag (`ONBOARDING_WIZARD_ENABLED`) default off; when off, dashboard renders exactly as today (no wizard, no "getting started" card).
- **D5 — a11y bar:** Confirm target (WCAG 2.1 AA). This drives review criteria (focus order, contrast, error-summary pattern, screen-reader step announcements).

## Rough file plan (post-decision)
- `supabase/migrations/02NN_organization_onboarding.sql` — additive `organization_onboarding` table, org-scoped RLS.
- `lib/onboarding-wizard.ts` (pure: step definitions, ordering, completion predicate, next-incomplete-step, validation) + test script.
- NEW `app/dashboard/(wizard)/getting-started/` route + step components (server actions per step; reuse property/tenancy/seed actions that already exist).
- A dashboard "Getting started" entry card (gated), dismissable, showing progress.
- Reuse `seedClauseLibrary` / `seedTenantMessageTemplates` for the seed step — do not reimplement.
- Dark-by-default: flag off → no wizard route surfaced, no dashboard card, zero behavioral change.

## Accessibility acceptance criteria (for the eventual build + review)
- Every step is a labelled landmark; heading structure is correct; `aria-current="step"` on the active step.
- Focus moves to the step heading on navigation; focus is never trapped; visible focus ring throughout.
- Fully keyboard-operable start→finish; no pointer-only actions.
- Errors surface in a linked error summary at top of step + inline; not color-only.
- Meets WCAG 2.1 AA contrast in light and dark (cross-check the `dataviz`/brand palette).

## Warm-verify notes for next session
- Re-read `app/onboarding/*` + confirm the signup→onboarding redirect chain before deciding replace-vs-augment (D1).
- Confirm the exact signatures of `seedClauseLibrary` / `seedTenantMessageTemplates` and the property/tenancy create actions to reuse them.
- Latest migration at spec time was **0202**; pick the next free number at build time.
