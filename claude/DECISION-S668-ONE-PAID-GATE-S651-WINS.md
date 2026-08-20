# DECISION - one paid gate, and it is s651's (S668, 2026-08-19)

_Status: RECOMMENDED and being built to. Noam asked to proceed with the review recommendation on
2026-08-19. Reverse it here if he disagrees before s651 lands; nothing shipped depends on it yet._

## The problem

`decidePaidGate` now exists TWICE in the worker:

- `src/paid-plan-logic.ts:36`, on `codex/s651-kijiji-paid-lane` (`33f846e`), unmerged and dark.
  It already takes `maxCents` and already lands `over_ceiling` at `:99`. It is the real paid lane.
- `src/paid-submit-logic.ts:102`, on `codex/s668-spend-authorization` (`1440b27`), built off `main`.
  It is a re-implementation with the ceiling inputs, and **nothing calls it with those inputs**.

The duplication is not Codex's fault. The S667 build prompt cited s651 line numbers
(`paid-plan-logic.ts:36`, `paid-plan-logic.ts:99`, `phase-b-submit.ts:114` `PAY_MAX_CENTS`,
the guards at `:1323/:1379/:1387/:1423/:1431`) while the S668 launch instructions pointed Codex at a
worktree off `main`, where **none of those files or symbols exist**. Verified 2026-08-19:
`paid-plan-logic.ts` is absent from `b34a387` and present only on `33f846e`.

## The decision

**s651's `paid-plan-logic.ts` is the one paid gate.** When s651 lands, `spend_max_cents` and
`spend_period_max_cents` get threaded into ITS `decidePaidGate` as the prompt originally intended,
and the s668 copy in `paid-submit-logic.ts` is deleted rather than reconciled.

**s668 keeps only what is real off `main`:** the `0217` migration, the
`claim_approved_distribution_run_item_for_worker` RPC, and the `claim.ts` authorization checks.
Those are the gate. They do not depend on the paid lane and they close a live liability today.

## Why this way round

- s651's version is the one wired into an actual checkout flow. s668's is wired into nothing, so
  keeping s668's would mean re-doing on s651 the very threading that s651 already has.
- The env ceiling `WORKER_PAY_MAX_CENTS` lives in s651's `phase-b-submit.ts`. The `Math.min(db, env)`
  rule has to sit where the env var is.
- Deleting unreachable code is cheaper and safer than rebasing a live lane onto a stub.

## What this means for the S668 branch

The ceiling helpers in `paid-submit-logic.ts` are **scaffolding, not enforcement**. They must be
labelled as such in the source so the next reader does not believe a ceiling is being applied. The
spend ledger table is likewise created and unwritten. Record S668 as **"the claim gate"**, never as
"the spend ceiling", in SESSION_LOG and 00-NEXT-SESSION.

## Carried risk if this decision is reversed

If s668's copy is kept instead, s651 must be rebased and its `paid-plan-logic.ts` gutted, and the
`over_ceiling` landing has to move with it. That is a bigger change to a branch that already carries
the recon-pending `basePackageCode` sentinels, so it should not be done casually.
