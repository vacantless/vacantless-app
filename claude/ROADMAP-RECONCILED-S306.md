# Vacantless roadmap, reconciled - S306 (2026-08-28)

**This supersedes the split between `PRODUCT-ROADMAP-SOURCE-OF-TRUTH-S596` (2026-07-29) and `VACANTLESS_SYNDICATION_ROADMAP_2026-08-22-S234`.** Those two documents were both live, neither referenced the other, and a month of sessions ran in a lane the first one does not sequence at all. Read this one; treat the other two as the source material they now are.

## Why the reconciliation was needed

- S596 calls itself "the single place to sequence work." Its suggested sequence is dogfood maintenance, then per-org entitlements, then receipt vault, then move-in/out.
- **Its item 1 was completed in S599 on 2026-07-29 and the doc was never updated.**
- Items 2 to 4 have not been touched in a month.
- Every session since has been in distribution, which S596 lists only as "4 landlord drafts awaiting Noam's click."
- S234 sequences distribution properly but says nothing about the rest of the product.

## The evidence that should drive sequencing

Read from production 2026-08-28, not from any doc.

**The product has one live workflow.** Agile Real Estate Group produced 105 of the last 106 leads across all 14 orgs. Everything else is near-zero.

| surface | rows all-time | last 30 days |
|---|---|---|
| leads | 219 | 106 |
| showings | 99 | 45 |
| distribution_run_items | 79 | 42 |
| tenancies | 22 | 0 |
| trade_contacts | 8 | 0 |
| **work_orders** | **1** | **0** |

The single work order is our own S599 dogfood row, still undeleted. Six orgs hold 21 real tenancies between them and generate no product activity at all.

**Two populations, one served.** Agile is leasing-heavy: 5 properties, 0 tenancies, 105 leads a month. Everyone else is tenancy-heavy and quiet: Abbas 11 tenancies, David 4, Davis Muscovitch 3, and no leads between them.

## The sequence

### 0. Close S306 (mechanical)
`bash "Agile Lead to Lease Engine/FILE-S306-DOCS.sh" preview` then `apply`. One command.

### 1. Turn attribution on. Highest value, lowest cost, not a build.
The per-post tracked link is built end to end and **has never been used once**: 0 of 105 leads carry a `listing_post_id`. See `FINDINGS-S306-ATTRIBUTION-BUILT-AND-NEVER-USED.md`. Two actions: make the tracked link the default "Copy link" on the Get online card, and re-point the four live Facebook ads.

**Everything below is unjudgeable until this is done.** We cannot say what a channel is worth, which is the exact question the distribution lane exists to answer.

### 2. Surface lapsed channels.
Three portals on a live available unit went `expired` on 2026-07-24/25 and the product said nothing for five weeks. S670 stopped the UI claiming `live` without proof; nothing yet makes it say "this went dark." Same family, opposite direction. Ticket-sized.

### 3. Wire the launch-coverage taxonomy.
`lib/distribution-launch-coverage.ts` shipped in S304 with the correct channel classification and has two consumers, itself and its own test. Every operator gate still branches on `mode === "api_automatic"`, so the authorize control renders for the two channels the worker has never run and none of the five it has. Ticket exists: `CODEX-PROMPT-S305-PUBLISH-RAIL-READS-LAUNCH-COVERAGE.md`. This is honesty, not automation.

### 4. Then, and only then, decide the Kijiji proof ladder.
S306 put Kijiji at rung 3 of 8 (authenticated dry run, no post). Rungs 4 to 8 remain. **Do not take rung 4 before step 1**, because rung 4 spends a real live post to prove a channel whose value we still cannot measure, and because Kijiji is paid-only by the S667 decision while the lane we proved is the free one and `requires_payment = false` in both orgs. Resolve that contradiction as part of the decision.

Also unresolved for rung 4: Growth Test's `5a1e0c7d` shares the address string `833 Pillette Rd, Unit 3, Windsor` with Agile's real Unit 3.

### 5. The tenancy side needs a demand test, not a build.
21 tenancies, 1 work order ever, 0 trade contacts we did not seed ourselves. The maintenance module is built, tiered, and proven at runtime (S599). It is not unproven; **it is unused**. Building the receipt vault, move-in/out checklist or utilities checklist on top of an unused module adds surface, not revenue.

The cheapest available demand test is already written and parked: **the four landlord first-touch drafts (David, Paul, 1 Bloor, Cunningham) awaiting Noam's click.** Send those before building anything else here.

### 6. Deferred, unchanged
Per-org entitlement layer, jurisdiction rules engine, smart-lock reminder, commercial channels (sequenced after residential per `DECISION-S305-COMMERCIAL-HEADLESS-AFTER-RESIDENTIAL.md`), realtor.ca (lawyer-gated), Meta App Review (in review, FB Page context blocks Marketplace measurement).

## The standing method, unchanged and reaffirmed twice today

**DESIGN -> WARM-VERIFY -> scoped Codex prompt -> Noam reviews and pushes -> verify LIVE.**

S306 nearly wrote a build ticket for attribution that already existed, and S596 recorded the same failure on the maintenance module (KI949). Warm-verify is not a formality; it has now changed the plan twice on the two largest items either roadmap contained.

## What must not happen

- No price drafting. Pricing at 833 Pillette is Narayan and Aaliyah's, and so are the leads.
- No live post without deciding the target first.
- No new build on the tenancy side before the four drafts go out.
