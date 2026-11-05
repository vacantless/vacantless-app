// S748g: Form N12 (Notice to End your Tenancy Because the Landlord, a Purchaser
// or a Family Member Requires the Rental Unit) - the pure rules. No I/O.
//
// Source: LTB N12 instructions and the N12 (2026/10) form, updated 2026-09-21
// (Bill 60 / Bill 97). What a notice must satisfy:
//   * termination date at least 60 days after the notice is given, not counting
//     the day it is given; mail or Xpresspost adds 5 days, courier adds one
//     business day;
//   * the termination date is the last day of a rental period (for rent due on
//     the 1st, the last day of a month), and for a fixed term it is the last day
//     of the term (never earlier);
//   * compensation of one month's rent (or another acceptable unit), paid by the
//     termination date, EXCEPT Reason 1 (own use) when the termination date is at
//     least 120 days after the notice is given (notices served on or after
//     2026-09-21). Reason 2 (purchaser) always pays;
//   * Reason 1: the landlord must be an individual (a corporation cannot give
//     this notice for own use), and the person moving in must intend to live
//     there at least one year;
//   * Reason 2: an agreement of purchase and sale is signed and the complex has
//     no more than 3 residential units.
// Prepare-only posture: Vacantless fills the form for the landlord to serve.

export type N12ServiceMethod = "hand" | "mail" | "courier";
export type N12Reason = 1 | 2;
/** Order matches the checkboxes on the form: A1..A6 / B1..B6. */
export const N12_RELATIONSHIPS = ["self", "spouse", "child", "parent", "spouse_child", "spouse_parent"] as const;
export type N12Relationship = (typeof N12_RELATIONSHIPS)[number];

export const N12_MIN_NOTICE_DAYS = 60;
export const N12_NO_COMPENSATION_DAYS = 120;
export const N12_120_DAY_RULE_FROM = "2026-09-21";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUTC(iso: string): Date {
  const m = ISO.exec(iso);
  if (!m) throw new Error(`n12: bad date ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDaysISO(iso: string, days: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}
export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((toUTC(toISO).getTime() - toUTC(fromISO).getTime()) / 86_400_000);
}

/**
 * The date the notice counts as given. Mail or Xpresspost adds 5 days; courier
 * adds one business day (Saturday and Sunday skipped; statutory holidays are not
 * modelled, so the landlord should add a day if one falls in the way).
 */
export function n12DeemedServiceDate(serviceISO: string, method: N12ServiceMethod): string {
  if (method === "mail") return addDaysISO(serviceISO, 5);
  if (method === "courier") {
    let d = addDaysISO(serviceISO, 1);
    while ([0, 6].includes(toUTC(d).getUTCDay())) d = addDaysISO(d, 1);
    return d;
  }
  return serviceISO;
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/**
 * The first last-day-of-a-rental-period on or after `minISO`, for monthly rent due
 * on `dueDay` (1 = the 1st, so periods end on the last day of a month). A due day
 * past the end of a short month falls on that month's last day.
 */
export function nextMonthlyPeriodEnd(minISO: string, dueDay = 1): string {
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error(`n12: bad due day ${dueDay}`);
  const min = toUTC(minISO);
  // Walk month by month from the month before `min`: the period end is the day
  // before rent is due in the following month.
  for (let k = -1; k < 3; k++) {
    const y = min.getUTCFullYear();
    const m0 = min.getUTCMonth() + k + 1; // the month rent is next due in
    const due = new Date(Date.UTC(y, m0, 1));
    const day = Math.min(dueDay, daysInMonth(due.getUTCFullYear(), due.getUTCMonth()));
    const end = fromUTC(new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), day - 1)));
    if (end >= minISO) return end;
  }
  throw new Error("n12: no period end found");
}

export type N12DateInput = {
  serviceDateISO: string;
  method: N12ServiceMethod;
  /** Day of the month rent is due (monthly rent). Defaults to 1. */
  dueDay?: number;
  /** Last day of a fixed term, if the lease is still in its fixed term. */
  fixedTermEndISO?: string | null;
};

/** Earliest valid termination date at least `minDays` after the notice counts as given. S751: shared with the N13. */
export function earliestEndAfter(input: N12DateInput, minDays: number): string {
  const deemed = n12DeemedServiceDate(input.serviceDateISO, input.method);
  const min = addDaysISO(deemed, minDays);
  const term = input.fixedTermEndISO && ISO.test(input.fixedTermEndISO) ? input.fixedTermEndISO : null;
  // Still in a fixed term on the earliest date -> the notice must end the term.
  if (term && term >= min) return term;
  return nextMonthlyPeriodEnd(min, input.dueDay ?? 1);
}

/** Earliest termination date the N12 can give (60 days + delivery days, end of a period or the term). */
export function earliestN12TerminationDate(input: N12DateInput): string {
  return earliestEndAfter(input, N12_MIN_NOTICE_DAYS);
}

/** Earliest termination date that also avoids compensation for Reason 1 (120 days). */
export function n12NoCompensationDate(input: N12DateInput): string {
  return earliestEndAfter(input, N12_NO_COMPENSATION_DAYS);
}

/**
 * Does this notice owe one month's rent (or another acceptable unit)? Reason 2
 * always does. Reason 1 does not when the termination date is at least 120 days
 * after the notice counts as given and the notice is given on or after 2026-09-21.
 */
export function n12CompensationRequired(args: {
  reason: N12Reason;
  serviceDateISO: string;
  method: N12ServiceMethod;
  terminationDateISO: string;
}): boolean {
  if (args.reason === 2) return true;
  if (args.serviceDateISO < N12_120_DAY_RULE_FROM) return true;
  const deemed = n12DeemedServiceDate(args.serviceDateISO, args.method);
  return daysBetween(deemed, args.terminationDateISO) < N12_NO_COMPENSATION_DAYS;
}

/** Words that mark a company. Reason 1 cannot be given by a corporation. */
export function looksLikeCompany(name: string): boolean {
  return /\b(inc|incorporated|ltd|limited|corp|corporation|ltée|ltee|llc|llp|co\.|company|group|holdings|properties|management|realty|investments?)\b\.?/i.test(
    name,
  );
}

export type N12Problem =
  | "bad_date"
  | "too_soon"
  | "not_period_end"
  | "before_term_end"
  | "not_term_end"
  | "company_landlord"
  | "no_person"
  | "no_tenant"
  | "no_address";

export type N12CheckInput = N12DateInput & {
  terminationDateISO: string;
  reason: N12Reason;
  landlordName: string;
  landlordIsIndividual: boolean;
  personName: string;
  tenantNames: string[];
  rentalUnitAddress: string | null;
};

/** Everything that would make the notice invalid. Empty = ready to fill. */
export function n12Problems(input: N12CheckInput): N12Problem[] {
  const out: N12Problem[] = [];
  if (!input.tenantNames.some((n) => n.trim())) out.push("no_tenant");
  if (!input.rentalUnitAddress?.trim()) out.push("no_address");
  if (!input.personName.trim()) out.push("no_person");
  if (input.reason === 1 && (!input.landlordIsIndividual || looksLikeCompany(input.landlordName))) {
    out.push("company_landlord");
  }
  if (!ISO.test(input.terminationDateISO) || !ISO.test(input.serviceDateISO)) {
    out.push("bad_date");
    return out;
  }
  const deemed = n12DeemedServiceDate(input.serviceDateISO, input.method);
  if (daysBetween(deemed, input.terminationDateISO) < N12_MIN_NOTICE_DAYS) out.push("too_soon");
  const term = input.fixedTermEndISO && ISO.test(input.fixedTermEndISO) ? input.fixedTermEndISO : null;
  const t = input.terminationDateISO;
  if (term && t < term) out.push("before_term_end");
  else if (term && t === term) {
    // ending the fixed term on its last day is valid
  } else if (nextMonthlyPeriodEnd(t, input.dueDay ?? 1) !== t) out.push("not_period_end");
  return out;
}

/** Plain-language reason for each problem, for the landlord. */
export const N12_PROBLEM_TEXT: Record<N12Problem, string> = {
  bad_date: "Enter a valid service date and termination date.",
  too_soon: "The termination date must be at least 60 days after the notice counts as given (mail adds 5 days, courier 1 business day).",
  not_period_end: "The termination date must be the last day of a rental period (for rent due on the 1st, the last day of a month).",
  before_term_end: "The lease is in a fixed term: the termination date cannot be before the last day of the term.",
  not_term_end: "For a fixed term, the termination date must be the last day of the term.",
  company_landlord: "Reason 1 (own use) can only be given by a landlord who is an individual, not a company.",
  no_person: "Name the person who will move in.",
  no_tenant: "Add the tenant's name to this tenancy first.",
  no_address: "Add the rental unit's address first.",
};
