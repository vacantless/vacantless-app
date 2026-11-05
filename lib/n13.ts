// S751: Form N13 (Notice to End your Tenancy Because the Landlord Wants to
// Demolish the Rental Unit, Repair it or Convert it to Another Use) - the pure
// rules. No I/O.
//
// Source: LTB N13 instructions (updated 2026-09-21) and the N13 (2026/09) form.
//   * Termination date at least 120 days after the notice counts as given (1 year
//     when the tenant owns a mobile or land lease home on the site), not counting
//     the day it is given; mail or Xpresspost adds 5 days, courier one business
//     day. It is the last day of a rental period, and never before the end of a
//     fixed term (same date rules as the N12, lib/n12.ts).
//   * Reason 1 demolish, Reason 2 repairs or renovations so extensive that a
//     building permit is required and the unit must be vacant, Reason 3 convert
//     to a non-residential use. Reason 2 can't say "no permits needed".
//   * Compensation by the termination date (or another unit the tenant accepts):
//     3 months' rent in a complex with 5 or more residential units, 1 month with
//     fewer. Reason 2 with a tenant who gave written notice they will move back:
//     the lesser of that and the rent for the repair period. A mobile or land
//     lease home site: the lesser of one year's rent or $3,000. None when the
//     demolition or repair was ordered under any Act.
//   * Details of the work: specific, with dates and how it will be done.
// Prepare-only posture: Vacantless fills the form for the landlord to serve.

import { earliestEndAfter, n12DeemedServiceDate, daysBetween, nextMonthlyPeriodEnd, type N12ServiceMethod } from "./n12";

export type N13Reason = 1 | 2 | 3;
export const N13_PERMITS = ["obtained", "will_obtain", "none_needed"] as const;
export type N13Permits = (typeof N13_PERMITS)[number];

export const N13_MIN_NOTICE_DAYS = 120;
export const N13_MOBILE_HOME_NOTICE_DAYS = 365;
export const N13_MOBILE_HOME_CAP_CENTS = 300_000;
export const N13_BIG_COMPLEX_UNITS = 5;

// Box sizes from the 2026/09 form (points) and the font we fill them with.
export const N13_TEXT_FONT_PT = 10;
export const N13_WORK_PLANNED_BOX = { w: 212, h: 262 };
export const N13_WORK_DETAILS_BOX = { w: 356, h: 262 };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export type N13DateInput = {
  serviceDateISO: string;
  method: N12ServiceMethod;
  dueDay?: number;
  fixedTermEndISO?: string | null;
  /** The tenant owns a mobile home or land lease home on the site. */
  mobileHome?: boolean;
};

export function n13MinDays(mobileHome?: boolean): number {
  return mobileHome ? N13_MOBILE_HOME_NOTICE_DAYS : N13_MIN_NOTICE_DAYS;
}

export function earliestN13TerminationDate(input: N13DateInput): string {
  return earliestEndAfter(input, n13MinDays(input.mobileHome));
}

/**
 * The compensation the landlord owes by the termination date, in cents. null =
 * not required (the work was ordered under an Act). For Reason 2 when the tenant
 * says they will move back, this is the most they can be owed: the lesser of
 * this and the rent for the repair period.
 */
export function n13CompensationCents(args: {
  rentCents: number | null;
  residentialUnits: number;
  mobileHome?: boolean;
  orderedUnderAct?: boolean;
}): number | null {
  if (args.orderedUnderAct) return null;
  if (args.rentCents == null || args.rentCents <= 0) return null;
  if (args.mobileHome) return Math.min(args.rentCents * 12, N13_MOBILE_HOME_CAP_CENTS);
  const months = args.residentialUnits >= N13_BIG_COMPLEX_UNITS ? 3 : 1;
  return args.rentCents * months;
}

/**
 * How many lines `text` takes in a box of `boxW` points at `fontPt`, wrapping on
 * spaces (a conservative Helvetica width of 0.55 em per character). Pure.
 */
export function wrappedLineCount(text: string, boxW: number, fontPt: number): number {
  const perLine = Math.max(1, Math.floor((boxW - 4) / (fontPt * 0.55)));
  let lines = 0;
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let cur = 0;
    let n = 1;
    for (const w of words) {
      const len = w.length;
      if (cur === 0) cur = len;
      else if (cur + 1 + len <= perLine) cur += 1 + len;
      else {
        n += 1;
        cur = len;
      }
      while (cur > perLine) {
        n += 1;
        cur -= perLine;
      }
    }
    lines += n;
  }
  return lines;
}

export function boxLineCapacity(boxH: number, fontPt: number): number {
  return Math.floor((boxH - 4) / (fontPt * 1.2));
}

export function fitsBox(text: string, box: { w: number; h: number }, fontPt = N13_TEXT_FONT_PT): boolean {
  return wrappedLineCount(text, box.w, fontPt) <= boxLineCapacity(box.h, fontPt);
}

export type N13Problem =
  | "bad_date"
  | "too_soon"
  | "not_period_end"
  | "before_term_end"
  | "no_tenant"
  | "no_address"
  | "no_work"
  | "work_too_long"
  | "repair_needs_permit"
  | "bad_permits";

export type N13CheckInput = N13DateInput & {
  terminationDateISO: string;
  reason: N13Reason;
  permits: string;
  workPlanned: string;
  workDetails: string;
  tenantNames: string[];
  rentalUnitAddress: string | null;
};

/** Everything that would make the notice invalid or overflow the form. Empty = ready. */
export function n13Problems(input: N13CheckInput): N13Problem[] {
  const out: N13Problem[] = [];
  if (!input.tenantNames.some((n) => n.trim())) out.push("no_tenant");
  if (!input.rentalUnitAddress?.trim()) out.push("no_address");
  if (!input.workPlanned.trim() || !input.workDetails.trim()) out.push("no_work");
  else if (!fitsBox(input.workPlanned, N13_WORK_PLANNED_BOX) || !fitsBox(input.workDetails, N13_WORK_DETAILS_BOX)) {
    out.push("work_too_long");
  }
  if (!(N13_PERMITS as readonly string[]).includes(input.permits)) out.push("bad_permits");
  else if (input.reason === 2 && input.permits === "none_needed") out.push("repair_needs_permit");
  if (!ISO.test(input.terminationDateISO) || !ISO.test(input.serviceDateISO)) {
    out.push("bad_date");
    return out;
  }
  const deemed = n12DeemedServiceDate(input.serviceDateISO, input.method);
  if (daysBetween(deemed, input.terminationDateISO) < n13MinDays(input.mobileHome)) out.push("too_soon");
  const term = input.fixedTermEndISO && ISO.test(input.fixedTermEndISO) ? input.fixedTermEndISO : null;
  const t = input.terminationDateISO;
  if (term && t < term) out.push("before_term_end");
  else if (term && t === term) {
    // ending the fixed term on its last day is valid
  } else if (nextMonthlyPeriodEnd(t, input.dueDay ?? 1) !== t) out.push("not_period_end");
  return out;
}

export const N13_PROBLEM_TEXT: Record<N13Problem, string> = {
  bad_date: "Enter a valid service date and termination date.",
  too_soon:
    "The termination date must be at least 120 days after the notice counts as given (1 year if the tenant owns a mobile home on the site). Mail adds 5 days, courier 1 business day.",
  not_period_end: "The termination date must be the last day of a rental period (for rent due on the 1st, the last day of a month).",
  before_term_end: "The lease is in a fixed term: the termination date cannot be before the last day of the term.",
  no_tenant: "Add the tenant's name to this tenancy first.",
  no_address: "Add the rental unit's address first.",
  no_work: "Describe the work you plan to do and the details: what, when and how.",
  work_too_long: "The work description doesn't fit the box on the form. Shorten it, and attach a page with the rest when you serve it.",
  repair_needs_permit: "Repairs or renovations (Reason 2) can only use an N13 when a building permit is required.",
  bad_permits: "Say whether you have, or will get, the permits for the work.",
};
