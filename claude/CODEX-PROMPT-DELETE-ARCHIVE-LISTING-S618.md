# CODEX BUILD — S618 Lane 1: Delete / Archive a listing from the rentals page

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-03
**Type:** new feature — one adaptive row control (Delete *or* Archive) on the rentals list, backed by two/three new server actions + one additive migration.
**Migration:** 0208 (`properties.archived_at`). **Flag:** NONE.
**Risk:** low–medium. New destructive action (hard delete) — the whole point is a **server-authoritative guard** that makes it impossible to hard-delete a listing with real history. Blast radius = `properties/page.tsx`, `properties/actions.ts`, one new client component, one migration.
**Design of record:** `claude/DESIGN-ESL-SIMPLE-MODE-AND-DELETE-S618.md` (Lane 1). Do not re-derive the strategy; build to it.

## Why
An operator (often ESL / self-managing) has no way to remove a junk/test **draft** listing — the rentals row only has Edit + "Get this listing online". They asked for delete. But a live/leased unit has real leads, sometimes a tenancy, and often posted ads the take-down chain references. So: **one control the app makes safe** — Delete when nothing is attached, Archive otherwise. The user never chooses; the app decides from attached history.

## Verified current-state facts (do NOT re-derive)
- Statuses: `draft`, `available` (Live), `paused`, `off_market`, `leased`. Helper `canPublishFromStatus()` = draft|paused|off_market.
- **No delete/archive action exists.** Only `deletePropertyDocument` / `softDeleteApplianceReceipts` (document-level). Mirror the **`duplicateProperty`** action (actions.ts ~1091) for the house pattern: `requireCapability("manage_properties", "/dashboard/properties?forbidden=1")` → `getCurrentOrg()` (redirect `/onboarding` if none) → `createClient()` (RLS scopes to org) → mutate `.eq("id", id)` → `revalidatePath("/dashboard/properties")` + `revalidatePath("/dashboard")` → `redirect(...)`. `revalidatePath` is already imported at actions.ts:3.
- **FK reality on `properties`:** `tenancies.property_id` = `on delete restrict` (DB blocks a hard delete of any unit with a tenancy). `leads.property_id` = `on delete set null` (a hard delete would *silently unlink* real inquiries — we must NOT allow that). ~23 child tables reference `properties`; the deletable case (draft/off_market + no leads/tenancy/posts) has only cascade/set-null children with nothing meaningful attached, so a plain delete succeeds once the guard passes.
- **Rentals list** (`app/dashboard/properties/page.tsx`): server component. Already loads, per org via one `Promise.all`, `leads` (→ `leadCounts` map) and `property_photos` (→ `photoCounts`). Row = address · specs · rent · `StatusChip` · get-online action/label · **Edit** · `ReadinessChips`. Query selects `id, address, rent_cents, beds, baths, status, description` ordered by `created_at desc`.
- Distribution posts live in table **`listing_posts`** (has `property_id`). Tenancies in **`tenancies`** (has `property_id`).

## Data model — migration `supabase/migrations/0208_property_archived_at.sql`
```sql
alter table public.properties add column if not exists archived_at timestamptz;
create index if not exists properties_archived_at_idx
  on public.properties (organization_id)
  where archived_at is not null;
```
- No new RLS/grants — `archived_at` is a column on an already-policied table.
- Semantics: `archived_at is null` = normal (default). `archived_at is not null` = retired/hidden from the management list. This is DISTINCT from `off_market` (a paused-but-real unit).
- After applying, `list_migrations` / SQL readback to confirm the column + index exist. (Cowork applies the migration to prod via Supabase MCP + readback BEFORE the code deploy — you do NOT run migrations; just author the file.)

## Server actions — add to `app/dashboard/properties/actions.ts`

Add one shared pure helper + three actions. Keep the guard **server-authoritative** — never trust a client-passed "deletable" flag.

**Guard (server-side, re-queried at action time):**
```
hardDeletable(status, leadCount, tenancyCount, postCount) =
  (status === "draft" || status === "off_market")
  && leadCount === 0 && tenancyCount === 0 && postCount === 0
```

1. **`deleteProperty(formData)`**
   - `requireCapability("manage_properties", ...)`, `id` from formData (return on empty), `getCurrentOrg()`.
   - Read the property (RLS-scoped `.eq("id", id).maybeSingle()`, select `status`); if not found → `redirect("/dashboard/properties")`.
   - Count, org- + property-scoped, `{ count: "exact", head: true }`: `leads`, `tenancies`, `listing_posts`.
   - If **not** `hardDeletable(...)` → `redirect("/dashboard/properties?delete_blocked=1")` (do NOT delete — the row state changed since render).
   - Else `supabase.from("properties").delete().eq("id", id).eq("organization_id", org.id)`.
   - `revalidatePath("/dashboard/properties")` + `revalidatePath("/dashboard")`, then `redirect("/dashboard/properties?deleted=1")`.

2. **`archiveProperty(formData)`**
   - Same auth/org/id preamble. Read current `status`.
   - Update: set `archived_at = new Date().toISOString()`; **and** if the unit is currently public (`status` ∈ available|paused), also set `status = "off_market"` so archiving actually stops it pulling inquiries. (Leave draft/off_market/leased status as-is.)
   - `.eq("id", id).eq("organization_id", org.id)`, revalidate, `redirect("/dashboard/properties?archived=1")`.

3. **`unarchiveProperty(formData)`**
   - Auth/org/id. Set `archived_at = null` (leave `status` as off_market — operator re-publishes deliberately). Revalidate, `redirect("/dashboard/properties?restored=1")`.

## List page — `app/dashboard/properties/page.tsx`
- Add `archived_at` to the select + `PropertyRow` type (`archived_at: string | null`).
- Add **tenancy** + **listing_posts** counts to the existing `Promise.all` (mirror the `leads` → `leadCounts` pattern): `supabase.from("tenancies").select("property_id").eq("organization_id", org.id)` and `supabase.from("listing_posts").select("property_id").eq("organization_id", org.id)` → `tenancyCounts` / `postCounts` maps. (If `listing_posts` has no `organization_id`, scope by the org's property ids instead — check the table; do NOT assume.)
- **View split via `searchParams.view`:** default (`view` unset) → render rows where `archived_at == null`. `view === "archived"` → render rows where `archived_at != null`. Add a small segmented control at the top of the list ("Active" | "Archived (N)") linking `?view=archived` / the base path. Do the filtering in JS over the already-fetched `rows` (cheap, single org) OR add `.is("archived_at", null)` to the query and a second count — either is fine; prefer the in-memory split so the Archived count is free.
- **Per-row control** (append to the existing action cluster, after Edit): compute `hardDeletable` per row from `status` + the three counts. Render a new **client** component:
  - Active view: `DeleteOrArchiveControl` — shows **"Delete"** (red/destructive styling) when `hardDeletable`, else **"Archive"**. Inline **two-step confirm** (click → "Confirm?" / "Cancel"; no native `confirm()` — it's automation-hostile, KI). On confirm it submits a `<form action={deleteProperty|archiveProperty}>` with a hidden `id`.
  - Archived view: a **"Restore"** button (`<form action={unarchiveProperty}>`) and NO delete.
  - New file: `app/dashboard/properties/row-actions.tsx` (`"use client"`). Keep styling consistent with the existing row buttons (`rounded-lg border ... px-2.5 py-1.5 text-xs`).
- **Toasts / notices:** surface `searchParams` `deleted=1` / `archived=1` / `restored=1` / `delete_blocked=1` as a small dismissible banner at the top (mirror how the page already handles `added` / `import`). `delete_blocked=1` copy: "That listing now has inquiries or history — we archived nothing; use Archive instead."
- Empty states: Active view with zero rows keeps the existing `EmptyState`. Archived view with zero rows → a minimal "No archived listings" note.

## Gates (all must pass; report each verbatim, counts included)
- `npx tsc --noEmit` → 0 errors
- `npm run lint` → clean (report any new warnings on touched files)
- `npm run build` → succeeds
- `git diff --check` → clean
- `npm run test` → still green (report counts). This lane's logic worth a unit test = the `hardDeletable` guard: add a tiny pure test if a suitable harness exists (`scripts/test-*.ts` pattern), else assert it's exercised via types. Do NOT add heavy test infra.

## Dogfood checklist (behavioral — verify by hand, Cowork will re-verify on a QA org)
- A bare **draft** with 0 inquiries → row shows **Delete** → two-step confirm → row gone; SQL confirms the property row + cascade children gone and **no orphaned/unlinked leads** (there were none).
- A listing **with a lead** (or a tenancy) → row shows **Archive**; even if `deleteProperty` is invoked directly it **refuses** (`delete_blocked=1`) and deletes nothing.
- **Archive** an active listing → disappears from Active, appears under **Archived (N)**, its public inquiry page stops accepting (status went off_market); **Restore** returns it to Active (as off_market).

## Do NOT
- Do NOT hard-delete anything that fails the guard; do NOT trust a client "deletable" flag — re-query counts in the action.
- Do NOT add a flag or touch the Get-online tab / add-property form (those are Lanes 2 & 3, separate prompts).
- Do NOT `git add -A` — commit touched files **by name** (untracked `claude/*.md` + `_to_delete/` must not be swept in).
- Do NOT run the migration yourself or push. Author the migration file; Cowork applies it to prod + readback, then Noam file-scoped pushes.
- Do NOT change public feed / dashboard queries beyond what archive-hiding requires.

## Commit (single, clean; touched files by name)
```
feat(properties): delete or archive a listing from the rentals page

Adaptive per-row control — hard delete only for a draft/off-market unit with no
leads, tenancy, or posts (server-authoritative guard); archive (hide from list,
recoverable) for anything with history. Migration 0208 adds properties.archived_at.
```
Reply with branch/SHA/diffstat + every gate result + the migration filename. **Do NOT push. Do NOT run the migration.**
