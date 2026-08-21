# PRE-SPEC (warm-verified, NOT yet dispatch-ready) — Move-in/out + utilities checklist engine (Wave 2 lane 2)

> **Status:** warm-verified against prod clone `a70f30f` on 2026-08-01 (S611). **Do NOT dispatch as-is** — resolve the OPEN DECISIONS below, then convert to a `CODEX-PROMPT-*.md`. Named PRESPEC on purpose so it isn't blind-dispatched (KI980 discipline).

## What ALREADY exists (do not rebuild)
- **`tenancy_inspections`** with `inspection_type ∈ {move_in, move_out, periodic, other}` (`lib/property-inspections.ts`, `-sweep.ts`), scheduling (`scheduled_for`, `completed_on`, `status`), and **freeform `condition_notes`**. UI in `app/dashboard/tenancies/[id]/inspection-section.tsx` + a reminder sweep. So move-in/out inspection *scheduling & tracking already ships.*
- **Utilities today = "included in rent" booleans only** on the property (`heat_included`, `hydro_included`, `water_included` in `properties`). There is **no** utility-account transfer/setup tracking.

## Genuine net-new scope (the two gaps)
1. **Itemized checklist layered on the existing move_in/move_out inspections** — replace/augment freeform `condition_notes` with structured line items (room/area → item → condition rating → note → photo ref), so a move-in and its matching move-out can be compared. Reuse the existing inspection row as the parent; add a child `inspection_checklist_items` table. Optionally seed a default template set (kitchen/bath/bedroom/common) per inspection.
2. **Utilities setup/transfer checklist per tenancy** — a small tracked list ("Hydro transfer", "Internet", "Gas", "Water account") each with: responsible party (tenant/landlord), target date, status (todo/in_progress/done/na), confirmation note. New `tenancy_utility_tasks` table. This is move-in operational hygiene, distinct from the listing "included" booleans.

## OPEN DECISIONS (resolve with Noam before building)
- **D1 — checklist vs notes:** Add the itemized checklist *alongside* `condition_notes` (additive, safest) or *replace* it? Recommend **alongside**, notes stays as the catch-all.
- **D2 — templates:** Ship a fixed default room/item template, or operator-editable templates? Recommend **fixed default v1** (mirror `org-seeds` pattern), editable later.
- **D3 — scope split:** Ship checklist + utilities together (one lane) or utilities as its own smaller lane? They're independent tables; could be two sub-lanes. Recommend **one lane, two additive tables**, both dark-gated.
- **D4 — photos:** Reuse the existing `documents`/media rail (mig 0202 added `documents.property_id`/`work_order_id`) for checklist item photos, or defer photos to v2? Recommend **defer photos to v2** (keep v1 to structured text) unless Noam wants them.
- **D5 — dark gating:** Same pattern as tenant-comms — a master env flag (`MOVE_IN_CHECKLIST_ENABLED`) default off, provably-inert when unset.

## Rough file plan (post-decision)
- `supabase/migrations/02NN_inspection_checklist_and_utility_tasks.sql` — additive: `inspection_checklist_items` (FK `tenancy_inspections`, org-scoped RLS) + `tenancy_utility_tasks` (FK `tenancies`).
- `lib/inspection-checklist.ts` (pure: item shape, condition ratings enum mirroring CHECK, default template, validation) + test script.
- `lib/utility-tasks.ts` (pure: task status machine, default task set, validation) + test script.
- MODIFY `app/dashboard/tenancies/[id]/inspection-section.tsx` — render checklist items under an inspection when gated on.
- NEW section/component for utilities tasks on `app/dashboard/tenancies/[id]/page.tsx` (additive, gated).
- Server actions for CRUD on both, org-scoped (getCurrentOrg + requireCapability("manage_tenancies")).
- Dark-by-default: when the flag is off, inspection-section renders exactly as today; no new sections.

## Warm-verify notes for next session
- Confirm `tenancy_inspections` RLS predicate + reuse it verbatim on the child table.
- Confirm the existing inspection-section markup so the checklist is strictly additive when dark.
- Latest migration at spec time was **0202**; pick the next free number at build time.
