// Pure prorated-rent engine (no I/O) for the clause-selection wizard.
//
// The prorated-rent clause carries four tokens the operator otherwise types by
// hand — the amount, the period start, the period end, and the date full rent
// begins. Every one of those is mechanically derivable from the tenancy's
// monthly rent + lease start date, which the wizard already holds. Proration is
// a notorious friction + error point (calendar-days vs a flat 30-day month), so
// this module standardizes BOTH industry methods and lets the UI offer a
// one-click suggestion the operator just validates.
//
// Everything here is pure date/integer arithmetic. Dates are handled as
// YYYY-MM-DD strings parsed into y/m/d integers (never `new Date`) so there is
// no timezone drift — a lease starting 2026-06-17 always prorates to June 30
// regardless of where the server runs.

// The two standard proration conventions.
//   calendar    — daily rate = monthly rent / actual days in the start month;
//                 charge the exact days from the start date to month-end. The
//                 most common and arguably fairest method.
//   thirty_day  — daily rate = monthly rent / 30 every month (the "banker's"
//                 flat-month method); charge (30 - startDay + 1) days. Matches
//                 the calendar method in 30-day months, diverges otherwise.
export const PRORATION_METHODS = ["calendar", "thirty_day"] as const;
export type ProrationMethod = (typeof PRORATION_METHODS)[number];

// The four clause tokens this engine fills. Single source of truth shared by the
// wizard (which inputs to attach a suggestion chip to) and the suggestion map.
export const PRORATION_TOKENS = {
  amount: "prorated_rent",
  periodStart: "prorated_period_start",
  periodEnd: "prorated_period_end",
  fullRentStart: "full_rent_start_date",
} as const;

export type ProrationToken = (typeof PRORATION_TOKENS)[keyof typeof PRORATION_TOKENS];

/** True iff `token` is one of the four prorated-rent tokens this engine fills. */
export function isProrationToken(token: string): token is ProrationToken {
  return (Object.values(PRORATION_TOKENS) as string[]).includes(token.toLowerCase());
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Calendar days in a given month (1-12). Returns 0 for an out-of-range month. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** Parse a strict YYYY-MM-DD string into {year, month, day}, or null if invalid. */
export function parseISODate(
  value: string,
): { year: number; month: number; day: number } | null {
  const m = DATE_RE.exec((value ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/**
 * Format integer cents as a 2-decimal dollar string ("$583.33"). Always shows
 * cents (unlike formatRentCents, which drops them) because a prorated figure is
 * almost never a round dollar. Negative inputs are clamped to 0.
 */
export function formatMoneyCents(cents: number): string {
  const safe = Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
  return (
    "$" +
    (safe / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

// One method's result: how many days were charged, the rounded cents, and the
// display string.
export type ProratedAmount = {
  method: ProrationMethod;
  daysCharged: number;
  cents: number;
  formatted: string;
};

export type ProrationComputation = {
  // false when the lease starts on the 1st — a full first month, no proration.
  applicable: boolean;
  startDate: string; // YYYY-MM-DD (== periodStart)
  periodStart: string; // YYYY-MM-DD, the lease start date
  periodEnd: string; // YYYY-MM-DD, last day of the start month
  fullRentStart: string; // YYYY-MM-DD, first day of the following month
  daysInMonth: number; // calendar days in the start month
  calendar: ProratedAmount;
  thirtyDay: ProratedAmount;
  // true iff both methods produce the same dollar figure (always so in a 30-day
  // month) — lets the UI hide the redundant second chip.
  methodsAgree: boolean;
};

/**
 * Compute the prorated-rent suggestion from monthly rent (in cents) and a lease
 * start date. Returns null when the rent is missing/non-positive or the date is
 * not a valid YYYY-MM-DD — the caller then simply shows the blank inputs.
 *
 * Both methods charge from the start date through the last day of the start
 * month; full rent begins the 1st of the next month. The amount is rounded to
 * the nearest cent.
 */
export function computeProration(
  rentCents: number | null | undefined,
  startDate: string | null | undefined,
): ProrationComputation | null {
  if (rentCents == null || !Number.isFinite(rentCents) || rentCents <= 0) return null;
  const parsed = parseISODate(startDate ?? "");
  if (!parsed) return null;

  const { year, month, day } = parsed;
  const dim = daysInMonth(year, month);

  const periodStart = `${year}-${pad2(month)}-${pad2(day)}`;
  const periodEnd = `${year}-${pad2(month)}-${pad2(dim)}`;
  const fullRentStart =
    month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;

  // Calendar method: daily rate over the month's actual length.
  const calDays = dim - day + 1;
  const calCents = Math.round((rentCents * calDays) / dim);

  // 30-day flat method: daily rate over a fixed 30-day month. Days charged can
  // hit 0 for a start on the 31st (30 - 31 + 1) — clamp so it never goes negative.
  const flatDays = Math.max(0, 30 - day + 1);
  const flatCents = Math.round((rentCents * flatDays) / 30);

  const calendar: ProratedAmount = {
    method: "calendar",
    daysCharged: calDays,
    cents: calCents,
    formatted: formatMoneyCents(calCents),
  };
  const thirtyDay: ProratedAmount = {
    method: "thirty_day",
    daysCharged: flatDays,
    cents: flatCents,
    formatted: formatMoneyCents(flatCents),
  };

  return {
    applicable: day !== 1,
    startDate: periodStart,
    periodStart,
    periodEnd,
    fullRentStart,
    daysInMonth: dim,
    calendar,
    thirtyDay,
    methodsAgree: calCents === flatCents,
  };
}

/**
 * The token -> value map to fill the four prorated-rent inputs for a chosen
 * method (the dates are method-independent; only the amount differs). The
 * caller spreads this into its `vars` state on a one-click "auto-fill" action.
 */
export function prorationVarValues(
  comp: ProrationComputation,
  method: ProrationMethod = "calendar",
): Record<ProrationToken, string> {
  const amount = method === "thirty_day" ? comp.thirtyDay : comp.calendar;
  return {
    [PRORATION_TOKENS.amount]: amount.formatted,
    [PRORATION_TOKENS.periodStart]: comp.periodStart,
    [PRORATION_TOKENS.periodEnd]: comp.periodEnd,
    [PRORATION_TOKENS.fullRentStart]: comp.fullRentStart,
  } as Record<ProrationToken, string>;
}
