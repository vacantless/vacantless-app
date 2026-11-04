// S749: Form N8 (Notice to End your Tenancy at the End of the Term) - the pure
// rules for Reason 1, persistent late payment. No I/O.
//
// Source: LTB N8 instructions + the N8 (2026/09) form, checked 2026-11-03.
//   * Persistent late (O. Reg. 516/06 s. 8.1, from 2026-09-21): rent paid more
//     than 7 days after the due date, at least 3 times within a 6-month period.
//     A payment that is late only because the landlord applied it to another
//     amount owed (arrears) does not count.
//   * Termination date: monthly tenancy at least 60 days after the notice is
//     given (not counting that day; mail adds 5 days, courier 1 business day),
//     on the last day of a rental period, or the last day of a fixed term.
//   * Details: when rent is due, the dates the tenant paid, the amounts and the
//     periods. The landlord can apply (Form L2) right after giving the notice.
// Vacantless reads the rent ledger: a period counts as late on the day its
// payments first add up to the rent, if that day is more than 7 days after the
// due date. Unpaid periods are arrears (N4), not late payments.

import { addDaysISO, daysBetween, n12Problems, earliestN12TerminationDate, type N12DateInput, type N12ServiceMethod } from "./n12";

export type N8ServiceMethod = N12ServiceMethod;
export const N8_LATE_AFTER_DAYS = 7;
export const N8_MIN_LATE_COUNT = 3;
export const N8_WINDOW_MONTHS = 6;
export const N8_MAX_DETAIL_CHARS = 1800;

export type N8Payment = { amount_cents: number; period_month: string | null; paid_on: string | null };
export type N8LatePeriod = { periodISO: string; dueISO: string; paidInFullISO: string; daysLate: number; amountCents: number };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Due date for the period starting `periodISO` (first of a month) with rent due on `dueDay`. */
export function n8DueDate(periodISO: string, dueDay = 1): string {
  const m = ISO.exec(periodISO);
  if (!m) throw new Error(`n8: bad period ${periodISO}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const d = Math.min(Math.max(1, dueDay), last);
  return `${m[1]}-${m[2]}-${String(d).padStart(2, "0")}`;
}

/** Monthly periods in the 6 months before `asOfISO` whose rent was paid in full more than 7 days late. */
export function findLatePeriods(input: {
  rentCents: number;
  payments: N8Payment[];
  asOfISO: string;
  dueDay?: number;
}): N8LatePeriod[] {
  const windowStart = addDaysISO(input.asOfISO, -183);
  const byPeriod = new Map<string, { paid_on: string; amount_cents: number }[]>();
  for (const p of input.payments) {
    if (!p.period_month || !p.paid_on || !ISO.test(p.paid_on)) continue;
    const key = p.period_month.slice(0, 7) + "-01";
    const arr = byPeriod.get(key) ?? [];
    arr.push({ paid_on: p.paid_on, amount_cents: Math.round(p.amount_cents) });
    byPeriod.set(key, arr);
  }
  const out: N8LatePeriod[] = [];
  for (const [period, arr] of Array.from(byPeriod.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const due = n8DueDate(period, input.dueDay ?? 1);
    if (due < windowStart || due > input.asOfISO) continue;
    arr.sort((a, b) => a.paid_on.localeCompare(b.paid_on));
    let sum = 0;
    let fullOn: string | null = null;
    for (const p of arr) {
      sum += p.amount_cents;
      if (sum >= input.rentCents) {
        fullOn = p.paid_on;
        break;
      }
    }
    if (!fullOn) continue; // unpaid or short: arrears, not a late payment
    const late = daysBetween(due, fullOn);
    if (late > N8_LATE_AFTER_DAYS) out.push({ periodISO: period, dueISO: due, paidInFullISO: fullOn, daysLate: late, amountCents: input.rentCents });
  }
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso;
}
function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function ordinal(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}

/** Plain-language details for the form, from the ledger. The landlord can edit before preparing. */
export function n8DetailsText(rentCents: number, dueDay: number, late: N8LatePeriod[]): string {
  const lines = [
    `The rent is ${money(rentCents)} a month, due on the ${ordinal(dueDay)} of each month.`,
    `In the past 6 months the rent was paid in full more than 7 days after it was due ${late.length} times:`,
    ...late.map((l) => {
      const label = `${MONTHS[Number(l.periodISO.slice(5, 7)) - 1]} ${l.periodISO.slice(0, 4)}`;
      return `- ${label} rent (${money(l.amountCents)}), due ${longDate(l.dueISO)}: paid in full on ${longDate(l.paidInFullISO)}, ${l.daysLate} days late.`;
    }),
  ];
  return lines.join("\n");
}

export type N8Problem =
  | "bad_date"
  | "too_soon"
  | "not_period_end"
  | "before_term_end"
  | "too_few_late"
  | "no_details"
  | "details_too_long"
  | "no_tenant"
  | "no_address";

export type N8CheckInput = N12DateInput & {
  terminationDateISO: string;
  lateCount: number;
  details: string;
  tenantNames: string[];
  rentalUnitAddress: string | null;
};

export function earliestN8TerminationDate(input: N12DateInput): string {
  return earliestN12TerminationDate(input);
}

/** Everything that would make the notice invalid. Empty = ready to fill. */
export function n8Problems(input: N8CheckInput): N8Problem[] {
  const out: N8Problem[] = [];
  // Same 60-day / end-of-period / fixed-term date rules as the N12.
  const dateProblems = n12Problems({
    ...input,
    reason: 2,
    landlordName: "x",
    landlordIsIndividual: true,
    personName: "x",
  });
  for (const p of dateProblems) {
    if (p === "bad_date" || p === "too_soon" || p === "not_period_end" || p === "before_term_end" || p === "no_tenant" || p === "no_address") {
      out.push(p);
    }
  }
  if (input.lateCount < N8_MIN_LATE_COUNT) out.push("too_few_late");
  if (!input.details.trim()) out.push("no_details");
  if (input.details.length > N8_MAX_DETAIL_CHARS) out.push("details_too_long");
  return out;
}

export const N8_PROBLEM_TEXT: Record<N8Problem, string> = {
  bad_date: "Enter a valid service date and termination date.",
  too_soon: "The termination date must be at least 60 days after the notice counts as given (mail adds 5 days, courier 1 business day).",
  not_period_end: "The termination date must be the last day of a rental period (for rent due on the 1st, the last day of a month).",
  before_term_end: "The lease is in a fixed term: the termination date can't be before the last day of the term.",
  too_few_late:
    "The rent ledger shows fewer than 3 payments made more than 7 days late in the past 6 months. Record the payment dates under Rent first.",
  no_details: "Describe the late payments: when rent is due, the dates paid, the amounts and the periods.",
  details_too_long: "The details are too long for the form. Shorten them, or put the full list on a separate page you give the tenant.",
  no_tenant: "Add the tenant's name to this tenancy first.",
  no_address: "Add the rental unit's address first.",
};
