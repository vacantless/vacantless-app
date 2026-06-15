// Pure price-drop-blast logic (no I/O) so it can be unit-tested in isolation —
// the same shape as lib/reminders.ts and lib/feedback.ts.
//
// A price-drop blast goes to the still-open leads on a property after the
// operator lowers its rent ("the price just dropped — still interested?").
// The decision below is idempotent + safe to re-run:
//
//   * isPriceDrop() decides, on a property edit, whether the new rent is a
//     genuine reduction from the old one.
//
//   * pendingDropFrom() folds a new edit into the property's pending "from"
//     price, keeping the HIGHEST prior rent so the announced reduction is the
//     largest honest one, and clears the pending state on a raise/clear.
//
//   * leadEligibleForPriceDrop() gates each lead: still open, has an email, and
//     hasn't already been emailed about this rent or lower. After a blast the
//     lead's price_drop_notified_cents is set to the current rent, so a repeat
//     click is a no-op and only a FURTHER drop re-notifies.

import type { LeadStatus } from "@/lib/pipeline";

// Leads in these terminal stages are done — never blast them.
export const PRICE_DROP_EXCLUDED_STATUSES: readonly LeadStatus[] = [
  "leased",
  "lost",
];

/** Is `newCents` a genuine reduction from `oldCents`? Both must be set. */
export function isPriceDrop(
  oldCents: number | null | undefined,
  newCents: number | null | undefined,
): boolean {
  if (oldCents == null || newCents == null) return false;
  return newCents < oldCents;
}

/**
 * The property's pending "announce a drop from" price after an edit.
 *
 * - On a genuine drop, keep the HIGHEST of any already-pending price and the
 *   rent just edited away from, so two drops before a blast still announce the
 *   full reduction from the original price.
 * - On a raise or a cleared rent, cancel the pending announcement (null).
 * - On an unchanged rent, leave the existing pending price as-is.
 */
export function pendingDropFrom(
  oldCents: number | null | undefined,
  newCents: number | null | undefined,
  existingPending: number | null | undefined,
): number | null {
  if (oldCents == null || newCents == null) return existingPending ?? null;
  if (newCents < oldCents) {
    return Math.max(existingPending ?? 0, oldCents);
  }
  if (newCents > oldCents) return null; // a raise cancels the pending drop
  return existingPending ?? null; // unchanged: don't disturb a pending drop
}

export type PriceDropLead = {
  email: string | null;
  status: LeadStatus | string;
  price_drop_notified_cents: number | null;
};

/**
 * Should this lead receive the price-drop blast at the current rent?
 *
 * True only when ALL hold:
 *   - the property has a current rent
 *   - the lead has an email
 *   - the lead is still open (not leased / lost)
 *   - the lead hasn't already been emailed about this rent or lower
 */
export function leadEligibleForPriceDrop(
  lead: PriceDropLead,
  currentRentCents: number | null | undefined,
): boolean {
  if (currentRentCents == null) return false;
  if (!lead.email || !lead.email.trim()) return false;
  if (
    (PRICE_DROP_EXCLUDED_STATUSES as readonly string[]).includes(lead.status)
  ) {
    return false;
  }
  const notified = lead.price_drop_notified_cents;
  if (notified == null) return true;
  return currentRentCents < notified;
}

/** How many of these leads would the blast reach at the current rent. */
export function countEligible(
  leads: PriceDropLead[],
  currentRentCents: number | null | undefined,
): number {
  return leads.reduce(
    (n, l) => n + (leadEligibleForPriceDrop(l, currentRentCents) ? 1 : 0),
    0,
  );
}

/**
 * Is a price-drop blast offerable for this property right now? Needs a pending
 * "from" price strictly above the current rent (a sane recorded drop), a
 * current rent, and at least one eligible lead.
 */
export function blastOfferable(
  pendingFromCents: number | null | undefined,
  currentRentCents: number | null | undefined,
  eligibleCount: number,
): boolean {
  if (currentRentCents == null) return false;
  if (pendingFromCents == null) return false;
  if (pendingFromCents <= currentRentCents) return false;
  return eligibleCount > 0;
}

/** "$1,250" from 125000 cents; null-safe. */
export function formatMoney(cents: number | null | undefined): string | null {
  if (cents == null) return null;
  return "$" + Math.round(cents / 100).toLocaleString("en-CA");
}

/** "$1,250/month" for email + UI; null-safe. */
export function formatRentLabel(
  cents: number | null | undefined,
): string | null {
  const m = formatMoney(cents);
  return m ? `${m}/month` : null;
}
