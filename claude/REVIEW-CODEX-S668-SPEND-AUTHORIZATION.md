# REVIEW - S668 per-org spend authorization (app `567ac5e`, worker `1440b27`)

_Reviewed 2026-08-19 (Session 668) by reading both diffs from the main clones, not from the
worktrees. Verdict: the load-bearing gate is REAL and correct. The ceiling is NOT WIRED, the
ledger has NO WRITER, and the prompt's worker anchors pointed at a branch this slice was not
built on. Do not merge as "the spend gate is done"._

## Verified untouched

App `main` and `origin/main` both `7c417293`; worker `main` and `origin/main` both `b34a387d`.
No PR, no merge, no deploy. Both branches pushed.

## What is genuinely delivered

1. **The claim gate is atomic, and that was the point.** `claimApprovedJob` no longer does its own
   CAS. It calls the new `public.claim_approved_distribution_run_item_for_worker` RPC
   (`0217`), whose claiming `update ... where` carries an `exists (...)` re-check of
   `automation_authorized`, `spend_authorized`, `spend_revoked_at is null` and
   `spend_max_cents > 0`. A revoke landing between the candidate read and the claim cannot
   produce a claim. This satisfies "mirror the condition into the CAS" properly.
2. **All six worker entry points inherit it** because they route through `claimApprovedJob` /
   `claimOneJob`, and both now call `spendAuthorizationIssue`.
3. **Re-grant after revoke works.** `updateDistributionChannelAccount` sets `spend_revoked_at = null`
   on grant. Forgetting this is the classic version of this bug and Codex avoided it.
4. **`effectiveSpendMaxCents` is a true `Math.min`** and returns null when the DB value is absent, so
   it fails closed rather than open.
5. **The `requires_payment = false` branch in the RPC is NULL-safe**, checked specifically:
   `0141_distribution_channel_accounts.sql:54` declares `requires_payment boolean not null default
   false`, so free channels cannot fall through the three-valued-logic hole.
6. The app-side check in `authorizeAutopilotSubmit` is read-then-write and therefore racy, but that
   is acceptable **because the RPC is authoritative**. The app check is a UX guard, not the gate.

## Findings

### F1 (blocking the "ceiling" claim) - the ceiling is dead code

`decidePaidGate` gained `checkoutAmountCents`, `spendMaxCents`, `envMaxCents`, `monthToDateCents`
and `spendPeriodMaxCents`. **No caller supplies any of them.** The only call site is
`phase-b-submit-paid.ts:267`, which still passes three booleans. With `checkoutAmountCents`
undefined, `positiveCents` returns null and the function returns `needs_payment` on every path.

Consequence: the per-ad ceiling, the monthly cap, `parseCheckoutTotalCents`, the `over_ceiling`
landing and `overCeilingAudit` are unreachable on this branch. The direction of failure is safe
(nothing can pay), but prompt item 3 is not delivered in substance.

### F2 (blocking the "ledger" claim) - nothing writes `distribution_channel_spend`

The table, index and RLS exist in `0217`. Runtime references in both repos: **zero**. The only hits
are string assertions in `scripts/test-spend-authorization.ts` grepping the migration text. So the
month-to-date input, even once wired, would read 0 forever. "A row is written to the ledger only
after a charge is believed to have completed" is unimplemented.

### F3 (my error, and the biggest merge risk) - the worker anchors were from an unmerged branch

The S667 prompt cited `paid-plan-logic.ts:36` (`decidePaidGate`), `paid-plan-logic.ts:99`
(`over_ceiling`), `phase-b-submit.ts:114` (`PAY_MAX_CENTS`) and the guards at `:1323/:1379/:1387/
:1423/:1431`. **None of those exist on worker `main`.** Verified: `paid-plan-logic.ts` is absent
from `b34a387` and present only on `codex/s651-kijiji-paid-lane` (`33f846e`), where
`PAY_MAX_CENTS` also lives (`phase-b-submit.ts:114`).

The S668 launch instructions sent Codex to a worktree off `main` while quoting those s651 line
numbers. Codex did the sensible thing and built a parallel implementation in `paid-submit-logic.ts`.
**When s651 merges there will be two `decidePaidGate` functions with different signatures and two
paid gates to reconcile.** Decide the reconciliation before either branch lands.

### F4 - the spend ledger is not append-only

`0217` grants `select, insert, update, delete` on `distribution_channel_spend` to `authenticated`,
with an RLS policy `for all`. Any org member can rewrite or delete their own spend history. An
audit trail that the audited party can edit is not an audit trail. Recommend `select` only for
`authenticated`, writes reserved to `service_role`.

### F5 - revoke destroys the authorized amount

The revoke path nulls `spend_max_cents` and `spend_period_max_cents`. The row survives, so the
audit "survives" in the narrow sense, but the number that was authorized does not. Keep the
ceilings and let `spend_revoked_at` carry the state, or copy them into the ledger first.

### F6 - refusal discards who approved

The RPC's refusal branch nulls both `operator_submit_approved_at` and `operator_submit_approved_by`.
Forcing re-approval is defensible; discarding the approver's identity is not, and the audit message
does not name them either.

### F7 - `claimOneJob` refuses silently

`claimOneJob` now applies `spendAuthorizationIssue` but simply skips the candidate: no audit line,
no error code. The prompt asked for loud refusal. `claimApprovedJob` does this correctly; the
autopilot path does not.

## Recommendation

Merging the claim gate alone is low risk and closes a live liability (today, one operator click is
unbounded spend consent). Free channels are unaffected because `requires_payment` defaults false,
and the paid lane is dark. Suggested order:

1. Fix F4 in `0217` before it is applied. Changing a migration after it runs in production is worse.
2. Decide F3 explicitly: either s668's `paid-submit-logic.ts` becomes the one gate and s651 is
   rebased onto it, or s651's `paid-plan-logic.ts` wins and s668's copy is deleted at merge.
3. Then merge s668 as "the claim gate", stating plainly that the ceiling and the ledger are
   scaffolding until the paid lane lands. Do not record this slice as enforcing a ceiling.
