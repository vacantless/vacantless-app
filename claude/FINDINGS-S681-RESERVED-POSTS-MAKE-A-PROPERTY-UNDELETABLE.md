# FINDINGS S681 - a co-pilot reservation makes a property PERMANENTLY undeletable through the UI

Session 681, 2026-09-05. Found while trying to hard-delete three test properties in
**Davis Muscovitch Rentals** (`9315e41e`), Noam's own org, at his request.

## The defect in one line

`deleteProperty` counts listing_posts **unfiltered**, but the where-posted tracker
**hides** url-less draft posts that a run item references. So those rows block the delete
while being invisible and unremovable. There is no UI path out.

## The two halves that disagree

**Render side** - `app/dashboard/properties/[id]/page.tsx:1658-1680` builds
`reservedPlumbingPostIds`: every `listing_posts` row with `status = 'draft'` and no `url`
**that a `distribution_run_items` row references**. Those ids are skipped when
`postsByPortal` is assembled, so they never render, so their `removeListingPost` form at
`distribute-tab.tsx:3357` never exists. The comment says this is deliberate, and it is
right to hide them: the co-pilot reservation is plumbing, not an operator-entered post.

**Delete side** - `app/dashboard/properties/actions.ts:1448` calls
`countPropertyReferences(supabase, "listing_posts", org.id, id)` with no such filter, and
`hardDeletable` (`lib/property-archive.ts:15-27`) requires `postCount === 0`.

A row hidden by the first is still counted by the second. The Delete control is therefore
hidden on the list page, and `deleteProperty` also redirects to `?delete_blocked=1` if
reached directly, so both the client and the server agree on refusing forever.

## Verified state, all six rows

Every stub is `status = draft`, `url = null`, `posted_on = null`, `label = null`, and
referenced by exactly one `distribution_run_items` row. All six match the hide condition.

| Property | Portal | listing_post | run item | run | run status |
|---|---|---|---|---|---|
| ZZZ TEST S515 - delete me | facebook | `52d99ddf` | `7903c715` | `bee647cb` | active |
| ZZZ TEST S515 - delete me | kijiji | `1d458d49` | `478106d9` | `bee647cb` | active |
| 2419 Mercer Street | kijiji | `d2c7b71d` | `bc0806aa` | `c7129f88` | active |
| 59 Dupont St | facebook | `02e0232f` | `08e8316d` | `a43aea05` | active |
| 59 Dupont St | kijiji | `425935fe` | `51cf22a2` | `a43aea05` | active |
| 59 Dupont St | linkedin | `224b7001` | `6b9651ce` | `a43aea05` | active |

All three runs are still `active` with `pending` items, abandoned since 2026-07-20,
2026-08-04 and 2026-08-07. All three properties have **zero leads and zero tenancies**.

## Proved live, not inferred from the repo

- 59 Dupont (`draft`): Get online tab renders zero Remove controls. Page text reads
  "Set this rental Live before adding posts or sharing tracked links."
- 2419 Mercer (`available`, Live): **also zero Remove controls.** This is the decisive
  check. It rules out "the gate is just Live" and isolates the cause to the
  reserved-plumbing hide.
- Properties list: every row offers **Archive only**, no Delete.

## Why this matters beyond three test rows

**The standing attribution rule is to reserve the `listing_posts` row FIRST, build the
tracked link from its id, then post.** That rule manufactures exactly the row shape that
triggers this. So every property that ever enters the co-pilot and does not complete a
post accumulates a permanent, invisible delete blocker. This grows with normal use.

## What NOT to do

**Do not "fix" this by filtering the shared `listingPostCount` query.** That count also
gates `hardDeletable` as a deletion SAFETY guard, and loosening it broadly risks deleting
a property that has real tracked posts. The existing standing rule against that still
holds.

## THE FIX, BUILT AND VERIFIED 2026-09-05 (NOT DEPLOYED)

**The first scoping of this was WRONG in one way worth recording: it called for a manual
cascade. None is needed.** The live schema was checked and `properties` already cascades
everything:

| child | parent | on delete |
|---|---|---|
| `listing_posts.property_id` | properties | **CASCADE** |
| `distribution_runs.property_id` | properties | **CASCADE** |
| `distribution_run_items.run_id` | distribution_runs | **CASCADE** |
| `distribution_publish_attempts.run_item_id` | distribution_run_items | CASCADE |
| `tenancies.property_id` | properties | **RESTRICT** (guard is doubly enforced) |

So the reserved plumbing is cleaned up by the FKs. **The defect was ONLY the count.**

**New module `lib/listing-post-reservations.ts`** holds the rule once: `isUnpostedDraft`,
`reservedListingPostIds`, `visibleListingPostCount`, `loadReservedListingPostIds`. Pure
functions; the DB round trip is injected by the caller so the module imports no Supabase
client and is fully unit-testable.

Three call sites now share it, which is the actual fix. The count parity was the symptom;
the single definition is the cure:

1. `app/dashboard/properties/[id]/page.tsx` - the existing inline block replaced by the
   helper. Behaviour unchanged, it is now the same code the other two run.
2. `app/dashboard/properties/actions.ts` - new `countOperatorVisibleListingPosts` replaces
   `countPropertyReferences(..., "listing_posts", ...)` in `deleteProperty`'s guard.
3. `app/dashboard/properties/page.tsx` - `postCounts` (which gates the Delete control)
   excludes reservations. `livePostCounts` is deliberately UNTOUCHED: it drives the launch
   state, not deletion.

**The standing rule is respected.** The shared `listingPostCount` query was NOT loosened.
A real tracked post still blocks the delete, which is what `hardDeletable` is for.

### Proofs

- `npx tsc --noEmit` on the whole project: **exit 0**.
- `scripts/test-listing-post-reservations.ts`: **19 passed, 0 failed**. Includes the two
  guard cases: a referenced LIVE post is never reserved, and a hand-made url-less draft
  that no run item references stays visible and keeps its Remove control.
- **Blast-radius audit, the rule run in SQL across every org in the database.** Eight
  properties carry reserved posts. Exactly **three** flip from undeletable to deletable:

| Org | Property | Status | Posts total / visible | Flips? |
|---|---|---|---|---|
| Davis Muscovitch Rentals | 59 Dupont St | draft | 3 / 0 | **yes, intended** |
| Davis Muscovitch Rentals | ZZZ TEST S515 | draft | 2 / 0 | **yes, intended** |
| North Star Rentals QA | 1420 Ouellette Ave Unit 3 | off_market | 2 / 0 | yes, QA org, harmless |
| **Agile Real Estate Group** | **833 Pillette Unit 30** | off_market | 4 / 1 | **NO** (3 leads, 1 real post) |
| Growth Test | 833 Pillette Unit 3 | available | 6 / 4 | NO |
| Growth Test | 350 City Hall Square W | off_market | 5 / 3 | NO |
| Abbas Husain | 50 Glenrose Ave Unit 5 | leased | 1 / 0 | NO (tenancy) |
| Davis Muscovitch Rentals | 2419 Mercer Street | available | 1 / 0 | NO (status) |

**Nothing is deleted by this change. Three properties gain a Delete button.** No Agile
production property is affected.

## STATUS: BUILT, TYPECHECKED, TESTED, **NOT COMMITTED AND NOT DEPLOYED**

PROD is still `53463f5`. The working tree now carries the new module, the three call-site
edits and the test. Deploying is Noam's call and has not been asked for yet.

**2419 Mercer needs one more thing even after deploy:** it is `available`, and
`hardDeletable` requires `draft` or `off_market`. One status change, not a code problem.

[[project_agile_leasing_engine]]
