# Codex handoff — S417 rent-from-bank (money-in lane)

**Review target:** the S417 commit (rent-from-bank). Range = the single commit pushed by `DEPLOY-S417-RENT-FROM-BANK.sh`.

## What & why
The bank-feed import stores incoming money as `bank_transactions.direction='credit'`, but the
expense triage only surfaces debits — so a rent deposit (e.g. a Rotessa lump covering several
tenancies) had **no path** to become "Rent collected" on the owner statement (dogfood finding on
the 506 Manning import: statement showed $0 rent / all-negative NET). This adds an income lane so
the operator can tag a credit as rent and **split it across active tenancies** into `rent_payments`
rows the owner statement already sums. We never move money — this only records what already landed.

## Scope of change (files)
- **migration `0107_rent_from_bank.sql`** (APPLIED to prod via the Supabase connector before deploy;
  additive + inert). `rent_payments` gains `source text default 'manual' check in (manual,bank)` and
  `bank_transaction_id uuid references bank_transactions(id) on delete set null` + a partial index.
  No RLS/grant change (inherited).
- **`lib/rent-from-bank.ts`** (new, pure): `isRentFromBankEnabled()` (env dark flag), `prefillRentSplit`
  (per-tenancy rent, capped at the credit total), `validateRentSplit` (>=1 positive, total <= credit),
  error-message map. 22 unit tests in `scripts/test-rent-from-bank.ts` (all green).
- **`app/dashboard/expenses/actions.ts`**: new `recordRentFromTransaction` server action.
- **`app/dashboard/expenses/page.tsx`**: the "Money in — is any of this rent?" lane + `?rent=` banner.

## Guardrails / invariants to check
1. **Dark:** the lane + action are gated on `isRentFromBankEnabled()` (env `RENT_FROM_BANK==="1"`,
   off by default) AND `providerForPlan(planEntitlements(org.plan)) !== null` (bank_feed / Growth+).
   Free and un-flagged orgs see nothing new.
2. **Capability:** action requires `manage_tenancies` (rent write), matching `recordPayment`.
3. **Only a PENDING CREDIT** can be recorded: `direction==='credit' && triage_status==='pending'`.
4. **No double-record:** the credit is *claimed* pending->assigned FIRST (`.update(...).eq('triage_status','pending').select('id').maybeSingle()`); if nothing was claimed -> `bank=already`. On insert error the claim is rolled back to pending.
5. **Split integrity:** only the org's `status='active'` tenancy ids are accepted (RLS-scoped read);
   allocations parsed as `alloc_<tenancyId>`; `validateRentSplit` rejects total > credit and all-zero.
6. **Statement:** no statement code changed — `rent_payments` rows (`paid_on`=credit's posted_on,
   `period_month`=that month, `method='other'`, `source='bank'`, `bank_transaction_id` set) are summed
   by the existing owner-statement rent query. `expense_id` stays null (income, not a cost).
7. **Money-safety:** never moves money; records only. No processor/rail touched.

## Known deliberate choices (not bugs)
- A lump credit maps to MANY `rent_payments` (one per tenancy) all linked to the same
  `bank_transaction_id` — so that column is intentionally NOT unique.
- Total allocated may be LESS than the credit (part of a deposit isn't rent); the whole credit still
  leaves the lane (marked assigned) once rent is recorded. Leftover is treated as not-rent.
- `method='other'` (the `rent_payments.method` whitelist has no bank/EFT value; avoided a constraint
  change). `note='Recorded from a bank deposit'`.

## Verify done
tsc clean; eslint clean on the 4 changed files; rent-from-bank 22/0; payments 47/0; bank-import 68/0.
Live smoke DEFERRED until `RENT_FROM_BANK=1` is set (dark). Smoke plan: on 506 Manning, tag the
$7,396 Rotessa credit, split $2,620/$3,352/$1,424 across the three units, confirm three rent_payments
+ owner statement "Rent collected" = $7,396 for June, then (optional) teardown.
