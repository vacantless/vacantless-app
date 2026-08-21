# CODEX PROMPT - Lease-term-shift capture: dark flag gate (S575d-b, DARK-FIRST)

**Status: DISPATCH-READY. Authored s576 (2026-07-26). Fast-follow to S575d (lease-term-shift capture, already on disk, NOT yet committed). Makes S575d ship dark like S575b/S575c instead of changing existing-tenancy behavior on deploy. Hand to Codex when idle. Land app changes NATIVELY on the Mac (Noam pushes; bridge git push = 403).**
**Standing constraints (do not violate): the flag OFF must reproduce PRE-S575d behavior EXACTLY (this is the whole point); do NOT change the ledger, the pure resolver, or the seeding logic; single source of truth for the flag check (one helper, reused); every pure-logic change ships a unit test; tsc clean; do NOT push or apply migrations.**

## Why
S575d added a confirmed-rent-ledger guardrail so rent-increase tracking cannot arm off a stale OCR base. The build is correct and warm-verified, BUT it is not behind a feature flag: its gate applies to EVERY existing active tenancy with no backfill. On deploy + 0189 apply, the rent-increase cron would skip every existing tenancy until its landlord re-confirms, and N1 generate/serve + record-increase would block for unconfirmed tenancies. That is the intended end-state, but it must be a DELIBERATE flip, not a silent side effect of deploying. This prompt puts the enforcement behind `LEASE_TERM_SHIFT_ENABLED` (default OFF) so S575d can land dark, be verified in prod against a test tenancy, and be turned on only when Noam decides how to handle existing tenancies.

## The flag
- Add `LEASE_TERM_SHIFT_ENABLED` (env, default OFF). Reuse the existing env-flag helper the cron already uses (`envFlagEnabled` from `lib/auto-listing-copy`, same pattern as `DISTRIBUTION_WORKER_ENABLED`); expose ONE tiny helper, e.g. `leaseTermShiftEnabled()` in `lib/rent-adjustments.ts` (pure read of `process.env.LEASE_TERM_SHIFT_ENABLED === "true"`, or the server helper module if it needs server-only) so every gate site calls the same function. Do not scatter `process.env` reads.
- OFF (default) = pre-S575d behavior EXACTLY: the ledger gate is bypassed everywhere; the cron nudges off `tenancies.rent_cents` as before; N1 generate/serve and record-increase work with no confirm requirement; the reconciliation step is not REQUIRED (hide it, or leave it optional, so onboarding proceeds exactly as before).
- ON = current S575d behavior (the confirmed-ledger gate applies at every site below).

## Exactly what to gate (the enforcement sites - verified line refs; re-read before editing)
Gate ONLY the ENFORCEMENT/required-ness. Leave the ledger table, `resolveRentReconciliation`, `currentEffectiveRent`, `seedConfirmedRentLedger`, `appendN1RentAdjustment`, and `hasConfirmedRentLedger` UNCHANGED (writing ledger rows when a landlord does confirm is additive and harmless in either flag state).

1. **Cron drip** - `app/api/cron/rent-increase/route.ts` (~line 197): the `if (!confirmedRentTenancies.has(t.id)) { summary.skipped++; continue; }` skip. When the flag is OFF, do NOT apply this skip (nudge as pre-S575d). Keep building `confirmedRentTenancies` only when ON (skip the extra query entirely when OFF to avoid a needless read / a missing-table error before 0189 is applied).
2. **Record rent increase** - `app/dashboard/tenancies/actions.ts` (~line 624): the `if (!(await hasConfirmedRentLedger(...))) redirect(...?increase=unconfirmed)`. Skip this guard when OFF. (The `appendN1RentAdjustment` call further down can stay; appending a row when a real increase is recorded is harmless.)
3. **Serve N1** - `app/dashboard/tenancies/actions.ts` (~line 942): the `?serve=unconfirmed` redirect. Skip when OFF.
4. **N1 pre-fill route** - `app/dashboard/tenancies/[id]/n1/route.ts` (~line 67): the 400 "Confirm the current rent before opening a pre-filled N1." Skip when OFF (return the notice as pre-S575d).
5. **Tenancy detail page** - `app/dashboard/tenancies/[id]/page.tsx` (~line 585): `rentLedgerConfirmed` drives the UI (confirm prompt vs card). When OFF, render as pre-S575d (do not force the reconciliation prompt; show the rent-increase card as before). `hasConfirmedRentLedger` may still be read, but it must not gate the card when the flag is OFF.
6. **Reconciliation mount points** - `tenancies/watch/page.tsx`, `tenancies/new/lease-upload-prefill.tsx` (and wherever the shared `rent-reconciliation-fields.tsx` is mounted): when OFF, the step is not required and does not block submit; onboarding completes exactly as before. When ON, it is required per S575d.

## Gates / definition of done
- **Flag OFF proven to equal pre-S575d:** a unit/targeted test (or a clear assertion) that with `LEASE_TERM_SHIFT_ENABLED` unset: the cron does NOT skip an unconfirmed active tenancy, the N1 route does NOT 400 on an unconfirmed tenancy, and record/serve do NOT redirect to `unconfirmed`. Mirror the S575d test style.
- **Flag ON preserves S575d:** the existing S575d assertions still hold (gate blocks, derive uses confirmed current). Do not regress `scripts/test-rent-adjustments.ts` (16/16), `test-watch-lease.ts`, `test-rent-increase.ts`.
- One shared `leaseTermShiftEnabled()` helper; no scattered env reads; pure enough to unit-test both states.
- OFF also means the cron does not query `tenancy_rent_adjustments` at all, so deploying the code BEFORE 0189 is applied cannot error the drip.
- tsc clean (app); land natively on the Mac; do NOT push, commit, or apply 0189.

## Out of scope (S575d-b)
- Any change to the ledger schema, the resolver, the seeding, or the reconciliation component's internals.
- A backfill of existing tenancies (a separate, deliberate decision; blanket backfill would arm off a possibly-stale base and is NOT wanted).
- Per-org flagging (v1 is one global env flag; per-org is later if needed).
