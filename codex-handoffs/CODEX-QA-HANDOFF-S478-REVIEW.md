# Codex QA handoff - S478 fold review

Date: 2026-07-13

Range reviewed: `132964b..ea52225`

HEAD reviewed: `ea52225` (`main` / `origin/main`)

Read first:

- `codex-handoffs/CODEX-QA-HANDOFF-S475-S477-REVIEW.md`

Verdict:

- No P1 found.
- **NOT ACCEPTED yet.** S478 closes the N4 P2s/P3 at runtime source level, but one P2 remains in the concierge completion fold.
- The completion-vs-completion CAS now prevents a second staffer's `completeConciergeItem` from reaching `listing_posts`, including the abandoned-claim takeover path.
- The completion reservation is still not protected from `rejectConciergeItem`, which can flip a just-reserved item to `rejected` while the completer is between the reservation and `listing_posts` write.

## Findings

### P2 - Reject can still race a reserved completion and leave a stale `listing_posts` side effect

File:

- `app/dashboard/admin/concierge-actions.ts:264`

S478 moves `completeConciergeItem` in the right direction: it first reserves the item with a state/claim CAS at `app/dashboard/admin/concierge-actions.ts:103-120`, then writes the tracker at `app/dashboard/admin/concierge-actions.ts:177-199`, and finally flips live only if the item is still held by the same staffer at `app/dashboard/admin/concierge-actions.ts:211-229`.

That closes the prior two-completer race. A second staffer's completion now loses the first CAS and returns `?err=stale` before any `listing_posts` write. The `.or(...)` clause is ANDed with the `id`, `mode`, and open-status filters by the Supabase/PostgREST query builder, and the 15-minute stale-claim takeover is also exclusive because the first takeover rewrites `concierge_claimed_by` and `concierge_claimed_at` before the second waiter re-evaluates the row.

The remaining hole is that `rejectConciergeItem` was not folded into the same ownership model. It still updates any open concierge item by `id`/`mode`/open status only at `app/dashboard/admin/concierge-actions.ts:264-278`, and `CONCIERGE_OPEN_STATUSES` includes `submitting`. The desk page also renders the Reject form for claimed items (`app/dashboard/admin/concierge/page.tsx:275-300`).

Race:

1. Staff A submits Mark live. The new CAS reserves the item as `concierge_claimed_by = A`, `publish_status = "submitting"`.
2. Staff B submits Reject from a stale or open desk page. Because reject ignores `concierge_claimed_by`, it matches the still-open `submitting` row and flips it to `rejected`.
3. Staff A continues and writes/updates `listing_posts`.
4. Staff A's final live flip sees `publish_status = "rejected"` and returns `?err=stale`, but the tracker write already happened.

This is the same class of stale side effect the S475-S477 review asked to eliminate before any `listing_posts` write. Fold by making reject acquire/hold the same reservation, or by requiring reject to match unclaimed/self/stale ownership before it can move an item out of open state. The same 15-minute abandoned-claim policy can apply; what matters is that a different staffer cannot reject an active reserved completion.

### P3 - Historical S477 deploy script still references the removed 2015 N4 filename

File:

- `DEPLOY-S477-N4-SLICE-B.sh:8`

Runtime code/config is clean: `lib/n4-official-pdf.ts` now loads `lib/forms/ltb-n4-2022.pdf`, `N4_TEMPLATE_VERSION` is `v.01/04/2022`, and `next.config.mjs` still only traces the N1 official route. The old `ltb-n4-2015.pdf` file is gone.

The only non-handoff, non-prior-review stale refs I found are in the historical `DEPLOY-S477-N4-SLICE-B.sh`, which still comments and `git add`s `lib/forms/ltb-n4-2015.pdf`. This is not a runtime blocker, but it is a stale repo script that could confuse a future rerun.

## Clean / Confirmed

- `completeConciergeItem` now reserves before tracker writes for completion-vs-completion, and the final live flip also checks `concierge_claimed_by = self`.
- A second staffer's completion loses the CAS and stops before `listing_posts`.
- A 15-minute abandoned claim can be taken over by one staffer, but two different staffers cannot both win that takeover concurrently.
- The `.or(concierge_claimed_by.is.null, concierge_claimed_by.eq.self, concierge_claimed_at.lt.cutoff)` filter is chained with `.eq("id")`, `.eq("mode")`, and `.in("publish_status", open)` so it is ANDed with the other predicates.
- A legitimately claimed item is not locked out from the claiming staffer; the self predicate lets that staffer proceed.
- `deriveN4Arrears` now exposes `conservativeOwingCents` and `hasUnresolvedCredits`. For the positive `rent_payments` ledger shape, the conservative floor is `max(0, computed - unassigned - outOfWindow)`, never exceeds `computedOwingCents`, never goes below zero, and the flag is true iff positive unattributed credits exist.
- The false "can never silently overstate" comment was corrected; `computedOwingCents` is now explicitly documented as the upper bound.
- `fillOfficialN4` no longer truncates rows. It throws on more than 3 rows, negative overpaid rows, and rows whose owing sum exceeds `totalOwingCents`.
- A valid 3-row reconciled snapshot still fills, and `scripts/test-n4-pdf.ts` now covers the fail-closed row contract.
- The N4 template was git-moved to `lib/forms/ltb-n4-2022.pdf`; the runtime template loads and the PDF golden test passes.
- Prepare-only posture still holds: no app route imports `fillOfficialN4`, and the N4 template is not added to `next.config.mjs` `outputFileTracingIncludes`.

## Verification

Commands/checks run:

- `git status --short`
- `git log --oneline --decorate --max-count=12`
- Read `codex-handoffs/CODEX-QA-HANDOFF-S475-S477-REVIEW.md`
- `git diff --stat 132964b..ea52225`
- `git diff --name-only 132964b..ea52225`
- Targeted source review of:
  - `app/dashboard/admin/concierge-actions.ts`
  - `app/dashboard/admin/concierge/page.tsx`
  - `lib/distribution-publish.ts`
  - `lib/n4.ts`
  - `lib/n4-official-pdf.ts`
  - `scripts/test-n4.ts`
  - `scripts/test-n4-pdf.ts`
  - `next.config.mjs`
- `rg` for `ltb-n4-2015`, `ltb-n4-2022`, `N4_TEMPLATE_VERSION`, `fillOfficialN4`, `notices`, and `outputFileTracingIncludes`
- `git diff --check 132964b..ea52225`: passed
- `./node_modules/.bin/tsc --noEmit`: passed
- `npx tsx scripts/test-n4.ts`: passed, `test-n4: 75/0`
- `npx tsx scripts/test-n4-pdf.ts`: first sandbox run hit the known `tsx` IPC `EPERM`; escalated rerun passed, `test-n4-pdf: 22/0`
- `npx tsx scripts/test-distribution-concierge.ts`: passed, `test-distribution-concierge: 60/0`
- `npm run lint`: exited 0 with the existing warning at `app/job/[token]/page.tsx:184` about `<img>` vs `next/image`
- `npm run build`: passed

Not run:

- Browser app QA.
- Live/production write-path QA.
- A DB-level concurrent mutation harness for concierge actions; the concierge race finding is from source-level row predicate review.

## Repo State Notes

The app repo already had unrelated dirty/untracked handoff/deploy clutter before this review. I left it untouched.

This review added:

- `codex-handoffs/CODEX-QA-HANDOFF-S478-REVIEW.md`
