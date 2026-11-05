// S751: Form N6 (Notice to End your Tenancy for Illegal Acts or Misrepresenting
// Income in a Rent-Geared-to-Income Rental Unit) - the pure rules. No I/O.
//
// Source: LTB N6 instructions (updated 2026-09-21) + the N6 (2026/09) form.
//   * Reason 1: an illegal act or business involving drugs (production,
//     trafficking, possession for trafficking): termination date at least 10 days
//     after the notice is given.
//   * Reason 2 (any other illegal act or business) and Reason 3 (misrepresented
//     income in rent-geared-to-income housing): at least 20 days for a first
//     notice in 6 months; 14 days for a second, but only when the first was an N5
//     that gave 7 days to fix the problem. With Reason 1 plus 2 or 3, the 2/3
//     rule applies.
//   * Not counting the day it is given; mail adds 5 days, courier one business day.
//   * The N6 can't be voided; the landlord may apply (L2) once it is given, and
//     no later than 30 days after the termination date.
//   * Describe each event: date, time, what happened, who. Reason 3: the income
//     misrepresented and how the amount was worked out.

import { addDaysISO, daysBetween, n12DeemedServiceDate, type N12ServiceMethod } from "./n12";
import { fitsBox } from "./n13";

export type N6ServiceMethod = N12ServiceMethod;
export type N6Which = "first" | "second";
export type N6Reasons = { drugs: boolean; illegal: boolean; income: boolean };
export const N6_DRUG_MIN_DAYS = 10;
export const N6_FIRST_MIN_DAYS = 20;
export const N6_SECOND_MIN_DAYS = 14;
export const N6_MAX_EVENTS = 3;
export const N6_EVENT_FONT_PT = 9;
export const N6_WHEN_BOX = { w: 104, h: 118 };
export const N6_EVENT_BOX = { w: 464, h: 118 };

export function n6MinDays(reasons: N6Reasons, which: N6Which): number {
  if (reasons.drugs && !reasons.illegal && !reasons.income) return N6_DRUG_MIN_DAYS;
  return which === "second" ? N6_SECOND_MIN_DAYS : N6_FIRST_MIN_DAYS;
}

export function earliestN6TerminationDate(serviceDateISO: string, method: N6ServiceMethod, reasons: N6Reasons, which: N6Which): string {
  return addDaysISO(n12DeemedServiceDate(serviceDateISO, method), n6MinDays(reasons, which));
}

/** First day the landlord can apply with an L2: once the notice counts as given. */
export function n6EarliestL2Date(serviceDateISO: string, method: N6ServiceMethod): string {
  return n12DeemedServiceDate(serviceDateISO, method);
}

export type N6Event = { when: string; details: string };

export type N6Problem =
  | "bad_date"
  | "too_soon"
  | "no_reason"
  | "no_events"
  | "too_many_events"
  | "event_too_long"
  | "no_first_n5"
  | "no_tenant"
  | "no_address";

export function n6Problems(input: {
  serviceDateISO: string;
  method: N6ServiceMethod;
  which: N6Which;
  terminationDateISO: string;
  reasons: N6Reasons;
  events: N6Event[];
  /** An N5 that gave 7 days to fix, served in the past 6 months, on record or confirmed. */
  firstN5OnFile: boolean;
  tenantNames: string[];
  rentalUnitAddress: string | null;
}): N6Problem[] {
  const out: N6Problem[] = [];
  if (!input.tenantNames.some((n) => n.trim())) out.push("no_tenant");
  if (!input.rentalUnitAddress?.trim()) out.push("no_address");
  const r = input.reasons;
  if (!r.drugs && !r.illegal && !r.income) out.push("no_reason");
  const events = input.events.filter((e) => e.when.trim() || e.details.trim());
  if (events.length === 0 || events.some((e) => !e.details.trim())) out.push("no_events");
  if (events.length > N6_MAX_EVENTS) out.push("too_many_events");
  if (events.some((e) => !fitsBox(e.details, N6_EVENT_BOX, N6_EVENT_FONT_PT) || !fitsBox(e.when, N6_WHEN_BOX, N6_EVENT_FONT_PT))) {
    out.push("event_too_long");
  }
  const twoOrThree = r.illegal || r.income;
  if (input.which === "second" && twoOrThree && !input.firstN5OnFile) out.push("no_first_n5");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDateISO) || !/^\d{4}-\d{2}-\d{2}$/.test(input.terminationDateISO)) {
    out.push("bad_date");
    return out;
  }
  const deemed = n12DeemedServiceDate(input.serviceDateISO, input.method);
  if (daysBetween(deemed, input.terminationDateISO) < n6MinDays(r, input.which)) out.push("too_soon");
  return out;
}

export const N6_PROBLEM_TEXT: Record<N6Problem, string> = {
  bad_date: "Enter a valid service date and termination date.",
  too_soon:
    "The termination date is too soon: at least 10 days for drugs only, otherwise 20 days (14 for a second notice after an N5). Mail adds 5 days, courier 1 business day.",
  no_reason: "Pick at least one reason.",
  no_events: "Describe at least one event: the date and time, who did it, and what happened.",
  too_many_events: "The form holds 3 events. Put the rest on a separate page you give the tenant with the notice.",
  event_too_long: "One event description doesn't fit its box on the form. Shorten it, or put the full account on a separate page.",
  no_first_n5: "The 14-day rule needs an N5 served in the past 6 months that gave 7 days to fix the problem.",
  no_tenant: "Add the tenant's name to this tenancy first.",
  no_address: "Add the rental unit's address first.",
};
