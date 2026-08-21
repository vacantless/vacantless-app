# CODEX PROMPT - Lease-term-shift capture: confirm the current rent before arming increases (v1)

**Status: DISPATCH-READY. Authored s575 (2026-07-26). Implements DESIGN-LEASE-TERM-SHIFT-CAPTURE-S575.md (design of record, decisions locked). Read that design doc FIRST. Hand to Codex when idle. Land app changes NATIVELY on the Mac (Noam pushes; bridge git push = 403).**
**Standing constraints: audit before building (the existing-lease confirm flow already exists - EXTEND it, do not build a parallel onboarding); never assert a table/constraint is absent without grepping migrations first; every pure-logic change ships a unit test; tsc clean.**

## Goal (one sentence)
Guarantee that `tenancies.rent_cents` is the landlord-confirmed CURRENT effective rent - never the raw OCR/original lease value - before rent-increase tracking (drip + N1 pre-fill) arms, and keep an append-only ledger so original -> every change -> current is reconstructable.

## Read first (the real substrate - reuse, do not fork)
- `claude/DESIGN-LEASE-TERM-SHIFT-CAPTURE-S575.md` - the design of record. Everything below implements it.
- `app/dashboard/tenancies/watch/page.tsx` + `app/dashboard/tenancies/actions.ts` - the existing "confirm an existing lease" flow (the arm path is here, ~line 307/458). PRIMARY entry point to extend.
- `app/dashboard/tenancies/[id]/page.tsx` (~line 545) - the active-tenancy confirm-lease flow (second mount point).
- `lib/rent-increase.ts` - `deriveRentIncrease`; base is `tenancies.rent_cents`. Must read the confirmed current, unchanged otherwise.
- `lib/lease-locator.ts` + `LEASE-OCR-EXTRACTION-SPEC-2026-07-06.md` - where OCR seeds a rent; the auto-trigger entry point.

## Build scope (v1)
1. **Ledger table (grep FIRST - do not create if a rent-history/adjustments table already exists).** If absent, add migration `tenancy_rent_adjustments`: { id uuid pk, organization_id uuid, tenancy_id uuid fk, effective_date date, rent_cents int, kind text check in ('original','increase','reduction','altered_term','correction'), source text check in ('lease_ocr','landlord_confirm','n1','import'), note text null, created_at timestamptz default now(), created_by uuid null }. Append-only (no update/delete of amounts; a fix is a new 'correction' row). RLS/grants matching the sibling tenancy tables.
2. **Pure resolver + unit test:** `currentEffectiveRent(adjustments[])` -> the row with the latest `effective_date` (tie-break newest `created_at`). Test: original-only; original + later confirmed (returns later); a correction after an increase (returns correction). NO I/O.
3. **One shared reconciliation step** (component + server action) asking "Is this still the current rent, or has it changed since the lease was signed?" with the known/OCR'd amount prefilled. Mount it BOTH inline in the watch confirm flow AND auto-trigger after a lease OCR seeds the base. One component, two mounts - not two flows.
   - Unchanged path: one confirm -> seed an 'original' row (effective = lease start) -> set `tenancies.rent_cents` = confirmed -> arm.
   - Changed path: capture current effective rent + the date it took effect (last-raised date) -> seed 'original' + a 'landlord_confirm' current row -> set `tenancies.rent_cents` = the current -> arm. Include an OPTIONAL "add an earlier change" affordance (show it, low-pressure - v1 default per design's open question, resolved SHOW-OPTIONAL) that appends intermediate rows; requiring only original + current.
4. **Required-confirm gate:** the arm path (drip + N1 pre-fill) MUST NOT fire until the landlord affirmatively confirms the current rent. Prefill is fine; the explicit confirm is mandatory. Keep `tenancies.rent_cents` synced to the latest ledger row.
5. **Keep N1 generation unchanged** once the base is correct - do not touch how N1s are produced, only the base they read.

## Gates / definition of done
- `deriveRentIncrease` (and the N1 pre-fill) base off the confirmed current effective rent, never the raw OCR original. Unit test: seed original + a later confirmed amount; assert the guideline math uses the later one.
- Tracking cannot arm for an existing-lease onboarding without the affirmative current-rent confirm. Assert on the arm path.
- Ledger is append-only; `currentEffectiveRent` resolver is pure + tested; `tenancies.rent_cents` == latest row after confirm.
- One shared reconciliation component mounted in both entry points; no parallel onboarding flow.
- Migration only if no rent-history table exists (grep first); tsc clean; land natively on the Mac.

## Out of scope (v1)
- Guided back-fill of the full historical chain (v1 requires only original + current; earlier rows optional-to-enter, and 'n1' rows auto-append as future increases land).
- Structured non-rent clause-change capture (free-text note only in v1).
- Any change to N1 generation mechanics once the base is correct.
