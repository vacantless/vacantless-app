# CODEX PROMPT — S583a: Extract the shared presentation kit (design-system foundation)

Written 2026-07-26. Prod sha 337cc43 (S582 next-intl, dark). This is the
FOUNDATION slice for the site-wide presentation layer
(`claude/DESIGN-PRESENTATION-DESIGN-SYSTEM-AND-ROLLOUT-S583.md`). Stage 1 (S583b)
and every screen migration consume what you build here. Ships DARK and ADDITIVE:
it adds tokens + primitives but restyles NO existing screen and changes NO
behavior.

## GOAL
Turn the current ad-hoc styling into a proper shared kit: design tokens
(Tailwind + globals.css) and accessible primitives in `components/ui.tsx`, at two
densities of one language — **Guided** (onboarding/renter/distribution) and
**Workbench** (dense operator/accounting). Extend what exists; do not duplicate or
break it.

## WHAT ALREADY EXISTS — EXTEND IT, DO NOT DUPLICATE (warm-verified against the repo)
- `tailwind.config.ts`: minimal; only `colors.brand.DEFAULT = var(--brand-color, #17362f)`.
- `app/globals.css`: brand ramp tokens `--color-primary` / `-hover` / `-accent`
  / `-accent-strong`, and `--brand-color` (per-org WHITE-LABEL override set per
  request by `lib/brand-theme.ts`). Greys are intentionally hardcoded
  (`body` color `#111827`, bg `#f9fafb`) and NOT yet tokenized.
- `components/ui.tsx` already exports: `PRIMARY_ACTION_CLASS`, `SECONDARY_ACTION_CLASS`,
  `Card`, `IconTile`, `BrandBanner`, `PageHeader`, `StatCard`, `SectionHeading`,
  `StatusChip` (+ `ChipTone` and the `*Tone` helpers), `EmptyState`.
- **Hard rule:** every one of those existing exports keeps its current public API
  AND its current rendered appearance. This slice only ADDS. `StatusChip` is the
  seed of the "status-in-words" idea; the new `StatusBanner` is its macro sibling,
  not a replacement.

## ADD — TOKENS (tailwind.config.ts theme.extend + globals.css vars)
Preserve white-label: the brand ramp stays overridable via `--brand-color` /
`lib/brand-theme.ts`; the kit's accent DERIVES from the brand token, never a
hardcoded green. Add:
- Neutrals scale as tokens (surface / elevated / border / text-primary /
  text-secondary / text-muted) — tokenize the greys currently hardcoded so screens
  share them. Keep the existing body/bg values as the token defaults so nothing
  shifts visually.
- A MACRO STATUS color set (success/linked, attention/warning, neutral/coming-soon,
  info/mls) each with an accessible on-color; align it with `ChipTone` so
  `StatusChip` and the new `StatusBanner` speak the same palette.
- Type scale (display / h1 / h2 / body / small) with TWO base sizes: Guided body
  >= 19px, Workbench body >= 15px. Spacing, radius, elevation, ONE focus-visible
  ring token, and motion tokens that honor `prefers-reduced-motion`.

## ADD — PRIMITIVES (in components/ui.tsx; all keyboard-accessible + focus-visible + i18n-ready)
- `StageShell` (Guided: centered single column ~640px, large rhythm) and a
  `PageShell` for Workbench (wrap or reuse `PageHeader`) — the two density shells.
- `StatusBanner` — oversized high-contrast banner that states status IN WORDS
  (macro sibling of `StatusChip`); never colour/dot alone.
- `Button` — a real component wrapping `PRIMARY_ACTION_CLASS` /
  `SECONDARY_ACTION_CLASS` with `variant` (primary | secondary | ghost) and `size`
  (sm | md | lg, where lg is the Guided oversized target >= 48-60px), proper
  disabled + focus-visible. Keep the class exports too (screens still use them).
- `Field` / `Input` / `Select` (labelled, focus ring, error slot).
- `LanguageDropdown` — EN + FR, wired to the S582 `setLocale` server action
  (`app/i18n/actions.ts`). Functional, not decorative.
- `BackNext` — fixed Back (bottom-left) + Next (bottom-right) anchors.
- `DataTable` primitives (Table / Row / Cell) for Workbench density so dense
  screens share the same type/spacing/focus language as everything else.

## HONESTY / CONSTRAINTS
- ADDITIVE ONLY. Do NOT migrate or restyle any existing screen in this slice
  (that is Phase 1/2). No route, nav, or behavior change. Fully dark.
- Preserve per-org white-label theming (`--brand-color`); do not hardcode brand
  colours into primitives — derive from the brand/accent tokens.
- No new dependencies. Next 14 + next-intl v4 (cookies() sync). Tailwind only.
- Keep en/fr top-level catalog key parity if you add any strings (S582 test).

## TESTS
- Unit/render smoke test for the new primitives: each renders with its props,
  variants/sizes apply the right classes, focus-visible + disabled states present,
  `StatusBanner` renders the status sentence. `LanguageDropdown` calls `setLocale`.
- Spot-check that 2-3 existing screens (e.g. a dashboard page using `Card` /
  `PageHeader` / `StatCard`) render byte-identical (import surface unchanged).
- `npx tsc --noEmit`, `npm run build`, `npm run lint` clean.

## OUT OF SCOPE
Migrating any existing screen; the Stage 1 "Link your portals" screen (that is
S583b); any backend/logic/data change; i18n of existing screens.

## HANDBACK / WARM-VERIFY CRITERIA
Report files changed and the new token + primitive inventory. Warm-verify will
confirm: (1) every prior `ui.tsx` export keeps its API + appearance; (2) white-label
`--brand-color` override still themes the kit; (3) new primitives are keyboard-
accessible with visible focus and honor reduced-motion; (4) zero route/nav/behavior
change (dark); (5) tsc/build/lint green; (6) en/fr key parity holds. Push is
Noam's; land natively on the Mac.
