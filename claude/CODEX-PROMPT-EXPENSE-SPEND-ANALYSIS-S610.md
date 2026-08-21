# CODEX PROMPT — Expense spend-analysis layer (S610)

**Base = main (prod HEAD 046b251). Premium-gated read-model on the existing ledger. NO migration (pure derivation). Ships behind the existing `accounting` entitlement. Do not `git push` — Noam reviews and pushes.**

Wave 1 / Lane 4 of the S610 backlog build. File-disjoint from the entitlements, smart-lock, and receipt-vault lanes. This is the Noam-flagged "highest-value new note" — a Rocket-Money-style spend view on the books you already own.

## WARM-VERIFY FIRST — grep, and STOP if already built
Confirm current state (as of prod):
- Ledger + categorization exist: `lib/expenses.ts` (`EXPENSE_CATEGORIES`, `expenseCategoryLabel`), `app/dashboard/expenses/`, bank feed (`lib/bank-feed/`, `lib/bank-import/`), `lib/categorization-rules.ts` (recurring via Plaid `stream_id`).
- Accounting rollups exist but are P&L/tax only: `lib/income-statement.ts` (`buildIncomeStatement` groups by category), `lib/t776.ts`, `app/dashboard/money/income-statement`, `.../tax-package`, `.../accountant-package`.
- `lib/reports.ts` is leads/showings analytics only — NO spend/trend. `app/dashboard/money/page.tsx` SECTIONS have NO analytics/trends entry.
If a spend-trend / spend-by-category / recurring-subscription view already exists under `app/dashboard/money`, STOP and report.

## WHAT THIS IS
A Premium "Spend" view that turns the expense ledger into insight (not a new P&L):
1. **Spend by category** over a selectable window (this month / last 3 / 6 / 12 months), with each category's total and share.
2. **Spend trend over time** — a per-month total (and optionally per-category) series so an operator sees spend rising/falling.
3. **Recurring spend** — surface the recurring charges already grouped by Plaid `stream_id` (merchant, cadence, last amount) so the operator can see their "subscriptions"/standing costs.

Read-only insight. It does NOT create/edit expenses and must reconcile to the same rows the owner statement sums.

## REUSE (import; do NOT modify the source modules)
- `lib/expenses.ts` — categories + labels + normalization.
- `lib/income-statement.ts` — the category-aggregation pattern (mirror it; don't fork the P&L).
- `lib/categorization-rules.ts` — `stream_id` recurring grouping is ALREADY computed; reuse it for the recurring view.
- `lib/reports.ts` — window helpers (`WindowDays`, `filterByWindow`, `windowStartMs`) for time-bucketing.
- `lib/billing.ts` — `hasEntitlement(org.plan, "accounting")` for the gate.
- `app/dashboard/money/page.tsx` — add a SECTION entry (same pattern as Income statement / Reconcile).

## FILES — exact scope
- NEW `lib/spend-analysis.ts` — PURE functions: `spendByCategory(expenses, window)`, `spendTrend(expenses, granularity='month')`, `recurringSpend(expenses|rules)`. No I/O, fully unit-testable. Reuse `lib/reports.ts` window helpers + `lib/expenses.ts` categories.
- NEW route `app/dashboard/money/spend/page.tsx` (+ a small server action/loader) — loads the org's expenses (same source the income statement uses), calls `lib/spend-analysis.ts`, renders the three views with a window selector. Server-gated on `accounting`; an ungated org sees the locked upsell (two-axis rule), never a half-rendered module.
- EDIT `app/dashboard/money/page.tsx` — add the "Spend" SECTION card/link.
- NEW `scripts/test-spend-analysis.ts` — category totals, monthly trend bucketing, recurring grouping, empty-ledger fallback. `npx tsx`.

## CONSTRAINTS / INVARIANTS
- **No migration, no new external vendor.** Data comes only from existing expense rows (Plaid + OFX import already loaded).
- **Reconciles to the owner statement:** category totals over a full period must equal what `lib/income-statement.ts` sums for the same set — do not invent a parallel figure. Add a test asserting this.
- Gate server-side on `accounting` at the route + loader (never UI-only). Growth/Free see the locked upsell.
- Pure logic in `lib/spend-analysis.ts`; no DB/network there.
- esbuild-check the new `.tsx`. Do NOT git push.
- If it renders any chart, follow the existing dashboard chart/styling convention already used in the money/reports surfaces — do not add a new chart dependency.

## VERIFICATION (Cowork re-runs)
- `scripts/test-spend-analysis.ts` passes: by-category sums, monthly trend, recurring grouping, empty-ledger returns a clean zero-state.
- Reconciliation test: category totals == income-statement expense totals for the same window.
- Prove the gate: a non-`accounting` org gets the locked upsell + the loader rejects.
- `git diff --check` clean; diff confined to the files above.

## OUT OF SCOPE
Budgets/alerts, editing expenses, any change to the P&L / tax package / owner statement, cross-org benchmarks.
