# FINDINGS S306: an unfinishable approved item starves every item behind it, forever

Written 2026-08-28 (Session 306). Found while waiting for a tick that could never come.

## The mechanism

`vacantless-worker/src/claim.ts:281`, inside `claimApprovedJob`:

```ts
.eq("publish_status", "needs_operator")
.not("operator_submit_approved_at", "is", null)
.is("concierge_claimed_by", null)
.order("operator_submit_approved_at", { ascending: true })
.limit(CANDIDATE_LIMIT);
```

Then the candidate loop:

```ts
for (const c of candidates) {
  ...
  const issue = spendAuthorizationIssue(a);
  if (issue == null) { job = c; account = a; break; }
  ...
}
```

**Oldest approval first, and `break` on the first candidate whose account check passes.** There is no notion of an item that keeps failing. A candidate that passes the account check but cannot complete its run is re-selected on every single tick, indefinitely, and nothing behind it is ever reached.

## What it cost, concretely

- `4dc42e36` (Growth Test kijiji) was approved 2026-08-28 **13:50:13**.
- `0640c0aa` (Growth Test kijiji, the S306 clean item) was approved **18:44:38**.
- Kijiji is `requires_payment = false`, so `spendAuthorizationIssue` returns null and `4dc42e36` passes the account check every time.
- `4dc42e36` carries `relist_radar_backup.source = relist_radar_autorefresh`, so `maybeRunRelistRadarFreeRefresh` takes it and releases it. **It can never complete.** See `FINDINGS-S306-RELIST-RADAR-CLASSIFIER-IS-AN-OR.md`.

So every five-minute tick claimed `4dc42e36`, printed `claimed: 1, skippedReason: free_refresh_flag_off`, released it, and stopped. `0640c0aa` sat approved and untouched. **Without intervention it would have waited forever**, and the journal would have shown a healthy worker claiming an item every five minutes the whole time.

S305 recorded this row as: *"`4dc42e36` sits approved at `needs_operator` and is claimed and released every five minutes. Harmless churn. Revoke that approval to quiet it, or keep it as standing evidence."* It was not churn. It was the queue head, and it was load-bearing on nothing.

## The fix taken in S306

Revoked `4dc42e36`'s approval, nulling `operator_submit_approved_at` and `operator_submit_approved_by` on that one row. Revert with both exact values written to disk first, at `Vacantless QA + Product Build/REVERT-S306-4DC42E36-APPROVAL.sql`, guarded so it no-ops if the row is already approved.

The very next tick, 18:55:45, claimed `0640c0aa` and carried it through the full dark submit. That is the first Kijiji concierge item ever to reach the normal submit path.

## Why this is a design gap and not a one-off

Nothing in the claim path records that a candidate was selected and failed. `releaseToNeedsOperator` deliberately preserves the approval so a benign miss stays re-runnable, which is correct on its own. Combined with strict oldest-first ordering and an unconditional `break`, it produces a permanent head-of-line block with no signal anywhere.

Options worth weighing, none taken:

1. **Skip and continue** rather than `break` when a candidate's runner returns a terminal-for-this-item reason. Requires the runner to tell the claimer that, which it currently does not.
2. **Order by `operator_submit_approved_at` but tie-break away from repeat failures**, using a consecutive-release counter on the item.
3. **Surface it**: a tick that claims the SAME item N times in a row with the same `skippedReason` should alert. This is the cheapest and probably the most valuable, because the failure mode is invisibility, not incorrectness.

Option 3 also covers the general case, which is worth stating plainly: **`claimed: 1` in the journal proves an item was selected, not that anything progressed.** A green tick and a stuck queue look identical from the outside.

## Related

Same family as the S304 finding that `no_approved_job` is ambiguous by construction, and the S670 finding that a screen said Live over a dead ad: in each case a surface reported activity while nothing was actually happening.
