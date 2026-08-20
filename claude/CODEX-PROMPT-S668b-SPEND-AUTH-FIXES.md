# CODEX PROMPT - S668b, review fixes on the spend-authorization branch

_Follow-up to app `567ac5e` / worker `1440b27`._

**Read these two first. They are in the MAIN CLONE, not in your worktree, so use the absolute paths:**

- `~/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app/claude/REVIEW-CODEX-S668-SPEND-AUTHORIZATION.md`
- `~/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app/claude/DECISION-S668-ONE-PAID-GATE-S651-WINS.md`

Do not copy them into the worktree and do not commit them on this branch. They are filed on `main`
separately.

## Working agreement

- Continue in the SAME two worktrees, on the SAME branch `codex/s668-spend-authorization`:
  - app:    `~/Documents/Claude/Projects/Agile Lead to Lease Engine/worktrees/s668-spend-auth-app`
  - worker: `~/Documents/Claude/Projects/Agile Lead to Lease Engine/worktrees/s668-spend-auth-worker`
- Commit on top, do not amend or force-push. Push both. Do not merge to `main`, do not deploy.
- Never `git add -A` in the app repo. It is PUBLIC. Explicit paths only.
- **Migration `0217` has NOT been applied anywhere.** Edit it in place rather than adding `0218`.
  Confirm before you start: `0216_property_status_before_archive.sql` is the latest applied in
  production. If `0217` turns out to have been applied, STOP and say so; the fix then needs its own
  migration.

## What was right, and must not be undone

The claim gate is correct. `claim_approved_distribution_run_item_for_worker` re-checks authorization
inside the claiming `UPDATE ... WHERE exists (...)`, so a revoke racing the candidate read cannot
produce a claim. Do not move that check back into TypeScript, and do not weaken the `exists` clause.

## Fix 1 (do this first) - the spend ledger must be append-only

`0217` currently grants `select, insert, update, delete` on `public.distribution_channel_spend` to
`authenticated`, under a `for all` policy. Any org member can rewrite or delete their own spend
history, which defeats the point of a ledger.

Mirror the house precedent for a money table, `0173_concierge_pack_purchases.sql:17-26`, exactly:

```
alter table public.distribution_channel_spend enable row level security;

drop policy if exists distribution_channel_spend_all on public.distribution_channel_spend;
drop policy if exists distribution_channel_spend_read on public.distribution_channel_spend;
create policy distribution_channel_spend_read on public.distribution_channel_spend
  for select using (organization_id in (select public.user_org_ids()));

revoke all on public.distribution_channel_spend from anon;
revoke all on public.distribution_channel_spend from authenticated;
grant select on public.distribution_channel_spend to authenticated;
grant select, insert on public.distribution_channel_spend to service_role;
```

Note the deliberate absence of `update` and `delete` for BOTH roles. A wrong ledger row is corrected
by a compensating row, never by an edit.

## Fix 2 - revoke must not destroy the authorized amount

`app/dashboard/settings/actions.ts` currently nulls `spend_max_cents` and `spend_period_max_cents`
on revoke. Keep both values; set `spend_authorized = false` and `spend_revoked_at = now` only. The
check constraint already permits a non-null ceiling on an unauthorized row, so this is safe, and it
means the record still says what was authorized and for how much.

Re-granting must still clear `spend_revoked_at` (it already does, keep that).

## Fix 3 - refusal must not discard who approved

The RPC's refusal branch nulls both `operator_submit_approved_at` and `operator_submit_approved_by`.
Clearing the timestamp is right, it forces a fresh approval. Clearing the identity is not.

Keep `operator_submit_approved_by` as it is, and include the prior approver's id in the audit
message so the trail reads: who approved, when the worker refused, and why.

## Fix 4 - `claimOneJob` must refuse loudly

`claimApprovedJob` writes an audit line on a spend refusal. `claimOneJob` applies the same
`spendAuthorizationIssue` check and just skips the candidate, silently. Add an audit line there too.

Constraint: in `claimOneJob` do NOT change `publish_status`, do NOT clear approvals, and do NOT
claim the item. Record `audit_message` / `error_code = 'spend_authorization_required'` and move on.
Write it at most once per item, so a polling worker does not rewrite the same row every cycle
(guard on `error_code` not already being `spend_authorization_required`).

## Fix 5 - label the scaffolding as scaffolding

Per the decision doc, the ceiling helpers in `src/paid-submit-logic.ts` (`decidePaidGate`'s new
inputs, `effectiveSpendMaxCents`, `parseCheckoutTotalCents`, `overCeilingAudit`, the `over_ceiling`
landing) are UNREACHABLE on this branch: the only call site, `phase-b-submit-paid.ts:267`, passes
three booleans, so `checkoutAmountCents` is always undefined and the function returns
`needs_payment` on every path.

Do not wire them. Add a short comment block above them stating, in plain words: these are not
enforcing anything today; the live paid gate is `paid-plan-logic.ts` on
`codex/s651-kijiji-paid-lane`; per `claude/DECISION-S668-ONE-PAID-GATE-S651-WINS.md` this copy is
deleted when s651 lands and the ceilings are threaded into s651's `decidePaidGate` instead.

Same for the ledger: one comment on the `distribution_channel_spend` table in `0217` saying no code
writes it yet and which slice will.

## Explicitly OUT of scope

- Wiring the ceiling or the ledger. It cannot be done off `main`; the paid lane is unmerged.
- Merging or rebasing `codex/s651-kijiji-paid-lane`.
- `posting_policy`. Still its own slice.
- Any change to the RPC's authorization logic.

## Tests

1. Re-run the app spend-authorization test and the concierge test. Extend the spend test to assert
   the ledger grants: `grant select on public.distribution_channel_spend to authenticated` present,
   and no `update`/`delete` grant to `authenticated` anywhere in `0217`.
2. Add a case asserting revoke preserves `spend_max_cents` (source-level is acceptable, say so).
3. Worker smoke: unchanged behaviour of `spendAuthorizationIssue`, plus the new `claimOneJob` audit
   path.
4. `tsc --noEmit` and lint in both repos, and the app build.

## Definition of done

Both repos green, both branches pushed, and a note saying for each fix whether you EXECUTED the
test or only reasoned about it. Do not report "verified" for anything you did not run.
