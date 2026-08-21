# DESIGN OF RECORD — Site-wide presentation design system + rollout (S583)

Written 2026-07-26. Prod sha 337cc43 (S582 next-intl foundation, dark). Directive
from Noam: "make sure the whole site matches this new improved UI presentation
slick layer too throughout." This doc is the recommendation, the design-system
definition, and the phased rollout across all 45 dashboard screens.

## THE DECISION (recommended long-term strategy — adopted)
Adopt ONE shared design system across the entire app, run at two densities of the
same visual language. Do NOT force the aged/ESL onboarding wizard (strict single
column, 60px targets, minimal jargon) onto every screen — that treatment is right
for onboarding/renter/distribution flows but degrades the data-dense operator and
accounting screens (rent roll, income statement, reconcile, bank triage, leads),
which need information density and speed.

Two densities, one language:
- **Guided** — onboarding, renter-facing/public, and the distribution command
  center. Full accessible-wizard feel: single column (~640px), oversized targets,
  macro status banners, plain language, EN/FR.
- **Workbench** — internal operator + accounting screens. SAME tokens, components,
  color, focus, and status-in-words language, but kept dense: real tables,
  multi-column, compact-but-legible (>= 15px), fast to scan and act on.

Why this over "full wizard everywhere": it makes the whole site read as one slick
premium product, keeps power-user screens usable, and is maintainable long term
(one component library, not a fork). Why over "leave dense screens alone": a
half-migrated app looks inconsistent; the point is cohesion throughout.

## THE DESIGN SYSTEM ("presentation kit")
Source of truth for the look = the interactive prototype (artifact
"vacantless-link-your-portals-wireframe"). Extract it into shared code, not
per-screen CSS.

Tokens (Tailwind theme + CSS vars in globals.css; light + dark, WCAG AA):
- Color: surface / elevated / border; text primary/secondary; brand accent; and a
  MACRO STATUS set (success/linked, warning/attention, neutral/coming-soon,
  info/mls) each with an accessible on-color. Status is always conveyed IN WORDS,
  never colour or a dot alone.
- Type scale: display / h1 / h2 / body / small. Guided body >= 19px; Workbench
  body >= 15px. One scale, two base sizes.
- Spacing, radius, elevation/shadow, and a single focus-visible ring token.
- Motion tokens that respect `prefers-reduced-motion` (no glow/slide when opted out).

Primitives (extract into `components/ui.tsx`, all keyboard-accessible,
focus-visible, i18n-ready via next-intl):
- `PageShell` / `StageShell` (Guided vs Workbench chrome; both apply the tokens).
- `Card` / `Tile`, `SectionHeader`.
- `StatusBanner` (status sentence + macro color; the status-in-words primitive).
- `Button` (primary / secondary / ghost; size tiers incl. the large Guided size).
- `Field` / `Input` / `Select`, `LanguageDropdown` (wired to the S582 `setLocale`
  server action), `BackNextAnchors`.
- Workbench table primitives (`DataTable` row/cell) so dense screens share the
  same type, spacing, and focus language as everything else.

## ROLLOUT (phased, every slice DARK-safe + warm-verified; Noam pushes; land natively)
1. **S583a — extract the kit.** Tokens into `tailwind.config.ts` + `globals.css`;
   primitives into `components/ui.tsx`. ADDITIVE and behavior-neutral: existing
   screens keep working untouched. First visible adopter can be `auth-shell.tsx`.
2. **S583b — Stage 1 "Link your portals" on the kit** (Guided density). Detailed
   spec: `claude/CODEX-PROMPT-S583-STAGE1-LINK-PORTALS.md`. Proves the kit + the
   UI-ahead-of-backend pattern.
3. **Phase 1 (Guided) migrations:** renter-facing/public pages + onboarding +
   the rest of the distribution flow (Stages 2-4 as their read-models land) adopt
   the kit fully.
4. **Phase 2 (Workbench) migrations — one screen-group per slice:** settings ->
   properties -> leads/showings -> tenancies -> money/accounting -> maintenance ->
   the rest. Each slice swaps ad-hoc styling for kit primitives, keeps tables
   dense, changes NO logic, and is reviewed by visual diff + a11y pass. 45 routes,
   migrated in groups, never a big-bang rewrite.

## GUARDRAILS
- Accessibility is the bar on every migrated screen: AA contrast, visible focus,
  full keyboard operation, reduced-motion honored, status-in-words.
- i18n: as a screen is touched, its strings move to catalog keys (EN + FR, keep
  top-level parity — S582 test). No screen ships a bare literal after migration.
- No new dependencies; no backend/logic/data-model changes; no migrations. This is
  a presentation skin over existing plumbing.
- Each slice lands natively on the Mac and is warm-verified against the real
  substrate before Noam pushes. Dark until reviewed.

## NON-GOALS
Rebuilding backend or business logic; changing data models; a single-PR rewrite of
all 45 screens; altering the S578-S582 read-models (consume as-is).
