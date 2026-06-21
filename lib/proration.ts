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

/**
 * Ordinal form of a day-of-month ("1st", "2nd", "17th", "21st"). Used by the
 * anniversary rent-cycle note ("rent runs from the 17th of each month"). The
 * 11th-13th teens always take "th".
 */
export function ordinalDay(day: number): string {
  const v = day % 100;
  const suffix =
    v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] ?? "th";
  return `${day}${suffix}`;
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

// A point in time as integer y/m/d, used internally for cycle-anchor math.
type Ymd = { year: number; month: number; day: number };

// Days since the civil epoch (1970-01-01) — Howard Hinnant's days_from_civil.
// Pure integer arithmetic, valid for any proleptic-Gregorian date, no `Date`
// and so no timezone drift. We only need the DIFFERENCE between two dates, so
// the epoch choice is immaterial.
function daysFromCivil({ year, month, day }: Ymd): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// Inverse of daysFromCivil — turn a day-serial back into a y/m/d. Lets us
// subtract a day from an anchor (period end = next anchor − 1) without
// special-casing month/year boundaries.
function civilFromDays(z0: number): Ymd {
  const z = z0 + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/** Number of whole days from date `a` to date `b` (b − a; negative if b < a). */
function daysBetween(a: Ymd, b: Ymd): number {
  return daysFromCivil(b) - daysFromCivil(a);
}

function toISO({ year, month, day }: Ymd): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** The month immediately after the given year/month, rolling the year in Dec. */
function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** The month immediately before the given year/month, rolling the year in Jan. */
function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/**
 * Clamp a requested rent day-of-month (1-31) into a valid range. Non-finite or
 * out-of-range values fall back to 1 (the first-of-month default).
 */
export function clampRentDay(day: number | null | undefined): number {
  if (day == null || !Number.isFinite(day)) return 1;
  return Math.min(31, Math.max(1, Math.trunc(day)));
}

/**
 * The actual calendar day a "rent on the Nth" cycle lands on in a given month —
 * the requested day, but never past the month's length (so "the 31st" bills on
 * Feb 28/29, Apr 30, etc., the standard end-of-month convention).
 */
export function rentDayInMonth(year: number, month: number, rentDay: number): number {
  return Math.min(clampRentDay(rentDay), daysInMonth(year, month));
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
  // false when the lease starts exactly on its rent-cycle day (1st, or the chosen
  // recurring day) — a full first cycle, no proration.
  applicable: boolean;
  rentDay: number; // the recurring rent day-of-month this cycle is anchored on
  startDate: string; // YYYY-MM-DD (== periodStart)
  periodStart: string; // YYYY-MM-DD, the lease start date
  periodEnd: string; // YYYY-MM-DD, the day before full rent begins
  fullRentStart: string; // YYYY-MM-DD, the next rent-cycle day
  daysInMonth: number; // calendar days in the billing cycle the stub sits in
  calendar: ProratedAmount;
  thirtyDay: ProratedAmount;
  // true iff both methods produce the same dollar figure (always so in a 30-day
  // cycle) — lets the UI hide the redundant second chip.
  methodsAgree: boolean;
};

/**
 * Compute the prorated-rent suggestion from monthly rent (in cents), a lease
 * start date, and the recurring rent day-of-month (default the 1st). Returns
 * null when the rent is missing/non-positive or the date is not a valid
 * YYYY-MM-DD — the caller then simply shows the blank inputs.
 *
 * The stub is charged from the start date through the day BEFORE the next
 * rent-cycle day; full rent then begins on that rent-cycle day. With the default
 * `rentDay = 1` this is identical to the classic "prorate the partial first
 * month, full rent on the 1st" behavior. With any other day it anchors on that
 * recurring day instead (e.g. rent on the 15th → a lease starting the 20th
 * prorates the 20th→14th stub, full rent on the 15th). A start that lands exactly
 * on the rent day is a full first cycle (`applicable: false`).
 *
 * Two methods: `calendar` divides the monthly rent by the actual length of the
 * cycle the stub sits in; `thirtyDay` uses a flat 30-day cycle. Both round to
 * the nearest cent.
 */
export function computeProration(
  rentCents: number | null | undefined,
  startDate: string | null | undefined,
  rentDayInput?: number | null,
): ProrationComputation | null {
  if (rentCents == null || !Number.isFinite(rentCents) || rentCents <= 0) return null;
  const parsed = parseISODate(startDate ?? "");
  if (!parsed) return null;

  const { year, month, day } = parsed;
  const rentDay = clampRentDay(rentDayInput ?? 1);

  // The rent day as it actually lands this month (clamped to month length).
  const thisMonthRentDay = rentDayInMonth(year, month, rentDay);

  // Find the next rent-cycle day strictly after the start date (= full-rent
  // start) and the previous one (= the day the current cycle opened). The stub
  // sits between them.
  let nextAnchor: Ymd;
  let prevAnchor: Ymd;
  if (day < thisMonthRentDay) {
    // Start is before this month's rent day → the cycle closes this month.
    nextAnchor = { year, month, day: thisMonthRentDay };
    const pm = prevMonth(year, month);
    prevAnchor = { ...pm, day: rentDayInMonth(pm.year, pm.month, rentDay) };
  } else {
    // Start is on/after this month's rent day → next cycle day is next month.
    const nm = nextMonth(year, month);
    nextAnchor = { ...nm, day: rentDayInMonth(nm.year, nm.month, rentDay) };
    prevAnchor = { year, month, day: thisMonthRentDay };
  }

  const start: Ymd = { year, month, day };
  const periodEnd = civilFromDays(daysFromCivil(nextAnchor) - 1);

  // Length of the full cycle the stub sits in (prev → next rent day).
  const cycleDays = daysBetween(prevAnchor, nextAnchor);

  // Calendar method: daily rate over the actual cycle length × days occupied.
  const calDays = daysBetween(start, nextAnchor);
  const calCents = Math.round((rentCents * calDays) / cycleDays);

  // 30-day flat method: how far into a notional 30-day cycle the start lands,
  // charged at rent/30 per remaining day. Clamped so it never goes negative
  // (a start past day 30 of the cycle charges 0).
  const flatDays = Math.max(0, 30 - daysBetween(prevAnchor, start));
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
    applicable: day !== thisMonthRentDay,
    rentDay,
    startDate: toISO(start),
    periodStart: toISO(start),
    periodEnd: toISO(periodEnd),
    fullRentStart: toISO(nextAnchor),
    daysInMonth: cycleDays,
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
