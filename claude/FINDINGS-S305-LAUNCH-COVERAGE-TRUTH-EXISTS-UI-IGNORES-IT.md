# FINDINGS S305: the correct channel taxonomy already shipped, and nothing on the operator surface reads it

Written 2026-08-28 (S305). All claims re-derived from `origin/main` at `b3b9b97`,
which is the sha currently serving production. [verified 2026-08-28 via git show and Vercel MCP]

## The headline

S305 set out to design a new `ChannelMode` value for worker-backed channels. That design
work is NOT needed. **`lib/distribution-launch-coverage.ts`, shipped in S304 as PR #38
(`1b82b9f`), already contains the correct taxonomy, correctly classified, with a test.**

It has exactly TWO consumers on main: itself, and `scripts/test-distribution-launch-coverage.ts`.
Nothing in `app/` and nothing else in `lib/` imports it. [verified 2026-08-28 via git grep]

Meanwhile every operator-facing gate still branches on `channel.mode === "api_automatic"`.

## What the shipped taxonomy already says

`LAUNCH_COVERAGE_MECHANISMS` = `api_post`, `headless_worker`, `paid_worker_stop`,
`browser_copilot`, `commercial_assist`, `broker_handoff`, `share_task`.

`WORKER_SCRIPT_BY_CHANNEL` maps all seven worker-backed channels to their npm scripts.
`launchCoverageForChannel` then classifies:

| channel | mechanism | machineBacked | unattendedLiveCandidate |
|---|---|---|---|
| facebook_feed, instagram | `api_post` | true | true |
| kijiji, rentals_ca, zumper | `headless_worker` | true | true |
| rentfaster, viewit | `paid_worker_stop` | true | false, payment gated |
| spacelist, costar_loopnet | `commercial_assist` | false | false |
| facebook | `browser_copilot` | false | false |
| realtor_ca | `broker_handoff` | false | false |
| whatsapp, linkedin, snapchat | `share_task` | false | false |

That is correct. It matches the worker: five of those runners have really executed
against production data (kijiji 36 live + 1 dark, rentfaster 2 live + 17 dark, viewit
7 dark, zumper 1 live + 2 dark, rentals_ca 2 live), while `facebook_feed` and
`instagram` have never run once. [verified 2026-08-28 via distribution_publish_attempts]

## What the UI reads instead

Nine sites branch on `mode === "api_automatic"` [verified 2026-08-28 via git grep]:

- `app/dashboard/properties/[id]/channel-publish-rail.tsx:223` and `:239`
- `app/dashboard/properties/[id]/publish-everywhere.tsx:265`
- `app/dashboard/properties/distribution-actions.ts:284`
- `lib/auto-distribution.ts:76`
- `lib/channel-publish-autofire.ts:57`
- `lib/distribution-launch-coverage.ts:95` (correct, this one is the factory itself)
- `lib/distribution-publish.ts:640`
- `lib/publish-everywhere.ts:107`
- `lib/relist-radar.ts:361`

Only `facebook_feed` and `instagram` carry `mode: "api_automatic"`.

## The consequence, stated plainly

**The "Authorize auto-post" control renders for exactly the two channels the worker has
never run, and for none of the five it has.** Those sets are disjoint. There is no
control anywhere in the shipped app that can authorize Kijiji automation, which is why
Growth Test's flag had to be written directly in S305 and why Agile's row carries
`automation_authorized = true` with `automation_authorized_at` and
`automation_authorized_by` both NULL. [verified 2026-08-28 via Supabase]

For the landlord this renders as `"Sign in + post"` and `"Start this site"` on Kijiji,
read live from the accessibility tree on property `092591ea`. The product presents itself
as assisted manual for the one channel it has posted to 36 times.

## Why this is good news

The expensive part, deciding what each channel actually is, is done, tested and on main.
The remaining work is wiring, not modelling. `mode` does not need a new value and the
`ChannelMode` union does not need to change, which removes the risk of a new enum value
falling silently through nine untouched branches.

## The one guardrail that matters

`lib/channel-publish-autofire.ts` is an autofire selector. Widening its
`mode !== "api_automatic"` guard to include worker-backed channels would be an ARMING
change, not a display change. Any wiring pass must leave autofire alone and change only
the surfaces that display state and offer authorization.

## Related, and separate

`codex/s304-headless-kijiji-ui` (`1644395`, still no PR) corrects the Kijiji catalog copy
and adds a guard test. Its own commit message records the root cause as the mode union.
That diagnosis was reasonable but is superseded by this finding: the fix is to read the
coverage factory, not to grow the union. The copy fix in that branch is still wanted.
