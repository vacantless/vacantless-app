# Codex handoff - S421 bank-triage: apply saved rules to lines already in the queue

**Review target:** the single S421 commit `ca85277` (pushed by `DEPLOY-S421-BANK-TRIAGE-BULK-APPLY.sh`). Range = `d095408..ca85277`. No migration, no new table, no env flag.

## What & why
"Remember this" auto-files matching debits ONLY at import/sync time (that is the only place `autoApplyRules` ran). So the first import of a busy account was fully manual: teaching a rule on line 1 left its sibling lines already staged in the queue unsorted until a FUTURE import. (Dogfood pain on the 506 Manning import - 10 expenses hand-tagged.) This reuses the existing, tested sweep RETROACTIVELY in two spots.

## Scope of change (3 files, view + action layer only)
- **`app/dashboard/expenses/triage-core.ts`**: `autoApplyRules` return type widened `Promise<void>` -> `Promise<number>` (count of pending debits it filed this run). Backward-compatible: the two existing callers (`syncConnectionById`, `importTransactionsFromFile`) ignore the return. Body otherwise unchanged (still pending-only + scoped-only via `ruleAutoFiles`).
- **`app/dashboard/expenses/actions.ts`**:
  - `assignTransaction`: after a Remember-this rule is INSERTED, if it is SCOPED (`property_id` or `building_key` set) it calls `autoApplyRules(org.id)` once and redirects `?assigned=1&swept=N`. A broad (category-only) rule does not trigger the sweep (`savedScopedRule` stays false).
  - new `applyRulesToQueue()` server action: `manage_work_orders`-guarded, calls `autoApplyRules(org.id)`, redirects `?swept=N`.
- **`app/dashboard/expenses/page.tsx`**: banner handles `swept` (assigned+swept, standalone swept, zero case); new "Apply saved rules" button in the To-review header, rendered only when `pending.length > 0 && rules.length > 0`; Remember-this label now "auto-sort matching ... charges, now and going forward".

## Guardrails / invariants to check
1. **Only scoped rules auto-file.** `autoApplyRules` skips any rule where `!ruleAutoFiles(rule)`, so a broad merchant->category rule never guesses a unit; it only pre-fills at triage (unchanged). The retroactive sweep inherits this - verified live (a "Not unit-specific" Remember did NOT file its sibling; `swept=0`).
2. **Pending-only sweep.** `autoApplyRules` reads `triage_status='pending' AND direction='debit'`. The just-assigned line is already `assigned`, so it is never double-filed. No new double-write path.
3. **Capability.** `applyRulesToQueue` requires `manage_work_orders` (same as `assignTransaction`/`syncConnection`).
4. **No money movement / no new table / no migration.** Only `expenses` rows via the unchanged `insertExpenseAndAssign`; `categorization_rules.times_applied` bumps as before.
5. **Sweep is best-effort, never blocks the assign.** The rule insert result is checked (`ruleErr`) before setting `savedScopedRule`; a failed rule insert => no sweep, assign still succeeds.

## Known deliberate choices (not bugs)
- Widening `void`->`number` rather than a separate function keeps one code path for import-time and retroactive sweeps.
- Standalone button hidden when no rules exist (nothing to apply) - intentional, not a missing state.
- After a broad Remember, the sibling shows the "Pre-filled from a rule you saved" chip on next render (existing `suggestionFor`) but stays in the queue - correct (pre-fill, not auto-file).

## Verify done
tsc clean; eslint clean on the 3 files; test-categorization-rules 47/0, test-bank-import 68/0, test-rent-from-bank 22/0; no new em dashes in code comments. Deploy `ca85277` READY on Vercel (top production deployment).

LIVE-SMOKED end to end on North Star QA (`b733a191`, Growth), all via the deployed UI + verified by execute_sql, then QA wiped to baseline (0/0/0/0):
- Seeded 4 HYDRO ONE + 2 TIM HORTONS pending debits (one import connection). Button correctly HIDDEN (no rules yet).
- Filed 1 HYDRO to the Shorncliffe building + Remember -> `?assigned=1&swept=3`, banner "Expense logged - and filed 3 more matching lines automatically."; all 4 HYDRO assigned to the building (source=bank); rule `times_applied=3`; 2 TIM untouched.
- Seeded 3 more HYDRO, clicked "Apply saved rules" -> `?swept=3`, "Filed 3 matching lines from your saved rules."
- Filed 1 TIM as "Not unit-specific" + Remember -> `?assigned=1&swept=0`, banner "Expense logged." only; sibling TIM stayed pending (broad rule did NOT auto-file).
- Clicked "Apply saved rules" with only the unmatched TIM left -> `?swept=0`, "No lines in the queue matched a saved rule."

---

## S422 fold-in (Codex review of `ca85277` = 2 P2, both fixed)

Codex ACCEPTED the S421 behavior + QA and raised two P2s; both folded into `app/dashboard/expenses/triage-core.ts` (ONE file, view + action layer, no migration). New commit via `DEPLOY-S422-BANK-TRIAGE-P2-FIXES.sh`.

- **P2 #1 (cross-org leak).** `autoApplyRules` read `categorization_rules` and pending `bank_transactions` with no `organization_id` filter (RLS-only). A multi-org user's bulk sweep could match another org's rule/txn and file the expense under the current `org.id`. **Fix:** explicit `.eq("organization_id", orgId)` on BOTH reads; the txn update inside `insertExpenseAndAssign` is now org-scoped too (defense in depth).
- **P2 #2 (concurrent double-file).** `insertExpenseAndAssign` inserted the expense BEFORE claiming the txn, and the claim update had no `triage_status='pending'` guard, so two concurrent sweeps (or a sweep racing the import-time pass) could read the same pending rows and insert duplicate expenses. **Fix:** claim-first. A single guarded, org-scoped `pending -> assigned` update with `.select("id")` runs BEFORE the expense insert; zero rows returned => another run already claimed it => return null (skip). If the expense insert then fails, the claim is rolled back (`triage_status='pending', expense_id=null`) so the line stays retryable.

Single-run happy path is byte-equivalent in outcome (each matching line still files exactly once). Re-verified locally: tsc clean, eslint clean on the changed file, tests 47/68/22 green, no new em dashes. Deployed as commit `33125e7` (Vercel READY, aliased to app.vacantless.com).

DEPLOYED-UI QA SMOKE PASSED on North Star Rentals QA (`b733a191`, Growth) then wiped to baseline (0/0/0/0). Seeded 4 HYDRO ONE (shared merchant_entity_id) + 2 TIM HORTONS pending debits on one import connection. Filed ONE HYDRO to the 18 Shorncliffe building + Utilities + Remember (scoped) via the deployed UI. Verified via execute_sql (screenshot was a KI637 form-restore artifact, not truth):
- 4 bank expenses filed / 4 DISTINCT bank_transaction_ids -> no double-file (claim-first held the happy path); all 4 HYDRO `assigned`, 0 pending.
- Every expense's txn links back (`bt.expense_id = e.id`) x4 -> no orphaned claims.
- All 4 scoped to `18 shorncliffe avenue, toronto, on` / `utilities` (wrong_scope = 0); the saved rule is org=`b733a191`, scope_kind `stream`.
- 2 TIM HORTONS untouched (different merchant, no rule).
- cross_org_leak = 0 (no seed-entity HYDRO rows outside the QA org). The `applyRulesToQueue` button path calls the same org-scoped `autoApplyRules(org.id)` exercised here.

## S422 ACCEPTED (Codex, 2026-07-06) - loop CLOSED

Codex reviewed `ca85277..33125e7` against this note = **ACCEPTED, no findings**. Both prior P2s confirmed closed in `triage-core.ts`: `autoApplyRules(orgId)` scopes both reads to `organization_id = orgId`; `insertExpenseAndAssign` claims `pending -> assigned` (keyed on `id + organization_id + triage_status='pending'`) before inserting, returns null if already claimed, rolls back on insert failure, keeps the final txn update org-scoped. Codex verification passed: `git diff --check`, eslint, `tsc --noEmit`, test-categorization-rules 47/0, test-bank-import 68/0, test-rent-from-bank 22/0. Codex did not rerun the deployed UI smoke; treated this note's deployed QA smoke as supporting evidence. **S421 + S422 accepted together - no open code-review queue on the bank-triage lane.**
