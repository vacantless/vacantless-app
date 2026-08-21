# CODEX PROMPT — Work-order receipt → per-property document vault (S610)

**Base = main (prod HEAD 046b251). Additive migration only. New surface ships behind the existing maintenance/document entitlement gates. Do not `git push` — Noam reviews and pushes.**

Wave 1 / Lane 3 of the S610 backlog build. File-disjoint from the entitlements, smart-lock, and spend-analysis lanes. Closes the ONE open gap in the (already-shipped) maintenance module: a completed work order records a cost but has no receipt document filed to the property.

## WARM-VERIFY FIRST — grep, and STOP if already built
Confirm the current state (as of prod):
- Document vault EXISTS but is TENANCY-scoped: `supabase/migrations/0076_document_vault.sql` (private `documents` bucket, tokenized share links), `lib/documents.ts` + `lib/documents-server.ts`. `doc_type` taxonomy ALREADY includes `"receipt"`. UI is per-tenancy only: `app/dashboard/tenancies/[id]/documents-section.tsx` + `documents-actions.ts`.
- `work_orders` store cost but NO receipt: `supabase/migrations/0054_work_orders.sql` (`cost_cents`), `0063` (`quote_cents`). `work_order_media` (`0069`) attaches media but `kind` is CHECK-limited to `('image','video')` — NOT documents. `rg "work_order" lib/documents.ts lib/documents-server.ts` → no link exists.
If a `work_order_id`/`property_id` link on `documents` or a per-property vault view already exists, STOP and report.

## WHAT THIS IS
1. Let a document (esp. a `receipt`) be filed against a WORK ORDER and/or a PROPERTY, not only a tenancy.
2. An "Attach receipt" action on the maintenance / work-order surface that files the doc into the existing vault with `doc_type='receipt'` and links it to the work order + its property.
3. A per-PROPERTY documents view that lists documents filed to that property (receipts, and any property-scoped docs).

## REUSE (import; do NOT modify the source modules' contracts)
- `lib/documents.ts` / `lib/documents-server.ts` — upload, signed download URLs, share links, `doc_type` incl. `receipt`. Reuse the upload + list helpers; extend their filters to accept a `work_order_id` / `property_id` scope.
- `0076_document_vault.sql` bucket + RLS pattern (org-scoped) — the new FKs live on the SAME `documents` table.
- `lib/work-orders.ts` + the maintenance surface `app/dashboard/maintenance/` — where the "Attach receipt" action mounts.
- `app/dashboard/tenancies/[id]/documents-section.tsx` — the existing vault UI to mirror for the per-property view (do not modify it; create a property-scoped analog).

## FILES — exact scope
- NEW migration `supabase/migrations/0201_documents_workorder_property_link.sql` — additive nullable `work_order_id uuid references work_orders(id)` and `property_id uuid references properties(id)` (and `unit_id` if that's the finer grain used elsewhere) on `documents`; indexes on the new FKs. Keep existing `tenancy_id` scoping intact. RLS unchanged (still org-scoped via `user_org_ids()`); `service_role` grant unchanged. NOTE: coordinate the migration number with the smart-lock lane so two lanes don't both claim `0201` — use the next free number at merge time.
- EDIT `lib/documents-server.ts` (+ `lib/documents.ts` types) — accept + persist `work_order_id`/`property_id` on create; add a `listDocumentsForProperty(orgId, propertyId)` and `listDocumentsForWorkOrder(...)`. Keep existing tenancy calls working unchanged.
- EDIT the maintenance/work-order actions + component under `app/dashboard/maintenance/` — an "Attach receipt" upload that sets `doc_type='receipt'`, `work_order_id`, and the work order's `property_id`. Optionally surface the linked receipt on the work-order card.
- NEW `app/dashboard/properties/[id]/documents-section.tsx` (+ its `-actions.ts`) — a per-property documents list mirroring the tenancy vault, gated identically.
- NEW `scripts/test-documents-scope.ts` — scope resolution + that tenancy-scoped listing is unchanged.

## CONSTRAINTS / INVARIANTS
- **Do not break the tenancy vault.** Existing per-tenancy documents behavior and queries stay identical; new FKs are nullable and additive. Prove it.
- Gate the new surfaces server-side with the SAME entitlement/auth the existing document + maintenance surfaces use (never UI-only).
- Signed-download + share-link security path is reused unchanged — no new public exposure of private docs.
- Pure scope-resolution logic (which documents belong to a property/work-order) in a testable spot; `npx tsx` test.
- esbuild-check every edited/new `.tsx`. Additive migration only; do NOT git push.

## VERIFICATION (Cowork re-runs)
- `scripts/test-documents-scope.ts` passes: a receipt attached to a work order resolves under both its work order and its property; tenancy-only docs still resolve only under the tenancy.
- Prove the gate: an org/user without access can't read another org's property documents (RLS + server gate).
- `git diff --check` clean; diff confined to the files above.

## OUT OF SCOPE
OCR of the receipt, auto-categorizing the receipt into the expense ledger (separate lane), and the accountant-package export change. This lane only files + surfaces the document.
