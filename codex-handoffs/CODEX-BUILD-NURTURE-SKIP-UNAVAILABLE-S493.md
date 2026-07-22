# Codex Build Ticket — S493: Nurture drip must skip leads whose property isn't available

**Date:** 2026-07-15 · **Author:** Cowork (grounded against real code + prod data) · **Status:** IMPLEMENTATION-READY
**Base:** HEAD `54ee07d`. **NO migration.** Small, pure guard + one query field + tests.
**Repo:** `.../Agile Lead to Lease Engine/vacantless-app`

## The bug (confirmed in prod)

The lead-nurture cron re-engages inquired leads with a paced drip ("Still interested?", **"Your next home might still be waiting"**, "One last note"). It filters on lead pipeline status and step count, **but never checks the property's status** — so it keeps dripping leads whose unit is already **leased** (or draft / off_market).

Proven 2026-07-15: lead `b63dc3d8` (Paul Schwartz dogfood org `1a28fea7`) on **10 Bellair #1604, which is `leased`**, received nurture **step 2** that morning. A real renter would get "your next home might still be waiting" about a unit that's already gone. (The offending lead has been retired to `lost` as a data hotfix; this ticket is the durable code fix.)

Root cause, `app/api/cron/nurture/route.ts`:
- The query (~L65-73) selects `properties(address, rent_cents)` — **no `status`** — and filters only:
  ```
  .in("status", NURTURABLE_STATUSES)   // lead status: new/replied/contacted
  .lt("nurture_step_sent", NURTURE_STEPS)
  .gt("created_at", oldestIso)
  ```
- The per-row decision `nurtureStepDue({...})` (~L96) is passed lead status/age/steps but **not** the property status, so it can't gate on it.

Property status enum in prod: `available` (15), `draft` (6), `leased` (6), `off_market` (3). Only **`available`** should be nurtured.

## The fix (pure guard, matches the existing `isNurturableStatus` pattern)

1. **`lib/nurture.ts`** — add a pure, unit-testable helper + thread property status into the decision:
   ```ts
   // A drip only makes sense while the unit is actually takeable.
   export const NURTURABLE_PROPERTY_STATUSES = ["available"] as const;
   export function isNurturablePropertyStatus(status: string | null | undefined): boolean {
     return (NURTURABLE_PROPERTY_STATUSES as readonly string[]).includes(status ?? "");
   }
   ```
   Add `propertyStatus: string | null` to `NurtureDueInput`, and early-return `0` in `nurtureStepDue` when a property status is present and not nurturable:
   ```ts
   // Right after the `if (!isNurturableStatus(status)) return 0;` line:
   if (input.propertyStatus != null && !isNurturablePropertyStatus(input.propertyStatus)) return 0;
   ```
   Keep the guard `propertyStatus != null` so a lead with **no** property (property_id null → no row) preserves today's behavior rather than silently changing it. (See open question.)

2. **`app/api/cron/nurture/route.ts`** — add `status` to the properties sub-select and pass it through:
   ```
   "properties(address, rent_cents, status), " +
   ```
   ```ts
   const step = nurtureStepDue({
     ...,
     propertyStatus: property?.status ?? null,
   });
   ```
   (Optionally also add `.neq` is NOT possible on a joined column here, so the guard belongs in `nurtureStepDue` as above — keep it in the pure layer, not the query.)

3. **`scripts/test-nurture.ts`** — add cases:
   - property `available` + otherwise-due → returns the due step (unchanged).
   - property `leased` / `draft` / `off_market` + otherwise-due → returns `0`.
   - `propertyStatus: null` + otherwise-due → returns the due step (no behavior change for property-less leads).

## Honest / safety
- This guard only ever **stops** a send; it never creates one. No email content change, no new send path.
- No migration. No change to lead status semantics, org flags, or the cron auth/idempotency.

## Verify (on the Mac; report results)
```
npx tsx scripts/test-nurture.ts
./node_modules/.bin/tsc --noEmit
npm run lint
npm run build
```

## Open question for Codex
Leads with **no property** (`property_id` null): keep nurturing (current behavior, as this ticket does), or also skip? Recommend keep-as-is for now — a property-less inquiry is rare and out of scope; flag if you see a reason to skip.

## Data state (already handled by Cowork, FYI)
- Offending lead `b63dc3d8` set to `lost` → drip stopped.
- Verified: **zero** leads currently satisfy (nurturable status + step < 3 + property not `available`), so no live renter is being mis-dripped right now. The two QA-seed leads on leased units are already at step 3 (exhausted), so they won't fire regardless.

## Files expected to change
`lib/nurture.ts`, `app/api/cron/nurture/route.ts`, `scripts/test-nurture.ts`. No migration.
