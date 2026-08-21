# CODEX PROMPT - Unarchive must restore the pre-archive status (S662, 2026-08-17)

**Priority: low, "at some point" per Noam. No deadline. Build dark is not required; this is small
and self-contained, but it DOES need a migration.**

## The defect

`archiveProperty` and `unarchiveProperty` are not symmetric.

`app/dashboard/properties/actions.ts:1460` (`archiveProperty`) sets `archived_at = now()` AND, when
the current status is `available` or `paused`, ALSO flips `status` to `off_market`:

```ts
const next: { archived_at: string; status?: string } = { archived_at: new Date().toISOString() };
if (p.status === "available" || p.status === "paused") {
  next.status = "off_market";
}
```

`app/dashboard/properties/actions.ts:1496` (`unarchiveProperty`) only reverses half of that:

```ts
await supabase.from("properties").update({ archived_at: null }).eq("id", id)...
```

So **Restore brings the row back as `off_market`, not as the `available` or `paused` it was.** The
operator has to notice and manually re-Live it. `off_market` 404s the public `/r` page
(`lib/listing-state.ts:112`) and drops the unit from the syndication feed (`lib/listing-feed.ts:35`),
so a "restored" unit is silently still dark.

## The footgun this creates (fix this too)

`hardDeletable` (`lib/property-archive.ts`) returns true for `status === "draft" || status ===
"off_market"` when the unit has no leads, tenancies or posts. `app/dashboard/properties/page.tsx:313`
computes `canHardDelete` from it and passes it to `DeleteOrArchiveControl` at line 415, which renders
`hardDelete ? "Delete" : "Archive"` (`row-actions.tsx:39`).

Chain: archive a clean `available` unit -> it becomes `off_market` -> Restore it -> it is still
`off_market` -> **its row button is now the IRREVERSIBLE "Delete" where it used to be the safe
"Archive".** The operator archived and restored, changed nothing intentionally, and the destructive
control quietly swapped in. Fixing the status restore closes this on its own; do not paper over it
by editing `hardDeletable`.

## Required change

**Do NOT infer the prior status.** `archiveProperty` cannot distinguish "was available" from "was
already off_market" after the fact, so guessing (`if off_market -> available`) would wrongly
re-list units that were deliberately retired before archiving. Record it.

### 1. Migration `supabase/migrations/0216_property_status_before_archive.sql`

`0215` is the latest applied migration [verified 2026-08-17 via the migrations dir and Supabase].

```sql
alter table public.properties
  add column if not exists status_before_archive text;

alter table public.properties
  drop constraint if exists properties_status_before_archive_chk;

alter table public.properties
  add constraint properties_status_before_archive_chk
  check (
    status_before_archive is null
    or status_before_archive = any (array['draft','available','paused','leased','off_market'])
  );

comment on column public.properties.status_before_archive is
  'Status captured at archive time so unarchive can restore it. Null when not archived or when archive did not change status. See 0216 / S662.';
```

Mirror the allowed values in `properties_status_check` exactly (draft, available, paused, leased,
off_market) - confirmed against the live constraint.

### 2. `archiveProperty`

When (and only when) the status is being flipped to `off_market`, also write
`status_before_archive: p.status`. Leave it null otherwise, so an already-`off_market` or `leased`
unit records nothing and restores unchanged.

### 3. `unarchiveProperty`

Select `status, status_before_archive` for the row (scoped by `organization_id` as the existing code
does). Then:
- If `status_before_archive` is non-null AND the current status is still `off_market`, set
  `status = status_before_archive` and `status_before_archive = null` alongside `archived_at = null`.
- If the current status is NOT `off_market` any more, the operator changed it while archived. Respect
  that: clear `status_before_archive`, set `archived_at = null`, leave `status` alone.
- Always clear `status_before_archive` on unarchive so a later archive cannot read a stale value.

### 4. Backfill

Do NOT backfill. Existing archived rows have no recorded prior status and guessing would be wrong.
They restore as `off_market`, same as today, which is the current behaviour and not a regression.

## No-regression baseline (state these FROM THE CODE before and after)

- `lib/listing-state.ts:112` - `off_market` and `draft` still 404 the public `/r` page.
- `lib/listing-feed.ts:35` - `off_market` still excluded from the feed.
- `lib/property-archive.ts` - `hardDeletable` logic UNCHANGED. The fix must come from the status
  being restored correctly, not from loosening the delete guard.
- `app/dashboard/tenancies/actions.ts:310` - the tenancy path "deliberately leaves `off_market`
  alone". Do not disturb it; it must not start seeing a restored status it did not expect.
- `app/dashboard/tenancies/actions.ts:465` - the private-unit creation path writes
  `status: 'off_market'` directly and never archives. It must never populate
  `status_before_archive`.

## Verification

1. `tsc --noEmit` clean (on the Mac; it does not run over the bridge).
2. Unit test the round trip for each starting status: `available` -> archive -> restore ->
   **`available`**; `paused` -> archive -> restore -> **`paused`**; `off_market` -> archive ->
   restore -> **`off_market`** (and `status_before_archive` stayed null); `leased` -> archive ->
   restore -> **`leased`**.
3. Test the operator-changed-it-while-archived branch: archive an `available` unit, mutate its
   status to `leased` while archived, restore, confirm it stays `leased` and
   `status_before_archive` is cleared.
4. Live check on a QA sandbox org, **never on Growth Test** (frozen Meta App Review reviewer org):
   archive an available unit, confirm its row action reads Restore, restore it, and confirm the row
   comes back **Live/available** and its button reads **Archive**, not **Delete**.
5. Prove by the OBJECT's row: re-read `status`, `archived_at` and `status_before_archive` from the
   properties row after each step. A green badge in the list is not proof.

## Context for whoever picks this up

Surfaced 2026-08-17 (S662) while preparing to archive 833 Pillette Units 22, 27, 30 and 34, which
Noam confirmed leased. Those four are still `available` and three of them are collecting renter
inquiries on units that are gone. The archive of those four is a SEPARATE operator task and is not
blocked on this fix; it just means a mistaken archive costs a manual re-Live until this ships.
