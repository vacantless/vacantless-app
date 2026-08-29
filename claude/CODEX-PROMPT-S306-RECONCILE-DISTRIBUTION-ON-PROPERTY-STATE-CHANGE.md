# CODEX PROMPT S306: close distribution items when the property leaves the market

Repo: vacantless-app
Evidence: claude/FINDINGS-S306-DISTRIBUTION-ITEMS-SURVIVE-THE-PROPERTY-LEAVING-MARKET.md

## The gap

Nothing reconciles distribution state against property state. A property can go `leased` and
its distribution items stay `queued`, waiting for an operator approval that would post an ad
for a unit already rented. Read 2026-08-29: 50 Glenrose Unit 5 is `leased` with a `queued`
concierge kijiji item, and 833 Pillette Unit 30 is `off_market` with a `queued` concierge
facebook item. Seven such items exist across four orgs.

Nothing has fired them only because the concierge lane needs an approval nobody gave. The
safety is an accident of the gate, not a rule the system enforces.

## Part 1: reconcile on status change

When a property's `status` changes to `leased`, `off_market` or `paused`, cancel its open
distribution items (`queued`, `needs_operator`, `submitting`) with a cancellation reason
naming the property state change, and record who or what triggered it. Do not silently
delete rows; a cancelled item with a reason is auditable, a vanished one is not.

Leave `live` items alone. A live ad needs a takedown decision, which is a different flow with
different consequences, and conflating the two would make a status edit tear down live
marketing. Surface them to the operator instead: "this property is now leased and still has
N live channel(s)."

## Part 2: a standing reconciliation read

The change above only fires going forward. Add a check that finds the existing drift and any
that reappears: items in actionable states whose property is not `available`. Put it where an
operator sees it, not in a cron that writes to a table nobody reads. The freshness cron is
the cautionary example: it has written `stale` on 50 Glenrose Unit 4 **337 times** and the
item still reads `live` against an `expired` listing_posts row.

## Part 3: decide the `vacantless` channel question, once

Five leased or off-market properties still carry a `live` item on the `vacantless` channel,
which is the `/r` public landing page. That may be deliberate, since a page saying "no longer
available" beats a dead link. Decide it explicitly and encode the decision, so this stops
looking like drift on every future audit. Whichever way it goes, write the reasoning in the
code near the check.

## Constraints

- Cancellation writes must be scoped to the property whose status changed. No bulk sweeps.
- Do not touch `live` items in the automatic path.
- The existing seven drifted items are customer data. Ship the mechanism; the backfill is a
  separate operator-approved action.

## How to verify

Set a test property to `leased` with a queued item on it. Expect the item cancelled with a
reason, and no change to any `live` item. Then set it back to `available` and confirm the
cancelled item is NOT resurrected, since re-listing should be an explicit act.
