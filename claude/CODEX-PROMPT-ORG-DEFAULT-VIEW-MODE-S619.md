# CODEX BUILD — S619: Org-level default Get-online view mode

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-03
**Type:** small fast-follow to S618 Lane 2 (Get-online Simple/Advanced mode). Adds an org-scoped default so a power org (Agile) auto-lands in **Advanced**, while the ESL default stays **Simple**. Per-browser localStorage still overrides.
**Migration:** `0209_organization_distribution_view_mode.sql` (0208 is the highest on disk + already applied to prod — next free is 0209). **Flag:** NONE. **Risk:** low — one nullable column + a prop threaded through two components + a two-line initializer/effect change.
**Design of record:** `claude/DESIGN-ORG-DEFAULT-VIEW-MODE-S619.md`. Build to it; do not re-derive strategy.
**Blast radius (all under `app/dashboard/properties/[id]/`):** `get-online-view.tsx`, `distribute-tab.tsx`, `page.tsx` + new `supabase/migrations/0209_organization_distribution_view_mode.sql`.

## Why
S618 shipped Simple mode as the Get-online default with an "Advanced tools →" toggle persisted only in `localStorage['vacantless.getonline.mode']` (per-browser). A power operator who lives in Advanced re-flips it on every fresh browser. Add an **org-level default** underneath localStorage so power orgs land in Advanced automatically. ESL default stays Simple.

## Verified current-state (do NOT re-derive)
- **`get-online-view.tsx`** (`"use client"`, 53 lines) exports `GetOnlineView({ simple, advanced })`. It hardcodes `const [mode, setMode] = useState<Mode>("simple");` and a `useEffect` that reads `window.localStorage.getItem("vacantless.getonline.mode")` and does `if (saved === "advanced") setMode("advanced");` (it never switches back to simple, because the initial is always simple). `Mode = "simple" | "advanced"`. `MODE_KEY = "vacantless.getonline.mode"`. `setAndStore` writes the value to localStorage.
- **`distribute-tab.tsx`** renders `<GetOnlineView simple={...} advanced={...} />` (it constructs both trees and wraps them). It receives its data as props from `page.tsx`.
- **`page.tsx`** (server component) loads the viewer's org via `const org = await getCurrentOrg();` (~line 528; `org` already exposes `booking_timezone`, `plan`). It renders `<DistributeTab .../>` (~line 3388). A targeted per-org column read pattern already exists in the concierge block (~lines 1466-1470): `.from("organizations").select("concierge_leaseup_cap_override").eq("id", propertyOrgId).maybeSingle()`.

## The job

### A. Migration `0209_organization_distribution_view_mode.sql`
Mirror the terse style of `0208_property_archived_at.sql`:
```sql
alter table public.organizations
  add column if not exists distribution_view_mode text
  check (distribution_view_mode in ('simple', 'advanced'));
```
- Nullable, default `null`. No index (read by `organizations.id`, the PK). Do NOT set any org's value in the migration — the column ships null so every existing org is unchanged.

### B. `page.tsx` — source + pass the org default
- Produce `const orgDefaultMode: "simple" | "advanced" | null` for the **viewing operator's** org (the `org` from `getCurrentOrg()`, NOT `propertyOrgId` — they can differ for a shared/network property and the preference belongs to the viewer).
- Prefer reading it off the already-loaded `org` if `getCurrentOrg()`'s select exposes the new column after the migration (`(org as { distribution_view_mode?: ... })?.distribution_view_mode`). If the helper uses an explicit column list that does NOT include it, do a small targeted read mirroring the concierge block, keyed on the viewer org's id, and read the value with the same `as`-cast style. Keep it file-local; do NOT widen a shared select unless that is the minimal change, and if you do, re-verify nothing else depends on the narrow shape.
- Normalize to exactly `"simple" | "advanced" | null` (guard any unexpected string to `null`).
- Pass `orgDefaultMode={orgDefaultMode}` to `<DistributeTab>`.

### C. `distribute-tab.tsx` — forward the prop
- Add `orgDefaultMode?: "simple" | "advanced" | null` to `DistributeTab`'s props and forward it: `<GetOnlineView simple={...} advanced={...} orgDefaultMode={orgDefaultMode} />`. Pure passthrough; no other change.

### D. `get-online-view.tsx` — honor the org default, keep localStorage on top
- Add `orgDefaultMode?: "simple" | "advanced" | null` to the component props.
- Initialize from it: `const [mode, setMode] = useState<Mode>(orgDefaultMode === "advanced" ? "advanced" : "simple");`
- In the existing `useEffect`, honor localStorage **both** ways so the explicit toggle still wins now that the initial can be advanced:
  ```ts
  const saved = window.localStorage.getItem(MODE_KEY);
  if (saved === "advanced") setMode("advanced");
  else if (saved === "simple") setMode("simple");
  ```
- Leave `MODE_KEY`, `setAndStore`, and the toggle button UI exactly as they are.

**Precedence (must hold):** explicit per-browser localStorage toggle > org default (`orgDefaultMode`) > `"simple"`. SSR and first client render both use `orgDefaultMode` as the initializer (no hydration mismatch); localStorage override applies in `useEffect`.

## Scope guards
- Reuse, don't rebuild. Net-new = the column + the prop thread + the initializer/effect change. NO change to the distribution engine, server actions, the Simple/Advanced trees, or the S618 delete / add-property lanes.
- Do NOT change the localStorage key or the toggle UI/behavior.
- Do NOT add a settings UI (MVP = SQL-set per org; see design §5).
- Do NOT default any org to advanced in the migration.

## Gates (report each verbatim)
- `npx tsc --noEmit` → 0 errors
- `npm run lint` → clean (report new warnings on touched files)
- `npm run build` → succeeds
- `git diff --check` → clean
- `npm run test` → green (counts). No new pure helper is required for this lane; if you extract one, add a small pure test in the existing `scripts/test-*.ts` style.

## Migration-before-deploy (Cowork runs this, listed for completeness)
Apply `0209` to prod via Supabase MCP + SQL readback (column present, CHECK enforced, all orgs null) BEFORE the code deploy — same order as every prior lane. Next free migration after this = 0210.

## Dogfood checklist (Cowork re-verifies on North Star QA via Claude-in-Chrome)
- Fresh browser (clear `vacantless.getonline.mode`) on an org with `distribution_view_mode = null` → Get-online lands in **Simple** (unchanged S618 behavior).
- Set the QA org's `distribution_view_mode = 'advanced'` via SQL → fresh browser lands in **Advanced**, no hydration warning, localStorage empty.
- Click "← Simple view" → lands Simple + persists across reload (explicit toggle beats org default on that browser).
- Clear localStorage → back to Advanced (org default reasserts).

## Do NOT
- Do NOT touch Lane 1 (rentals list delete/archive) or Lane 3 (`/properties/new`).
- Do NOT add a flag or a second migration. Do NOT `git add -A` — stage touched/new files by name (untracked `claude/*.md` + `_to_delete/` + `_gitlock_quarantine/` must not be swept in).
- Do NOT set Agile's or any real org's `distribution_view_mode` in code or migration — that is a deliberate post-deploy SQL write on Noam's go.

## Commit (single, clean; touched/new files by name)
```
feat(properties): org-level default for the Get online view mode

Adds organizations.distribution_view_mode ('simple'|'advanced', nullable) so a
power org can auto-land in the Advanced Get-online command center while the ESL
default stays Simple. Threaded viewer-org default -> DistributeTab -> GetOnlineView
as the useState initializer; per-browser localStorage toggle still overrides.
Migration 0209 (nullable column, no org defaulted). No engine or flag change.
```
Reply with branch/SHA/diffstat + every gate result. **Do NOT push. Do NOT apply the migration** (Cowork applies 0209 + does the SQL readback before deploy).
