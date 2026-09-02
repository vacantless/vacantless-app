# S674 build: thread the worker's existing `error_code` into the durable attempt row

**Repo:** `vacantless-worker` (NOT `vacantless-app`).
**Start from:** `origin/main` = **`8efb93b`** (`Merge pull request #8 from
vacantless/codex/s304-worker-autopilot-channel-map`).
**Work in a git worktree off that sha, or push immediately.** Do not work in the main clone.

Note before you start: local `main` in Noam's clone is one commit ahead and unpushed,
`89ef02c "S304: add a dark mode to the autopilot sweep"`, touching only `src/autopilot.ts`,
`src/autopilot-channels.ts` and `scripts/test-autopilot-channels.ts`. **Every anchor below is
byte-identical at `8efb93b` and `89ef02c`** [verified 2026-08-31 by `git grep` at both revisions],
so either base works. Do not touch that commit.

## Why

`distribution_publish_attempts` is the durable, append-only publish log.
**`error_code` is non-null on 0 rows and `error_message` on 0 rows** [verified 2026-09-02 via the
Supabase MCP]. Both columns exist. Nothing is missing from the schema.

Quote the denominator honestly: the table holds 2,067 rows but **1,953 of them (94.5 percent) are
`distribution_freshness_cron` no-ops**. **Only 114 rows are real publish attempts**, and that 114 has
not moved since the last `phase_b_submit` on 2026-08-14. So the honest statement is **0 of 114**, not
0 of 2,067.

The worker computes real error codes and writes them to **`distribution_run_items`**, which is
**current state**, so each pass overwrites the last and the history is lost. Today's writers:

- `src/claim.ts:99` - `spend_authorization_required`
- `src/claim.ts:143` - `worker_stale_submitting_reclaimed`
- `src/phase-b-submit.ts:1571` - `kijiji_validation_error`
- `src/phase-b-submit.ts` relist-radar refresh path, eight distinct codes passed to
  `releaseRefreshToOperator`: `kijiji_repost_failed_after_delete` (`:2244`),
  `kijiji_refresh_record_failed` (`:2309`), `kijiji_refresh_wrong_org` (`:2372`),
  `kijiji_refresh_backup_missing` (`:2386`), `kijiji_preflight_failed` (`:2412`, `:2438`),
  `kijiji_delete_audit_failed` (`:2483`), `kijiji_delete_not_confirmed` (`:2501`)

**The worker's own attempt recorder cannot carry them.** `recordAgentAttempt`
(`src/claim.ts:414-450`) has no `errorCode` or `errorMessage` parameter and inserts neither column.

**This is a missing wire, not a missing field. Do not add a column. Do not write a migration.**
`distribution_publish_attempts.error_code` and `.error_message` are plain nullable `text` with no
check constraint [read from `information_schema.columns` and `pg_constraint`, 2026-08-31].

## Scope: exactly this, nothing else

**1. `src/claim.ts` - widen `recordAgentAttempt` (additive, optional).**
Add to the args object at `:416-425`:
```ts
    errorCode?: string | null;
    errorMessage?: string | null;
```
and to the `.insert({...})` at `:432-444`:
```ts
      error_code: args.errorCode ?? null,
      error_message: args.errorMessage ?? null,
```
Both optional, both defaulting to null, so every existing call site keeps compiling and keeps
behaving identically.

**2. `src/submit-logic.ts` - one exported pure helper, so the two writers cannot drift.**
```ts
/**
 * The error_code the run item will carry for this landing. Exported so the
 * durable attempt row and the run-item update derive it from ONE place: they
 * drifted apart before S674 because the run item computed it inline.
 */
export function attemptErrorCodeForLanding(landing: Landing): string | null {
  return landing.errorMessage ? "kijiji_validation_error" : null;
}
```
This must return exactly what `src/phase-b-submit.ts:1571` computes today
(`update.error_code = landing.errorMessage ? "kijiji_validation_error" : null;`). Do not change the
value, do not add cases, do not invent new codes anywhere in this change.

**3. `src/phase-b-submit.ts:1569-1574` - `applyLanding` calls the helper** instead of its inline
ternary. Same value, one source.

**4. Pass the code at the attempt call sites that have one.** All ten call sites are unchanged at
`8efb93b`:

| call site | pass |
|---|---|
| `src/phase-b-submit.ts:2894` (free/paid kijiji submit) | `errorCode: attemptErrorCodeForLanding(landing)`, `errorMessage: landing.errorMessage ?? null` |
| `src/phase-b-submit.ts:2204` (relist radar repost) | the same `errorCode`/`errorMessage` strings that this path's `releaseRefreshToOperator` call passes; `null` on the success branch |
| `src/phase-b-submit.ts:2462` (relist radar delete) | same rule |
| `src/phase-b-submit-paid.ts:602` | `errorCode: attemptErrorCodeForLanding(landing)`, `errorMessage: landing.errorMessage ?? null` |
| `src/phase-a-proof.ts:140`, `src/phase-b-proof.ts:171`, `src/phase-b-submit-rentals.ts:1112`, `src/phase-b-submit-zumper.ts:370`, `src/phase-b-submit-instagram.ts:236`, `src/phase-b-submit-facebook.ts:251` | explicit `errorCode: null, errorMessage: null` - plumbing only, no behaviour change |

**Ordering matters and is already correct: leave it alone.** The attempt row is inserted BEFORE
`applyLanding` (the S479 reserve-then-mutate model). Derive the code from `landing` before both.
Do not move the recorder after the mutation to make this easier.

## Out of scope, deliberately

- **Do NOT change where a landing lands.** `case "live"` returning `needs_operator` with
  `externalUrl` is the **S642 worker contract**, stated at `src/phase-b-submit.ts:2969-2971` and
  enforced by `assertWorkerNeverTerminal` in the app
  (`vacantless-app/lib/distribution-worker.ts:94-99`, forbidden list
  `["live","submitted","skipped","rejected"]`). Widening `Landing.publishStatus`
  (`src/submit-logic.ts:29-30`) is a separate, migration-first slice.
- **Do NOT add a `submit_ready` status.** Separate slice. The DB check constraint has to widen
  first, and `submitted` is already taken by the feed-partner path.
- **Do NOT make `recordSpendAuthorizationRefusal` (`src/claim.ts:88-121`) record an attempt.** It is
  a real gap (it writes an error code to current state and no history at all) but it changes what
  gets logged on a refusal path, which needs its own review.
- No migration. No new error-code strings. No backfill of existing rows.

## Test, and prove the gate bites first

New file `scripts/test-attempt-error-code.ts`, plus `"test:attempt-error-code": "tsx
scripts/test-attempt-error-code.ts"` in `package.json` and appended to the `smoke:all` chain.

It must cover, with a fake admin client that captures the insert payload:

1. `attemptErrorCodeForLanding` returns `"kijiji_validation_error"` when `landing.errorMessage` is
   set, and `null` when it is not, for both a truthy and an empty-string message.
2. `recordAgentAttempt` inserts `error_code` and `error_message` when given, and inserts explicit
   `null` for both when omitted.
3. **The anti-drift assertion:** the value `applyLanding` writes to
   `distribution_run_items.error_code` and the value the attempt row carries for the same landing
   are equal. This is the assertion that catches a future edit to one writer and not the other.

**PROVE IT FAILS FIRST.** Before applying the source changes, run the new test against unmodified
`8efb93b` and paste the failure output in the PR body. A test that passes on the unpatched tree
proves nothing. `npm run typecheck` must also be clean.

## Deployment

**This ships to the repo only.** The worker box is deployed deliberately and separately, its run
mode comes from a systemd drop-in and not from `.env`, and there is an older commit intentionally
not deployed. **Do not deploy the worker as part of this change and do not suggest it in the PR.**

## What "done" looks like

- `npm run typecheck` clean.
- `npm run test:attempt-error-code` passes, with the pre-change failure output in the PR body.
- `npm run smoke:all` passes.
- Diff touches only: `src/claim.ts`, `src/submit-logic.ts`, `src/phase-b-submit.ts`,
  `src/phase-b-submit-paid.ts`, the six plumbing-only call sites, `scripts/test-attempt-error-code.ts`,
  `package.json`. No SQL. No migration. No file in `vacantless-app`.
- The PR body states in one line that no behaviour changes: the same statuses land in the same
  places, and two columns that were always null now carry the value the run item already had.
