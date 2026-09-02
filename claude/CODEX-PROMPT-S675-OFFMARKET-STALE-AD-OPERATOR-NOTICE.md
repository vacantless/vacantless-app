# CODEX PROMPT S675: tell the operator when a unit goes off-market with a live ad still up

## Anchor

Work in a **git worktree off `vacantless-app` `origin/main`**, which is **`82776e6`** at the time of
writing. **Do not pin that sha in any gate.** Re-derive HEAD yourself and verify CONTENT identity
instead, with these three anchors, which must all be true before you change anything:

- `app/dashboard/properties/actions.ts` contains `export async function archiveProperty(formData: FormData) {`
- `lib/leaseup-takedown.ts` contains `if (!property || property.status !== "leased") return;`
- `lib/leaseup-decision.ts` contains `propertyStatus: "leased";`

If any anchor is missing, **stop and report**; main has moved under this prompt.

Read `claude/FINDINGS-S675-STALE-AD-IS-FOUR-GATES-AND-THE-OBVIOUS-FIX-CHANGES-NOTHING.md` first.
It contains the reasoning this prompt depends on and one instruction you must not violate.

## The problem, stated exactly

A property can leave `available` while its Facebook Marketplace ad is still serving. Today nothing
tells anybody. `archiveProperty` (`app/dashboard/properties/actions.ts:1466-1497`) writes `properties`
and nothing else. `handleLeaseupAdLifecycle` is never reached from it, and would early-return anyway
because it requires `status === "leased"`.

Verified live on 2026-09-02: `1551 Assumption St Unit D` is `off_market`, archived, and carries a
`listing_posts` row with `status = 'live'` and url `.../marketplace/item/1915331599118623/`.

## THE TRAP. Read this before you write code.

**Do NOT "fix" this by calling `handleLeaseupAdLifecycle` from `archiveProperty`.** It is the obvious
one-liner and it produces **no behaviour change**. `decideLeaseupAdLifecycle` returns `steer_to_pool`
whenever `siblingAvailableCount > 0`, and Agile has three available 1-beds at 833 Pillette right now,
so the ladder would deliberately leave the ad up and write a log row. You would ship a no-op and a
passing test.

**Do NOT widen `decideLeaseupAdLifecycle`'s `propertyStatus: "leased"` literal.** The leased path is
shipped behaviour covered by `scripts/test-leaseup-takedown-confirm.ts` and
`scripts/test-leaseup-takedown.ts`. Leave it alone.

**Do NOT write `listing_posts.status`.** Nothing in this product probes Facebook. `833 Pillette Unit 30`
is marked `expired` in our table while its ad is believed to still be serving, which is the standing
proof that our status and the world disagree. Writing a status we cannot verify is the defect, not the
fix.

**Do NOT delete, edit or repoint any live ad**, and do not enqueue a `takedown`-transport run item.
That transport is claimed by the worker and implies a Graph delete, which is impossible for a
Marketplace listing (`automatedDelete` requires `portal === "facebook_feed"`,
`lib/leaseup-takedown.ts:339-342`).

## What to build

A notification, and nothing else.

1. **New flag, dark by default.** `OFFMARKET_STALE_AD_NOTICE_ENABLED`, read exactly like
   `leaseupTakedownEnabled()` does at `lib/leaseup-takedown.ts:47-50`. Export a
   `offmarketStaleAdNoticeEnabled()` helper. **Ship it dark. Do not set it anywhere.**

2. **New function** in a new file `lib/offmarket-stale-ad.ts` (do not grow `leaseup-takedown.ts`):

   ```
   notifyOffmarketStaleAds({ supabase, org, propertyId }): Promise<void>
   ```

   - return immediately unless `offmarketStaleAdNoticeEnabled()`
   - load the property scoped by `organization_id`; return unless its `status` is `off_market`
     or `paused`, or `archived_at` is non-null
   - load `listing_posts` for that org+property with `status = 'live'`; return if none
   - for each such post, send ONE notification, reusing the **existing** event key
     `"leasing.distribution_takedown_needed"` (registered at `lib/notifications.ts:435`, lane
     `"listing"` at `:1156`, so **no migration and no new template**). Copy the call shape of
     `sendLeaseupTakedownNeededNotification` (`lib/leaseup-takedown.ts:102-140`) including
     `leaseupTakedownDashboardUrl`, `operatorFallback` and the `action` button.
   - set `reason` to something that names the real situation, e.g.
     `` `${channelLabel(post.portal)}: unit is off-market and this ad is still live` ``
   - wrap the send in the same best-effort `try {} catch {}` the existing helper uses. **A failed
     notification must never roll back or block the archive.**
   - log the decision through the existing `distribution_verifications` insert shape
     (`logLeaseupDecision`, `lib/leaseup-takedown.ts:142+`) with
     `metadata.source = "offmarket_stale_ad"` and `action = "offmarket_ad_still_live"`, so this is
     auditable without a new table. Reuse, do not duplicate, if you can export it cleanly; otherwise
     write the insert directly rather than refactoring the leased path.

3. **Two call sites**, both in `app/dashboard/properties/actions.ts`:
   - in `archiveProperty`, **after** the `properties` update succeeds and **before**
     `revalidatePropertyList()`
   - on the save path beside the existing lifecycle call at `:1007`, guarded on the transition
     `priorStatus` in (`available`,`paused`) and `effectiveStatus === "off_market"`

   Both calls are `await`ed and both are inside the existing flow, not a new route.

## Tests

Add `scripts/test-offmarket-stale-ad.ts`, modelled on `scripts/test-leaseup-takedown.ts`. It must
prove, with the flag forced on and then off:

- flag off -> no notification, no verification row
- property still `available` -> no notification
- property `off_market` with zero `status='live'` posts -> no notification
- property `off_market` with one `status='live'` post -> exactly one notification carrying the post url
- **`listing_posts` is never written** - assert this by source inspection the way
  `test-leaseup-takedown.ts:66` asserts on source text, not only by mock
- the leased path's behaviour is unchanged: `decideLeaseupAdLifecycle` still types `propertyStatus`
  as `"leased"` and `handleLeaseupAdLifecycle` still early-returns on non-leased

Restore `process.env` in a `finally`, as the existing tests do.

**There is no CI gate on push** - `.github/workflows/` holds only `reminders.yml`, `on: schedule`.
So the deploy script below is the only thing that will ever run this.

## Handover script

Write `COMMIT-S675-OFFMARKET-STALE-AD.sh` in the repo root, POSIX only, `set -uo pipefail`, with:

- a PREVIEW mode and an APPLY mode, preview first
- content gates on the three anchors above, **not** a sha pin
- a positive-marker gate that the new file, the new flag string and the new test all exist
- a gate that `git --no-optional-locks diff --no-pager --stat` touches only the intended paths
- `npx tsx scripts/test-offmarket-stale-ad.ts` **and** the two existing leaseup tests, all three
  green, as a hard gate before the commit
- **no `#` or `~` in any path**, and **never `grep -q` inside a pipe** under `pipefail` - the writer
  takes SIGPIPE and the pipeline returns 141. Use `VAR=$(...)` then `case`.
- `git --no-pager log`, never `git log --no-pager`; the flag precedes the subcommand
- prove each gate bites by running it against a case that must fail, and say so in the output

**The script is Noam's to run. Do not run git writes yourself.**

## Definition of done

Flag exists and is dark; the notification fires only in the four conditions above; no migration; no
listing_posts write; no ad touched; leased path byte-identical in behaviour; three tests green;
handover script gated and previewed.
