# Codex QA handoff - S475-S477 concierge folds + N4 notice library review

Date: 2026-07-12

Range reviewed: `7fa4b36..132964b`

HEAD reviewed: `132964b` (`main` / `origin/main`)

Implementer handoff read first:

- `codex-handoffs/CODEX-QA-HANDOFF-S475-S477-CONCIERGE-FOLDS-AND-N4.md`

Verdict:

- No P1 found.
- Not accepted yet: P2 folds remain.
- S475 closes the old target-org authZ issue and the simple stale claim/reject desk mutations, but `completeConciergeItem` still has a side-effect race before the atomic final row update.
- S474's old anon `showing_instructions` RPC leak stays closed at source-review level.
- S476/S477 are prepare-only as claimed: no route imports `fillOfficialN4` or wires `notices` into app behavior yet.

## Findings

### P2 - Stale/double concierge completion can still overwrite the tracked listing post before the atomic item update rejects it

File:

- `app/dashboard/admin/concierge-actions.ts:127`

S475 makes the final `distribution_run_items` update state-conditional at `app/dashboard/admin/concierge-actions.ts:189`, which is good. The problem is that the external side effect happens first: `completeConciergeItem` validates/reuses/creates/updates `listing_posts` at `app/dashboard/admin/concierge-actions.ts:127-179`, and only afterward tries the guarded item update at `app/dashboard/admin/concierge-actions.ts:189-206`.

Two staff can load the same open item, both pass the fast stale guard, and both write the run-derived `org/property/portal` tracker. Only one final item update wins; the loser redirects `?err=stale`, but its earlier `listing_posts.update({ url, status: "live" })` may already have overwritten the tracker's URL/status. That leaves the live run item and the attribution tracker disagreeing, and means the stale form did not fully resolve to zero side effects.

Fix direction:

- Acquire the item with a state-conditional claim/reservation before touching `listing_posts`, or move the tracking write behind an atomic state transition that gives one completer ownership of the completion attempt.
- Alternatively use a DB transaction/RPC that locks the item, validates open state, writes the tracker, then marks the item live as one unit.
- Keep the existing org/property/portal validation; it closes the cross-org overwrite part of the old P2.

### P2 - N4 arrears defaults can still overstate or produce a non-reconciling official table when credits are ambiguous or overpaid

Files:

- `lib/n4.ts:151`
- `lib/forms/shared-combs.ts:18`
- `lib/n4-official-pdf.ts:116`

`deriveN4Arrears` surfaces unassigned and out-of-window payments but does not apply them to `computedOwingCents` (`lib/n4.ts:151-181`). That may be a reasonable UX if Slice C forces the operator to resolve/override before generating a notice, but as a library default it is not conservative against overstatement: a real rent payment that is unassigned can leave the default N4 amount too high.

There is a related table-math problem for tagged overpayments. `deriveN4Arrears` allows a period row to have negative `owingCents` (the test explicitly covers this), while `combAmountCents` clamps negative amounts to `0` before filling the PDF. If one overpaid period offsets another unpaid period, the PDF can show row-level `Rent Owing` cells that sum higher than `Total Rent Owing`, because the total uses net charged-minus-paid but each negative row is rendered as zero.

The current Tribunals Ontario N4 checklist says to check that the table's Total Rent Owing is correct and matches the page-1 amount, so this should be folded before any operator route uses these helpers to produce a default official N4.

Fix direction:

- If `unassignedPaidCents` or `outOfWindowPaidCents` is non-zero, either block default form generation until the operator resolves the credits, or apply the positive unresolved credits against the default owing amount in the tenant-protective direction.
- Normalize/allocate overpayments across the arrears rows before packing/filling so the displayed row amounts reconcile to the total, or fail the fill until the operator resolves the credit allocation.
- Update the comments that say the current derive "can never silently overstate arrears"; that is not true for unassigned payments.

### P2 - `fillOfficialN4` silently truncates arrears rows instead of enforcing the 3-row packing contract

File:

- `lib/n4-official-pdf.ts:112`

`packN4ArrearsRows` itself matches the stated overflow strategy for the edge cases I checked: 1 and 3 rows pass through, 4/many rows combine all-but-last and keep the last period alone in the last completed row.

But `fillOfficialN4` accepts `arrearsRows` and then does `snap.arrearsRows.slice(0, 3)` at `lib/n4-official-pdf.ts:112`. If Slice C accidentally passes raw derived rows instead of the packed rows, the official PDF silently drops every row after the third. For a legal notice helper, this should fail closed the same way `combAmountCents` fails on over-wide amounts.

Fix direction:

- Throw when `snap.arrearsRows.length > 3`, or have `fillOfficialN4` accept raw `N4PeriodRow[]` and call `packN4ArrearsRows` itself.
- Add a regression test with 4+ rows proving the last period is not silently omitted.

### P3 - N4 template version metadata/comments are stale even though the rendered form is the 2022 N4

File:

- `lib/n4-official-pdf.ts:31`

The code and handoff describe `lib/forms/ltb-n4-2015.pdf` / `N4_TEMPLATE_VERSION = "2015/11/30"`, but the rendered sample and the current Tribunals Ontario public N4 PDF show `v. 01/04/2022`. Local `pdfinfo` on the bundled template also reports `ModDate: Tue May 17 12:27:16 2022 EDT`.

Runtime behavior is better than the comments: the generated output is AcroForm and has `JavaScript: no` after `fillOfficialN4` runs. This is still worth cleaning up before Slice C records snapshots or audit metadata.

Fix direction:

- Rename the file/constant/comment to the actual form revision, or add an explicit source/version note explaining why a 2022 form lives under a 2015 filename.

## Clean / Confirmed

- `requestConciergePublish` now loads the target run first, derives `run.organization_id`, checks `getRoleForOrg(runOrgId)`, and checks `hasEntitlement(runOrg.plan, "listing_marketing")` for that exact org. I did not find a residual `getCurrentOrg()` authZ path in this action.
- `getRoleForOrg` is scoped by both `user_id` and `organization_id`.
- The previous S474 anon booking extras RPC leak remains closed: migration `0138` returns only `leasing_phone` and `plan`; remaining `showing_instructions` reads are authenticated operator or agent-token surfaces.
- S475 validates stale/corrupt `listing_post_id` against run-derived `organization_id`, `property_id`, and normalized portal before trusting it. Direct cross-org/property overwrite via the denormalized FK is closed.
- Claim and reject desk mutations are state-conditional (`mode='concierge'`, open statuses; claim also `concierge_claimed_by IS NULL`) and check affected rows.
- S476/S477 are prepare-only at source level: `rg` found `fillOfficialN4`, `deriveN4Arrears`, `packN4ArrearsRows`, and `notices` only in the new library/tests/migration, not in app routes.
- `deriveN4TerminationDate` implements 14 days for monthly/yearly/bi-weekly and 7 days for daily/weekly. The current official N4 PDF explicitly confirms 14 days for month/year and 7 days for day/week; bi-weekly remains correctly flagged for legal-verify.
- `combAmountCents` throws on over-wide positive amounts and leaves the blank separator cell for 9/10/11-cell amount combs. The rendered sample's amount/date comb alignment looked correct on page 1 and page 2.
- Migration `0140` is org-scoped with `organization_id in user_org_ids()` for `authenticated`. No explicit `service_role` grant is fine for prepare-only; service-role clients bypass RLS when Slice C needs public token reads/admin writes.

## Verification

Commands/checks run:

- `git status --short --branch`
- `git log --oneline --decorate -8`
- `git diff --stat 7fa4b36..132964b`
- `git diff --name-only 7fa4b36..132964b`
- Targeted source review of:
  - `7fa4b36..a60cbb8 -- app/dashboard/properties/actions.ts lib/membership.ts app/dashboard/admin/concierge-actions.ts`
  - `7fa4b36..132964b -- lib/n4.ts lib/forms/shared-combs.ts lib/n4-official-pdf.ts supabase/migrations/0140_notices.sql`
- `rg` for `showing_instructions`, `requestConciergePublish`, `getCurrentOrg`, `fillOfficialN4`, `notices`, and N4 helpers.
- Current official Tribunals Ontario N4 PDF spot-check:
  - `https://tribunalsontario.ca/documents/ltb/Notices%20of%20Termination%20%26%20Instructions/N4.pdf`
- `npx tsx scripts/test-distribution-concierge.ts`
  - Passed: `test-distribution-concierge: 60/0`
- `npx tsx scripts/test-n4.ts`
  - First sandbox run failed with `listen EPERM` on the `tsx` IPC pipe.
  - Escalated rerun passed: `test-n4: 70/0`
- `N4_SAMPLE_OUT=/private/tmp/vacantless-n4-sample.pdf npx tsx scripts/test-n4-pdf.ts`
  - Escalated run passed: `test-n4-pdf: 17/0`
  - Output included expected pdf-lib message: `Removing XFA form data as pdf-lib does not support reading or writing XFA`
- `pdfinfo /private/tmp/vacantless-n4-sample.pdf`
  - `Form: AcroForm`
  - `JavaScript: no`
  - `Pages: 3`
- Rendered sample with `pdftoppm`; rendering completed but emitted noisy fontconfig cache warnings. Visually checked page 1 and page 2 PNGs for nonblank output and comb alignment.
- `./node_modules/.bin/tsc --noEmit`
  - Passed.
- `npm run lint`
  - Exited 0, but printed the existing warning at `app/job/[token]/page.tsx:184` about `<img>` vs `next/image`.

## Repo State Notes

Observed dirty/untracked repo state before writing this handoff already included older unrelated handoff/deploy clutter. I left it untouched.

This review added:

- `codex-handoffs/CODEX-QA-HANDOFF-S475-S477-REVIEW.md`
