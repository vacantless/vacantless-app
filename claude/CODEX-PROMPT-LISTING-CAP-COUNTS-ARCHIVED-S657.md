# CODEX PROMPT - free-plan listing cap counts ARCHIVED listings (S657)

**Repo:** `vacantless-app`
**Base:** `main` at `eee04f9`
**Branch to create:** `codex/s657-listing-cap-ignores-archived`
**Ship state:** commit on the branch. Do NOT push.

---

## WHY

`publishProperty` (`app/dashboard/properties/actions.ts:1100`) enforces the free-plan live
listing allowance. The count it uses is:

```ts
const { count: liveCount } = await supabase
  .from("properties")
  .select("id", { count: "exact", head: true })
  .eq("status", "available")
  .neq("id", id);
if ((liveCount ?? 0) >= cap) {
  redirect(`/dashboard/properties/${id}?publish=plan`);
}
```

It filters on `status` alone. **It does not exclude archived rows.**

Archiving a property sets `properties.archived_at` but leaves `status` untouched. So an archived
listing keeps `status = 'available'` forever and keeps consuming the org's allowance, while being
invisible in the Rentals list (which filters on `archived_at`).

`listingCapForPlan` (`lib/billing.ts:591`) returns `TIERS.free.maxActiveListings` for free /
trial / unknown plans, and `null` (unlimited) for any paid or pilot plan. So this only bites
**free-tier customers** - the ones least equipped to diagnose it.

### The failure the user sees

A free customer publishes listing A, later archives it, then adds listing B and clicks publish.
They are bounced to `?publish=plan` and told they are at their limit. The Rentals list shows
zero active listings. There is no surface anywhere in the product that shows them the archived
row that is holding their only slot. They cannot self-serve out of it.

### Verified 2026-08-16

Org `Growth Test` `8ea1da48-0cd2-45a4-bfba-023b31a67884`, plan free (cap 1):

| id | address | status | archived_at |
|---|---|---|---|
| `092591ea-...` | 350 City Hall Square West | `available` | **2026-08-05 18:52:02+00** |
| `5a1e0c7d-...` | 833 Pillette Rd, Unit 3 | `draft` | null |

Publishing the second listing hit the cap because the first - archived eleven days earlier and
absent from every list view - still counted. Confirmed by setting the archived row to
`off_market`, after which publish succeeded. That workaround is already applied in prod to
Growth Test only; **it is a workaround, not the fix, and this branch should not depend on it.**

---

## WHAT TO BUILD

Exclude archived rows from the cap count.

```ts
.eq("status", "available")
.is("archived_at", null)
.neq("id", id)
```

Then **audit every other place that counts or gates on live listings** and apply the same rule
where it is missing. Search at minimum for `maxActiveListings`, `listingCapForPlan`, and
`.eq("status", "available")` across `app/` and `lib/`. Report in the PR body every site you
found and, for each, whether it already excluded archived rows or you changed it. Do not fix
only the one site named above and stop.

Two candidate follow-ons - decide and justify, do not silently skip:

1. Should archiving a listing also move `status` off `available`? That would be the deeper fix,
   but it changes semantics for un-archive and may have other readers. If you believe it is
   right, say so in the PR body and propose it as a **separate** branch. Do not do both in one
   commit.
2. When the cap does fire, the `?publish=plan` message should be able to say how many listings
   are live and where they are. Out of scope for this branch unless it falls out for free.

## ACCEPTANCE CRITERIA

Report the ACTUAL result of each.

1. A free-plan org with exactly one `status='available'` **archived** listing can publish a new
   listing. Before the change it is blocked; after, it succeeds.
2. A free-plan org with one `status='available'` **non-archived** listing is still blocked at the
   cap. The allowance itself is unchanged.
3. Paid and pilot plans are unaffected (`listingCapForPlan` returns null; the count never runs).
4. Every additional live-listing count site you found is listed in the PR body with its verdict.
5. `npm run build` passes.

## PROVE THE COMMIT

Report `git diff main...codex/s657-listing-cap-ignores-archived --stat` verbatim. Not
`git status`, not plain `git diff`.
