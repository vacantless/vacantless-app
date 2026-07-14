#!/usr/bin/env bash
# S427 - App unification: forest-green default identity + nav IA v2, plus the
# Codex homepage review fold-in (P2 dispatch copy, P3 token comment).
#   Commit 1 (docs): the S427 Codex handoff note (so Codex reads it from the repo).
#   Commit 2 (Codex P2): soften the homepage "dispatch" maintenance copy.
#   Commit 3 (palette): default brand -> forest green on every UNBRANDED surface
#     (default constants + globals.css/tailwind fallback + pre-auth chrome + the
#     public-page brand fallback -> DEFAULT_BRAND_COLOR + green presets), and the
#     Codex P3 token-comment correction. Saved org brand_color still overrides.
#   Commit 4 (nav): primary bar = Overview/Rentals/Leasing/Tenants/Money/Maintenance;
#     account items -> org pill menu; new /dashboard/money hub (Rent/Expenses/Reports,
#     Rent shows a set-it-up state when no rail is connected).
# Gates: tsc clean; next lint clean on touched files; test-brand-theme 135/0;
# test-branding 82/0. No migration, no env change.
set -euo pipefail
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add codex-handoffs/S427-APP-UNIFICATION.md
git commit -m "docs(S427): Codex handoff for app unification (green default + nav IA v2)"

git add app/page.tsx
git commit -m "S427: fold Codex homepage P2 - soften maintenance 'dispatch' to 'coordination'"

git add app/globals.css tailwind.config.ts lib/brand-theme.ts scripts/test-brand-theme.ts \
  components/auth-shell.tsx app/onboarding/page.tsx app/onboarding/onboarding-form.tsx \
  components/brand-color-field.tsx "app/dashboard/properties/[id]/fill-sheet-card.tsx" \
  components/description-guide.tsx "app/r/[propertyId]/page.tsx" "app/f/[showingId]/page.tsx" \
  "app/job/[token]/page.tsx" "app/report/[token]/page.tsx" "app/sign/[token]/page.tsx" \
  "app/d/[token]/page.tsx" "app/repair/[token]/page.tsx" "app/showing/cancel/[token]/page.tsx" \
  "app/showing/[token]/page.tsx"
git commit -m "S427: default brand -> forest green on unbranded surfaces (constants + globals/tailwind fallback + pre-auth chrome + public-page fallback + green presets); fix Codex P3 token comment"

git add app/dashboard/dashboard-nav.tsx app/dashboard/layout.tsx app/dashboard/money/page.tsx
git commit -m "S427: nav IA v2 - Money + Maintenance primary tabs, account items in an org pill menu, new /dashboard/money hub"

git push origin main
