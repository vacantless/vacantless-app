// ============================================================================
// "Watch a lease" — pure input validation for the FREE compliance-wedge entry
// (rent-increase autopilot, Slice 2, S340).
//
// This is the free front door: an owner who is NOT running the leasing pipeline
// or rent rails enrolls a single existing lease into the rent-increase drip.
// It writes the SAME property + tenancy records the Slice 1 cron, the
// RentIncreaseCard, and the N1 route already read — no parallel data model.
//
// This module is PURE (no DOM/IO/Supabase/Next imports), so it is unit-tested
// directly with `npx tsx scripts/test-watch-lease.ts` (same discipline as
// lib/tenancy / lib/rent-increase). The server action validates with this, then
// performs the inserts.
// ============================================================================

export type WatchLeaseValidation = { ok: true } | { ok: false; code: string };

/**
 * Validate the minimal fields the watch entry captures. Mirrors
 * `validateTenancyInput` but for the standalone create (no pre-existing unit:
 * the address IS the unit) and adds the rent-increase-specific date rule.
 *
 * The exemption flag is owner-asserted and intentionally NOT validated here —
 * we never conclude a unit's rent-control status, we only store what the owner
 * declares (flag-don't-conclude). `firstOccupancyDate` is optional evidence.
 */
export function validateWatchLeaseInput(v: {
  address: string | null;
  startDate: string | null;
  lastIncreaseDate: string | null;
  primaryTenantName: string | null;
}): WatchLeaseValidation {
  if (!v.address || v.address.trim() === "") return { ok: false, code: "address" };
  if (!v.startDate) return { ok: false, code: "start" };
  if (!v.primaryTenantName || v.primaryTenantName.trim() === "") {
    return { ok: false, code: "tenant" };
  }
  // A "last increase" before the lease even started is nonsensical and would
  // corrupt the anniversary clock the autopilot derives from.
  if (v.lastIncreaseDate && v.lastIncreaseDate < v.startDate) {
    return { ok: false, code: "increase_before_start" };
  }
  return { ok: true };
}

/**
 * Validate the "confirm an existing tenancy" path — the prefill flow where the
 * landlord points "watch a lease" at a tenancy that ALREADY exists (created from
 * the leasing pipeline). The unit/parties already live on the record, so this
 * mode never re-creates them and never asks for the address again; it only
 * confirms the lease start and captures the rent-increase-specific fields the
 * autopilot consumes (last-increase anchor + the owner-asserted exemption).
 *
 * Same date rule as the standalone create (a last increase can't precede the
 * lease start), minus the address/tenant-name requirements that the existing
 * record already satisfies.
 */
export function validateWatchExistingLease(v: {
  startDate: string | null;
  lastIncreaseDate: string | null;
}): WatchLeaseValidation {
  if (!v.startDate) return { ok: false, code: "start" };
  if (v.lastIncreaseDate && v.lastIncreaseDate < v.startDate) {
    return { ok: false, code: "increase_before_start" };
  }
  return { ok: true };
}

const WATCH_LEASE_ERRORS: Record<string, string> = {
  address: "Enter the unit's address.",
  start: "A lease start date is required.",
  tenant: "Add the tenant's name.",
  increase_before_start: "The last rent increase can't be before the lease start.",
  notfound: "That tenancy could no longer be found.",
  forbidden: "You don't have permission to add a lease.",
};

export function watchLeaseErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return WATCH_LEASE_ERRORS[code] ?? "Something went wrong. Please check the form.";
}
