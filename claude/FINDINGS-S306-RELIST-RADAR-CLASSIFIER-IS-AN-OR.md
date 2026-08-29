# FINDINGS S306: the Relist Radar classifier is an OR, so the `last_attempt_id` fix does not unblock the dark submit

Written 2026-08-28 (Session 306). Corrects a recommendation carried out of S305.

## What S305 handed forward

The S305 wrap offered three routes to a first dark submit and recommended Option B:

> fix `last_attempt_id` to track the newest attempt. Genuine defect, clean test, clears two of the three classifier conditions on its own, touches no production data.

Both halves of that sentence are true. The conclusion drawn from them is not.

## What the source actually says

`vacantless-worker/src/phase-b-submit.ts:1647`:

```ts
export function isRelistRadarFreeRefreshJob(item: ...): boolean {
  if (item.channel !== "kijiji" || item.mode !== "concierge") return false;
  const backup = objectRecord(item.relist_radar_backup);
  const source = backup?.source;
  const workerLane = item.lastAttemptMetadata?.worker_lane;
  const attemptSource = item.lastAttemptMetadata?.source;
  return (
    source === "relist_radar_autorefresh" ||
    workerLane === "phase_b_submit_free_plan" ||
    attemptSource === "relist_radar_autorefresh"
  );
}
```

The three conditions are joined by `||`, not `&&`. **Any one of them is sufficient.**

`maybeRunRelistRadarFreeRefresh` (`:2358`) short-circuits on it:

```ts
if (!item || !isRelistRadarFreeRefreshJob(item)) return false;
```

## Why that kills Option B specifically

For `4dc42e36`, `relist_radar_backup->>'source'` is `relist_radar_autorefresh` [verified 2026-08-28 from the row]. That is condition one and it stands on its own, independent of `last_attempt_id` entirely.

`last_attempt_id` feeds only `lastAttemptMetadata`, which supplies conditions two and three. Repointing it at the newest attempt clears exactly those two. The classifier still returns true, the runner still takes the Relist Radar branch, and the item still releases with `free_refresh_flag_off`.

**Option B is a correct defect fix that cannot unblock the item it was proposed to unblock.** The only ways past the classifier for a Kijiji concierge item are a null or non-autorefresh `relist_radar_backup`, or clearing that backup, which is forbidden because it is the snapshot used to restore a deleted ad.

## The defect is still real, and slightly worse than recorded

`4dc42e36.last_attempt_id` is `d42aa2a9`, a 2026-08-14 `relist_radar_kijiji_repost` attempt, although two newer attempts exist:

| attempt | started_at | actor | metadata.source | attempt_no |
|---|---|---|---|---|
| `a74849a8` | 2026-08-28 13:50:13 UTC | concierge | `operator_approved_submit` | 8 |
| `a7efb993` | 2026-08-28 13:24:49 UTC | agent | `phase_b_proof` | 8 |
| `d42aa2a9` | 2026-08-14 12:18:45 UTC | agent | `relist_radar_kijiji_repost` | **9** |

Note `attempt_no`. The 2026-08-14 row carries 9 while both 2026-08-28 rows carry 8. **`attempt_no` is non-monotonic**, which is the same defect seen from the other side: whatever computes "the newest attempt" is not ordering by time. A fix that only repoints `last_attempt_id` without correcting the `attempt_no` derivation leaves the second half of the bug in place.

## What was done instead

Option A, on a fresh item with no Relist Radar history. See `FINDINGS-S306-FREE-PLAN-BLOCKS-CONCIERGE-REQUEST.md` for the wall that had to come down first.

## The generalisable rule

When a handoff counts how many conditions a fix clears, read whether they are ANDed or ORed before believing the count. "Clears two of three" is a strong claim under AND and a meaningless one under OR. This is the same family as grading a defect by who READS the field rather than by how wrong the value looks.
