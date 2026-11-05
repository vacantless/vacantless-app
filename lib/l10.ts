// S751: Form L10 (Application to Collect Money a Former Tenant Owes) - the pure
// rules. No I/O.
//
// Source: LTB L10 instructions (July 2026) + the L10 (2026/09) form.
//   * Only after the tenant moved out; the move-out date must be on or after
//     2021-09-01, and the landlord files no more than one year after it.
//   * Reason 1: rent not paid during the tenancy (and per-day compensation after
//     it ended), counted in the same packed rent table as the N4 / L1 / L9.
//   * Reason 4: damage (repair or replacement cost, with an explanation).
//   * Reason 5: substantial interference (out-of-pocket costs, explained).
//   * NSF (Reason 2) and utilities (Reason 3) need their own tables and bills;
//     Vacantless leaves those for the landlord to add on the form.
//   * Fee $186 through the Tribunals Ontario Portal, $201 on paper; the LTB
//     can't order more than $50,000. The former tenant's current address (not
//     the rental unit) goes on the form when known.

import { buildN4Snapshot, n4SnapshotBlocker } from "./n4-snapshot";
import type { N4FormRow } from "./n4";
import type { PaymentRow } from "./payments";
import { l1FeeCents, LTB_MAX_CLAIM_CENTS, type L1FilingMethod } from "./l1";
import { fitsBox } from "./n13";

export const L10_MOVE_OUT_FLOOR = "2021-09-01";
export const L10_DETAIL_BOX = { w: 572, h: 104 };
export const L10_DETAIL_FONT_PT = 9;

/** Last day to file: one year after the move-out date. */
export function latestL10FilingDate(moveOutISO: string): string {
  const [y, m, d] = moveOutISO.split("-").map(Number);
  const next = new Date(Date.UTC(y + 1, m - 1, d));
  // Feb 29 + 1 year lands on Mar 1 in JS; the LTB counts to Feb 28.
  if (next.getUTCMonth() !== m - 1) return `${y + 1}-${String(m).padStart(2, "0")}-28`;
  return next.toISOString().slice(0, 10);
}

export type L10Problem =
  | "no_move_out"
  | "not_moved_out"
  | "too_old_move_out"
  | "too_late"
  | "nothing_claimed"
  | "unresolved_credits"
  | "not_reconciling"
  | "detail_needed"
  | "detail_too_long"
  | "over_limit"
  | "same_address";

export type L10Calc = {
  filingDateISO: string;
  moveOutISO: string;
  latestFilingISO: string;
  rows: N4FormRow[];
  rentOwingCents: number;
  damageCents: number;
  interferenceCents: number;
  feeCents: number;
  totalCents: number;
  needsScheduleOfParties: boolean;
  problems: L10Problem[];
};

export function computeL10(input: {
  moveOutISO: string | null;
  filingDateISO: string;
  method: L1FilingMethod;
  tenantCount: number;
  rentCents: number | null;
  startDateISO: string | null;
  payments: PaymentRow[];
  damageCents?: number;
  damageDetail?: string;
  interferenceCents?: number;
  interferenceDetail?: string;
}): L10Calc {
  const problems: L10Problem[] = [];
  const moveOut = input.moveOutISO && /^\d{4}-\d{2}-\d{2}$/.test(input.moveOutISO) ? input.moveOutISO : null;
  if (!moveOut) problems.push("no_move_out");
  else {
    if (moveOut > input.filingDateISO) problems.push("not_moved_out");
    if (moveOut < L10_MOVE_OUT_FLOOR) problems.push("too_old_move_out");
    if (input.filingDateISO > latestL10FilingDate(moveOut)) problems.push("too_late");
  }

  let rows: N4FormRow[] = [];
  let rentOwingCents = 0;
  if (moveOut && input.rentCents && input.startDateISO) {
    const snap = buildN4Snapshot({
      landlordName: "",
      tenantNames: [],
      rentCents: input.rentCents,
      startDateISO: input.startDateISO,
      noticeDateISO: moveOut,
      payments: input.payments,
      formVersion: "",
      capturedAtIso: "",
    });
    const blocker = n4SnapshotBlocker(snap);
    if (blocker === "unresolved_credits") problems.push("unresolved_credits");
    else if (blocker && blocker !== "no_arrears") problems.push("not_reconciling");
    if (!blocker) {
      rows = snap.arrearsRows;
      rentOwingCents = snap.totalOwingCents;
    }
  }

  const damageCents = Math.max(0, Math.round(input.damageCents ?? 0));
  const interferenceCents = Math.max(0, Math.round(input.interferenceCents ?? 0));
  if ((damageCents > 0 && !input.damageDetail?.trim()) || (interferenceCents > 0 && !input.interferenceDetail?.trim())) {
    problems.push("detail_needed");
  }
  if (
    (input.damageDetail && !fitsBox(input.damageDetail, L10_DETAIL_BOX, L10_DETAIL_FONT_PT)) ||
    (input.interferenceDetail && !fitsBox(input.interferenceDetail, L10_DETAIL_BOX, L10_DETAIL_FONT_PT))
  ) {
    problems.push("detail_too_long");
  }
  if (rentOwingCents + damageCents + interferenceCents <= 0 && !problems.includes("no_move_out")) problems.push("nothing_claimed");

  const feeCents = l1FeeCents(input.method);
  const totalCents = rentOwingCents + damageCents + interferenceCents + feeCents;
  if (totalCents > LTB_MAX_CLAIM_CENTS) problems.push("over_limit");

  return {
    filingDateISO: input.filingDateISO,
    moveOutISO: moveOut ?? "",
    latestFilingISO: moveOut ? latestL10FilingDate(moveOut) : "",
    rows,
    rentOwingCents,
    damageCents,
    interferenceCents,
    feeCents,
    totalCents,
    needsScheduleOfParties: input.tenantCount > 2,
    problems,
  };
}

export const L10_PROBLEM_TEXT: Record<L10Problem, string> = {
  no_move_out: "Enter the date the tenant moved out.",
  not_moved_out: "An L10 is only for a tenant who has moved out. For a current tenant, use the L9 (rent) or L1 / L2.",
  too_old_move_out: "The L10 only covers tenants who moved out on or after September 1, 2021.",
  too_late: "The L10 must be filed no more than one year after the tenant moved out.",
  nothing_claimed: "The rent ledger shows nothing owing and no damage or other costs were entered.",
  unresolved_credits: "Some payments aren't assigned to a rental period. Assign them under Rent first.",
  not_reconciling: "The rent table doesn't add up. Check the rent ledger first.",
  detail_needed: "Explain each cost you claim: what happened and how you worked out the amount.",
  detail_too_long: "An explanation doesn't fit its box on the form. Shorten it, and attach a page with the rest.",
  over_limit: "The LTB can't order more than $50,000. Talk to a lawyer about going to court.",
  same_address: "Give the former tenant's new address, not the rental unit. Leave it blank if you don't know it.",
};

