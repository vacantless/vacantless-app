// Pure N4 (Notice to End a Tenancy Early for Non-payment of Rent) domain logic —
// no I/O, unit-tested in isolation. Slice A: the arrears derive (from the tenancy
// rent + the rent_payments ledger, with an operator override) and the minimum
// termination date. The official gov-form PDF fill + the operator serve flow are
// Slices B/C (behind the legal-verify gate).
//
// LEGAL NOTE: these are the app's COMPUTED SUGGESTIONS for the operator to review,
// not legal advice. An N4 is VOID if it overstates the arrears or gives too little
// notice, so the derive is deliberately conservative (it never inflates owing, and
// surfaces — but does NOT auto-apply — payments it can't confidently attribute),
// and the operator confirms/overrides every figure before any serve. The exact
// minimum-notice + deemed-service rules and the current LTB form revision must
// pass the legal-verify gate (N-FORM-LIBRARY-DESIGN-2026-07-12.md, section 6)
// before serve-on-behalf is enabled.

import {
  formatPeriodMonth,
  normalizePeriodMonth,
  type PaymentRow,
} from "./payments";

export type RentPeriodUnit = "daily" | "weekly" | "monthly" | "yearly";

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

/**
 * RTA s.59(1) minimum notice for an N4: 7 days for a daily/weekly tenancy, else
 * 14 days (monthly / yearly / longer). CHECKLIST value — verify against the
 * current statute + form before serve-on-behalf (design section 6).
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
  chargedCents: number;
  paidCents: number;
  owingCents: number; // charged - paid (negative = that period was overpaid)
};

export type N4Arrears = {
  rows: N4PeriodRow[];
  totalChargedCents: number;
  totalPaidCents: number; // paid tagged to periods IN the window
  computedOwingCents: number; // max(0, totalCharged - totalPaid)
  unassignedPaidCents: number; // payments with no period_month — surfaced, NOT applied
  outOfWindowPaidCents: number; // payments tagged outside the window — surfaced, NOT applied
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
 * period, or tagged outside the window, are summed separately and NOT applied —
 * they are shown to the operator (who decides via the override) so the derive
 * can never silently overstate arrears (an overstated N4 is void).
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
      chargedCents: rent,
      paidCents: paid,
      owingCents: rent - paid,
    };
  });

  const totalChargedCents = rows.reduce((s, r) => s + r.chargedCents, 0);
  const totalPaidCents = rows.reduce((s, r) => s + r.paidCents, 0);
  const computedOwingCents = Math.max(0, totalChargedCents - totalPaidCents);

  return {
    rows,
    totalChargedCents,
    totalPaidCents,
    computedOwingCents,
    unassignedPaidCents,
    outOfWindowPaidCents,
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
