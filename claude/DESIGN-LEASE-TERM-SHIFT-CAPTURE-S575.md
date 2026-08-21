# DESIGN - Lease-term-shift capture: never compound a rent increase onto a stale base (S575, design of record)

**Status: DESIGN OF RECORD. Authored s575 (2026-07-26) with Noam. Decisions below are LOCKED (Noam delegated the final calls after analysis). Next step: convert to a dispatch-ready CODEX-PROMPT after Noam okays this doc. NOT yet a build order.**
**Standing constraints: audit before building (rule 22 - most of the entry flow already exists); never assert a table/constraint is absent without grepping migrations first; build behind the existing tenancy flows, not a new silo; every pure-logic change ships a unit test; land app changes natively on the Mac.**

## The problem (from Noam's s574 onboarding note)
When a landlord onboards an EXISTING lease, the lease's stated rent and terms can be stale: there may have been increases, reductions, or altered terms in the years since signing. Lease OCR pulls the ORIGINAL number. If rent-increase tracking arms off that original, the guideline/N1 math compounds onto a wrong base - the one error that turns into a legal misfire (over- or under-shooting a lawful increase). The fix is to guarantee the base is the TRUE current effective rent, affirmatively confirmed, before the increase drip arms - and to keep the provenance (original + every change) so a landlord entering mid-stream can reconstruct the chain.

## What already exists (audited s575 - reuse, do not rebuild)
- `app/dashboard/tenancies/watch/page.tsx` - the "confirm an existing lease" flow: captures lease start, when rent was last raised, and rent-control exemption, to arm rent-increase tracking with a pre-filled N1. THIS is the primary entry point to extend.
- `app/dashboard/tenancies/actions.ts` - the server actions behind that flow (the "one existing lease into the rent-increase drip in a single screen" path, ~line 307; last-increase date sets the anniversary clock, ~line 458).
- `app/dashboard/tenancies/[id]/page.tsx` (~line 545) - an active-tenancy "confirm lease" flow for a tenancy with a rent set.
- `lib/rent-increase.ts` - `deriveRentIncrease`; the base is `tenancies.rent_cents` ("the current rent", per its own comment). This is the value that must be the confirmed current effective rent.
- `lib/lease-locator.ts` + the lease OCR extraction spec (`LEASE-OCR-EXTRACTION-SPEC-2026-07-06.md`) - where an uploaded lease's rent/terms are extracted. The second entry point (auto-trigger reconciliation when OCR seeds the base).

## Locked decisions
1. **WHERE - one shared reconciliation step, two entry points.** Build ONE "is this rent still current?" reconciliation component/step and mount it BOTH (a) inline in the `tenancies/watch` confirm flow, and (b) auto-triggered right after a lease OCR when the extracted rent is about to seed the base. Not two divergent flows - one component, reused. (Noam: "is both best" -> yes, via a single shared step.)
2. **CAPTURE - an append-only rent-adjustment ledger, not a flat field.** A landlord entering mid-stream must be able to load the ORIGINAL lease rent and every change over the years up to the current amount. Model it as an append-only ledger; the flat `tenancies.rent_cents` stays synced to the latest effective row.
   - Proposed table (VERIFY none exists first - grep migrations for rent history/adjustments before creating): `tenancy_rent_adjustments` { id, organization_id, tenancy_id, effective_date (date), rent_cents (int), kind ('original'|'increase'|'reduction'|'altered_term'|'correction'), source ('lease_ocr'|'landlord_confirm'|'n1'|'import'), note (text, nullable), created_at, created_by }. Append-only (no deletes; a mistake is corrected by a new 'correction' row).
   - Current effective rent = the row with the latest `effective_date` (tie-break newest `created_at`). Keep `tenancies.rent_cents` = that value so `deriveRentIncrease` and everything downstream are unchanged.
   - v1 SEEDS two rows on confirm: 'original' (from the lease/OCR, effective = lease start) and, if the landlord says it shifted, the confirmed 'landlord_confirm' current (effective = last-raised date they give). Intermediate historical rows are OPTIONAL to enter in v1 (a "add a past change" affordance), REQUIRED to be reconstructable later as real N1s land ('n1' rows append automatically).
3. **GUARDRAIL - required confirm before tracking arms.** The increase drip / N1 does NOT arm until the landlord affirmatively confirms "this is the current rent." A stale-base arm is the one legally dangerous default; the extra tap is worth it for Vacantless's "right amount, on time, lawfully" promise. Prefill the OCR/known value, but require the explicit confirmation to proceed.

## Flow (v1)
1. Landlord enters an existing lease (watch flow) OR uploads a lease that OCRs a rent.
2. The reconciliation step shows the known/OCR'd amount and asks: "Is this still the current rent, or has it changed since the lease was signed?"
3. If unchanged -> one confirm; seed an 'original' ledger row; arm tracking.
4. If changed -> capture the current effective rent + the date it took effect (last-raised date), with an optional "add earlier changes" affordance for the in-between history; seed 'original' + the confirmed current row(s); arm tracking.
5. `tenancies.rent_cents` is set to the confirmed current; the anniversary clock uses the last-effective date. Nothing arms until step 3/4's explicit confirm.

## Gates / definition of done
- Rent-increase tracking (drip + N1 pre-fill) CANNOT arm for an existing-lease onboarding until the landlord has affirmatively confirmed the current rent. Assert with a test on the arm path.
- `deriveRentIncrease` bases off the confirmed current effective rent (the latest ledger row), never the raw OCR original. A unit test seeds original + a later confirmed amount and asserts the guideline math uses the later one.
- The ledger is append-only and reconstructs original -> ... -> current by effective_date; `tenancies.rent_cents` equals the latest row. Test the "latest effective row" resolver as pure logic.
- Reuse the existing watch/confirm UI and actions; the reconciliation step is one shared component mounted in both entry points. No second parallel onboarding flow.
- Migration only if no rent-history table exists (grep first); tsc clean; land natively on the Mac.

## Out of scope (v1)
- Full guided back-fill of every historical adjustment (v1 requires only original + confirmed-current; earlier rows are optional-to-enter, auto-appended as future N1s land).
- Altered NON-rent terms beyond a free-text note (structured clause-change capture is later).
- Any change to how N1s are generated once the base is correct (that path is unchanged).

## Open question for Noam (before the Codex prompt)
- v1 default for the "add earlier in-between changes" affordance: SHOW it (optional) so a diligent landlord can enter the chain now, or HIDE it in v1 (only original + current, chain fills over time)? Recommendation: SHOW it but optional - zero pressure, but a landlord who has the numbers can seed real provenance immediately.
