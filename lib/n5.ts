// S748g: Form N5 (Notice to End your Tenancy for Interfering with Others, Damage
// or Overcrowding) - the pure rules. No I/O.
//
// Source: LTB N5 instructions + the N5 (2026/09) form.
//   * First N5 in the past 6 months: termination date at least 20 days after the
//     notice is given; the tenant has 7 days to fix the problem, which voids the
//     notice. The landlord can apply (Form L2) from the 8th day.
//   * Second N5 in 6 months, where the first gave 7 days to fix: at least 14 days;
//     it can't be voided and the landlord can apply right away.
//   * Not counting the day it is given; mail adds 5 days, courier one business day.
//   * Describe each event (date, time, who, what happened). Reason 3 names the
//     limit and the law or by-law that sets it. Apply no later than 30 days after
//     the termination date.

import { addDaysISO, daysBetween, n12DeemedServiceDate, type N12ServiceMethod } from "./n12";

export type N5ServiceMethod = N12ServiceMethod;
export type N5Which = "first" | "second";
export const N5_FIRST_MIN_DAYS = 20;
export const N5_SECOND_MIN_DAYS = 14;
export const N5_FIX_DAYS = 7;
export const N5_MAX_EVENTS = 3;
export const N5_MAX_EVENT_CHARS = 600;

export function n5MinDays(which: N5Which): number {
  return which === "second" ? N5_SECOND_MIN_DAYS : N5_FIRST_MIN_DAYS;
}

export function earliestN5TerminationDate(serviceDateISO: string, method: N5ServiceMethod, which: N5Which): string {
  return addDaysISO(n12DeemedServiceDate(serviceDateISO, method), n5MinDays(which));
}

/** Last day the tenant can fix the problem (first N5 only). */
export function n5FixByDate(serviceDateISO: string, method: N5ServiceMethod): string {
  return addDaysISO(n12DeemedServiceDate(serviceDateISO, method), N5_FIX_DAYS);
}

/** First day the landlord can apply with an L2. */
export function n5EarliestL2Date(serviceDateISO: string, method: N5ServiceMethod, which: N5Which): string {
  const deemed = n12DeemedServiceDate(serviceDateISO, method);
  return which === "second" ? deemed : addDaysISO(deemed, N5_FIX_DAYS + 1);
}

/** Last day to apply with an L2: 30 days after the termination date. */
export function n5LatestL2Date(terminationISO: string): string {
  return addDaysISO(terminationISO, 30);
}

export type N5Event = { when: string; details: string };

export type N5Problem =
  | "bad_date"
  | "too_soon"
  | "no_reason"
  | "no_events"
  | "too_many_events"
  | "event_too_long"
  | "no_max_people"
  | "no_first_n5"
  | "no_tenant"
  | "no_address";

export function n5Problems(input: {
  serviceDateISO: string;
  method: N5ServiceMethod;
  which: N5Which;
  terminationDateISO: string;
  reasons: { interference: boolean; damage: boolean; overcrowding: boolean };
  maxPeople?: string | null;
  events: N5Event[];
  /** A first N5 served in the past 6 months is on record, or the landlord confirms one. */
  firstN5OnFile: boolean;
  tenantNames: string[];
  rentalUnitAddress: string | null;
}): N5Problem[] {
  const out: N5Problem[] = [];
  if (!input.tenantNames.some((n) => n.trim())) out.push("no_tenant");
  if (!input.rentalUnitAddress?.trim()) out.push("no_address");
  const r = input.reasons;
  if (!r.interference && !r.damage && !r.overcrowding) out.push("no_reason");
  if (r.overcrowding && input.which === "first" && !input.maxPeople?.trim()) out.push("no_max_people");
  const events = input.events.filter((e) => e.when.trim() || e.details.trim());
  if (events.length === 0 || events.some((e) => !e.details.trim())) out.push("no_events");
  if (events.length > N5_MAX_EVENTS) out.push("too_many_events");
  if (events.some((e) => e.details.length > N5_MAX_EVENT_CHARS)) out.push("event_too_long");
  if (input.which === "second" && !input.firstN5OnFile) out.push("no_first_n5");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDateISO) || !/^\d{4}-\d{2}-\d{2}$/.test(input.terminationDateISO)) {
    out.push("bad_date");
    return out;
  }
  const deemed = n12DeemedServiceDate(input.serviceDateISO, input.method);
  if (daysBetween(deemed, input.terminationDateISO) < n5MinDays(input.which)) out.push("too_soon");
  return out;
}

export const N5_PROBLEM_TEXT: Record<N5Problem, string> = {
  bad_date: "Enter a valid service date and termination date.",
  too_soon: "The termination date is too soon: at least 20 days for a first N5, 14 for a second (mail adds 5 days, courier 1 business day).",
  no_reason: "Pick at least one reason.",
  no_events: "Describe at least one event: the date and time, who did it, and what happened.",
  too_many_events: "The form holds 3 events. Put the rest on a separate page you give the tenant with the notice.",
  event_too_long: "One event description is too long for the form. Shorten it, or put the full account on a separate page.",
  no_max_people: "For overcrowding, enter the most people allowed, and name the by-law or law in the details.",
  no_first_n5: "A second N5 needs a first N5 served in the past 6 months that gave 7 days to fix the problem.",
  no_tenant: "Add the tenant's name to this tenancy first.",
  no_address: "Add the rental unit's address first.",
};
