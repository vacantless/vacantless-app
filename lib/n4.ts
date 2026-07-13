// Pure N4 (Notice to End a Tenancy Early for Non-payment of Rent) domain logic —
// no I/O, unit-tested in isolation. Slice A: the arrears derive (from the tenancy
// rent + the rent_payments ledger, with an operator override) and the minimum
// termination date. The official gov-form PDF fill + the operator serve flow are
// Slices B/C (behind the legal-verify gate).
//
// LEGAL NOTE: these are the app's COMPUTED SUGGESTIONS for the operator to review,
// not legal advice. An N4 is VOID if it overstates the arrears or gives too little
// notice, so the derive surfaces (but does NOT auto-apply) payments it can't
// confidently attribute and exposes a tenant-protective LOWER bound
// (conservativeOwingCents) next to the raw computed UPPER bound; the operator
// confirms/overrides every figure before any serve. The exact
// minimum-notice + deemed-service rules and the current LTB form revision must
// pass the legal-verify gate (N-FORM-LIBRARY-DESIGN-2026-07-12.md, section 6)
// before serve-on-behalf is enabled.

import {
  formatPeriodMonth,
  normalizePeriodMonth,
  type PaymentRow,
} from "./payments";

export type RentPeriodUnit =
  | "daily"
  | "weekly"
  | "bi_weekly"
  | "monthly"
  | "yearly";

// --- dates (pure, tz-safe: parse YYYY-MM-DD as a civil date, no local Date) ---

function parseYmd(iso: string): { y: number; m: number; d: number } {
  const match = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error(`n4: invalid date "${iso}"`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Add whole days to a YYYY-MM-DD civil date. Returns YYYY-MM-DD. */
export function addDaysISO(iso: string, days: number): string {
  const { y, m, d } = parseYmd(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Last calendar day of the month that `iso` (any YYYY-MM-DD) falls in, as YYYY-MM-DD. */
export function endOfMonthISO(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec((iso ?? "").trim());
  if (!m) throw new Error(`n4: invalid month "${iso}"`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * RTA s.59(1) minimum notice for an N4: 7 days for a daily/weekly tenancy, else
 * 14 days (bi-weekly / monthly / yearly / longer — the LTB N4 instructions state
 * bi-weekly is 14). CHECKLIST value — verify against the current statute + form
 * before serve-on-behalf (design section 6).
 */
export function minN4NoticeDays(unit: RentPeriodUnit): 7 | 14 {
  return unit === "daily" || unit === "weekly" ? 7 : 14;
}

/**
 * Earliest LAWFUL N4 termination date = service date + the minimum notice days.
 * (Unlike a no-fault notice, an N4's termination date need NOT fall on the last
 * day of a rental period.) Returns YYYY-MM-DD. The operator may pick a LATER date;
 * a date before this is void. Deemed-service add-ons (mail/courier +5 days, etc.)
 * are applied to the service date UPSTREAM, not here.
 */
export function deriveN4TerminationDate(
  serviceDateISO: string,
  unit: RentPeriodUnit,
): string {
  return addDaysISO(serviceDateISO, minN4NoticeDays(unit));
}

// --- arrears ledger ---------------------------------------------------------

export type N4PeriodRow = {
  period: string; // 'YYYY-MM-01'
  label: string; // 'June 2026'
  fromISO: string; // period first day (YYYY-MM-01)
  toISO: string; // period last day (YYYY-MM-<end>)
  chargedCents: number;
  paidCents: number;
  owingCents: number; // charged - paid (negative = that period was overpaid)
};

export type N4Arrears = {
  rows: N4PeriodRow[];
  totalChargedCents: number;
  totalPaidCents: number; // paid tagged to periods IN the window
  computedOwingCents: number; // max(0, totalCharged - totalPaid) — UPPER bound: credits nothing unattributed
  unassignedPaidCents: number; // payments with no period_month — surfaced, NOT applied to computedOwingCents
  outOfWindowPaidCents: number; // payments tagged outside the window — surfaced, NOT applied to computedOwingCents
  conservativeOwingCents: number; // tenant-protective LOWER bound: computedOwing minus every unattributed credit
  hasUnresolvedCredits: boolean; // unassigned/out-of-window payments exist -> operator must resolve before a default serve
};

/**
 * Enumerate monthly period keys ['YYYY-MM-01', ...] from `firstISO`..`lastISO`
 * inclusive (both normalized to the first of their month). Empty if either is
 * unparseable or first > last. Guarded at 1200 months (100 years) against runaway.
 */
export function monthlyPeriodKeys(firstISO: string, lastISO: string): string[] {
  const first = normalizePeriodMonth(firstISO);
  const last = normalizePeriodMonth(lastISO);
  if (!first || !last || first > last) return [];
  const keys: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const endY = Number(last.slice(0, 4));
  const endM = Number(last.slice(5, 7));
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 1200) {
    keys.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return keys;
}

/**
 * Derive an N4 arrears ledger from the tenancy rent + the payment records. Builds
 * one row per monthly period from the anchor (firstPeriodISO ?? tenancy start)
 * through the period containing `asOfISO` (the notice date), charging `rentCents`
 * each and crediting payments tagged to that exact period. Payments with no
 * period, or tagged outside the window, are summed separately and NOT applied to
 * `computedOwingCents` — they are surfaced (unassigned/outOfWindow totals + the
 * `hasUnresolvedCredits` flag) for the operator to resolve via the override.
 *
 * IMPORTANT: `computedOwingCents` is the UPPER bound and CAN overstate real
 * arrears when a genuine payment is unassigned or tagged out of window. Use
 * `conservativeOwingCents` (the tenant-protective LOWER bound crediting every
 * unattributed payment) as the safe default, and force the operator to resolve
 * credits when `hasUnresolvedCredits` is true before generating/serving an N4
 * (an overstated N4 is void).
 */
export function deriveN4Arrears(input: {
  rentCents: number;
  startDateISO: string;
  asOfISO: string;
  payments: PaymentRow[];
  firstPeriodISO?: string | null;
}): N4Arrears {
  const rent = Math.max(0, Math.round(input.rentCents || 0));
  const anchorISO = input.firstPeriodISO ?? input.startDateISO;
  const windowKeys = monthlyPeriodKeys(anchorISO, input.asOfISO);
  const windowSet = new Set(windowKeys);

  const paidByPeriod = new Map<string, number>();
  let unassignedPaidCents = 0;
  let outOfWindowPaidCents = 0;
  for (const p of input.payments) {
    const amt = Math.round(p.amount_cents || 0);
    if (amt === 0) continue;
    const key = normalizePeriodMonth(p.period_month ?? undefined);
    if (!key) {
      unassignedPaidCents += amt;
      continue;
    }
    if (!windowSet.has(key)) {
      outOfWindowPaidCents += amt;
      continue;
    }
    paidByPeriod.set(key, (paidByPeriod.get(key) ?? 0) + amt);
  }

  const rows: N4PeriodRow[] = windowKeys.map((period) => {
    const paid = paidByPeriod.get(period) ?? 0;
    return {
      period,
      label: formatPeriodMonth(period),
      fromISO: period,
      toISO: endOfMonthISO(period),
      chargedCents: rent,
      paidCents: paid,
      owingCents: rent - paid,
    };
  });

  const totalChargedCents = rows.reduce((s, r) => s + r.chargedCents, 0);
  const totalPaidCents = rows.reduce((s, r) => s + r.paidCents, 0);
  const computedOwingCents = Math.max(0, totalChargedCents - totalPaidCents);
  // Tenant-protective floor: credit EVERY unattributed payment (unassigned +
  // out-of-window) against owing. This can only lower the figure, so a default
  // built from it can never overstate. The operator override still wins.
  const unresolvedCreditCents = unassignedPaidCents + outOfWindowPaidCents;
  const conservativeOwingCents = Math.max(
    0,
    computedOwingCents - unresolvedCreditCents,
  );

  return {
    rows,
    totalChargedCents,
    totalPaidCents,
    computedOwingCents,
    unassignedPaidCents,
    outOfWindowPaidCents,
    conservativeOwingCents,
    hasUnresolvedCredits: unresolvedCreditCents > 0,
  };
}

/**
 * The authoritative arrears figure for the notice: the operator override when
 * provided (a finite value >= 0), else the computed figure. The operator is
 * legally responsible for the amount on a served N4, so an explicit override
 * always wins — including overriding DOWN to settle a disputed period.
 */
export function resolveN4OwingCents(
  computedOwingCents: number,
  overrideCents?: number | null,
): number {
  if (
    overrideCents != null &&
    Number.isFinite(overrideCents) &&
    overrideCents >= 0
  ) {
    return Math.round(overrideCents);
  }
  return Math.max(0, Math.round(computedOwingCents || 0));
}

// --- form-row packing (the official N4 table has only THREE rows) ------------

export type N4FormRow = {
  fromISO: string;
  toISO: string;
  chargedCents: number;
  paidCents: number;
  owingCents: number;
};

/**
 * Pack derived monthly period rows into the <=3 rows the official N4 table holds.
 * Per the LTB N4 instructions: "if the tenant owes rent for more than three
 * rental periods, you can combine two or more rental periods in the first or
 * second row... in the last row you complete, you must show the rent charged,
 * paid and owing for the LAST rent period." So <=3 periods -> one row each; >3 ->
 * row 1 = ALL BUT the last period combined (earliest from-date .. second-last
 * to-date, summed), row 2 = the last period alone. `combined` tells the operator
 * review that summarization happened. Pure.
 */
export function packN4ArrearsRows(rows: N4PeriodRow[]): {
  formRows: N4FormRow[];
  combined: boolean;
} {
  const toForm = (r: N4PeriodRow): N4FormRow => ({
    fromISO: r.fromISO,
    toISO: r.toISO,
    chargedCents: r.chargedCents,
    paidCents: r.paidCents,
    owingCents: r.owingCents,
  });
  if (rows.length <= 3) {
    return { formRows: rows.map(toForm), combined: false };
  }
  const last = rows[rows.length - 1];
  const earlier = rows.slice(0, rows.length - 1);
  const combinedRow: N4FormRow = {
    fromISO: earlier[0].fromISO,
    toISO: earlier[earlier.length - 1].toISO,
    chargedCents: earlier.reduce((s, r) => s + r.chargedCents, 0),
    paidCents: earlier.reduce((s, r) => s + r.paidCents, 0),
    owingCents: earlier.reduce((s, r) => s + r.owingCents, 0),
  };
  return { formRows: [combinedRow, toForm(last)], combined: true };
}
