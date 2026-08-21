# CODEX VERIFY+FINISH — S617: ESL simple-listing setup + posting plan (warm-verify the parked WIP branch)

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-03
**Type:** verify + finish an ALREADY-BUILT parked WIP branch. Pure IA/presentation slice on the existing property **detail** page (`/dashboard/properties/[id]`) — guides a landlord through a simple "get online" path. No new logic surface.
**Migration:** NONE. **Flag:** NONE (ungated presentation change — see Risk note).
**Risk:** low. Additive UI only; no data model, no server action, no migration, no new dependency. Blast radius = the setup + distribute tabs on the property detail page and one deep-link on the properties list.

## The branch (do NOT re-derive — Cowork verified this on 2026-08-03)
- Branch: **`wip/esl-simple-listing-posting-plan`**, single commit **`0d7eb40`** ("wip(esl): simple-listing setup + posting plan (S614 carryover, unverified)").
- **Merge-base is the CURRENT main tip `3d9117d`** — the branch is `main + 1 commit`. All 3 files are untouched on `main` since, so it applies as a **clean fast-forward, zero conflict** (`git merge-tree` = clean).
- Diff = **3 files, +320 / −33**:
  - `app/dashboard/properties/[id]/distribute-tab.tsx` (+223): new `SimplePostingPlan` 5-step ordered-checklist component; `DistributionBasicsPanel` re-keyed from `readyToShare`/`requiredOutstanding` → `linkIsLive`/`setupOutstanding`/`canSetLive`; readiness label now distinguishes *finish-details* → *set-live* → *post*.
  - `app/dashboard/properties/[id]/page.tsx` (+128): derives `setupOutstandingCount` / `setupReady` / `hasListingPhotos` from `readiness.checks` + `photoRows`; adds the "Finish the simple listing first" 3-card guide; relabels tabs (`Setup`→`Edit listing`, `Post online`→`Get online`); converts **Showings** and **More details** sections into collapsible `<details>` accordions; passes `setupOutstanding` / `hasPhotos` / `canSetLive` into the distribute tab.
  - `app/dashboard/properties/page.tsx` (+2): the list "Edit" button deep-links to `#rental-details`.

## What Cowork already static-verified (so you know where to focus)
All referenced symbols resolve and are type-coherent on the branch: `linkIsLive` (pre-existing prop, already passed), `Icons` (imported from `@/components/icons`), `searchParams.tourerr` (typed `tourerr?: string` at page.tsx:357), `photoRows` (page.tsx:419), and `readiness.checks.required` — that field is `ShareCheck.required` (`lib/share-readiness.ts:20`), **used identically by pre-existing code at page.tsx:1107**, so the new filter is type-safe. New props are defined + threaded at all call sites. All 6 anchor targets resolve to real ids (`#publish-checklist` → `launch-run-panel.tsx`, `#property-photos` → `photo-manager.tsx`, `#publish-action` / `#share` / `#property-rent` / `#listing-description` / `#rental-details` present). What was NOT run: `tsc` / `next build` / `lint` — **that is your job.**

## The job (verify → fix → finish; do NOT push)
1. `git checkout wip/esl-simple-listing-posting-plan` (it is already `main` + 1 commit; do NOT rebase — merge-base is already the current main tip).
2. Run every gate below. If a gate fails, fix it **within the existing 3 files only** — do not widen scope, do not add files, do not touch anything the diff didn't already touch. If a fix genuinely needs a new pure helper, keep it local and minimal.
3. If the slice is trivially clean (likely), make no code change. If you did make fixes, keep them in the branch.
4. **Reword/finish the commit into one clean commit** (amend, single commit — see Commit below). Drop the "unverified" WIP wording.
5. Reply with branch + SHA + diffstat + every gate's result (counts). **Do NOT push** — Noam file-scoped pushes after reviewing.

## Gates (all must pass; report each verbatim)
- `npx tsc --noEmit`  → 0 errors
- `npm run lint`  → clean (report any new warnings on the 3 files)
- `npm run build`  → succeeds
- `git diff --check`  → no whitespace/conflict markers
- Existing pure test suites still green — run the lead/property ones and report counts: `npm run test`, `npm run test:property-qa`, `npm run test:ai-reply`. (This slice adds no pure logic worth a new unit test; it's presentation. If `tsc`/build surface a real defect, fix it — do not paper over with `any`.)

## Dogfood checklist (the one behavioral risk — verify by hand, not just build-green)
The diff converts **Showings** and **More details** into collapsed `<details>`, and the new cards/steps deep-link across the page (and, for photos, effectively across tabs). Confirm the deep-links actually land, using the existing `section-deeplink-opener.tsx` (built to expand a collapsed `<details>` when its `#anchor` is targeted):
- Setup tab renders the "Finish the simple listing first" 3-card guide; the "N details left" / "Basics ready" badge reflects `setupOutstandingCount` correctly.
- "Showings" and "More details" render collapsed and expand on click; the "More details" `<details>` auto-opens when `?tourerr=` is present (existing behavior preserved).
- Distribute tab renders "Simple posting plan" with the 5 steps in order; done/undone states track `setupOutstanding` / `hasPhotos` / `linkIsLive` / `hasRun` / `liveChannels`.
- Each step/card button scrolls to its target — **especially "Add photos" → `#property-photos`** (lives in the photo manager) and "Choose sites / Open checklist" → `#publish-checklist` (launch-run panel). If any deep-link into a now-collapsed section fails to open it, that's the fix to make (extend the deeplink-opener coverage, not restructure the page).
- With `ai_reply`/status unchanged, the page's other tabs (market / inquiries) render exactly as before.

## Do NOT
- Do NOT push, add a migration, add a flag, or change any server action / data model.
- Do NOT `git add -A` — commit the 3 files **by name** (the working tree has unrelated untracked `claude/*.md` + `_to_delete/` that must NOT be swept in).
- Do NOT expand the slice (no new sections, no copy rewrites beyond what the diff already contains, no touching `/dashboard/properties/new` — that's the separate S614 add-property flow).
- Do NOT "fix" the collapsed-`<details>` deep-link by un-collapsing the sections; the collapse is the intended IA.

## Risk note (ungated — Noam's call before push)
This ships behind no feature flag, so a clean push makes it live for all operators on the next deploy. That's fine for a reversible presentation change, but call it out in your reply so Noam pushes deliberately. If Noam wants it dark first, the cheap option is wrapping the new setup-guide section + `SimplePostingPlan` render behind an env check — flag this as an option, do not build it unless asked.

## Commit (single, clean — amend the WIP commit)
```
feat(properties): simple-listing setup guide + posting plan on the property detail page

Guides landlords through a simple get-online path: a "finish the basics" setup
guide, collapsed optional sections, and an ordered posting plan on the distribute
tab. Presentation/IA only — no migration, no flag, no server-action change.
```
Reply branch/SHA/diffstat + all gate results. **Do NOT push.** No migration.
