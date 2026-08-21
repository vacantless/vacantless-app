# CODEX PROMPT — Move-in/out itemized checklist + utilities-transfer tracker (Wave 2 lane 2, S614)

> **Dispatch-ready.** Derived from `claude/PRESPEC-MOVE-IN-OUT-UTILITIES-CHECKLIST-S611.md` with all OPEN DECISIONS resolved (D1–D5, see below). Warm-verified against prod on 2026-08-02 (S614): next free migration is **0205**; `tenancy_inspections` (0094) RLS + grant shape confirmed; `envFlagEnabled` + `getCurrentOrg` + `requireCapability("manage_tenancies")` signatures confirmed; net-new table names are unused. **Ship DARK behind `MOVE_IN_CHECKLIST_ENABLED` (unset = inert). Two additive tables, zero change to any existing behavior when the flag is off.**

## Resolved decisions (do NOT re-open)
- **D1 — alongside, not replace.** The itemized checklist is ADDITIVE to the existing freeform `tenancy_inspections.condition_notes`. `condition_notes` stays as the catch-all; do NOT remove, rename, or stop writing it.
- **D2 — fixed default template v1.** A hard-coded default room/item template in the pure lib (operator-editable templates are a later slice — do NOT build editing of templates now).
- **D3 — one lane, two additive tables.** `inspection_checklist_items` (child of `tenancy_inspections`) + `tenancy_utility_tasks` (child of `tenancies`). Both dark-gated by the same flag.
- **D4 — photos deferred to v2.** v1 is structured text only. Do NOT wire `documents`/media for checklist items.
- **D5 — master env flag `MOVE_IN_CHECKLIST_ENABLED`, default off**, provably inert when unset (mirror the `ONBOARDING_WIZARD_ENABLED` / `AUTO_LISTING_COPY_ENABLED` pattern).

## What ALREADY exists (reuse, do NOT rebuild)
- `tenancy_inspections` (migration `0094_tenancy_inspections.sql`): `inspection_type ∈ {move_in,move_out,periodic,other}`, `scheduled_for`, `status ∈ {scheduled,completed,skipped,canceled}`, `completed_on`, freeform `condition_notes`, org denormalized, `on delete cascade` with the tenancy. RLS = single `for all` policy `organization_id in (select public.user_org_ids())`, explicit grants to `authenticated` + `service_role`.
- UI: `app/dashboard/tenancies/[id]/inspection-section.tsx` (server component, `type InspectionView`, per-row `<details>` edit form), server actions in `inspection-actions.ts`, pure helpers in `lib/property-inspections.ts` (`INSPECTION_TYPES`, `dueStatusFor`, etc.).
- `app/dashboard/tenancies/[id]/page.tsx` fetches `tenancy_inspections` (~L1358), maps to `InspectionView[]`, renders `<TenancyInspectionSection tenancyId inspections={inspectionViews}/>` at ~L1670 inside `<section id="inspections">`.
- Utilities today are ONLY `heat_included` / `hydro_included` / `water_included` booleans on `properties` (listing "included-in-rent" flags). There is NO utility-account transfer tracking — that is the net-new gap.
- Helpers: `envFlagEnabled(value)` @ `lib/auto-listing-copy.ts:22`; `getCurrentOrg(): Promise<Org|null>` @ `lib/org.ts:87`; `requireCapability(cap, redirect?)` @ `lib/membership.ts:65`.

---

## 1) Migration — `supabase/migrations/0205_inspection_checklist_and_utility_tasks.sql`

Additive only. Mirror the 0094 conventions EXACTLY (org denormalized, `on delete cascade`, single `for all` RLS policy on `organization_id in (select public.user_org_ids())`, explicit grants to `authenticated` + `service_role`, `create table if not exists`, `create index if not exists`). Do NOT touch or alter any existing table.

**Table A — `public.inspection_checklist_items`** (child of `tenancy_inspections`):
- `id uuid primary key default gen_random_uuid()`
- `organization_id uuid not null references public.organizations(id) on delete cascade`
- `inspection_id uuid not null references public.tenancy_inspections(id) on delete cascade`
- `area text` — room/area label (e.g. "Kitchen"); nullable
- `item text not null` — line item (e.g. "Countertops")
- `condition text check (condition in ('good','fair','poor','damaged','na'))` — nullable (blank until rated)
- `note text` — nullable freeform per-item note
- `sort_order integer not null default 0`
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- indexes: `(organization_id)`, `(inspection_id)`
- RLS enabled; single `for all` policy `inspection_checklist_items_all` using/with-check `organization_id in (select public.user_org_ids())`
- grants: `select, insert, update, delete` to `authenticated` and `service_role`
- table + column comments in the 0094 house style (note: v1 structured text only, no media; PII posture = landlord's own condition facts, no DL/SIN/credit).

**Table B — `public.tenancy_utility_tasks`** (child of `tenancies`):
- `id uuid primary key default gen_random_uuid()`
- `organization_id uuid not null references public.organizations(id) on delete cascade`
- `tenancy_id uuid not null references public.tenancies(id) on delete cascade`
- `label text not null` — e.g. "Hydro transfer"
- `responsible_party text not null default 'tenant' check (responsible_party in ('tenant','landlord','na'))`
- `target_date date` — nullable
- `status text not null default 'todo' check (status in ('todo','in_progress','done','na'))`
- `confirmation_note text` — nullable
- `sort_order integer not null default 0`
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
- indexes: `(organization_id)`, `(tenancy_id)`
- RLS enabled; single `for all` policy `tenancy_utility_tasks_all` using/with-check `organization_id in (select public.user_org_ids())`
- grants: `select, insert, update, delete` to `authenticated` and `service_role`
- comments in the 0094 house style.

> **Do NOT apply the migration.** Cowork applies it via the Supabase MCP with a SQL readback BEFORE any deploy. Leave the file on disk only.

---

## 2) Pure lib + tests (no DB, no Next imports)

### `lib/inspection-checklist.ts`
- `CHECKLIST_CONDITIONS = ['good','fair','poor','damaged','na'] as const` + `type ChecklistCondition` + `isChecklistCondition(v: string): v is ChecklistCondition` + `checklistConditionLabel(v): string` (e.g. Good / Fair / Poor / Damaged / N/A; unknown/blank → "Not rated").
- `type ChecklistItemInput = { area?: string|null; item: string; condition?: string|null; note?: string|null; sort_order?: number }`.
- `DEFAULT_CHECKLIST_TEMPLATE: ReadonlyArray<{ area: string; items: readonly string[] }>` — a fixed move-in/out template covering at least: Kitchen (Countertops, Cabinets, Sink & faucet, Appliances, Flooring), Bathroom (Toilet, Sink & vanity, Tub/shower, Flooring, Ventilation), Bedroom (Walls, Flooring, Closet, Windows), Living/Common (Walls, Flooring, Ceiling, Windows, Doors), General (Smoke/CO detectors, Keys/fobs, Locks, Light fixtures). Same template used for both move_in and move_out.
- `buildDefaultChecklistItems(): ChecklistItemInput[]` — flattens the template to ordered `{area,item,sort_order}` rows (condition/note blank), `sort_order` monotonically increasing.
- `normalizeChecklistItem(raw): {item,area,condition,note} ` validation helper: trims, rejects blank `item`, coerces invalid condition → null.

### `scripts/test-inspection-checklist.ts`
Pure `tsx` test in the existing house style (self-counting `pass/fail`, exit code). Cover: condition guard accepts the 5 valid + rejects junk; label map incl. "Not rated" fallback; `buildDefaultChecklistItems` returns a non-empty ordered set with unique ascending `sort_order` and every `item` non-blank; `normalizeChecklistItem` trims + drops invalid condition + rejects blank item.

### `lib/utility-tasks.ts`
- `UTILITY_TASK_STATUSES = ['todo','in_progress','done','na'] as const` + type + `isUtilityTaskStatus` + `utilityTaskStatusLabel` (To do / In progress / Done / N/A).
- `RESPONSIBLE_PARTIES = ['tenant','landlord','na'] as const` + type + `isResponsibleParty` + `responsiblePartyLabel` (Tenant / Landlord / N/A).
- `type UtilityTaskInput = { label: string; responsible_party?: string; target_date?: string|null; status?: string; confirmation_note?: string|null; sort_order?: number }`.
- `DEFAULT_UTILITY_TASKS: ReadonlyArray<{ label: string; responsible_party: 'tenant'|'landlord' }>` — Hydro transfer (tenant), Gas transfer (tenant), Water account (tenant), Internet (tenant), Tenant insurance proof (tenant), Mail forwarding (tenant). (Text-only seed; operator edits after.)
- `buildDefaultUtilityTasks(): UtilityTaskInput[]` — ordered, `status:'todo'`, ascending `sort_order`.
- `normalizeUtilityTask(raw)` validation: reject blank `label`, coerce invalid `status` → 'todo', invalid `responsible_party` → 'tenant', validate `target_date` as `YYYY-MM-DD` or null.

### `scripts/test-utility-tasks.ts`
Pure `tsx` test: status + responsible-party guards accept valid / reject junk; label maps; `buildDefaultUtilityTasks` non-empty, ascending `sort_order`, all labels non-blank, valid enums; `normalizeUtilityTask` coercions + date validation + blank-label rejection.

---

## 3) Server actions (org-scoped, redirect-based, mirror `inspection-actions.ts`)

### `app/dashboard/tenancies/[id]/checklist-actions.ts` (`"use server"`)
Actions: `addChecklistItem`, `updateChecklistItem`, `removeChecklistItem`, `seedDefaultChecklist(inspectionId)`.
- Each: `await requireCapability("manage_tenancies")`, load `getCurrentOrg()`, confirm the parent inspection belongs to this org (select `tenancy_inspections` by id — RLS scopes it; also verify the row exists) before writing; set `organization_id` from the current org on insert; `revalidatePath` the tenancy page; redirect back to `…?checklist=added|updated|removed|seeded#inspections` (or `?checklist=forbidden` on capability failure, matching the inspection flash pattern).
- `seedDefaultChecklist`: no-op (redirect `…?checklist=exists`) if the inspection already has ≥1 checklist item; otherwise bulk-insert `buildDefaultChecklistItems()` mapped to rows with `inspection_id` + `organization_id`.
- **Every action must early-return / redirect to `?forbidden` behavior unchanged if `!envFlagEnabled(process.env.MOVE_IN_CHECKLIST_ENABLED)`** — belt-and-suspenders so the endpoints are inert when dark even if a stale form is posted. (Redirect to the plain tenancy page.)

### `app/dashboard/tenancies/[id]/utility-actions.ts` (`"use server"`)
Actions: `addUtilityTask`, `updateUtilityTask`, `removeUtilityTask`, `seedDefaultUtilityTasks(tenancyId)`. Same guards (`manage_tenancies`, org confirm on the tenancy via the existing `tenancyInOrg` shape), same flag early-return, `…?utility=added|updated|removed|seeded#utilities` flashes.

---

## 4) UI — strictly additive, gated in `page.tsx`

### `app/dashboard/tenancies/[id]/page.tsx`
- Compute `const checklistEnabled = envFlagEnabled(process.env.MOVE_IN_CHECKLIST_ENABLED)` ONCE.
- **When `checklistEnabled` is false: do NOT run any new query and do NOT render any new section.** The existing inspection fetch + `<TenancyInspectionSection>` render EXACTLY as today (byte-identical). This is the KI990 discipline — the new queries are stubbed/skipped when the flag is off, so the page is safe even before migration 0205 is applied.
- **When true:** after the existing inspection fetch, fetch `inspection_checklist_items` for this org's inspections on this tenancy (`.eq('organization_id', org.id).in('inspection_id', inspectionIds)` ordered by `sort_order`), group by `inspection_id`, and pass `checklistByInspection` + `checklistEnabled` into `<TenancyInspectionSection>`. Also fetch `tenancy_utility_tasks` for the tenancy (ordered by `sort_order`) and render a NEW `<TenancyUtilitySection tenancyId utilities={…}/>` in its own `<section id="utilities">` placed right after the inspections section. Add the `checklist`/`utility` flash-message parsing alongside the existing `inspection` flashes (same shape).

### `app/dashboard/tenancies/[id]/inspection-section.tsx` (MODIFY, additive)
- Extend props: `checklistEnabled?: boolean`, `checklistByInspection?: Record<string, ChecklistItemRow[]>` (both optional; when absent the file renders EXACTLY as today).
- When `checklistEnabled`, inside each inspection row render an additive checklist block: the item rows (area · item · condition badge · note) + an inline add-item form + per-item `<details>` edit (native, no client JS, mirroring the existing edit disclosure) + a "Seed default checklist" button (posts `seedDefaultChecklist`) shown only when that inspection has no items. Reuse `checklistConditionLabel` for badges; keep colours as class strings like the existing `LIFECYCLE_META` (status conveyed by label text, not colour alone — WCAG). Do NOT alter the existing fields grid or `condition_notes`.

### `app/dashboard/tenancies/[id]/utility-tasks-section.tsx` (NEW, server component)
- Presentational, mirrors `inspection-section.tsx` structure: a list of utility tasks (label · responsible party · target date · status badge · confirmation note), an inline add form, per-row `<details>` edit, and a "Add standard utilities" seed button (posts `seedDefaultUtilityTasks`) shown when the list is empty. All forms post to `utility-actions.ts`. No client JS. WCAG: status/party by label text + shape, not colour alone; labelled inputs; error surfaced via the `?utility=…` flash.

---

## 5) Dark-by-default proof (Cowork will independently re-verify — make it easy)
- With `MOVE_IN_CHECKLIST_ENABLED` unset: `page.tsx` runs NO new query, renders NO utility section, passes NO checklist to the inspection section → the tenancy page and inspection section are unchanged. The two new tables need not even exist for the dark path to be safe.
- The migration is additive; no existing table/column/policy is altered.
- The server actions early-return when the flag is off.

## 6) Codex verification checklist (run + paste results)
1. `npx tsc --noEmit` clean (or the repo's typecheck script).
2. Lint (the known unrelated `<img>` warning is fine).
3. `npx tsx scripts/test-inspection-checklist.ts` → all pass, exit 0.
4. `npx tsx scripts/test-utility-tasks.ts` → all pass, exit 0.
5. `npm run build` → full page build succeeds (same page count as prod + the additive server components compile).
6. `git diff --check` + `git diff --cached --check` clean.
7. Confirm by grep that with the flag path removed the diff to `page.tsx` is limited to the gated branch (no change on the dark path).

## 7) Files summary
- NEW `supabase/migrations/0205_inspection_checklist_and_utility_tasks.sql` (do NOT apply)
- NEW `lib/inspection-checklist.ts` + `scripts/test-inspection-checklist.ts`
- NEW `lib/utility-tasks.ts` + `scripts/test-utility-tasks.ts`
- NEW `app/dashboard/tenancies/[id]/checklist-actions.ts`
- NEW `app/dashboard/tenancies/[id]/utility-actions.ts`
- NEW `app/dashboard/tenancies/[id]/utility-tasks-section.tsx`
- MODIFY `app/dashboard/tenancies/[id]/inspection-section.tsx` (additive, gated props)
- MODIFY `app/dashboard/tenancies/[id]/page.tsx` (gated fetch + render + flash parsing)

**Build on disk, run the verification, commit by name, but do NOT push and do NOT apply the migration** — Cowork warm-verifies the diff against a prod clone, applies 0205 via Supabase MCP + SQL readback before deploy, and Noam does the file-scoped push (one lane).
