# S427 - App unification: forest-green default + nav IA v2 (+ Codex homepage fold-in)

Review scope: three commits (see the deploy script `DEPLOY-S427-APP-UNIFICATION.sh`).
No migration, no env change. Gates: `tsc --noEmit` clean; `next lint` clean on the
touched files; `test-brand-theme` 135/0; `test-branding` 82/0.

## 1. Codex homepage review fold-in (from your `b58ac8e..d152adb` review)
- **P2 (dispatch copy).** Softened the two user-facing "dispatch" strings in
  `app/page.tsx` to the "coordinate/track" framing the S426 guardrail requires:
  - Product-depth group 7: "Repair dispatch and reminders..." -> "Repair
    **coordination** and reminders, where available".
  - Premium tier bullet: "Maintenance and repair **dispatch**" -> "Maintenance and
    repair **coordination**".
  - The guardrail COMMENT at ~line 421 ("repairs are 'tracked' (NOT guaranteed
    dispatch)") is intentionally left - it is the guardrail statement itself.
- **P3 (token contract).** `app/globals.css` comment claimed a white-label customer
  overrides `--color-primary` and "the derived roles follow", but `-hover/-accent/
  -accent-strong` are independent literals. Rather than fake derivation in CSS, the
  comment now states the truth: these are FOUR independent role tokens (a small
  brand ramp), and a white-label override sets the ramp (typically primary + the two
  accents). No rendered pixel changed.

## 2. Default brand -> forest green (unbranded surfaces only)
Rule followed: *change the default; never override a saved org `brand_color`.*
- `lib/brand-theme.ts`: `DEFAULT_BRAND_COLOR "#4f46e5" -> "#17362f"`,
  `DEFAULT_BRAND_SECONDARY "#14b8a6" -> "#16756a"` (the marketing `--color-primary` /
  `--color-accent`). These are the fallback for any org with a null brand and for the
  brand-picker seed/reset; a saved brand_color still wins (the dashboard layout sets
  an inline `--brand-color` per request from the org's value).
- `app/globals.css` `:root --brand-color` and `tailwind.config.ts` `brand.DEFAULT`
  fallback both `#4f46e5 -> #17362f` (kept in sync with the constant).
- Public renter pages replaced the stale literal `|| "#4f46e5"` with
  `|| DEFAULT_BRAND_COLOR` (single source of truth) across `app/r`, `app/f`,
  `app/job`, `app/report`, `app/sign`, `app/d`, `app/repair`, `app/showing`,
  `app/showing/cancel`.
- Pre-auth chrome (NOT brand-scoped) rethemed indigo/teal/violet -> forest green:
  `components/auth-shell.tsx` (backdrop blobs, button + input, trust dot),
  `app/onboarding/page.tsx` (step bar). Buttons/dots use the marketing hexes
  `#17362f -> #16756a`; soft blobs use emerald/teal tints.
- Two in-app accent components moved indigo -> emerald tints
  (`fill-sheet-card.tsx`, `description-guide.tsx`).
- Brand presets reordered to lead with green; added a `Forest` solid (#17362f) and a
  `Forest` ombre (#17362f->#16756a). Counts: solid 8->9, gradient 6->7. Test
  assertions updated accordingly (`scripts/test-brand-theme.ts`), including the
  DEFAULT_BRAND_COLOR value.
- NOT touched: `components/vacantless-mark.tsx` "gradient" logo variant is dead
  (only `black`/`white` variants render anywhere) - left as-is, out of scope.

Things to check: (a) no remaining `#4f46e5` literal in `app/` outside the deprecated
alias in `lib/brand-theme.ts`; (b) `accessibleBrand`/`brandGradientCss` behaviour
unchanged (only the default constant moved); (c) every new preset clears WCAG AA with
white text (test loop covers it); (d) a saved brand_color org is unaffected (the
inline `--brand-color` still overrides `:root`).

## 3. Nav IA v2 (approved by Noam before implementation, with a before/after map)
- `app/dashboard/dashboard-nav.tsx` rewritten. The old flat bar + "More ▾" dropdown
  (which mixed core work beside account items) becomes:
  - **PRIMARY (sacred, daily work only):** Overview · Rentals · Leasing · Tenants ·
    **Money** · **Maintenance**. Money is a NEW hub (href `/dashboard/money`, `match`
    `/dashboard/rent|expenses|reports`); Maintenance is promoted to a primary tab.
    Money is ALWAYS visible now (previously appended only when a rent rail was active).
  - **ORG MENU (right pill "{orgName} ▾" + initial avatar):** Settings · Your plan ·
    [Refer a landlord] · [Captures] · Sign out. Referral/Captures still gated by their
    flags; Sign out is no longer a primary-bar button.
  - Outside-click/Escape close, route-change close, and the mobile panel (primary +
    account + sign out) all preserved.
- `app/dashboard/layout.tsx`: passes `orgName={org.name}`; removed the now-unused
  `rentActive` computation + `isRentCollectionActive` import (the Money hub page
  computes rail status itself).
- `app/dashboard/money/page.tsx` (NEW): hub landing mirroring the Leasing/Tenants hub
  pattern (BrandBanner + Card/IconTile grid). Cards = Rent / Expenses / Reports. When
  no rent rail is connected, the Rent card shows a "Not set up yet" chip + a
  set-it-up blurb (still links to `/dashboard/rent`) instead of vanishing - per
  Noam's "don't make a top-nav section disappear" rule. Rail status via the same
  `stripe_connect_accounts`/`rotessa_accounts` reads the layout used (RLS-scoped).

Things to check: `isActive` still lights the right hub on child routes; the Money
match prefixes don't collide with anything; no other importer referenced the old
`rentActive` prop (verified: only layout imports DashboardNav; only rent + money
import rent-status).

## S427b - Codex P2 fold-in (review of dc0908d)
Codex reviewed `8f774f4..dc0908d` and ACCEPTED all of the priority list (saved
brand_color still overrides; the public-page fallback is centralized through
DEFAULT_BRAND_COLOR; no rentActive references remain; homepage/token fixes present).
ONE P2: the Money hub "Reports" card described owner statements/rent roll but linked
to `/dashboard/reports`, which is the LEASING FUNNEL report (`buildFunnel` /
`buildShowingReport` / `buildLeaseTiming`); nav also marked `/dashboard/reports` a
Money child, so Money lit up on a non-money page. Fix (commit in `DEPLOY-S427b`):
- `money/page.tsx`: the third card is now "Owner statement" -> `/dashboard/rent/statement`
  (the real money report; rent-roll is its sibling under `/dashboard/rent`).
- `dashboard-nav.tsx`: removed `/dashboard/reports` from Money's `match`; added it to
  Leasing's `match` (the funnel report is leasing analytics).
- `leasing/page.tsx`: added a "Reports" hub card -> `/dashboard/reports` so the funnel
  report has a home under Leasing.
Gate: tsc + eslint clean. Codex's other checks (git diff, tsc, lint, both test suites
135/0 + 82/0) all passed on dc0908d.

## Org brand data reset (done, per Noam - "start fresh, no true customers yet")
Separately from the code: all 9 orgs' saved `brand_color`/`brand_color_secondary` were
reset to the new green default `#17362f`/`#16756a` via a single SQL update (they were a
mix of the old seeded default `#4f46e5` and a few QA test colors; none were real
white-label customers under the GTM sell-hold). This is a DATA change, not in this
commit range - the dashboard header is data-driven, so every org's chrome reads green
immediately. When a real branded customer signs up, their chosen `brand_color` will
still override the default exactly as before.
