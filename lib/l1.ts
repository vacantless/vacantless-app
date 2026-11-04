// S748g: Form L1 (Application to Evict a Tenant for Non-payment of Rent and to
// Collect Rent the Tenant Owes) - the pure rules. No I/O.
//
// Source: LTB L1 instructions + the L1 (2026/09) form.
//   * File only after a served N4, and no earlier than the day after the N4's
//     termination date; not if the tenant paid what the N4 asked for, and only
//     while the tenant still lives in the unit.
//   * Rent owing is counted up to the filing date (new rent that came due after
//     the N4 is included), using the same packed table rules as the N4.
//   * Total = rent owing + NSF-related charges + the filing fee ($186 through the
//     Tribunals Ontario Portal, $201 on paper; LTB fee table, checked 2026-11-03).
//   * More than 2 tenants or more than 1 landlord needs the Schedule of Parties.

import { buildN4Snapshot, n4SnapshotBlocker } from "./n4-snapshot";
import { addDaysISO, type N4FormRow } from "./n4";
import type { PaymentRow } from "./payments";

export const L1_FEE_PORTAL_CENTS = 18600;
export const L1_FEE_PAPER_CENTS = 20100;
export const LTB_MAX_CLAIM_CENTS = 5_000_000;
export type L1FilingMethod = "portal" | "paper";

export function l1FeeCents(method: L1FilingMethod): number {
  return method === "portal" ? L1_FEE_PORTAL_CENTS : L1_FEE_PAPER_CENTS;
}

/** The earliest day the L1 can be filed: the day after the N4's termination date. */
export function earliestL1FilingDate(n4TerminationISO: string): string {
  return addDaysISO(n4TerminationISO, 1);
}

export type L1Problem =
  | "n4_not_served"
  | "too_early"
  | "not_in_possession"
  | "no_arrears"
  | "unresolved_credits"
  | "not_reconciling"
  | "over_limit";

export type L1Calc = {
  filingDateISO: string;
  rows: N4FormRow[];
  rentOwingCents: number;
  nsfCents: number;
  feeCents: number;
  totalCents: number;
  needsScheduleOfParties: boolean;
  problems: L1Problem[];
};

export function computeL1(input: {
  n4Status: string;
  n4TerminationISO: string;
  filingDateISO: string;
  method: L1FilingMethod;
  tenantInPossession: boolean;
  tenantCount: number;
  rentCents: number;
  startDateISO: string;
  payments: PaymentRow[];
  nsfCents?: number;
  /** S750: what the landlord took off the N4 total (override). The L1 keeps it. */
  n4ConcessionCents?: number;
}): L1Calc {
  const problems: L1Problem[] = [];
  if (input.n4Status !== "served" && input.n4Status !== "filed") problems.push("n4_not_served");
  if (input.filingDateISO < earliestL1FilingDate(input.n4TerminationISO)) problems.push("too_early");
  if (!input.tenantInPossession) problems.push("not_in_possession");

  // Same derive + pack + tenant-protective total as the N4, counted to the filing date.
  const base = {
    landlordName: "",
    tenantNames: [],
    rentCents: input.rentCents,
    startDateISO: input.startDateISO,
    noticeDateISO: input.filingDateISO,
    payments: input.payments,
    formVersion: "",
    capturedAtIso: "",
  };
  let snap = buildN4Snapshot(base);
  // S750: if the landlord lowered the N4 total, the L1 must not claim that
  // amount back (live walk: N4 $2,200, L1 $4,400 for the same months).
  const concession = Math.max(0, Math.round(input.n4ConcessionCents ?? 0));
  if (concession > 0 && snap.conservativeOwingCents > 0) {
    snap = buildN4Snapshot({
      ...base,
      overrideOwingCents: Math.max(0, snap.conservativeOwingCents - concession),
    });
  }
  const blocker = n4SnapshotBlocker(snap);
  if (blocker === "no_arrears") problems.push("no_arrears");
  else if (blocker === "unresolved_credits") problems.push("unresolved_credits");
  else if (blocker) problems.push("not_reconciling");

  const nsfCents = Math.max(0, Math.round(input.nsfCents ?? 0));
  const feeCents = l1FeeCents(input.method);
  const rentOwingCents = snap.totalOwingCents;
  const totalCents = rentOwingCents + nsfCents + feeCents;
  if (totalCents > LTB_MAX_CLAIM_CENTS) problems.push("over_limit");

  return {
    filingDateISO: input.filingDateISO,
    rows: snap.arrearsRows,
    rentOwingCents,
    nsfCents,
    feeCents,
    totalCents,
    needsScheduleOfParties: input.tenantCount > 2,
    problems,
  };
}

export const L1_PROBLEM_TEXT: Record<L1Problem, string> = {
  n4_not_served: "Record that you served the N4 first.",
  too_early: "You can file the L1 starting the day after the N4's termination date.",
  not_in_possession: "You can't file an L1 once the tenant has moved out. Use an L10 instead.",
  no_arrears: "The rent ledger shows nothing owing. If the tenant paid what the N4 asked for, the N4 is void.",
  unresolved_credits: "Some payments aren't assigned to a rental period. Assign them under Rent first.",
  not_reconciling: "The rent table doesn't add up. Check the rent ledger first.",
  over_limit: "The LTB can't order more than $50,000. Talk to a lawyer about going to court.",
};

/**
 * S750: how much the landlord took off the N4's ledger total with an override,
 * read from the served N4's frozen snapshot. 0 when there was no override. Pure.
 */
export function n4ConcessionCents(
  snap: { conservativeOwingCents?: number | null; totalOwingCents?: number | null } | null | undefined,
): number {
  if (!snap) return 0;
  const floor = Math.round(snap.conservativeOwingCents ?? 0);
  const total = Math.round(snap.totalOwingCents ?? 0);
  return Math.max(0, floor - total);
}
