# duplicateProperty silently clones ZERO photos, because Growth Test's photos live under the Agile org prefix (S660, 2026-08-16)

**STATUS 2026-08-17 (S661): PARTLY CLOSED. The customer half of defect 2 is FIXED and proven.**
The two 50 Glenrose photo sets now sit under Abbas Husain's own prefix, verified byte-identical and
proven on the public pages and on an RLS-scoped authenticated `list` as Abbas's org. **Defect 1 is
untouched** and still open, and two FIXTURE listings (Growth Test 18, QA seed 3) are still
mis-prefixed. See `claude/STATUS-CROSSORG-PHOTO-REHOME-S661.md`.
The 19 original objects under the Davis prefix were deliberately left in place.

Found while building a reviewer fixture for the Meta App Review submission.

---

## Defect 1: a duplicate can silently produce a photo-less listing

Duplicating `5a1e0c7d` (833 Pillette Rd Unit 3, Growth Test) created draft
`46def756-bb4e-4077-b87c-14ac68566692` with **0 of 18 photos**. The app redirected to
`?duplicated=0` and reported it, so it is not hidden, but nothing failed loudly and the operator is
left with a listing that cannot be posted to Instagram at all (IG requires a cover image).

The copy loop is deliberately best-effort (`actions.ts:1338-1342`):

```
const { error: copyErr } = await supabase.storage.from(PHOTO_BUCKET).copy(c.fromPath, c.toPath);
if (copyErr) continue; // best-effort: skip a failed copy, keep going
```

`copyErr` is discarded. When every copy fails, the operator gets `duplicated=0` and no reason.
`photos_ready` is correctly left `false` (`:1374-1380`), which is the one part that behaves well.

## Defect 2 (the root cause): a Growth Test listing's photos are stored under the AGILE org prefix

All 18 rows for `5a1e0c7d` have `storage_path` beginning
`921f7c08-98af-428f-a238-36f4a781b0de/` = **Agile Real Estate Group**, not Growth Test
`8ea1da48-0cd2-45a4-bfba-023b31a67884` [verified 2026-08-16 via Supabase]:

```
select distinct split_part(storage_path,'/',1), count(*)
  from property_photos where property_id='5a1e0c7d-...';
-> 921f7c08-98af-428f-a238-36f4a781b0de | 18
```

Storage RLS on `storage.objects` is per-bucket and scoped by the leading org segment
(`property_photos_select` / `_insert`, role `authenticated`). Reading as a Growth Test user, the
source objects are out of scope, so `.copy()` is refused 18 times and swallowed 18 times.

**The listing renders fine** because the bucket serves public URLs, so nothing looks wrong until
something needs authenticated storage access. Duplicate is the first thing that did.

### It is NOT just Growth Test - a real customer is affected

Running the audit query below across the whole table [verified 2026-08-16 via Supabase]:

| Property | Org that owns the listing | Org prefix the photos actually sit under | Photos | State |
|---|---|---|---|---|
| 833 Pillette Rd, Unit 3, Windsor (available) | Growth Test | **Agile Real Estate Group** | 18 | OPEN |
| 833 Pillette Road, Windsor (QA seed) | North Star Rentals QA | literal `seed` | 3 | OPEN |
| 50 Glenrose Ave, Unit 4, Toronto (available) | Abbas Husain | ~~Davis Muscovitch Rentals~~ | 11 | FIXED S661 |
| 50 Glenrose Ave, Unit 5, Toronto (leased) | Abbas Husain | ~~Davis Muscovitch Rentals~~ | 8 | FIXED S661 |

**The two 50 Glenrose listings belong to a real customer and their photos are stored under a
different business's prefix.** All the orgs involved are Noam's, so there is no third-party
exposure today. The exposure is operational: if Davis Muscovitch Rentals' storage is ever cleaned,
re-keyed, or that org is offboarded, **Abbas's live listing loses its photos**, and any
authenticated storage operation performed as Abbas's org against those objects fails exactly the
way duplicate just did.

This is the same cross-org class as the S566 identity failures and the 50 Glenrose Page incident,
now in the storage layer. It keeps recurring on the same listings.

### Why this does NOT change the Meta posts

The Instagram and Facebook posts published 2026-08-16 from Growth Test carry an image served out of
the Agile org's storage. Same owner on both sides, no third-party exposure, and the photo is a
genuine photo of the listing being advertised. This is **not** a reason to take those posts down or
republish.

## Reproduce

1. Growth Test, open `5a1e0c7d`.
2. Click "Duplicate this property".
3. Land on `?duplicated=0`. New draft has 0 photos.
4. `select storage_path from property_photos where property_id='5a1e0c7d-...'` shows the Agile prefix.

## Suggested fix direction

- **Stop swallowing the error.** Log `copyErr` and surface a distinguishable outcome when
  `clonedCount === 0 && sourcePhotos.length > 0`. "Copied 0 of 18 photos" should not read the same
  as "this listing had no photos".
- **Do not assume `storage_path` shares the caller's org prefix.** Either derive the source prefix
  from the row rather than the caller, or perform the copy with a service-role client that is not
  subject to the per-org path policy, scoped by an explicit ownership check on the property.
- **Re-home the two 50 Glenrose photo sets under Abbas's own org prefix FIRST.** That is the only
  entry on this list with a real customer behind it. Copy the storage objects to
  `b2cb4eab-.../<property_id>/...` with a service-role client, repoint `property_photos.storage_path`
  and `.url`, verify the public listing still renders, and only then remove the originals (standing
  rule: never destroy a live asset before the replacement is proven).
- Re-seed Growth Test fixtures so a test org owns its own assets.
- **Add a guard** so a photo row cannot be written whose `storage_path` prefix disagrees with the
  property's `organization_id`. A CHECK-style assertion or an insert-time validation would have
  caught all four of these at write time.

### The audit query, for re-running later

```sql
select p.id, p.address, p.status, o.name as org,
       split_part(ph.storage_path,'/',1) as prefix, count(*) as photos
  from property_photos ph
  join properties p on p.id = ph.property_id
  join organizations o on o.id = p.organization_id
 where p.organization_id::text <> split_part(ph.storage_path,'/',1)
 group by 1,2,3,4,5 order by photos desc;
```

Expect zero rows once this is fixed. **As of 2026-08-17 it returns two rows, both test data.**

### What the public page can and cannot prove (added S661)

The bucket is public, so the public listing page renders every photo whether or not the prefix is
correct. **A green public page is not evidence that this defect is fixed, and never was.** The
assertion that actually discriminates is an authenticated, RLS-scoped
`POST /storage/v1/object/list/property-photos` on `"{owning_org_id}/{property_id}/"` performed as a
principal of the OWNING org. Before a re-home it returns 0; after, it returns the full count. That
is the same scoping that refused `.copy()` 18 times in defect 1, so it tests the real thing.

## Consequence for the Meta App Review reviewer fixture

A reviewer given a photo-less draft would publish and get no Instagram post, which is worse than
giving them nothing. Until this is fixed, a publishable fixture needs photos uploaded through the
UI (which writes under the caller's own org prefix), not cloned.

## Related

- Gate 2 - `publishProperty` no-ops on an already-live listing, so 833 Pillette itself cannot serve
  as a re-runnable fixture now that it is Live.
- `claude/FINDINGS-AUTHORIZE-RAIL-STALE-RENDER-S660.md` - the other S660 defect.
