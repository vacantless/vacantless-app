# CODEX PROMPT - S660: photos are stored under the wrong org's prefix, and duplicate silently clones zero

Repo: `vacantless-app`. Base: `main` at `3084501`.
Branch: `codex/s660-crossorg-photo-storage`

> **AMENDED 2026-08-17 (S661). CHANGE 1 IS COMPLETE FOR ALL FOUR LISTINGS - do not redo any of it.**
> The audit query now returns **ZERO ROWS**. Glenrose Units 4+5 (19), Growth Test 833 Pillette Unit 3
> (18) and the QA seed (3) are all re-homed, each verified byte-identical on size and eTag and proven
> on the public page plus an RLS-scoped authenticated `list` as the owning org.
> **No original was deleted** - 37 orphaned objects remain in place as Noam's separate approved
> delete. Full record: `claude/STATUS-CROSSORG-PHOTO-REHOME-S661.md`.
>
> **`0215` IS NOW SAFE TO APPLY** (re-confirm the audit reads zero first).
>
> **Your job is changes 2, 3, 4 and 5 - the CODE. Plus one thing the data fix did not resolve:
> `scripts/rehome-property-photo-prefixes.mjs` still cannot run.** See the blocker below. Either make
> it runnable or delete it, but do not leave a preflighted script in the tree that nobody can execute.

## Why

Two defects, one root cause. **A real customer is affected**, so read the priority order below
before picking up any of it.

### The data problem

`property_photos.storage_path` is expected to begin with the owning property's
`organization_id`. Four listings violated that. **Two are now fixed, two remain**
[verified 2026-08-17 via Supabase]:

| Listing | Owning org | Photos actually under | N | State |
|---|---|---|---|---|
| 833 Pillette Rd Unit 3, Windsor (available) | Growth Test `8ea1da48` | Agile Real Estate Group `921f7c08` | 18 | **OPEN** |
| 833 Pillette Road, Windsor (QA seed) | North Star Rentals QA `b733a191` | literal `seed` | 3 | **OPEN** |
| 50 Glenrose Ave Unit 4, Toronto (available) | Abbas Husain `b2cb4eab` | ~~Davis Muscovitch Rentals `9315e41e`~~ | 11 | FIXED S661 |
| 50 Glenrose Ave Unit 5, Toronto (leased) | Abbas Husain `b2cb4eab` | ~~Davis Muscovitch Rentals `9315e41e`~~ | 8 | FIXED S661 |

Every org here belongs to Noam, so there is no third-party exposure today. The exposure is
operational: **if the org whose prefix is borrowed is ever cleaned, re-keyed or offboarded, the
listing loses its photos**, and any authenticated storage operation performed as the owning org
against those objects fails. This is the same cross-org class as the S566 identity failures and the
50 Glenrose Page incident, now in the storage layer.

Nothing looks wrong in the UI because the bucket serves public URLs. The first operation that
needed authenticated storage access is the one that broke.

### The code problem it surfaced

Duplicating `5a1e0c7d` produced draft `46def756-bb4e-4077-b87c-14ac68566692` with **0 of 18
photos**. Storage RLS on `storage.objects` is scoped by the leading org segment
(`property_photos_select` / `_insert`, role `authenticated`), so reading as a Growth Test user the
source objects are out of scope and `.copy()` is refused 18 times.

`app/dashboard/properties/actions.ts:1338-1342`:

```ts
const { error: copyErr } = await supabase.storage.from(PHOTO_BUCKET).copy(c.fromPath, c.toPath);
if (copyErr) continue; // best-effort: skip a failed copy, keep going
```

`copyErr` is discarded. The operator lands on `?duplicated=0` with no reason given, and a listing
that cannot post to Instagram at all, because IG requires a cover image.

## Priority order - do not reorder this

1. ~~Re-home the two 50 Glenrose photo sets.~~ **DONE S661.** See the amendment banner.
2. Stop swallowing the copy error.
3. Make duplicate work across prefixes.
4. Add the write-time guard.
5. Growth Test and QA seed fixtures last. They are test data.

## Scope

### Change 1 - re-home the two REMAINING mis-prefixed photo sets (fixtures only)

The customer half of this is closed. What is left is 18 Growth Test photos under the Agile prefix
and 3 QA seed photos under the literal prefix `seed`.

**Do not try to do these with a service-role edge function and do not do them from a Cowork
sandbox.** Both were tried in S661 and both are structurally blocked: neither the cloud sandbox nor
`device_bash` has network to `supabase.co`, and deploying a one-off edge function to the prod
project is refused by the sandbox permission classifier. A repo script run on a machine with real
network is fine.

**Do NOT add a membership row to Agile Real Estate Group to make a browser-session copy work.**
Agile is a LIVE org. No single login spans Agile `921f7c08` and Growth Test `8ea1da48`, and that is
correct, not a bug to route around [verified 2026-08-17 via `memberships`].

The route that works without touching Agile at all: the `property-photos` bucket is **public**, so
the source objects can be **read by public URL with no auth whatsoever**; the upload then happens
under the DESTINATION org's own credentials, which the RLS insert policy already permits. For each
affected photo row:

- Fetch the object from its current public URL.
- Upload it to `"{owning_org_id}/{property_id}/{filename}"` as a principal that belongs to the
  owning org.
- Verify the destination exists and is byte-identical, by comparing `metadata->>'size'` AND
  `metadata->>'eTag'` in `storage.objects` against the source row. Do not trust the write API's own
  response as the verification.
- Update `property_photos.storage_path` and `.url` to the new location.
- **Only then** consider removing the original.

**Standing rule: never destroy a live or paid asset before the replacement is PROVEN.** Do the
copy and the repoint, verify the public listing page renders every photo, and leave the originals
in place. Deleting them is a separate, later, explicitly-approved step. A dangling duplicate object
costs pennies; a customer's live listing losing its photos does not.

Note the QA seed row uses the literal prefix `seed`, not a UUID. Handle or explicitly skip it;
do not crash on it.

### Change 2 - stop swallowing the copy error

In `duplicateProperty`, log `copyErr` with the path, and distinguish the outcomes. "Copied 0 of 18"
must not read the same as "this listing had no photos". Surface a distinguishable signal when
`clonedCount === 0 && sourcePhotos.length > 0`.

`photos_ready` handling at `:1374-1380` is already correct - it only inherits `true` when every
photo came across. Keep it.

### Change 3 - make duplicate work regardless of source prefix

Do not assume `storage_path` shares the caller's org prefix. Either derive the source prefix from
the row itself, or perform the copy with a service-role client guarded by an explicit ownership
check that the caller's org owns the SOURCE property. Do not widen RLS.

### Change 4 - a write-time guard

Prevent a `property_photos` row whose `storage_path` prefix disagrees with the property's
`organization_id`. A CHECK-style assertion or insert-time validation would have caught all four of
these when they were written. Confirm the guard does not reject the QA seed convention, or migrate
that fixture first.

**Ordering constraint added S661:** as of 2026-08-17 there are still **two violating listings in
prod** (Growth Test 18, QA seed 3). A guard that validates on UPDATE as well as INSERT will make
those rows unwritable. Either land change 1 for the fixtures BEFORE the guard, or scope the guard to
INSERT only in the first pass. Do not ship a guard that a live prod row already violates without
saying so explicitly in the PR.

### THIS IS NOW BUILT, AND IT HAS AN ORDERING DEADLOCK. Read before applying anything.

`codex/s660-crossorg-photo-storage` at **`c41f000`** (local only, **not pushed**, 1 commit ahead of
`main`) contains `supabase/migrations/0215_property_photos_storage_prefix_guard.sql` plus
`scripts/rehome-property-photo-prefixes.mjs`.

**The precise behaviour, read from the migration, not assumed:** the trigger is
`before insert or update **OF property_id, organization_id, storage_path**`. It is column-scoped, so
the 21 fixture rows are **not** globally unwritable - `sort_order`, `is_cover` and `url` updates
still succeed. What it blocks is any update touching those three columns.

**`storage_path` is one of them, and `storage_path` is exactly what the re-home has to update.**

> **Applying 0215 before running the re-home script blocks the re-home script.** The migration
> forbids the repair it is waiting for. `scripts/rehome-property-photo-prefixes.mjs` has **no
> awareness of the trigger** (no `session_replication_role`, no disable/enable, no mention of 0215),
> and a trigger fires for the service role too, since only RLS is bypassed. It would fail on the
> `UPDATE`, not on the storage copy.

**Correct order, no exceptions:**

1. Run `scripts/rehome-property-photo-prefixes.mjs` (it defaults to dry-run; `--apply` turns it on).
2. Confirm the audit query returns **zero** rows.
3. Only then apply `0215`.

### BLOCKER FOUND 2026-08-17: the script CANNOT RUN. Its precondition is false in prod.

`--apply` aborts at `preflightUpdatePrivilege` (`:363`) with
**`permission denied for table property_photos`**. This is not an environment or key problem: a
legacy `service_role` JWT fails identically. The script's own header states "The service_role DB role
must also have update privilege on property_photos" - **nothing in this branch grants it, and it is
not granted in production.**

Measured grants [verified 2026-08-17 via `information_schema.role_table_grants`]:

| Table | `service_role` privileges |
|---|---|
| `public.property_photos` | `REFERENCES, SELECT, TRIGGER, TRUNCATE` - **no INSERT/UPDATE/DELETE** |
| `storage.objects` | full DML - **fine**, so change 3's admin-client `storage.copy` does work |

So the storage half of this branch is sound and only the row-update half is blocked.

**Context before you "just add the grant".** `property_photos` is one of **13 of 93** public tables
where `service_role` is read-only. The others are `availability_days_off`, `availability_overrides`,
`availability_rules`, `concierge_leaseup_claims`, `concierge_usage`,
`distribution_partner_accounts`, `feedback`, `lease_ocr_usage`, `notices`, `rental_applications`,
`templates`, `user_preferences`. That set looks like **grant drift across migrations** rather than a
deliberate security boundary, but intent is unproven. Two consequences:

1. If you add the grant, ship it as a **migration in this branch** with a one-line rationale, not as
   an ad-hoc console `GRANT`. Widening what every service-role key can do to a table is a real
   change and belongs in review.
2. Any future service-role job touching one of those other 12 tables hits the same wall. Worth a
   separate ticket to decide the intended posture rather than fixing them one crisis at a time.

**The 18 Growth Test rows were completed on 2026-08-17 WITHOUT this grant**, using a Growth Test
user session for the uploads (the `authenticated` role has full DML on both `property_photos` and
`storage.objects`, and RLS permits writing under the caller's own org prefix) plus a `postgres`-role
`UPDATE` for the repoint. **All four listings are fixed and the audit query reads zero.**

### RECOMMENDATION: DELETE the script. Do not add the grant.

The script existed to perform a **one-off remediation that is now complete**. Adding a permanent
privilege - `service_role` write on `property_photos` - to keep a finished one-off runnable is a bad
trade: the grant outlives the need, and it widens what every service-role key can do to a table
holding customer listing photos. Deleting the script also removes the trap of a preflighted file in
the tree that nobody can execute.

If you disagree and want it kept runnable, then the grant must ride as a **scoped migration in this
branch** (`grant update on public.property_photos to service_role;`) with a written rationale, and
the PR must say plainly that it widens service-role privilege. Do not add it silently alongside
other work.

Either way, **the session-based route is the documented one going forward** and needs no privileges
at all: read sources by public URL, upload under the destination org's own login, repoint the rows.
See `claude/STATUS-CROSSORG-PHOTO-REHOME-S661.md`.

The three guard conditions and where prod stands against them [verified 2026-08-17 via Supabase]:

| Rows | `photo.organization_id = property.organization_id` | `storage_path` prefix matches | 0215 verdict |
|---|---|---|---|
| 50 Glenrose U4 (11) + U5 (8) | pass | pass | **accepted** |
| Growth Test (18) | pass | **fail** | rejected on a guarded-column update |
| QA seed (3) | pass | **fail** (`seed`) | rejected on a guarded-column update |

So the S661 re-home left the Glenrose rows fully consistent on all three conditions, including the
`organization_id` column the trigger also checks. 0215 is safe for them.

The script never deletes originals (`:9`) and treats an existing destination as `already-present`
(`:220`, `:251`), so re-running it over Glenrose is a safe no-op.

## Verify

```sql
select p.id, p.address, p.status, o.name as org,
       split_part(ph.storage_path,'/',1) as prefix, count(*) as photos
  from property_photos ph
  join properties p on p.id = ph.property_id
  join organizations o on o.id = p.organization_id
 where p.organization_id::text <> split_part(ph.storage_path,'/',1)
 group by 1,2,3,4,5 order by photos desc;
```

Expect **zero rows** when this is done. As of 2026-08-17 it returns **two** rows, Growth Test (18)
and the QA seed (3). Re-run it after the fixture re-home and paste the result into the PR.

Verify by opening the **public listing page** for each listing you touch and confirming every photo
still renders, against a count taken BEFORE the change. Prove it on the public surface, not by
trusting the table.

The public page is not sufficient on its own, because a public bucket serves the old prefix happily
and hides the entire defect. Also prove it at the layer that was broken: an authenticated,
RLS-scoped `POST /storage/v1/object/list/property-photos` on
`"{owning_org_id}/{property_id}/"` as a principal of the owning org must return the full photo
count. That is the assertion that fails before a re-home and passes after.

## Tests

- Duplicate a property whose photos sit under a different org prefix: all photos clone.
- Duplicate a property with zero photos: unchanged behaviour, no false error.
- A partial copy failure still leaves `photos_ready=false` and reports the real count.
- The write-time guard rejects a mis-prefixed insert and permits a correct one.

## Related

- `claude/STATUS-CROSSORG-PHOTO-REHOME-S661.md` - change 1 for the customer listings, done and proven.
- `claude/FINDINGS-DUPLICATE-PHOTO-COPY-AND-CROSSORG-STORAGE-S660.md` - the full finding.
- Empty draft `46def756-bb4e-4077-b87c-14ac68566692` ("Copy of 833 Pillette Rd, Unit 3") is the
  artifact of the failed clone. Safe to delete once this is fixed.
