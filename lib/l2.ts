// S749: Form L2 (Application to End a Tenancy and Evict a Tenant or Collect
// Money) - the pure rules for the notice-based path. No I/O.
//
// Source: LTB L2 instructions + the L2 (2026/09) form, checked 2026-11-03.
//   * Reason 1: the landlord gave a Notice to End (N5, N6, N7, N8, N12, N13).
//     File with a copy of the notice and its Certificate of Service, and no later
//     than 30 days after the notice's termination date.
//   * When the landlord can start: N5 first notice from the 8th day after it
//     counts as given (the tenant had 7 days to fix it); second N5, N8 and N12
//     right after it is given.
//   * The tenant must still live in the unit on the filing day.
//   * Compensation for each day the tenant stays past the termination date can
//     be claimed (Part 3, box 1); the LTB then subtracts any rent deposit, so the
//     form asks for the current rent and the deposit.
//   * N12 needs Schedule B: how the one month's compensation was handled, every
//     other N12 or N13 the landlord gave in the past 2 years (any unit), and a
//     signed declaration from the person moving in, filed with the L2.
//   * Fee: $186 through the Tribunals Ontario Portal, $201 on paper (same as L1).

import { addDaysISO, n12DeemedServiceDate, type N12ServiceMethod } from "./n12";
import { L1_FEE_PAPER_CENTS, L1_FEE_PORTAL_CENTS, type L1FilingMethod } from "./l1";

export const L2_LATEST_DAYS_AFTER_TERMINATION = 30;
export const L2_PRIOR_NOTICE_ROWS = 3;
export const L2_NOTICE_TYPES = ["N5", "N8", "N12"] as const;
export type L2NoticeType = (typeof L2_NOTICE_TYPES)[number];

export function l2FeeCents(method: L1FilingMethod): number {
  return method === "portal" ? L1_FEE_PORTAL_CENTS : L1_FEE_PAPER_CENTS;
}

/** Last day to file: 30 days after the notice's termination date. */
export function latestL2FilingDate(terminationISO: string): string {
  return addDaysISO(terminationISO, L2_LATEST_DAYS_AFTER_TERMINATION);
}

/** The bits of a stored notice snapshot the L2 reads. */
export type L2NoticeSnap = {
  serviceDateISO?: string;
  method?: N12ServiceMethod;
  earliestL2ISO?: string;
  rentalUnitAddress?: string | null;
  reason?: 1 | 2;
  personName?: string;
  relationship?: string;
  compensationRequired?: boolean;
  landlordName?: string;
  landlordIsIndividual?: boolean;
  signer?: { firstName?: string | null; lastName?: string | null } | null;
};

/**
 * S750: who the L2 names as landlord, taken from the notice it is based on (the
 * LTB expects the same landlord on both). A person (an N12 Reason 1 landlord is
 * always one) goes in the first/last name boxes with no company; otherwise the
 * notice's landlord name is the company. Falls back to the account name. Pure.
 */
export function l2LandlordPrefill(
  snap: L2NoticeSnap | null | undefined,
  fallbackName: string,
): { company: string; first: string; last: string } {
  const name = (snap?.landlordName ?? "").trim() || fallbackName.trim();
  const isPerson = snap?.landlordIsIndividual === true;
  if (!isPerson) return { company: name, first: "", last: "" };
  const sf = (snap?.signer?.firstName ?? "").trim();
  const sl = (snap?.signer?.lastName ?? "").trim();
  if (sf && sl && `${sf} ${sl}`.toLowerCase() === name.toLowerCase()) return { company: "", first: sf, last: sl };
  const cut = name.lastIndexOf(" ");
  if (cut <= 0) return { company: "", first: name, last: "" };
  return { company: "", first: name.slice(0, cut).trim(), last: name.slice(cut + 1).trim() };
}

/**
 * First filing day from the notice's own rules. The N5 stores it (8th day for a
 * first N5, right away for a second); an N8 or N12 can be filed once it counts
 * as given. Null when the snapshot can't tell (never guess a legal date).
 */
export function earliestL2FilingDate(type: string, snap: L2NoticeSnap | null | undefined): string | null {
  if (!snap) return null;
  if (type === "N5") return snap.earliestL2ISO ?? null;
  if (type !== "N8" && type !== "N12") return null;
  if (!snap.serviceDateISO || !snap.method) return null;
  return n12DeemedServiceDate(snap.serviceDateISO, snap.method);
}

/**
 * Schedule B, Part A. Option order matches the form:
 *   gave = paid on or before the termination date; offered = another unit, accepted;
 *   will_give = will pay by the termination date; not_required = Reason 1 with 120+ days.
 */
export const L2_N12_COMPENSATION = ["gave", "offered", "will_give", "not_required"] as const;
export type L2N12Compensation = (typeof L2_N12_COMPENSATION)[number];

export type L2PriorNotice = { dateISO: string; address: string; intended: string };

export type L2Problem =
  | "notice_not_served"
  | "unsupported_notice"
  | "too_early"
  | "too_late"
  | "not_in_possession"
  | "compensation_needed"
  | "bad_compensation_choice"
  | "too_many_prior_notices"
  | "over_limit";

export type L2Input = {
  noticeType: string;
  noticeStatus: string;
  terminationISO: string;
  /** First day the landlord may file (from the notice's own rules). */
  earliestFilingISO: string;
  filingDateISO: string;
  method: L1FilingMethod;
  tenantInPossession: boolean;
  tenantCount: number;
  /** N12 only. */
  n12?: {
    reason: 1 | 2;
    compensationRequired: boolean;
    compensation: L2N12Compensation;
    priorNotices: L2PriorNotice[];
    /** The landlord gave other N12 or N13 notices outside Vacantless in the past 2 years. */
    priorOutside: boolean;
  } | null;
};

export type L2Calc = {
  filingDateISO: string;
  latestFilingISO: string;
  feeCents: number;
  totalCents: number;
  needsScheduleOfParties: boolean;
  problems: L2Problem[];
};

export function computeL2(input: L2Input): L2Calc {
  const problems: L2Problem[] = [];
  if (!(L2_NOTICE_TYPES as readonly string[]).includes(input.noticeType)) problems.push("unsupported_notice");
  if (input.noticeStatus !== "served" && input.noticeStatus !== "filed") problems.push("notice_not_served");
  const latest = latestL2FilingDate(input.terminationISO);
  if (input.filingDateISO < input.earliestFilingISO) problems.push("too_early");
  if (input.filingDateISO > latest) problems.push("too_late");
  if (!input.tenantInPossession) problems.push("not_in_possession");

  if (input.noticeType === "N12") {
    const n = input.n12;
    if (!n || !(L2_N12_COMPENSATION as readonly string[]).includes(n.compensation)) {
      problems.push("bad_compensation_choice");
    } else {
      // Reason 2 has no "not required" option; Reason 1 only when the notice gave 120+ days.
      if (n.compensation === "not_required" && (n.reason === 2 || n.compensationRequired)) {
        problems.push("compensation_needed");
      }
      if (n.priorNotices.length > L2_PRIOR_NOTICE_ROWS) problems.push("too_many_prior_notices");
    }
  }

  const feeCents = l2FeeCents(input.method);
  return {
    filingDateISO: input.filingDateISO,
    latestFilingISO: latest,
    feeCents,
    totalCents: feeCents,
    needsScheduleOfParties: input.tenantCount > 2,
    problems,
  };
}

export const L2_PROBLEM_TEXT: Record<L2Problem, string> = {
  notice_not_served: "Record that you served the notice first.",
  unsupported_notice: "Vacantless fills the L2 for an N5, N8 or N12 you prepared here.",
  too_early: "It's too early to file. After a first N5 the tenant has 7 days to fix the problem; you can file from the 8th day.",
  too_late: "The L2 must be filed no later than 30 days after the notice's termination date. You would need to give a new notice.",
  not_in_possession: "You can't file an L2 once the tenant has moved out. Use an L10 to collect money a former tenant owes.",
  compensation_needed:
    "This N12 owes the tenant one month's rent (or another unit they accept). \"Not required\" only applies to Reason 1 with at least 120 days' notice given on or after September 21, 2026.",
  bad_compensation_choice: "Choose how you handled the one month's compensation.",
  too_many_prior_notices: "The form lists 3 earlier N12 or N13 notices. Add the rest on a separate page you file with the L2.",
  over_limit: "The LTB can't order more than $50,000. Talk to a lawyer about going to court.",
};

/** Plain text for the person moving in under an N12 (Schedule B, Part C "intended occupant"). */
export function n12IntendedText(personName: string, relationship: string, reason: 1 | 2 = 1): string {
  const who = reason === 2 ? "purchaser" : "landlord";
  const rel: Record<string, string> = {
    self: who,
    spouse: `${who}'s spouse`,
    child: `${who}'s child`,
    parent: `${who}'s parent`,
    spouse_child: `child of the ${who}'s spouse`,
    spouse_parent: `parent of the ${who}'s spouse`,
  };
  const r = rel[relationship];
  return r ? `${personName.trim()} (${r})` : personName.trim();
}
