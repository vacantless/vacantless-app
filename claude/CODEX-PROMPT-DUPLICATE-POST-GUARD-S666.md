# CODEX PROMPT - Stop re-approving a run item that already has an unconfirmed live ad (S666)

## Why this exists

Between 2026-08-11 20:34 and 2026-08-14 12:18, **twelve distinct real Kijiji ads were created for one
property** (350 City Hall Square West, Growth Test org). Every one of the twelve
`distribution_publish_attempts` rows carries a real ad id in `metadata.live_url`, so twelve real ads
went up. **Exactly one Kijiji delete has ever been confirmed** in the system's history, so eleven of
them were left orphaned on a Kijiji account that permits **one free ad at a time**. Two paying
customers' unrelated ads on that same shared account are now gone as well.

Nothing in the loop is a crash or a race. Every step behaves exactly as written. The defect is that
**a successful post and a never-attempted post are indistinguishable to both the claim query and the
operator UI**, so the same item gets approved and posted again and again.

## The sequence, verified against the code on `main` at `c4022b8`

1. The worker clicks Post, captures the live URL, and `landingFor` returns
   `publishStatus: "needs_operator"`, `clearApproval: true`, `externalUrl: liveUrl`
   (`vacantless-worker/src/submit-logic.ts`, `case "live":`). **This is deliberate** - the operator
   confirms on the desk before the item goes live, and `completeConciergeItem` does the real
   `listing_posts` write. **Do not change this gate.**
2. `clearApproval: true` nulls `operator_submit_approved_at`, so the item drops back to exactly the
   state of an item that has never been submitted.
3. `claimApprovedJob` (`vacantless-worker/src/claim.ts:189-201`) selects on
   `publish_status = 'needs_operator'` + `operator_submit_approved_at IS NOT NULL` +
   `concierge_claimed_by IS NULL`. **`external_url` is not in the predicate, and is not even in the
   select list.**
4. `approveConciergeSubmit` (`app/dashboard/admin/concierge-actions.ts:378-388`) guards on
   `mode = 'concierge'` + `publish_status = 'needs_operator'` + `operator_submit_approved_at IS NULL`.
   **No `external_url` check.**
5. `authorizeAutopilotSubmit` (`app/dashboard/properties/distribution-actions.ts:531-533`) guards on
   `publish_status IN ('needs_operator','needs_payment')` + `operator_submit_approved_at IS NULL`.
   **No `external_url` check.**
6. The Concierge Desk (`app/dashboard/admin/concierge/page.tsx:369-381`) renders the prominent violet
   **"Approve & submit"** button whenever `operator_submit_approved_at` is null and the prep snapshot
   looks ready. **There is no branch for "this item already produced a live ad."** The only cue that
   an ad exists is an `text-[11px]` audit line reading "Worker posted to Kijiji; live URL captured:
   ... Confirm on the desk to mark live."

So the operator sees a familiar, prominent "Approve & submit" and a small grey sentence. Clicking it
is one click; confirming the existing ad is a different, less prominent control. Twelve times.

## Scope

**`vacantless-app` only.** Do not touch `vacantless-worker` - the worker's confirmation gate is
correct, and a second repo doubles the review surface for no extra safety. The app owns both entry
points that set `operator_submit_approved_at`, so guarding there closes the loop.

Branch from `main` at `c4022b8`. Branch name: `codex/s666-duplicate-post-guard`.

## What to change

### 1. Refuse re-approval when an unconfirmed live ad already exists

In **both** `approveConciergeSubmit` (`app/dashboard/admin/concierge-actions.ts`) and
`authorizeAutopilotSubmit` (`app/dashboard/properties/distribution-actions.ts`), add
`.is("external_url", null)` to the guarded update, alongside the existing
`.is("operator_submit_approved_at", null)`.

A row that already carries an `external_url` then matches 0 rows and falls into the existing
"stale" path. **Give it its own error code** rather than reusing `stale`, because the operator needs
a different instruction: `?err=already_posted` on the desk, and `already_posted` on the property
page's `backTo(...)`. Surface a message along the lines of *"An ad from a previous submit is already
live for this listing. Confirm it or take it down before submitting again."*

### 2. Make the desk show the truth instead of an identical button

In `app/dashboard/admin/concierge/page.tsx`, add a branch **above** the existing
`prep.reachedForm && (prep.filledCount ?? 0) > 0` case: when `item.external_url` is non-null and the
item is not yet live, do **not** render "Approve & submit". Render instead:

- the captured URL as a real link, so the operator can open the ad and see it exists;
- the existing **Mark live** / complete control as the primary action;
- an explicit, secondary, deliberately less prominent escape hatch for the genuine case where the
  captured ad is wrong or already removed. It must **not** be a one-click resubmit. Require the
  operator to clear `external_url` first through its own control (e.g. "This ad is gone - clear it"),
  which then restores the normal Approve path on the next render. Two intentional acts, not one.

### 3. Make an orphaned ad visible somewhere a human will look

Today a captured-but-unconfirmed ad is discoverable only by reading
`distribution_run_items.external_url` or the append-only
`distribution_publish_attempts.metadata.live_url`. Nothing sweeps or reports it, and no code path
writes it to `listing_posts`.

Add the cheapest durable signal that fits the existing patterns: surface run items where
`external_url IS NOT NULL AND publish_status = 'needs_operator'` as a **distinct section or badge on
the Concierge Desk** ("Posted, awaiting confirmation"), separate from items that have never been
submitted. Do not invent a new table or a new cron for this.

## Do NOT break these

- **The confirmation gate itself.** A successful worker post must still land at `needs_operator` and
  still require a human to mark it live. `completeConciergeItem` remains the only writer of
  `listing_posts` for these channels.
- `approveConciergeSubmit` must still approve **exactly once** and still redirect `?err=stale` when
  the item genuinely moved on. The new refusal is a **different** condition with a different message.
- `authorizeAutopilotSubmit` must keep working for `needs_payment` items, which legitimately have no
  `external_url`.
- The stale-worker reclaim path (`reclaimStaleWorkerSubmittingJobs`) must keep working: a crash
  between delete and repost leaves `operator_submit_approved_at` **set**, and that item SHOULD still
  be reclaimable. Your guard must not block it. Note this case is distinguishable because the
  approval was never cleared.
- No migration should be needed. `external_url` already exists on `distribution_run_items` and is
  already selected by the desk page (`concierge/page.tsx:88`).

## Tests

Extend `scripts/test-distribution-concierge.ts` (and `scripts/test-distribution-worker.ts` if the
claim-side logic is touched). Keep every existing assertion passing. Add coverage for:

- approve refused when `external_url` is set and `operator_submit_approved_at` is null;
- approve still allowed when `external_url` is null;
- approve still allowed for a `needs_payment` item with no `external_url`;
- the stale-reclaim case (approval still set) is NOT blocked by the new guard;
- the desk renders the "posted, awaiting confirmation" branch rather than "Approve & submit" when
  `external_url` is present.

Follow the existing harness style in those files. Report the pass/fail counts.

## Gate

Run the repo's build and the full script suite before handing back and state the numbers. `npx tsx`
and `next build` cannot run on the Mac bridge (linux arm64 VM against a darwin-only
`node_modules/@esbuild/`), so run them in your own environment and report actual output rather than
asserting success.

## Commit

One labelled commit on the branch:
`S666: refuse re-approval when a run item already has an unconfirmed live ad`

Do not merge. Leave the branch for review.

## Context worth reading first

- `claude/FINDINGS-KIJIJI-12-DUPLICATE-POSTS-ONE-ADDRESS-S666.md` - the twelve ads, the counts, the evidence.
- `claude/DECISION-KIJIJI-SHARED-ACCOUNT-OPTIONS-S666.md` - the shared-account constraint this defect sits inside.

Note the strategic question of whether Kijiji stays a free channel at all is **open and separate**.
This fix is worth shipping regardless, because the same approve-and-post loop is channel-agnostic:
any browser-automated channel that captures a live URL and lands at `needs_operator` can duplicate
the same way.
