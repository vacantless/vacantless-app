# CODEX PROMPT - Standing per-org spend authorization for paid distribution channels (S667)

_Decision context: `claude/DECISION-KIJIJI-PAID-ONLY-WITH-STANDING-SPEND-AUTH-S667.md`. Read it
first. This slice is the hard prerequisite for enabling the Kijiji paid lane; nothing paid ships
before it._

## Working agreement

- Work in a **git worktree** off `main`, or push the branch immediately. A separate clone in
  `/private/tmp` is NOT reviewable: its refs and objects never reach the main repo.
- Two repos are involved: `vacantless-app` (Next.js + Supabase) and `vacantless-worker`.
  The worker's paid lane currently lives unmerged on `codex/s651-kijiji-paid-lane` (`33f846e`).
  **Do not merge that branch as part of this slice.** This slice lands the gate; lighting the lane
  is a separate, later decision.
- Ship the reversibility before the operation: every new authorization must be revocable through
  the same UI that grants it, and revoking must take effect on the next claim without a redeploy.

## The problem in one paragraph

Today, one operator click on a `needs_payment` distribution run item is treated as the landlord's
consent to pay that site's listing fee. `app/dashboard/properties/distribution-actions.ts:526`
says so in a comment and the update at `:531` runs
`.in("publish_status", ["needs_operator", "needs_payment"])`. There is no ceiling recorded against
the org, no record of what amount was consented to, and no audit of what was actually charged. The
worker does have a ceiling, `WORKER_PAY_MAX_CENTS` (`vacantless-worker/src/phase-b-submit.ts:114`,
default 5000 cents), but it is **process-global**: one env var for every organization on the box.

## What to build

### 1. Migration: per-org spend authorization on the existing account row

Extend `public.distribution_channel_accounts` (already unique on `(organization_id, channel)` per
`supabase/migrations/0141_distribution_channel_accounts.sql:74`). **Do not create a new table.**

Add, in the additive `add column if not exists` style used by
`0177_distribution_worker_authorization.sql:22`:

- `spend_authorized boolean not null default false`
- `spend_max_cents integer` (null when not authorized; the per-AD ceiling)
- `spend_period_max_cents integer` (null = no periodic cap; the per-CALENDAR-MONTH ceiling)
- `spend_authorized_at timestamptz`
- `spend_authorized_by uuid references auth.users(id) on delete set null`
- `spend_revoked_at timestamptz`

Add a check constraint so an authorized row cannot have a null or non-positive per-ad ceiling:
`check (spend_authorized = false or (spend_max_cents is not null and spend_max_cents > 0))`.

Also add a spend ledger, because a ceiling with no record of what was spent against it is not
enforceable:

- `public.distribution_channel_spend` with `id`, `organization_id`, `channel`,
  `distribution_run_item_id`, `amount_cents integer not null check (amount_cents > 0)`,
  `currency text not null default 'CAD'`, `external_url text`, `charged_at timestamptz not null
  default now()`, `created_at`. Index `(organization_id, channel, charged_at)`. RLS matching the
  sibling distribution tables.

**A row is written to the ledger only after a charge is believed to have completed**, and it
records the amount actually seen on the checkout total, not the planned amount.

### 2. Enforce it in the CLAIM PREDICATE, not only in the UI

This is the load-bearing part. `vacantless-worker/src/claim.ts`:

- Candidate select is at `:194-201`; the per-candidate account check is at `:208-221`; the guarded
  CAS is at `:244-249`. **All six worker entry points go through this one function**
  (`phase-b-submit.ts:2531`, `phase-b-submit-paid.ts:370`, `-rentals.ts:710`, `-zumper.ts:172`,
  `-instagram.ts:127`, `-facebook.ts:152`), so gating here covers every channel at once.
- Today the only account condition is `if (a?.automation_authorized === true)` (`:216`).
  `requires_payment` is selected at `:211` and **never tested** - grep confirms it appears only at
  `claim.ts:24, 119, 211`. Fix that: when `requires_payment === true`, the account must ALSO satisfy
  `spend_authorized === true`, `spend_revoked_at is null`, and a positive `spend_max_cents`.
- Mirror the condition into the CAS at `:247` so a concurrent revoke cannot be raced. Do not rely on
  the read at `:216` alone.
- Refusal must be **loud and legible**: the item stays claimable-by-a-human at `needs_operator` with
  an audit line naming the org, the channel and which condition failed. Never silently skip.

### 3. Make the worker's ceiling per-org

`vacantless-worker/src/phase-b-submit.ts:114` `PAY_MAX_CENTS` becomes a fallback, not the source of
truth. Thread the claimed account's `spend_max_cents` into `decidePaidGate`
(`src/paid-plan-logic.ts:36`) as `maxCents`. Keep the env var as a **hard upper bound the DB value
cannot exceed** - take `Math.min(dbMaxCents, envMaxCents)` - so a bad DB write cannot authorize an
unbounded spend.

Do NOT weaken any existing guard. Specifically, keep all of:

- the double evaluation at `:1379` and `:1423`,
- the `basePackageCode`-empty kill-switch at `:1387` and `:1431`,
- the total-does-not-equal-base-price belt at `:1323`,
- the `over_ceiling` landing at `paid-plan-logic.ts:99` that lands `needs_operator` with no payment.

Add the month-to-date check against `distribution_channel_spend` where `spend_period_max_cents` is
set: if `mtd + thisCharge > spend_period_max_cents`, return `over_ceiling` with an audit line that
names both numbers.

### 4. UI: grant and revoke

In the existing channel-account settings surface, add an explicit authorization control that states
the amount in dollars, the period, and the channel by name, writes `spend_authorized_by` and
`spend_authorized_at`, and offers revoke. **Revoke sets `spend_revoked_at` and flips
`spend_authorized` to false; it never deletes the row**, so the audit survives.

### 5. Split operator approval from spend consent

`app/dashboard/properties/distribution-actions.ts:519` (`authorizeAutopilotSubmit`, declared `:500`)
currently accepts `needs_payment` items on the S631 reasoning quoted at `:526`. Once a standing
authorization exists, approving a `needs_payment` item must require it. Update the comment at `:526`
to state the new model rather than leaving the old justification in place, and make the failure
message tell the operator exactly what to go and authorize.

## Explicitly out of scope for this slice

- Merging `codex/s651-kijiji-paid-lane`.
- Filling in `mappings/kijiji.json` `_meta.paidPlan.basePackageCode` or the real
  `savedMethodNames`. They stay as the recon-pending sentinels so the lane cannot click pay.
- The posting-side QA-org gate. Related and required before any paid post, but a separate slice.
- Pass-through billing / invoicing.
- `posting_policy` enforcement. Flagged in the decision doc as written-in-six-places-read-in-none;
  worth its own slice, do not fold it in here.

## Tests I want to see

1. `decidePaidGate` unit tests: db ceiling below env ceiling wins; env ceiling below db ceiling wins;
   null/zero/negative `spend_max_cents` yields `needs_payment`, never `pay_onfile`.
2. `claimApprovedJob`: an account with `requires_payment = true` and `spend_authorized = false` is
   NOT claimed. Same account with authorization granted IS claimed. Revoking between the candidate
   read and the CAS results in no claim.
3. Month-to-date: a charge that fits the per-ad ceiling but breaches the monthly ceiling returns
   `over_ceiling` and writes no ledger row.
4. A regression test that the `basePackageCode`-empty kill-switch still forces `needs_payment` even
   when everything else is authorized.

## Definition of done

`tsc`, lint, unit tests green in both repos, branch pushed (or in a worktree), and a short note
saying which of the four test groups above you actually ran versus reasoned about. **Do not report
"verified" for anything you did not execute.**
