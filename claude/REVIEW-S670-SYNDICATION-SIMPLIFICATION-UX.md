# S670 syndication simplification: UX/copy review

Read-only QA, 2026-08-21. Abbas Husain org, 50 Glenrose Ave Unit 4
(`7886fe96-865f-4dc7-86b8-e2acd0138047`), against `http://localhost:3011`.

## Scope, and two corrections to the brief

**Reviewed the WORKING TREE, not `9bc4486`.** The "Other tracking" alignment is not committed
or pushed: local and origin are both still at `9bc4486`, and `launch-run-panel.tsx` plus
`scripts/test-distribution-run.ts` are uncommitted modifications. Per your own precondition the
commit pin is not valid yet. The working tree does have the right content.

**This branch does not contain the Rentals launch-queue redesign.** `rentalLaunchState` has zero
occurrences here; that work is on `codex/s670-autopilot-mobile-ui`. So QA item 1 splits, below.

Guardrails held: read-only throughout, `SELECT` queries only, nothing posted, no photo changes,
no status changes, no writes. Org header read as **Abbas Husain** before anything else.

---

## BLOCKER

### B-1. A listing with zero live ads says "You're online" and "You're live on 2 channels"

On one screen, roughly three inches apart:

- `Ready to syndicate` · **`0 sites posted`**
- `You're online` · **`You're live on 2 channels.`** · **`2/14 reaching renters`**

Glenrose Unit 4 has **no live external ad at all**. Both `listing_posts` rows are `expired`.

The count comes from `buildChannelPublishRailBuckets` in `channel-publish-rail.tsx`, which seeds
its list with two **synthetic** rows before any real channel is considered:

```js
const instant = [
  syntheticRow("vacantless_page", "Vacantless page", input.linkIsLive),
  syntheticRow("email_alerts",   "Email alerts",     input.linkIsLive),
];
...
liveCount: [...].filter(row => row.reachesRenters).length
```

Both are driven by `linkIsLive`, the Vacantless-hosted renter page. So "2 channels" means
"our own page is up, and email alerts are on". Neither is syndication. `liveChannelKeys` IS
correctly proof-gated (`status.value === "posted"`), so the real external count is 0 and the
headline still reads 2.

This is the exact "Live on X channels vs Proof saved on Y sites" conflict the brief asked me to
watch for. It is also the same failure as the Glenrose stuck-live bug found earlier today, but
from the other direction: not stale data, a definition that flatters.

**Fix:** either exclude the synthetic rows from `liveCount`, or say what they are. "Your renter
page is live. 0 outside sites posted." is true and is the sentence an operator needs.

### B-2. The lifecycle rail says "2 posts" for two expired ads

The "Where this rental is" rail reads **`Market — Live · 11 photos · 2 posts`**. Both posts are
expired. This is the same unfiltered `listing_posts` count that was fixed on the other branch
(`postCounts` vs `livePostCounts`), still unfixed here in a different component. The two branches
will disagree with each other on the same property until this one is aligned.

---

## HIGH

### H-1. Get online sits 1055px down the page

Measured: the tab bar's top is **1055px** from page top. On a phone that is more than a full
screen of scrolling before the operator can even see the tab that contains syndication. Above it
sit the property header, a "Duplicate this property" button, the amber vacancy-cost banner, and
the seven-step lifecycle rail. This is the single biggest miss against "Get online should be
usable without hunting".

### H-2. The tab bar clips Get online at phone width

Measured at a 606px viewport: bar `clientWidth` 558, `scrollWidth` 686, so it already scrolls.
Tab widths: Edit listing 125, Listing assets 147, **Get online 122**, Safety & appliances 166,
Renters 109. Total 670px.

Cumulative offsets put **Get online at 272–394px**. At a 375px phone viewport its right edge is
cut off, and **Renters (ending at 669px) is entirely invisible**. The bar is
`overflow-x-auto` with `shrink-0 whitespace-nowrap`, so the page does not overflow, but there is
**no fade or arrow affordance**, so nothing signals that more tabs exist.

At 834px (iPad portrait) everything fits: client 786, scroll 786, no overflow. **The problem is
phone-only.**

### H-3. Tab order puts the secondary surface before the primary one

Order is Edit listing, **Listing assets**, **Get online**, Safety & appliances, Renters. The brief
says Get online should be primary and Listing assets secondary, but assets comes first and is the
wider of the two (147 vs 122), which is precisely why Get online is the one that gets clipped.
Moving Get online to position two fixes H-2 and H-3 together.

---

## MEDIUM

- **M-1. Get online is never the default tab.** `defaultTab = requestedTab ?? (setUpOpen ? "setup" : marketOpen ? "market" : inquiriesOpen ? "inquiries" : "market")`. `distribute` only appears when `?tab=distribute` is passed. Arriving from a lead, a search, or a bookmark lands away from syndication. For a Live listing, distribute is the better default.
- **M-2. First screen is spent before syndication starts.** Vacancy-cost banner plus a seven-step rail in two rows. On a phone the rail alone is most of a screen.
- **M-3. "Duplicate this property" is top-level**, sitting beside the rent, above everything about getting the listing online. Odd prominence for a rare action.

---

## Verified good

| brief item | result |
|---|---|
| Row CTA lands on Get online, not Listing assets | **Fixed.** Both CTAs are `?tab=distribute#distribute-header`. |
| Photos compact when present, Manage opens full tools | **Fixed.** `defaultOpen = photoCount === 0`. Verified live: Glenrose has 11 photos and the `<details>` reads `open: false`. |
| Glenrose should not show the long photo grid by default | **Confirmed on the actual property.** |
| Public page live vs external proof saved | **Distinguished** in `distribute-tab.tsx` (`Proof saved on N sites` / `Public page live`) and `publish-everywhere.tsx`. Zero `Live on` strings remain there. Undone by B-1 elsewhere on the same screen. |
| Marketing kit, listing copy, portal paste sheet not first-scroll | **Fixed.** All are `<details>`. |
| Listing assets secondary | Partly. It is a tab and never a default, but it sits ahead of Get online (H-3). |
| No horizontal page overflow | **Confirmed** at 606px and 834px: `scrollWidth === clientWidth`, zero over-wide elements. |
| Deep links still reach collapsed content | **Confirmed.** `id="property-photos"` moved onto the `<details>`, and `SectionDeeplinkOpener` opens `<details>` ancestors and the target itself. |

One honesty gain worth protecting: the tooltip **"Get this listing online. Nothing is posted
automatically."** still exists on this branch. The autopilot branch deletes it.

---

## Is this simple enough for the first mobile syndication pass?

**Not yet, on two counts.**

The iPad case is close. At 834px there is no overflow, the tabs fit, photos are collapsed, and
the assets panels are tucked away. Fix H-1 and it is genuinely usable.

The phone case is not there: Get online is clipped in the tab bar, a whole tab is invisible with
no affordance, and the surface is a full screen of scrolling below the fold.

**B-1 is the one that should block regardless of screen size.** An operator looking at Glenrose
Unit 4 today is told they are online and live on 2 channels, when the listing has no live ad
anywhere. That is worse than a layout problem, and it is the same class of error as the stuck
`live` row found on this property this morning.

Smallest set that would flip the verdict: exclude synthetic rows from `liveCount` (B-1), use the
proof-gated count in the lifecycle rail (B-2), move Get online to tab position two (H-2/H-3), and
lift the tab bar above the lifecycle rail (H-1).
