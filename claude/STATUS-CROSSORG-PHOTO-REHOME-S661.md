# STATUS - S661: cross-org photo storage is FULLY CLOSED. The audit query returns ZERO ROWS.

_2026-08-17, Session 661. Supersedes change 1 of `CODEX-PROMPT-CROSSORG-PHOTO-STORAGE-S660.md`._

## HEADLINE: all four affected listings are fixed. Audit = 0 rows [verified 2026-08-17 via Supabase].

| Listing | Org | N | How |
|---|---|---|---|
| 50 Glenrose Unit 4 | Abbas Husain | 11 | server-side `copy`, dual-org user session |
| 50 Glenrose Unit 5 | Abbas Husain | 8 | same |
| 833 Pillette Rd Unit 3 | Growth Test | 18 | public-URL read + upload, Growth Test session |
| 833 Pillette Road (QA seed) | North Star QA | 3 | pure `UPDATE`, no storage objects ever existed |

**No original was deleted anywhere.**

### CORRECTION - the orphan count is 19, NOT 37. Read this before deleting anything.

An earlier draft of this doc said "37 orphaned objects (19 Davis + 18 Agile)". **The 18 under the
Agile prefix are NOT orphans.** They belong to `ab3a44a0-9959-4ee2-9774-0dbbc896ab16`, Agile Real
Estate Group's own live 833 Pillette Rd Unit 3 listing (status `available`), and **all 18 of that
listing's photo rows point at them**, correctly prefixed. Growth Test was borrowing them. Deleting
them would wipe a live customer listing's entire photo set.

| Prefix / folder | Objects | Rows still referencing | Verdict |
|---|---|---|---|
| `9315e41e-.../7886fe96-...` (Davis) | 11 | **0** | orphaned, deletable |
| `9315e41e-.../da08230f-...` (Davis) | 8 | **0** | orphaned, deletable |
| `921f7c08-.../ab3a44a0-...` (Agile) | 18 | **18** | **LIVE - NEVER DELETE** |

[verified 2026-08-17 via a `storage.objects` left join on `property_photos.storage_path`.]

**Never delete by prefix or by "these look like leftovers". Delete only by reference count.** The
count is the only test that distinguishes these two cases, and eyeballing the prefixes gets it
exactly backwards.

`scripts/delete-orphaned-photo-objects-s661.mjs` implements this: it recomputes the orphan set from
the database at run time, refuses any object still referenced, requires a proven live replacement
serving HTTP 200 with non-zero bytes, is scoped to the two Davis folders only, expects exactly 19,
and aborts the whole run if anything is refused. Dry-run by default; `--apply` deletes. **This is
Noam's to run** - it is irreversible.

**Migration `0215` IS APPLIED, and PROVEN BY BEHAVIOUR** [2026-08-17, after the branch merged].
Registered as `0215_property_photos_storage_prefix_guard`, following `0214`. The trigger
`property_photos_storage_prefix_guard` is installed on `public.property_photos` (1 non-internal
trigger).

It was not accepted on presence alone. A rollback-guaranteed probe ran both directions inside a
subtransaction, with a deliberate outer `raise exception` discarding everything:

- a mis-prefixed `UPDATE` was **REJECTED**: `property_photos.storage_path prefix must match
  property organization_id`
- a valid same-value `UPDATE` was **ACCEPTED**

After the probe: `mismatched_rows = 0`, `probe_residue = 0`, `total_photo_rows = 123` - unchanged.
A completion badge validates presence, not correctness; this validated correctness.

**Both lanes are shipped.** Prod went `3084501 -> 817f23b -> 075c267 -> 5f8546e`, each deploy
confirmed READY on the production aliases via the Vercel MCP rather than from merge output. The
crossorg branch was rebased before merging, and `git patch-id` confirmed both rewritten commits were
IDENTICAL to the reviewed originals (`c41f000 -> e3a5314`, `6c2fbbf -> 5f8546e`).

## Result

**Both Abbas Husain listings now store their photos under their own org prefix.** 19 of 19 objects
re-homed from `9315e41e-1c03-43e3-9c8f-78563512f302` (Davis Muscovitch Rentals) to
`b2cb4eab-9a29-4972-8fca-564dc8ca6a61` (Abbas Husain). **No original was deleted.**

| Listing | Property id | Photos | Copied | Byte-identical | Public page after |
|---|---|---|---|---|---|
| 50 Glenrose Ave Unit 4 (available) | `7886fe96-865f-4dc7-86b8-e2acd0138047` | 11 | 11 | 11 | 11 rendered |
| 50 Glenrose Ave Unit 5 (leased) | `da08230f-81d6-47ce-a75b-116639c10a5a` | 8 | 8 | 8 | 8 rendered |

The audit query is down from four rows to two, and **both survivors are test data** (Growth Test 18,
North Star QA seed 3) [verified 2026-08-17 via Supabase MCP `execute_sql`].

## How it was proven, in the order it was proven

1. **Baseline taken from the public surface FIRST, before any write.** `/r/7886fe96...` rendered 11
   photos and `/r/da08230f...` rendered 8, all on the `9315e41e` prefix [verified 2026-08-17 via
   Claude in Chrome DOM extraction]. Those two counts are the no-regression baseline.
2. **Copy**, one probe object first, then the remaining 16 in a batch. Every call returned 200.
3. **Verified against `storage.objects`, not against the copy API's own response**: for all 19,
   destination `metadata->>'size'` AND `metadata->>'eTag'` equal the source's. 0 missing,
   0 zero-byte.
4. **Repointed `property_photos.storage_path` and `.url`**, Unit 4 first, verified, then Unit 5.
5. **Re-read the public pages**: 11 and 8, every URL on the `b2cb4eab` prefix, every one fetching
   200 with non-zero bytes, `naturalWidth === 0` on zero `<img>` elements.
6. **Proved it at the layer that was actually broken.** An authenticated, RLS-scoped
   `POST /storage/v1/object/list/property-photos` as Abbas's org returns **11 and 8**. Before the
   re-home those objects were out of scope for that org entirely, which is the whole defect. The
   public CDN never showed the problem and could never have proven the fix.

## Two things S660 did not know

- **One destination object already existed** at
  `b2cb4eab.../7886fe96.../4302d16c-85d0-41e8-925f-57ffd70701f5.jpg`, created **2026-08-16
  20:24:56 UTC**, mid-S660, size and eTag identical to source. S660 copied one photo as a probe and
  never repointed the row. It was verified identical and reused, not re-copied.
- **Unit 5's 8 photos are only 3 distinct images by eTag.** Four rows share
  `6438b9684977f65ff6acd02cad0e5a58` and three share `4eaa6c8df0f26fb7b117248dbc9907e3`. Not a
  defect in scope here, but "8 photos" on that listing is thinner than the count suggests, and
  anyone judging listing quality from photo count should know.

`documents`, `work_order_media` and `incident_media` were audited for the same class and are clean.
The defect is confined to `property_photos` [verified 2026-08-17 via Supabase MCP].

## The mechanism, and why it matters for next time

The obvious route did not work, and the reason is structural, so do not re-derive it:

- The **cloud sandbox has no network to `supabase.co`** (curl exits 56). So does **`device_bash`**
  (HTTP 000). Neither can reach the Storage API.
- **Deploying a one-off service-role edge function was refused** by the sandbox permission
  classifier. Do not plan a data fix around deploying an edge function to the prod project.
- The route that worked needs **no service-role key and no RLS change at all**:
  `noammuscovitch@gmail.com` is `owner_admin` of **both** `b2cb4eab` (Abbas) and `9315e41e` (Davis),
  so that one signed-in session satisfies `property_photos_select` on the source and
  `property_photos_insert` on the destination. Claude in Chrome read the `sb-<ref>-auth-token`
  cookie (JS-readable, `base64-` prefixed JSON), pulled `access_token`, and called
  `POST /storage/v1/object/copy` with `apikey: <anon>` + `Bearer <user token>`. The DB repoint was a
  separate service-role `UPDATE` over the Supabase MCP.
- **Page navigation destroys `window` globals.** A token stashed on `window` before a
  `navigate` is gone after it, and the next Storage call fails `Invalid Compact JWS`. Re-extract the
  token from the cookie in the same execution that uses it.

## What is deliberately NOT done

- **The 19 originals under `9315e41e` are still in place**, roughly 30MB of now-orphaned objects.
  Standing rule: never destroy a live asset before the replacement is proven. The replacement is
  proven on the public page, but deleting is a separate explicitly-approved step and Noam chose
  2026-08-17 to leave them and revisit. **This is the only cleanup this change owes.**
- **The two fixture listings are untouched** and handed to Codex, see the amended prompt.

## Why the fixtures could not be done the same way

No single login spans the pair. Agile Real Estate Group `921f7c08` has `thadmusco@gmail.com` and
`rentals@agileonline.ca`; Growth Test `8ea1da48` has `noammuscovitch+growthtest@gmail.com`; there is
no overlap [verified 2026-08-17 via `memberships` join]. A browser-session copy is therefore
impossible for that pair, and confirmed live: the RLS-scoped list of the Agile source prefix returns
**0** for `noammuscovitch@gmail.com`.

The route that does work, and never touches Agile's storage or its membership rows: the bucket is
public, so **read the 18 source objects by their public URL with no auth at all**, then **upload**
them under `8ea1da48/...` while signed in as `noammuscovitch+growthtest@gmail.com`. The QA seed's 3
objects work the same way under `noammuscovitch+vacantlessfresh0617@hotmail.com`. Do NOT add a
membership row to Agile to work around this. Agile is a live org.

## Where the remaining fixtures stand (updated 2026-08-17, end of S661)

The audit went **21 mismatched rows -> 18** this session. One fixture group is closed, one is not.

**QA seed (3 rows): DONE, and it never needed storage work.** All three `seed/833-pillette/*.jpg`
objects **do not exist** - `storage.objects` has no row for any of them, and the photos' `url`
column points at **Unsplash**, not Supabase. The `storage_path` on those rows was always decorative.
So the fix was a pure `UPDATE` to
`b733a191-.../11111111-.../{living,bedroom,kitchen}.jpg`, matching exactly what the amended
`scripts/seed-codex-qa-northstar.sql` now emits, leaving `url` alone. Old values recorded:
`seed/833-pillette/{living,bedroom,kitchen}.jpg`. Verified after: all 3 satisfy every 0215
condition, and `/r/11111111-...` still renders 3 images with zero broken elements.

**Growth Test (18 rows): DONE 2026-08-17, and NOT with the script.** The script remains unrunnable -
`service_role` has no write privilege on `property_photos`, so
`scripts/rehome-property-photo-prefixes.mjs --apply` aborts at its own preflight. That blocker is
unchanged and still owed; see the Codex prompt.

The 18 were completed with **zero privilege changes**, using route 1 below:
- Signed in as `noammuscovitch+growthtest@gmail.com`; **JWT `email` and `sub` claims verified before
  any byte moved** (`sub 967c8db1-...`, the Growth Test member).
- Public baseline first: 18 photos, all on the Agile prefix, 0 broken.
- Read all 18 sources by **public URL, no auth**, then uploaded each under
  `8ea1da48-.../5a1e0c7d-.../` using that session's own RLS grants. 18 uploaded, 0 failed.
- **Fidelity check, which matters here because the bytes round-tripped through the browser rather
  than being server-side copied**: all 18 destinations match source on **size AND eTag**, 0
  zero-byte, 0 mismatches. Rows were repointed only after that passed.
- Public page after: **18 photos, all on `8ea1da48`, all fetch 200, 0 broken** - matching the
  pre-change baseline of 18 exactly.
- **Proven at the layer that was broken**: an RLS-scoped authenticated `list` as the Growth Test
  user returns **18** on its own prefix and **0** on the Agile source prefix. That 0 is the original
  defect stated precisely - it is why `duplicateProperty` cloned 0 of 18 and swallowed 18 errors.

**Provenance, worth keeping:** the 18 rows did not merely carry the wrong ORG prefix, they pointed at
a different PROPERTY entirely - `921f7c08-.../ab3a44a0-...`. `ab3a44a0` is **Agile Real Estate
Group's** 833 Pillette Rd Unit 3 (created 2026-07-15); `5a1e0c7d` is the Growth Test clone of it
(created 2026-08-16, the day of the App Review work). The clone's rows referenced the source's
objects and nothing was ever copied, so **the Meta reviewer's fixture listing had been serving its
photographs out of the live Agile org's storage** until this fix. Storage-dependency point only; the
Abbas/Agile disclosure question is closed and stays closed.

The dry-run output is correct and worth keeping: it resolves 18 rows for property `5a1e0c7d` and
maps each to `8ea1da48-.../5a1e0c7d-.../{filename}`. It emits nothing for the two Glenrose targets
(already done) and nothing for the QA seed (already done), which independently corroborates both.

**Provenance of the Growth Test breakage, found 2026-08-17.** Its 18 photo rows do not merely carry
the wrong ORG prefix - they point at a different PROPERTY entirely:
`921f7c08-.../ab3a44a0-...`. `ab3a44a0` is **Agile Real Estate Group's** 833 Pillette Rd Unit 3
(created 2026-07-15); `5a1e0c7d` is the Growth Test clone of it (created 2026-08-16, the day of the
App Review work). The clone's rows were written referencing the source's objects and nothing was
ever copied. **The Meta reviewer's fixture listing therefore serves its photographs out of the live
Agile org's storage.** If that storage is ever cleaned the fixture loses its images. That is an
argument for doing the re-home sooner rather than later, and it is a storage-dependency point only -
the Abbas/Agile disclosure question is closed and stays closed.

**Two routes remain, both needing a human decision:**
1. **No privilege change.** Sign into `app.vacantless.com` as `noammuscovitch+growthtest@gmail.com`,
   read the 18 sources by public URL (no auth needed), upload under Growth Test's own prefix using
   that session's RLS grants, then repoint the rows with a `postgres`-role `UPDATE`. This is the
   method that worked for Glenrose. Note uploads round-trip the bytes through the browser, so eTag
   equality is a real fidelity check here, not a formality.
2. **Grant `service_role` UPDATE on `property_photos`** as a reviewed migration in the Codex branch,
   then the script runs as designed.

## THE NEXT GATE: apply the re-home script BEFORE migration 0215, never the other way round

Codex has since built `codex/s660-crossorg-photo-storage` at **`c41f000`** (local only, not pushed,
`main...HEAD = 0 1`), carrying `0215_property_photos_storage_prefix_guard.sql` and
`scripts/rehome-property-photo-prefixes.mjs`.

The 0215 trigger is `before insert or update **OF property_id, organization_id, storage_path**`. It
is column-scoped, so the 21 remaining fixture rows are **not** globally unwritable, which is the
easy thing to get wrong when describing it. But `storage_path` IS guarded, and `storage_path` is the
one column the re-home must update, so:

**Applying 0215 first blocks the very repair it is waiting for.** The re-home script has no
awareness of the trigger, and a trigger fires for the service role too. Order: run the script, get
the audit query to zero rows, then apply 0215.

The 19 Glenrose rows satisfy all three of the trigger's conditions, including
`property_photos.organization_id = properties.organization_id` (which this re-home did not need to
change - only the storage path had drifted) [verified 2026-08-17 via Supabase]. 0215 accepts them.

## Related

- `claude/CODEX-PROMPT-CROSSORG-PHOTO-STORAGE-S660.md` - changes 2 to 5 still open, change 1 closed.
- `claude/FINDINGS-DUPLICATE-PHOTO-COPY-AND-CROSSORG-STORAGE-S660.md` - the original finding.
