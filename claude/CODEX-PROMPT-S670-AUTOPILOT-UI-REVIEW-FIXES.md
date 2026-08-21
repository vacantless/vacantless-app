# Codex: S670 autopilot mobile UI, review fixes (B1, B2, B3)

Branch under review: `codex/s670-autopilot-mobile-ui`.
Full review: `claude/REVIEW-S670-AUTOPILOT-MOBILE-UI.md`.
Root-cause context you will need for B1: `claude/FINDINGS-GLENROSE-4-FACEBOOK-STUCK-LIVE-S670.md`.

## READ THIS FIRST, IT DETERMINES WHETHER YOU CAN START

As of 2026-08-21 the S670 UI work is **UNCOMMITTED in Noam's working tree**. The branch
`codex/s670-autopilot-mobile-ui` points at `3cabc01`, identical to `main`, and the three changed
files exist only as unstaged edits:

- `app/dashboard/properties/[id]/distribute-tab.tsx`
- `app/dashboard/properties/page.tsx`
- `scripts/test-distribution-run.ts`

**Noam must commit and push that branch before you are pointed at it.** Do not start against a
branch that does not contain the work; every line number below refers to the edited files, not to
`main`. This is the S668 anchor mistake and it is not to be repeated.

State to build on: PROD `3cabc01`. Database head is **0220** (0220 revoked service_role's TRUNCATE
on `renter_reply_ingests` on 2026-08-21). No migration is needed for anything here. All three fixes
are presentation-layer only.

## Scope

Fix three blockers. **Do not add, change, or gate any posting behaviour.** Proof-before-Live, paid
approval, login, and operator-confirmation boundaries must come out exactly as they went in. The
review confirmed the branch does not touch any server action, gate, or publish path; keep it that way.

---

## B1. The Rentals list claims listings are Live on evidence it does not have

`app/dashboard/properties/page.tsx` builds `postCounts` from **every** `listing_posts` row for the
org, with no status filter (around line 273). `rentalLaunchState` then renders that number as
`Live on N sites` with the detail `Saved ad links are tracked`.

The detail page does not agree with itself. `distribute-tab.tsx` computes `liveChannels` as
`channelCards.filter(c => c.status.value === "posted")`, the proof-gated count. So the list and the
page it links to show different numbers for the same rental, and the list is the optimistic one.

**This is not hypothetical. Measured against production on 2026-08-21, seven properties across five
orgs would display a wrong count:**

| org | property | list would say | actually live | rows |
|---|---|---|---|---|
| Agile Real Estate Group | 833 Pillette Rd Unit 20 | **Live on 5 sites** | **1** | facebook=live, kijiji=draft, kijiji=expired, rentals_ca=expired, zumper=expired |
| Growth Test | 833 Pillette Rd Unit 3 | Live on 5 sites | 2 | facebook=draft, facebook_feed=live, instagram=removed, instagram=live, kijiji=draft |
| Abbas Husain | 50 Glenrose Ave Unit 4 | **Live on 2 sites** | **0** | facebook=expired, kijiji=expired |
| Agile Real Estate Group | 833 Pillette Rd Unit 3 | Live on 2 sites | 1 | facebook=live, kijiji=draft |
| North Star Rentals QA | 833 Pillette Road | Live on 2 sites | 0 | kijiji=removed, kijiji=removed |
| Davis Muscovitch Rentals | 2419 Mercer Street | **Live on 1 site** | **0** | kijiji=draft |
| Maple Door Rentals | 343 Berkeley St Main Floor | **Live on 1 site** | **0** | kijiji=draft |

Worst case is a live customer's best-performing unit overstating by 5x. Three properties would claim
Live while **zero** ads are live. A `draft` row counts today, and a draft was never posted anywhere.

### THE TRAP. Read this before you touch the query.

**Do NOT fix this by adding `.eq("status", "live")` to the `postRefs` query.** That same
`postCount` is passed to `hardDeletable(p.status, leadCount, tenancyCount, postCount)`
(`lib/property-archive.ts:15-27`), which requires `postCount === 0`. It is a deletion **safety
guard**: a property with any posting history at all, including expired and draft rows, must not be
hard-deletable. Filtering the shared query to live-only would make every property whose ads have
since expired newly hard-deletable and would destroy real posting history.

### Required shape

Keep two separate counts:

- `postCount` -> **unchanged**, every row, continues to feed `hardDeletable`. Do not touch it.
- `livePostCount` -> `listing_posts` rows for that property whose `status = 'live'`, used **only**
  for the launch-state label.

Select `status` alongside `property_id` in the existing `postRefs` query and derive both maps from
one result set. Do not add a second round trip.

Then in `rentalLaunchState`, use `livePostCount` for the `Live on N sites` branch. If
`livePostCount` is 0 but `postCount` is greater than 0, the rental is Live with **no** live ad
anywhere, which is a real and actionable state: label it as such (for example `Live, no active ads`
with action `Start distribution`) rather than silently falling through to a generic branch.

Add a test asserting that a property with two expired rows does not report any site as live.

---

## B2. "Autopilot running" is never checked against anything actually being automatic

`distribute-tab.tsx`, in `AutopilotLaunchCard`:

```
const attentionCount = automationSummary.oneTap + automationSummary.needsRefresh + automationSummary.blocked;
...
: hasRun ? (attentionCount > 0 ? "Autopilot needs one tap" : "Autopilot running")
```

with the detail `Vacantless is tracking each channel and will only interrupt for proof, login,
payment, or approval.`

The label is derived purely from the **absence** of attention items, never from the presence of an
automated one. In `lib/distribution-run.ts`, `automationStatusForItem` returns state `processing`
for an item with `status === "live"` and `mode !== "automatic"` (label "Live with proof"), which is
a channel the operator posted **by hand** and pasted a proof link for. It contributes zero to
`attentionCount`. So the common manual case reads "Autopilot running" while nothing automatic ever
happened. An all-`skipped` run produces the same false positive.

`automationSummary.liveAuto` is the honest field, it is already passed into the card, and it is
never read.

### Required shape

Derive the label from what is actually true:

- `liveAuto > 0` -> "Autopilot running" is earned.
- `liveAuto === 0` and `processing > 0` -> something is in flight but nothing is automatic. Use
  wording like "Tracking your posts".
- otherwise -> "Run in progress".

Keep "Autopilot needs one tap" for `attentionCount > 0`. Adjust the detail sentence to match each
case; the current one promises tracking-and-interruption that only holds for the automatic case.

Add tests covering: all-manual-live reads as tracking not autopilot; at least one `liveAuto` reads
as autopilot; all-skipped does not read as running.

---

## B3. The only unconditional disclaimer was deleted, and a test now enforces its absence

The previous card carried a permanent `No automatic posting` badge. The branch removes it and
`scripts/test-distribution-run.ts` now asserts `!distributeSource.includes("No automatic posting")`.

What replaces it is conditional and leaves a gap:

- `distribute-tab.tsx:606` ("You still approve any outside-site post or payment, and a site counts
  as Live only after the real ad link is saved") renders only when a run exists **and** there is a
  next action.
- The line at the bottom of the card ("Submitted channels still require proof before they read as
  Live") renders only when `blockers.length === 0`.

The uncovered state is the first-time operator: no run yet, blockers outstanding. That person sees
`Autopilot almost ready` and `Fix the required blockers once; Vacantless handles the channel routing
after that.` with no qualifier anywhere.

That sentence is also the strongest overpromise in the branch. Automatic posting is double-gated by
`AUTO_DISTRIBUTION_ENABLED` **and** `AUTO_DISTRIBUTION_ORG_ALLOWLIST` (`lib/auto-distribution.ts:47-55`),
and instant publish additionally requires authorization. The card receives no signal about either,
so it makes an identical promise to an allowlisted org and to one where nothing will ever self-post.

### Required shape

1. Add **one always-visible line** on the card that survives every branch of `launchLabel` and
   `blockers`. It must state plainly that Vacantless prepares each channel, that outside-site posts
   need the operator, and that a site counts as Live only once real ad proof is saved.
2. Soften the blocked-state detail. "Vacantless handles the channel routing after that" overclaims.
   Something like "Vacantless prepares each channel and shows you the one step it needs" matches
   what the code does.
3. Leave the test assertion in place if the new wording is genuinely unconditional; if you keep any
   variant of the old badge, update the assertion rather than leaving a contradiction.

---

## Also worth doing while you are in these files, lower priority

- **C1.** Draft and off-market rows read `Ready to launch` / `Details and photos are ready` /
  `Launch autopilot`, but the actual next required step is Set Live, which is not mentioned. The old
  code had an explicit `Set Live to share your link` hint and the branch deletes it.
- **C2.** `Launch autopilot`, `Start distribution` and `Start autopilot` are all anchor navigations,
  not actions. `Open autopilot` or `Set up autopilot` is true and costs nothing.
- **C3.** Leased and paused rows now render the StatusChip, the new launch chip, a sentence, and a
  Review button, three of which say the same word. Suppress the launch chip when it duplicates the
  StatusChip. This is the densest part of the row on the iPad widths this branch targets.
- **C4.** `rentalLaunchState` ignores description and availability windows, which the adjacent
  `rentalRowReadiness` strip does check, so the two widgets in one row can contradict each other.

## Structural question for Noam, not for you to decide

`AutopilotLaunchCard` renders only inside `advancedTools`, which requires
`publishSimpleDefaultEnabled === false` **and** the operator to have switched `GetOnlineView` into
advanced mode (it defaults to simple). If `PUBLISH_SIMPLE_DEFAULT_ENABLED` is `true` in production,
this entire card is unreachable. Do not restructure the surface to fix that. Flag it and stop.

## Verification required before you hand back

- `npx tsc --noEmit` clean.
- `npx tsx scripts/test-distribution-run.ts` -> note that this suite is **already red on `main`**,
  85 passed / 1 failed, on the assertion `panelSource.includes("More sites")` while
  `launch-run-panel.tsx` says "Other tracking". The S670 branch already fixes that incidentally.
  Confirm you end at 0 failures, and say so explicitly.
- `npx tsx scripts/test-distribution-freshness.ts` -> expect 35 passed, 0 failed.
- State plainly which of B1, B2, B3 you completed and which you did not.

## Constraints

- No new posting behaviour. No migration. No change to any gate.
- Do not touch `postCount` or `hardDeletable`.
- No em dashes in copy or comments.
