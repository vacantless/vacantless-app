# Review: codex/s670-autopilot-mobile-ui (UX/copy QA)

Session 670, 2026-08-20 EDT. Scope as asked: UX and copy only, no new posting behavior.

## What is actually being reviewed

The branch is **local and uncommitted**. `codex/s670-autopilot-mobile-ui` is checked out on the Mac at HEAD `3cabc01`, which is the same sha as `origin/main` and as PROD. There are no commits on the branch and nothing is pushed to origin. The review target is the working-tree diff:

```
app/dashboard/properties/[id]/distribute-tab.tsx | 224 +++++++++---------
app/dashboard/properties/page.tsx                | 183 ++++++++++---
scripts/test-distribution-run.ts                 |  17 +-
3 files changed, 302 insertions(+), 122 deletions(-)
```

**Boundary check passes structurally.** No server action, no gate, no publish path, no migration is touched. Two presentational files and one source-assertion test. Proof-before-Live, paid approval, login and operator-confirmation logic is all untouched, and the copy that carries those boundaries still exists in `launch-run-panel.tsx` (lines 291, 310, 322, 761), `publish-everywhere.tsx` (1048) and `copilot-panel.tsx` (278).

Every problem below is a copy or placement problem, not a behavior problem.

---

## Blockers

### B1. "Live on N sites" is counted from unfiltered `listing_posts` rows

`app/dashboard/properties/page.tsx:245-250` builds `postCounts` from every `listing_posts` row for the org with no status filter and no ad-URL filter. `rentalLaunchState` then renders that number as `Live on 3 sites` with the detail `Saved ad links are tracked` (lines 142-148).

The detail page does not agree with itself here. `distribute-tab.tsx:458-460` computes `liveChannels` as `channelCards.filter(c => c.status.value === "posted")`, which is the proof-gated count, and shows it as the "Proof saved" bucket. So the list view and the page it links to will show different numbers for the same rental, and the list view is the optimistic one.

**Measured against production on 2026-08-21, this understates the problem. Seven properties across five orgs would display a wrong count:**

| org | property | list would say | actually live | rows |
|---|---|---|---|---|
| Agile Real Estate Group | 833 Pillette Rd Unit 20 | **Live on 5 sites** | **1** | facebook=live, kijiji=draft, kijiji=expired, rentals_ca=expired, zumper=expired |
| Growth Test | 833 Pillette Rd Unit 3 | Live on 5 sites | 2 | facebook=draft, facebook_feed=live, instagram=removed, instagram=live, kijiji=draft |
| Abbas Husain | 50 Glenrose Ave Unit 4 | **Live on 2 sites** | **0** | facebook=expired, kijiji=expired |
| Agile Real Estate Group | 833 Pillette Rd Unit 3 | Live on 2 sites | 1 | facebook=live, kijiji=draft |
| North Star Rentals QA | 833 Pillette Road | Live on 2 sites | 0 | kijiji=removed, kijiji=removed |
| Davis Muscovitch Rentals | 2419 Mercer Street | **Live on 1 site** | **0** | kijiji=draft |
| Maple Door Rentals | 343 Berkeley St Main Floor | **Live on 1 site** | **0** | kijiji=draft |

Worst case is a live customer's best-performing unit overstating by 5x. Three properties would claim Live while zero ads are live. A `draft` row counts, and a draft was never posted anywhere.

This is the one finding that breaks proof-before-Live at the copy layer. A row asserts a live external ad on evidence that is only the presence of a database row.

**Fix, and there is a trap in the obvious version.** Do NOT simply add `.eq("status","live")` to the `postRefs` query. That same `postCount` feeds `hardDeletable(...)` (`lib/property-archive.ts:15-27`), which requires `postCount === 0` as a deletion **safety guard** so a property with any posting history cannot be hard-deleted. Filtering the shared query would make every property whose ads have since expired newly hard-deletable and would destroy real posting history.

Keep two counts derived from one query: `postCount` unchanged for `hardDeletable`, and a new `livePostCount` filtered to `status = 'live'` used only for the label. Also handle the newly visible state where `livePostCount` is 0 but `postCount` is not: that rental is Live with no active ad anywhere, which is worth saying out loud.

Full build spec: `claude/CODEX-PROMPT-S670-AUTOPILOT-UI-REVIEW-FIXES.md`.

### B2. "Autopilot running" never checks that anything is automatic

`distribute-tab.tsx:1572-1596`:

```
const attentionCount = automationSummary.oneTap + automationSummary.needsRefresh + automationSummary.blocked;
...
: hasRun ? (attentionCount > 0 ? "Autopilot needs one tap" : "Autopilot running")
```

with the detail `Vacantless is tracking each channel and will only interrupt for proof, login, payment, or approval.`

"Autopilot running" is derived purely from the *absence* of attention items. It is never derived from the presence of an automated one. Trace `automationStatusForItem` in `lib/distribution-run.ts`: an item with `status === "live"` and `mode !== "automatic"` returns state `processing`, label "Live with proof". That is a channel the operator posted **by hand** and pasted a proof link for. It contributes zero to `attentionCount`.

So the common case reads wrong: an operator who manually posted every channel and saved every proof link sees "Autopilot running" and is told Vacantless is tracking the channels. Nothing automatic happened. The all-`skipped` case produces the same false positive.

`automationSummary.liveAuto` is the field that would make the claim true. It is passed into the card and never read.

**Fix:** gate the word on `automationSummary.liveAuto > 0`. Something like: `liveAuto > 0` gives "Autopilot running"; `processing > 0` with `liveAuto === 0` gives "Tracking your posts"; otherwise "Run in progress".

### B3. The unconditional disclaimer is deleted, and the test now enforces its absence

The old card carried a permanent badge reading `No automatic posting`. The new card drops it, and `scripts/test-distribution-run.ts:400` now asserts `!distributeSource.includes("No automatic posting")`. That is not incidental removal, it is a locked-in removal, so it should be a decision made on purpose rather than a side effect of the redesign.

What replaces it is conditional. `distribute-tab.tsx:606` ("You still approve any outside-site post or payment, and a site counts as Live only after the real ad link is saved") renders only when a run exists and there is a next action. Line 1708 ("Submitted channels still require proof before they read as Live") renders only when `blockers.length === 0`.

The uncovered state is the first-run operator: no run yet, blockers outstanding. That person sees `Autopilot almost ready` and `Fix the required blockers once; Vacantless handles the channel routing after that.` with no qualifier anywhere on the card.

That sentence is also the strongest single overpromise in the diff. Automatic posting is double-gated by `AUTO_DISTRIBUTION_ENABLED` plus `AUTO_DISTRIBUTION_ORG_ALLOWLIST` (`lib/auto-distribution.ts:47-55`), and instant publish additionally requires authorization. The card is handed no signal about either, so it makes the same promise to an allowlisted org and to one where nothing will ever post itself.

**Fix:** put one always-visible line on the card that survives every branch, and soften the blocked-state detail. "Vacantless handles the channel routing" overclaims; "Vacantless prepares each channel and tells you the one step it needs" matches what the code does.

---

## Structural: the card is right, the placement is wrong

**Direct answer to "is the Autopilot launch card the right first read": no, because on the default path it is not read at all.**

`AutopilotLaunchCard` is rendered inside `advancedTools` (`distribute-tab.tsx:555-557`). That subtree reaches the screen only if both of these hold:

1. `publishSimpleDefaultEnabled === false` (line 824). When the flag is true, the component returns `publishEverywhereSurface` directly and `advancedTools` is never rendered. The flag is `process.env.PUBLISH_SIMPLE_DEFAULT_ENABLED === "true"` (`app/dashboard/properties/[id]/page.tsx:2203-2204`).
2. The operator has switched `GetOnlineView` into "advanced". That component defaults to `simple` unless `orgDefaultMode === "advanced"` or `localStorage["vacantless.getonline.mode"]` says advanced.

So the card sits behind a mode toggle behind an env flag. If `PUBLISH_SIMPLE_DEFAULT_ENABLED` is true in production, this entire redesign is unreachable code.

Worth settling before merge: what is that env var set to on the production deployment? If the goal is an automation-first cockpit for iPad, the cockpit needs to be on the default surface, which today is `PublishEverywhere`.

As a card in isolation the design is good. Headline, one primary action, four counters, one blocker line is the right shape for a tablet, and the primary action correctly retargets through basics, photos, Set Live and then the run.

---

## Clarity issues

**C1. Draft rows say "Ready to launch" when the next required step is Set Live.** `page.tsx:132-140`: once basics and photos pass and the status is not publicly bookable, the row reads `Ready to launch` / `Details and photos are ready` / `Launch autopilot`. Set Live is not mentioned. The old code had an explicit `Set Live to share your link` hint and this diff deletes it. Either name Set Live in the detail or label the action `Set Live` and point at `#publish-action`.

**C2. Every "launch" verb is a scroll.** `Launch autopilot`, `Start distribution` and `Start autopilot` are all anchor navigations (`#distribute-header`, `#publish-checklist`). Nothing starts. On desktop the page-jump makes that obvious quickly; on an iPad, where the destination fills the screen, an operator can reasonably believe they just kicked something off. `Open autopilot` or `Set up autopilot` costs nothing and is true.

**C3. Leased and paused rows now say it three times.** The row renders the existing `StatusChip` ("Paused"), plus the new launch chip ("Paused"), plus the sentence "Paused - not accepting inquiries", plus a Review button. Four elements, three carrying the same word. This is the densest part of the row and the change is aimed at narrow screens. Suppress the launch chip when its label duplicates the StatusChip.

**C4. Two readiness widgets in one row can contradict each other.** `rentalLaunchState` checks address, rent, beds, baths, photos. The adjacent `rentalRowReadiness` strip (`page.tsx:440-448`) also checks description and availability windows. A rental with no description and no viewing windows gets `Ready to launch` from one widget and a warning from the other, side by side. Feed the launch state the same inputs, or have it defer to the readiness result.

**C5. "Autopilot set: N selected for launch"** labels every selected channel as automated. Most are guided or manual. `Channels selected` says the same thing without the claim.

---

## Test note

`scripts/test-distribution-run.ts:235` changes the assertion from `panelSource.includes("More sites")` to `"Other tracking"`. `launch-run-panel.tsx` is not modified by this branch and already contains "Other tracking" and no "More sites". That means the old assertion was already failing on main and this branch fixes it incidentally. Not a problem, but confirm it is deliberate rather than a copied-over edit, because it means the distribution test was red before this work started.

I did not execute the suite. The three new assertions check out by inspection against the current file contents.

---

## Summary

| | |
|---|---|
| Boundaries preserved | Yes. No gate, action or publish path touched. |
| Row states clear | Mostly, with C1, C3 and C4 to fix. |
| Dynamic CTAs match behavior | No. C2, and B1's label overstates evidence. |
| Autopilot card the right first read | Right card, wrong place. Unreachable on the default path. |
| Anything overpromises automatic posting | Yes. B2 and B3. |

Recommend not merging until B1, B2 and B3 are addressed. They are all copy-layer or one-line-count fixes, so this is a short pass, not a redesign.
