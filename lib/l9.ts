// S751: Form L9 (Application to Collect Rent the Tenant Owes) - the pure rules. No I/O.
//
// Source: LTB L9 instructions (page dated July 2026) + the L9 (2026/09) form.
//   * Collects rent only; it can't evict. No notice has to be served first
//     (to evict for unpaid rent the landlord uses an N4, then an L1).
//   * The tenant must still live in the unit when the landlord files. If they
//     moved out, the landlord uses an L10 instead.
//   * Rent owing is counted up to the filing date, with the same rent table
//     rules as the N4 and L1 (more than three periods are combined, the last
//     period on its own row).
//   * Total = rent owing + NSF-related charges + the filing fee ($186 through
//     the Tribunals Ontario Portal, $201 on paper; same fee as the L1).
//   * The LTB can't order more than $50,000.
//   * More than 2 tenants or more than 1 landlord needs the Schedule of Parties.

import { buildN4Snapshot, n4SnapshotBlocker } from "./n4-snapshot";
import type { N4FormRow } from "./n4";
import type { PaymentRow } from "./payments";
import { l1FeeCents, LTB_MAX_CLAIM_CENTS, type L1FilingMethod } from "./l1";

export type L9FilingMethod = L1FilingMethod;
export const l9FeeCents = l1FeeCents;

export type L9Problem =
  | "not_in_possession"
  | "no_arrears"
  | "unresolved_credits"
  | "not_reconciling"
  | "over_limit"
  | "future_filing_date";

export type L9Calc = {
  filingDateISO: string;
  rows: N4FormRow[];
  rentOwingCents: number;
  nsfCents: number;
  feeCents: number;
  totalCents: number;
  needsScheduleOfParties: boolean;
  problems: L9Problem[];
};

export function computeL9(input: {
  filingDateISO: string;
  todayISO: string;
  method: L9FilingMethod;
  tenantInPossession: boolean;
  tenantCount: number;
  rentCents: number;
  startDateISO: string;
  payments: PaymentRow[];
  nsfCents?: number;
}): L9Calc {
  const problems: L9Problem[] = [];
  if (!input.tenantInPossession) problems.push("not_in_possession");
  // Rent is counted to the filing date; a future date would claim rent that
  // isn't owed yet. Prepare it on the day you file.
  if (input.filingDateISO > input.todayISO) problems.push("future_filing_date");

  const snap = buildN4Snapshot({
    landlordName: "",
    tenantNames: [],
    rentCents: input.rentCents,
    startDateISO: input.startDateISO,
    noticeDateISO: input.filingDateISO,
    payments: input.payments,
    formVersion: "",
    capturedAtIso: "",
  });
  const blocker = n4SnapshotBlocker(snap);
  if (blocker === "no_arrears") problems.push("no_arrears");
  else if (blocker === "unresolved_credits") problems.push("unresolved_credits");
  else if (blocker) problems.push("not_reconciling");

  const nsfCents = Math.max(0, Math.round(input.nsfCents ?? 0));
  const feeCents = l9FeeCents(input.method);
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

export const L9_PROBLEM_TEXT: Record<L9Problem, string> = {
  not_in_possession: "You can't file an L9 once the tenant has moved out. Use an L10 instead.",
  no_arrears: "The rent ledger shows nothing owing, so there is nothing to collect.",
  unresolved_credits: "Some payments aren't assigned to a rental period. Assign them under Rent first.",
  not_reconciling: "The rent table doesn't add up. Check the rent ledger first.",
  over_limit: "The LTB can't order more than $50,000. Talk to a lawyer about going to court.",
  future_filing_date: "Rent is counted up to the day you file. Prepare the L9 on the day you file it.",
};
