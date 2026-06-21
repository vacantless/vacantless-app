// Smart default-open for the tenancy detail page (S286).
//
// The tenancy page is a stack of CollapsibleSections (S283), each with a status
// line on its header. Rather than always opening the Tenants roster, we open
// the ONE section that needs the operator's attention now — derived from the
// same status values the headers already show. Pure (no I/O) so the priority
// rule can be unit-tested in isolation, mirroring lib/rental-next-action.ts.

import type { RentIncreaseStatus } from "./rent-increase";

/** Section ids that can be the default-open one. */
export type TenancyOpenSectionId =
  | "tenants"
  | "lease-document"
  | "rent-increase"
  | "rent-collection";

/** Lease-document header status (see the page's leaseDocStatus). */
export type LeaseDocStatusLabel =
  | "Not started"
  | "Draft"
  | "Sent for signature"
  | "Signed";

/** Rent-collection header status (see the page's rentCollectionStatus). */
export type RentCollectionStatusLabel =
  | "Not set up"
  | "Authorized — not scheduled"
  | "Automatic monthly debit";

export type TenancyOpenInput = {
  /** Tenants on the lease. Zero = nothing else can be set up yet. */
  tenantCount: number;
  leaseDocStatus: LeaseDocStatusLabel;
  rentCollectionStatus: RentCollectionStatusLabel;
  /**
   * Rent-increase derived status, or null when no increase card shows (not an
   * active tenancy with rent set, or the tenancy is too new for a card).
   * Mirrors deriveRentIncrease().status.
   */
  rentIncreaseStatus: RentIncreaseStatus | null;
};

/**
 * Pick the single section to open by default. Priority, most-urgent first:
 *   1. No tenants yet              -> Tenants (can't set up a lease/rent without one)
 *   2. Rent increase serveable     -> Rent increase (legal deadline + money on the table)
 *   3. Lease not finished          -> Lease document (create the lease, or send the draft)
 *   4. Rent collection not set up   -> Rent collection
 *   5. Everything in order          -> Tenants (the roster, same as the old default)
 *
 * A lease that's "Sent for signature" is waiting on the tenant (not the
 * operator), so it does not pull focus; an "exempt"/"scheduled" rent increase
 * has no action due yet, so it doesn't either.
 */
export function pickDefaultOpenSection(
  input: TenancyOpenInput,
): TenancyOpenSectionId {
  if (input.tenantCount <= 0) return "tenants";

  const increaseActionable =
    input.rentIncreaseStatus === "serve_window" ||
    input.rentIncreaseStatus === "serve_late" ||
    input.rentIncreaseStatus === "overdue";
  if (increaseActionable) return "rent-increase";

  const leaseNeedsAttention =
    input.leaseDocStatus === "Not started" || input.leaseDocStatus === "Draft";
  if (leaseNeedsAttention) return "lease-document";

  if (input.rentCollectionStatus === "Not set up") return "rent-collection";

  return "tenants";
}
