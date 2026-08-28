# DECISION S305: commercial channels get the same headless promise, sequenced after residential

Decided 2026-08-28 (S305) by Noam, verbatim: commercial "will get the same headless
but we can prioritize them after residential. they should be lower on list grouped
together."

## The decision

SpaceList and CoStar / LoopNet are NOT a separate, permanently operator-gated product
line. They get the same headless posting promise as the residential channels. They are
sequenced AFTER residential and are worked as ONE grouped phase, not interleaved.

## Why this needed deciding

The catalog on `origin/main` describes CoStar / LoopNet as a channel where "login,
verification, payment, and posting stay human-gated" and SpaceList as one where
"a signed-in operator reviews" the sheet. Read as product statements those foreclose
headless. They are staging statements. This decision says so explicitly so no future
session reads the blurb as the roadmap.

## Verified state at the time of the decision [verified 2026-08-28 via origin/main and Supabase]

- `spacelist`: integrationStatus `planned`, connectKind `none`, mode `assisted_manual`, paid `false`
- `costar_loopnet`: integrationStatus `planned`, connectKind `none`, mode `assisted_manual`, paid `true`
- ZERO `distribution_channel_accounts` rows for either channel, in any org
- `scriptForAutopilotChannel("spacelist")` returns null, asserted by a worker test
- PROD `b3b9b97` exists because commercial-only packet fields blocked default Marketplace
  and Kijiji readiness and had to be scoped. Anything added to the shared packet must be
  scoped at introduction or it will break residential again.

## Consequences that follow from the decision

1. **The mode union must encode CAPABILITY, not payment.** Today `kijiji`, `spacelist`
   and `costar_loopnet` all read `assisted_manual` and mean three different things
   (mislabelled, not built, deliberately gated). Since commercial is headless-eventually,
   CoStar's correct mode is worker-PLANNED, not human-gated. Payment stays a separate
   axis: `paid`, `requires_payment`, `spend_authorized`, `spend_max_cents`. One vocabulary
   covers all channels.
2. **Fix the commercial copy in the SAME pass as the Kijiji copy.** It is the identical
   defect class that branch `codex/s304-headless-kijiji-ui` (`1644395`, no PR) was written
   for. Two passes would leave the catalog lying about one set of channels while telling
   the truth about the other.
3. **The spend gate is the commercial prerequisite and it is already built.** Claim-side
   refusal, standing per-org authorization, ceiling fields, all shipped and on the box at
   `8efb93b`. It has never been exercised for a commercial channel only because no account
   row exists. Expect commercial to behave like viewit and rentfaster do now: approvals
   silently revoked on first sweep until spend is authorized.

## Ordering

1. Prove the residential chain once, end to end.
2. Residential UI truth: mode union, authorize control, live status. Removes the guided surface.
3. All-channel residential sweep: apply the autopilot dark patch, resolve `facebook_feed`
   and `instagram` orphaning, rehearse dark, then live.
4. Residential session durability, so single click survives a dead portal session.
5. **Commercial headless, as one grouped phase:** worker runners for `spacelist` and
   `costar_loopnet`, account rows, spend authorization exercised end to end, commercial
   packet fields scoped so they cannot block residential readiness.

## Status

Decision only. No code, no schema, no channel rows created. Filed on disk, untracked.
