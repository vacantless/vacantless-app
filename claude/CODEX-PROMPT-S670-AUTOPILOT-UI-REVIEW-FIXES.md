# SUPERSEDED, 2026-08-21. Do NOT hand this to Codex as written.

**B1, B2 and B3 were already fixed by Noam on `codex/s670-autopilot-mobile-ui` at `69ca0bb`
before this prompt was ever run.** Running it would send a builder to redo finished work and
would likely undo the fixes. Verified against the pushed sha, not the working tree.

This file is kept because the reasoning behind each fix is still the record of why the code
looks the way it does, and because the one genuinely open item is at the bottom.

## What was already done on 69ca0bb [verified 2026-08-21 against origin]

| item | state | evidence |
|---|---|---|
| **B1** unfiltered Live count | **FIXED, correctly** | `page.tsx` now selects `("property_id, status, url")` once and derives BOTH `postCounts` (unfiltered) and `livePostCounts` (status='live'). `hardDeletable` still receives the unfiltered count, so the deletion-safety guard is intact. That was the trap and it was avoided. |
| **B2** "Autopilot running" | **FIXED** | `distribute-tab.tsx:1575` `const hasAutomaticWork = automationSummary.liveAuto > 0;` The label is now derived from an actually-automatic item, which is what the review asked for. |
| **B3** deleted disclaimer | **ADDRESSED** | `"Outside-site posts, paid submits"` line present. |
| **C1** draft rows silent on Set Live | **FIXED** | `"Ready for Set Live"` / `"Open Set Live"`. |
| **C2** verbs promising action | **FIXED** | `Launch autopilot`, `Start distribution`, `Start autopilot` all gone. Now `Open autopilot`, `Open distribution`, `Open Set Live`. Zero occurrences of the old strings. |
| **C5** "Autopilot set" overclaiming | **FIXED** | now `Channels selected`. |

The `livePostCount === 0 && postCount > 0` case falls through to `Live, not distributed` /
`Open the channel run`, which no longer overstates. It does not distinguish "never distributed"
from "had ads, all now dead". That is a nicety, not a defect.

---

# THE ONE REAL OPEN ITEM: two branches merge to a RED test, silently

**This is proven by trial merge, not predicted.**

Two branches now exist off `main` (`d8b4879`):

- `codex/s670-autopilot-mobile-ui` @ `69ca0bb`
- `codex/s670-tab-nav-and-syndication-copy` @ `9bc4486`

They resolve the SAME pre-existing inconsistency in OPPOSITE directions:

| branch | what it changes | result |
|---|---|---|
| `s670-tab-nav-and-syndication-copy` | the **UI**: `launch-run-panel.tsx:490` `Other tracking` -> **`More sites`** | existing test passes |
| `s670-autopilot-mobile-ui` | the **test**: `test-distribution-run.ts:235` asserts **`Other tracking`** | test passes against unchanged UI |

Each branch is green on its own. Merged together the UI says `More sites` and the test demands
`Other tracking`.

**They touch DIFFERENT FILES, so git auto-merges them with no conflict and no warning.** The
failure only shows up when the suite is next run, with nothing in the merge to explain it.

Trial merge result, `main` + tab-nav + autopilot-ui:

```
distribution-run: 86 passed, 1 failed
  ✗ site picker and active run list stay compact when sites grow
```

There is also **one loud conflict**, in `app/dashboard/properties/page.tsx`. That one is fine,
because git stops and asks. The silent one above is the hazard.

### Fix before merging either branch

Pick one wording and make both sides agree. Two lines total.

`Other tracking` is the better label on the merits: those rows are channels being tracked, not
additional sites to go post on, and `More sites` invites a click that leads to tracking rather
than posting. If you keep `Other tracking`, revert the one-line UI change on
`s670-tab-nav-and-syndication-copy` and keep the UI branch's test assertion as-is.

### Suggested merge order

1. Settle the wording on both branches.
2. Merge `s670-tab-nav-and-syndication-copy` first. It is smaller, self-contained, and verified
   green: tsc clean and 8/8 suites passing including `distribution-run 86/0`,
   `rental-lifecycle 84/0`, `rental-next-action 59/0`.
3. Rebase `s670-autopilot-mobile-ui` onto it, resolve the `page.tsx` conflict there where it is
   visible, re-run the suites, then merge.

Do not merge them in the other order without re-running `scripts/test-distribution-run.ts`
against the merged tree.

## Note for whoever reads this next

This file was written on 2026-08-21 and was stale within the hour, because the branch it
described moved while it sat on disk. That is the S669 rule about anchors having a TIME
dimension, not just a branch dimension. Re-derive the branch state before acting on any prompt
in this folder.
