# REVIEW - Codex duplicate-post guard, `6f262dc` (S666)

_2026-08-18. Reviewed from a fresh clone of the public repo in an isolated container, off `origin/codex/s666-duplicate-post-guard`. No git writes on the Mac bridge._

## Verdict

**Merge it.** The guard is correct, scoped exactly as asked, and closes the dominant path. But it is
**not complete**, and the gap is measurable: of the twelve ads this was written to prevent, **it
blocks ten and leaves two possible.**

## Provenance

Unlike `c4022b8`, this commit was made in a **separate clone** at
`/private/tmp/vacantless-app-s666-duplicate-post-guard`, not a `git worktree`. It therefore did NOT
appear in the main repo's object store, `git worktree list` did not know about it, and it could not
be reviewed until it was pushed. **On a filesystem macOS purges on reboot, with no second copy, that
work was one restart from gone.** Worth insisting on `git worktree` or an immediate push next time.

After the push: `origin/codex/s666-duplicate-post-guard` = `6f262dc`, `origin/main` = `c4022b8`,
merge-base `c4022b8`, exactly **1 commit ahead, 0 behind**.

## Scope

`5 files changed, 259 insertions(+), 3 deletions(-)`, `git diff --check` clean. **No worker files, no
migrations, no `supabase/`** - confirmed by name filter, not by trust.

## What is right

- **Both approval entry points guarded.** `.is("external_url", null)` added to the CAS in
  `approveConciergeSubmit` and `authorizeAutopilotSubmit`, so a row with a captured ad matches 0 rows.
- **The refusal is distinguishable.** A second scoped query separates `already_posted` from `stale`,
  with its own copy on both the desk and the property page. That was the point - the operator needed
  a different instruction, not a different-coloured version of the same one.
- **The confirmation gate is untouched.** A successful post still lands at `needs_operator`, and
  `completeConciergeItem` is still the only writer of `listing_posts`.
- **The stale-worker reclaim path still works.** A crash between delete and repost leaves
  `operator_submit_approved_at` **set**, and neither new guard fires on that path. Correct, and it
  was the easiest thing in this change to get wrong.
- **`needs_payment` items stay approvable** while they carry no `external_url`.
- **The UI no longer lies.** The captured-ad branch is inserted above the `prep.reachedForm` case, so
  "Approve & submit" is not rendered at all when an ad exists; the URL is a real link, "Mark live"
  becomes "Mark captured ad live", and the header carries an "N posted, awaiting confirmation" count.
  Clearing and re-approving are two deliberate acts, as specified.

## Findings

### 1. The guard is per-run-item, and 2 of the 12 ads did not come from one - **the main gap**

Re-derived from `distribution_publish_attempts` grouped by `run_item_id`:

| run_item_id | ads posted | window | run_id |
|---|---|---|---|
| `4dc42e36-ff7c-4b62-a956-8a2551013419` | **10** | 08-11 20:34 to 08-14 12:18 | `1363918e` |
| `e8d80187-edae-4c04-b7e6-b1003edbe11b` | 1 | 08-12 13:01 | `56d4fadb` |
| `6407dcac-c330-49d8-864d-4e0090f5a8f0` | 1 | 08-12 14:37 | `41bc6a90` |

Ten of the twelve came from **repeatedly re-approving one run item**, which this change now blocks
outright. The other two came from **separate run items on separate runs**, and that path is still
open: staging a fresh distribution run creates a new item with `external_url` null, and
`preparePublishChannel` short-circuits only on `existingLiveUrl` sourced from **`listing_posts`** -
where a captured-but-unconfirmed ad is never written.

So the loop is throttled, not sealed. **Follow-up, not a blocker:** make the pre-post check consult
the property's unconfirmed captured ads, not just `listing_posts`.

### 2. The clear button renders where it cannot work

`hasCapturedUnconfirmedAd` is `external_url && status === "needs_operator"`, but
`clearConciergeExternalUrl` additionally requires `operator_submit_approved_at IS NULL`. For a
crash-reclaimed item - approval still set, URL still set - the panel and its "This ad is gone - clear
it" button render, and pressing it redirects `?err=stale`. It fails closed, so nothing breaks, but it
is a dead control in exactly the state an operator is most likely to be confused. Gate the panel on
the same condition the action enforces.

### 3. Every new test is a regex over source text

All 15 new assertions `readFileSync` a file and check for substrings. None exercises behaviour.

This is **more defensible than the same finding in S665**, where the logic was a pure function that
could have been imported: here the guard is a Supabase query chain inside a server action, which
cannot be unit-tested without a database or a mock harness that does not exist in this repo. They
would catch someone deleting `.is("external_url", null)`, which is worth something.

They would **not** catch the predicate being attached to the wrong query, the branch being correctly
ordered in source but wrong at runtime, or the gap in finding 1. And one assertion is mislabelled:
*"already_posted classification only applies after approval was cleared, preserving approved
stale-worker reclaim cases"* is checked by a `[\s\S]*?` regex proving two strings appear in order,
which is not that claim.

### 4. `clearConciergeExternalUrl` leaves no append-only audit

`approveConciergeSubmit` writes a `buildAttemptRecord` row. The clear action only sets
`audit_message`, which the next write overwrites. Clearing is the one operator act that erases the
system's pointer to a real ad that is still live on a third-party site. The ad id does survive in
`distribution_publish_attempts.metadata.live_url`, so nothing is permanently lost - but who cleared
it, and when, is not durably recorded.

## Not verified here

`npm run build`, `npx tsc --noEmit`, `npm run lint` and the suite counts (76/0, 53/0 and the rest) are
Codex's report and were not re-run. The review is of the diff and of the database evidence behind
finding 1.
