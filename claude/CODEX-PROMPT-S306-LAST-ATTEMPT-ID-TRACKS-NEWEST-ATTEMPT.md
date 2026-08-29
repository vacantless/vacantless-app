# CODEX PROMPT S306: make `last_attempt_id` and `attempt_no` track the newest attempt

Written 2026-08-28 (Session 306). Repo: `vacantless-worker`. Branch from `main` at `8efb93b`.

READ THIS FIRST: this ticket does NOT unblock the Relist Radar dark submit. Anyone who tells you it clears the classifier is repeating a superseded S305 line. See `vacantless-app/claude/FINDINGS-S306-RELIST-RADAR-CLASSIFIER-IS-AN-OR.md`. Fix this because the ledger is wrong, not because it opens a lane.

## The defect, from production rows

`distribution_run_items 4dc42e36-...` carries `last_attempt_id = d42aa2a9`, a `relist_radar_kijiji_repost` attempt from 2026-08-14. Two newer attempts on the same item exist and neither moved the pointer:

| attempt | started_at | actor_type | metadata.source | attempt_no |
|---|---|---|---|---|
| `a74849a8` | 2026-08-28 13:50:13 UTC | concierge | `operator_approved_submit` | 8 |
| `a7efb993` | 2026-08-28 13:24:49 UTC | agent | `phase_b_proof` | 8 |
| `d42aa2a9` | 2026-08-14 12:18:45 UTC | agent | `relist_radar_kijiji_repost` | 9 |

Two distinct bugs, one root:

1. **`last_attempt_id` is not updated** by the `phase_b_proof` write or by the operator approval write, though both insert `distribution_publish_attempts` rows.
2. **`attempt_no` is non-monotonic.** The 2026-08-14 row is 9 while both 2026-08-28 rows are 8. Whatever derives the next attempt number is not ordering by time, so it re-issues numbers already used.

Fixing only (1) leaves a ledger where "the newest attempt" and "the highest attempt_no" disagree, which is how (1) became invisible in the first place.

## Scope

- Find every site that inserts into `distribution_publish_attempts` and audit whether it updates the parent item's `last_attempt_id`. Do not assume the two writers above are the only ones; enumerate them.
- Derive `attempt_no` from the item's existing attempts by time, not from a stale counter. State in the PR body where the old number came from.
- `distribution_run_items.attempt_count` is a SEPARATE field and is NOT in scope. It is inflated by freshness-cron noise (1,732 cron rows against 76 real agent rows) and nothing in either repo compares it against a maximum. **Do NOT backfill it and do NOT "fix" it.** See the S304 finding.

## Constraints

- The change is worker-side. If any part needs a schema change, migration order follows the change shape, not a habit: read `feedback_migration_vs_code_ordering` before deciding.
- Do NOT touch `relist_radar_backup` in any code path. It is the snapshot used to restore a deleted ad.
- Do NOT alter `isRelistRadarFreeRefreshJob`. Its OR is deliberate defensive behaviour and correcting the pointer will legitimately narrow which items it catches. That is the intended consequence, not a regression.

## Verification required in the PR body

- A test proving `last_attempt_id` follows the newest attempt across at least three writers, including one out-of-order insert.
- A test proving `attempt_no` never re-issues a number already present on the item.
- A replay of the corrected derivation against every currently non-null `last_attempt_id` in production, reporting HOW MANY decisions it changes. Blast radius before merge, per the S670 pattern. If it changes more than a handful, say so and stop rather than shipping.
- `npx tsc --noEmit` and the worker test suite.

## Anchors

Cite anchors from the branch you are building on, not from another branch. On `main` at `8efb93b`: `src/phase-b-submit.ts:1647` (`isRelistRadarFreeRefreshJob`), `src/phase-b-submit.ts:2358` (its only caller). Locate the attempt writers yourself and list them in the PR body rather than trusting this file's count.

## STRONGER EVIDENCE, added later the same day

The defect was reproduced on a brand-new item across a complete, successful lifecycle. `0640c0aa` went from creation to a finished dark submit and wrote FOUR attempts:

| attempt | time UTC | source |
|---|---|---|
| `75f9787a` | 17:56:09 | `phase_b_proof` (failed launch) |
| `fe0a51e8` | 18:42:03 | `phase_b_proof` (20 fields) |
| `7ec1ed58` | 18:44:38 | `operator_approved_submit` |
| `217c7d21` | 19:01:20 | `phase_b_submit_dark` (reached Post, stopped) |

**`0640c0aa.last_attempt_id` was NULL before and is still NULL after all four.** This is not an old row with a stale pointer inherited from history; the pointer was never set at all, by any of the four writers, on an item with no prior state. Use this item as the fixture.
