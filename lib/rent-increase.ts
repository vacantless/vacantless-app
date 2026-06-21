// ============================================================================
// Ontario rent-increase engine — pure calc core (N1 v1, S282).
//
// "Don't leave money on the table": for a tenancy, derive WHEN the next legal
// rent increase can take effect, by WHEN the N1 must be served to hit it, the
// guideline % for that year, and the resulting new rent — so the operator is
// reminded in time and never misses an annual increase.
//
// Ontario rules encoded (verified 2026-06-21):
//   * Rent may rise once every 12 months, measured from move-in OR the last
//     increase, whichever is more recent.
//   * Form N1 must be served at least 90 days before the increase takes effect.
//   * The guideline is set ANNUALLY by the province from the Ontario CPI,
//     capped at 2.5%. It is a moving target — see GUIDELINE below; UPDATE YEARLY.
//   * Units first occupied after 2018-11-15 are exempt from the guideline cap
//     (no limit) — caller passes `exempt: true` for those.
//
// This module is surface-agnostic and PURE (no DOM/IO/clock — `today` is an
// argument). UI placement (Overview reminders vs per-tenancy) is a later slice.
// Out of scope here: AGI (above-guideline) applications; auto-bumping rent in
// Stripe/Rotessa; e-signing the N1 (the legal-gated tail).
// ============================================================================

import { parseISODate } from "./proration";

/**
 * Ontario rent-increase guideline by the YEAR the increase takes effect.
 * Set annually by the Ministry of Municipal Affairs and Housing.
 *
 * ⚠️ UPDATE EACH YEAR when the next guideline is published (usually late
 * summer for the following calendar year). A year not listed → null (treated as
 * "guideline not yet published").
 */
export const ONTARIO_GUIDELINE: Record<number, number> = {
  2023: 2.5,
  2024: 2.5,
  2025: 2.5,
  2026: 2.1,
};

export function guidelineForYear(year: number): number | null {
  return ONTARIO_GUIDELINE[year] ?? null;
}

export const NOTICE_DAYS = 90; // N1 must be served at least this far ahead
export const MIN_INCREASE_MONTHS = 12; // once every 12 months
export const REMINDER_LEAD_DAYS = 120; // start nudging this far before eligibility

// "exempt"       — post-2018-11-15 unit; guideline cap doesn't apply (no amounts)
// "scheduled"    — eligible date is further out than the reminder window
// "serve_window" — within the reminder window AND ≥90 days of runway: serve now
//                  to hit the earliest legal effective date
// "serve_late"   — past the serve-by date but not yet the eligible date: you can
//                  still serve, but the effective date pushes out to today+90
// "overdue"      — eligible date has passed and no increase taken: money left on
//                  the table; serve now for an effective date of today+90
export type RentIncreaseStatus =
  | "exempt"
  | "scheduled"
  | "serve_window"
  | "serve_late"
  | "overdue";

export type RentIncreaseInput = {
  /** tenancies.start_date (YYYY-MM-DD). */
  startDate: string;
  /** Date of the most recent increase, if any (YYYY-MM-DD). Null = none yet. */
  lastIncreaseDate?: string | null;
  /** tenancies.rent_cents (the current rent). */
  currentRentCents: number;
  /** Post-2018-11-15 rent-control exemption (no guideline cap). */
  exempt?: boolean;
  /** Guideline lookup by effective year; defaults to the Ontario table. */
  guideline?: (year: number) => number | null;
};

export type RentIncrease = {
  status: RentIncreaseStatus;
  exempt: boolean;
  /** Soonest legal effective date per the 12-month rule (YYYY-MM-DD). */
  earliestEffectiveDate: string;
  /** Realistic effective date — may be pushed to today+90 if you're late. */
  effectiveDate: string;
  /** Serve the N1 on or before this date to hit effectiveDate (effective−90). */
  serveByDate: string;
  /** Days from today to the earliest eligible effective date (negative if past). */
  daysUntilEligible: number;
  guidelinePercent: number | null;
  currentRentCents: number;
  newRentCents: number | null;
  increaseCents: number | null;
  /** Short human-readable status line. */
  note: string;
};

// --- UTC date helpers (avoid TZ drift; mirror proration's strict-ISO style) --

function toUTC(d: { year: number; month: number; day: number }): number {
  return Date.UTC(d.year, d.month - 1, d.day);
}

function isoFromUTC(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  return `${y}-${pad(m)}-${pad(day)}`;
}

function addMonthsUTC(ms: number, months: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate());
}

function addDaysUTC(ms: number, days: number): number {
  return ms + days * 86_400_000;
}

function diffDays(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / 86_400_000);
}

/**
 * Derive the rent-increase picture for one tenancy as of `today`.
 * Pure: same inputs → same output. Returns null only on unparseable dates.
 */
export function deriveRentIncrease(
  input: RentIncreaseInput,
  today: string,
): RentIncrease | null {
  const todayParts = parseISODate(today);
  const baseRaw = input.lastIncreaseDate || input.startDate;
  const baseParts = parseISODate(baseRaw);
  if (!todayParts || !baseParts) return null;

  const todayMs = toUTC(todayParts);
  const baseMs = toUTC(baseParts);
  const guideline = input.guideline ?? guidelineForYear;

  // The 12-month rule: earliest the increase can TAKE EFFECT.
  const earliestEffectiveMs = addMonthsUTC(baseMs, MIN_INCREASE_MONTHS);
  const daysUntilEligible = diffDays(todayMs, earliestEffectiveMs);

  // If we're already inside (or past) the 90-day notice runway, serving today
  // can't make the earliest date — the effective date pushes to today+90.
  const todayPlusNoticeMs = addDaysUTC(todayMs, NOTICE_DAYS);
  const effectiveMs = Math.max(earliestEffectiveMs, todayPlusNoticeMs);
  const serveByMs = addDaysUTC(effectiveMs, -NOTICE_DAYS);

  const earliestEffectiveDate = isoFromUTC(earliestEffectiveMs);
  const effectiveDate = isoFromUTC(effectiveMs);
  const serveByDate = isoFromUTC(serveByMs);

  // Amounts (only when the guideline cap applies).
  const exempt = input.exempt === true;
  const effectiveYear = new Date(effectiveMs).getUTCFullYear();
  const guidelinePercent = exempt ? null : guideline(effectiveYear);
  const currentRentCents = Math.max(0, Math.round(input.currentRentCents));
  const newRentCents =
    guidelinePercent == null
      ? null
      : Math.round(currentRentCents * (1 + guidelinePercent / 100));
  const increaseCents = newRentCents == null ? null : newRentCents - currentRentCents;

  // Status.
  let status: RentIncreaseStatus;
  if (exempt) {
    status = "exempt";
  } else if (daysUntilEligible > REMINDER_LEAD_DAYS) {
    status = "scheduled";
  } else if (daysUntilEligible >= NOTICE_DAYS) {
    // Within the reminder window and still ≥90 days of runway to the eligible date.
    status = "serve_window";
  } else if (daysUntilEligible >= 0) {
    // Past serve-by but not yet eligible: can still serve, effective date slips.
    status = "serve_late";
  } else {
    status = "overdue";
  }

  const note = buildNote(status, {
    earliestEffectiveDate,
    serveByDate,
    effectiveDate,
    guidelinePercent,
    daysUntilEligible,
  });

  return {
    status,
    exempt,
    earliestEffectiveDate,
    effectiveDate,
    serveByDate,
    daysUntilEligible,
    guidelinePercent,
    currentRentCents,
    newRentCents,
    increaseCents,
    note,
  };
}

function buildNote(
  status: RentIncreaseStatus,
  d: {
    earliestEffectiveDate: string;
    serveByDate: string;
    effectiveDate: string;
    guidelinePercent: number | null;
    daysUntilEligible: number;
  },
): string {
  const g =
    d.guidelinePercent == null
      ? "the guideline (not yet published)"
      : `the ${d.guidelinePercent}% guideline`;
  switch (status) {
    case "exempt":
      return "This unit is exempt from the guideline cap (first occupied after Nov 15, 2018).";
    case "scheduled":
      return `Next increase eligible ${d.earliestEffectiveDate}. Serve the N1 by ${d.serveByDate} to apply ${g}.`;
    case "serve_window":
      return `Serve the N1 now (by ${d.serveByDate}) for a ${d.earliestEffectiveDate} increase at ${g}.`;
    case "serve_late":
      return `Past the ideal serve date — serve now for a ${d.effectiveDate} effective date at ${g}.`;
    case "overdue":
      return `Eligible since ${d.earliestEffectiveDate} — you're leaving money on the table. Serve now for a ${d.effectiveDate} increase at ${g}.`;
  }
}
