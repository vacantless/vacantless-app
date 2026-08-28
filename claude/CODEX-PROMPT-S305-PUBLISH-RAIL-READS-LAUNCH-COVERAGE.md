# CODEX S305: make the operator surface read the launch coverage factory instead of `mode === "api_automatic"`

## Start point, and it is not negotiable

Branch from `origin/main` at **`b3b9b97`**. Every line number below was derived at that
sha on 2026-08-28. Use a `git worktree`, or push immediately. A separate clone under
`/private/tmp` is not reviewable and will be rejected.

This repo is PUBLIC. Never `git add -A`. Stage exact paths only.

## The problem in one sentence

`lib/distribution-launch-coverage.ts` already classifies every channel correctly, and
nothing outside that file and its own test imports it, so the operator UI still decides
what a channel is from `channel.mode === "api_automatic"` and therefore offers
automation only for `facebook_feed` and `instagram`.

Background and evidence: `claude/FINDINGS-S305-LAUNCH-COVERAGE-TRUTH-EXISTS-UI-IGNORES-IT.md`.

## What to change

Make the two operator surfaces derive channel capability from
`launchCoverageForChannel(channel)` rather than from `channel.mode`:

1. `app/dashboard/properties/[id]/channel-publish-rail.tsx`, the
   `needsAutomationAuthorization` predicate at `:223` and the `automationAction`
   ternary at `:239`.
2. `app/dashboard/properties/[id]/publish-everywhere.tsx`, `automationActionForCard`
   at `:265`, which additionally resolves an account only for `facebook_feed` and
   `instagram` and must resolve one for any channel with a
   `distribution_channel_accounts` row.

Rule to implement: a channel offers the authorize/revoke control when its coverage row
has `machineBacked === true`. That is `api_post`, `headless_worker` and
`paid_worker_stop`, so it picks up kijiji, rentals_ca, zumper, rentfaster and viewit
alongside the two existing API channels. The existing account preconditions are
unchanged: `account_status === "connected"` and the account row must exist.

Also update the Kijiji catalog blurb and the honesty-rule comment in
`lib/distribution-channels.ts`. `codex/s304-headless-kijiji-ui` (`1644395`) already
contains that copy work; lift it rather than rewriting it, and drop that branch's
premise that the mode union is the root cause, because it is not.

## What NOT to change, and this is the safety boundary

- **Do not touch `lib/channel-publish-autofire.ts`.** Its `mode !== "api_automatic"`
  guard at `:57` selects items to fire automatically. Widening it to worker-backed
  channels is an ARMING change. It stays exactly as it is in this pass.
- **Do not change the `ChannelMode` union** and do not add a value to it. The whole point
  of this ticket is that the union does not need to grow.
- **Do not change `lib/auto-distribution.ts:76`, `lib/distribution-publish.ts:640`,
  `lib/relist-radar.ts:361`, `lib/publish-everywhere.ts:107`, or
  `app/dashboard/properties/distribution-actions.ts:284` in this pass.** Each is a real
  question and each is its own gate. If you believe one of them blocks this change,
  stop and write down why instead of editing it.
- No schema change, no migration, no data write, no channel account rows.

## Tests you must add

1. A test asserting the authorize control is offered for every channel whose coverage row
   is `machineBacked`, driven off `launchCoverageRows()` so it cannot drift from the
   factory.
2. A test asserting `kijiji` specifically offers it. This is the regression that matters.
3. A test asserting `channel-publish-autofire.ts` still selects ONLY `facebook_feed` and
   `instagram`. Prove this one fails if the autofire guard is widened, and say so in the
   PR body.
4. A test asserting `spacelist` and `costar_loopnet` do NOT offer the control, since they
   are `commercial_assist` and have no runner yet.

## Verification to run and paste into the PR body

```
npx tsx scripts/test-distribution-launch-coverage.ts
npx tsx scripts/test-distribution-channels.ts
npx tsx scripts/test-publish-everywhere.ts
npx tsx scripts/test-distribution-publish.ts
npx tsx scripts/test-distribution-run.ts
npx tsc --noEmit
npm run lint
npm run build
```

Plus, for each new assertion, show it FAILING against unmodified source before showing it
passing. An assertion never proven to fail is not evidence.

## Scope note

This changes what the operator can authorize. It does not change what posts. Nothing
publishes without an approved item and a worker tick, and the worker's own gates
(`automation_authorized`, `requires_payment`, `spend_authorized`) are untouched.
