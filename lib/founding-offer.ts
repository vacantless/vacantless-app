// founding-offer.ts (S731). The Founding 20 offer for the first outside
// landlords: pay nothing until Vacantless books your first viewing, then 30
// more days free, then Growth at 50% off ($49) for the rest of the first year.
// Card at checkout, at most 90 days free, 20 spots. Noam went with this on
// 2026-10-22 after the offer research (card trials convert 2 to 3 times
// better; rental demand bottoms in Nov to Dec, so a calendar trial would bill
// landlords who saw no renters). Everything here is pure so it is unit tested
// (scripts/test-founding-offer.ts); checkout, the Billing card and the daily
// free-period job call it.

export const FOUNDING20_COUPON_ID = "FOUNDING20-50X12";
export const FOUNDING20_OFFER = "founding20";
export const FOUNDING20_SPOTS = 20;
export const FOUNDING20_PERCENT_OFF = 50;
export const FOUNDING20_DISCOUNT_MONTHS = 12;
export const FOUNDING20_FREE_CAP_DAYS = 90;
export const FOUNDING20_AFTER_BOOKING_DAYS = 30;

const DAY_SEC = 86_400;

/** Where a founding landlord came from; one link per channel. */
export const FOUNDING_CHANNELS = ["warm", "agent", "assoc", "ads", "other"] as const;
export type FoundingChannel = (typeof FOUNDING_CHANNELS)[number];

function asChannel(v: unknown): FoundingChannel | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (FOUNDING_CHANNELS as readonly string[]).includes(s) ? (s as FoundingChannel) : null;
}

/**
 * The founding channel for this account, or null when it has no founding link.
 * A ?founding=<channel> on the Billing page wins (someone who already had an
 * account); otherwise a sign-up that came from a link tagged
 * utm_source=founding&utm_campaign=<channel> (signup_source on the org).
 */
export function foundingChannel(input: {
  param?: string | null;
  signupSource?: unknown;
}): FoundingChannel | null {
  if (input.param) return asChannel(input.param) ?? "other";
  const src = input.signupSource as { source?: unknown; campaign?: unknown } | null | undefined;
  if (src && typeof src === "object" && String(src.source ?? "").toLowerCase() === "founding") {
    return asChannel(src.campaign) ?? "other";
  }
  return null;
}

/** Show the founding card only to a landlord with a founding link who is not paying yet. */
export function foundingOfferVisible(input: {
  channel: FoundingChannel | null;
  plan: string | null | undefined;
  hasSubscription: boolean;
  billingReady: boolean;
}): boolean {
  if (!input.channel || !input.billingReady) return false;
  if (input.hasSubscription) return false;
  return (input.plan ?? "free") === "free";
}

/** Spots left from how many founding subscriptions exist (any status). */
export function foundingSpotsLeft(used: number): number {
  return Math.max(0, FOUNDING20_SPOTS - Math.max(0, Math.floor(used || 0)));
}

/** The longest free period, from checkout: now plus 90 days (Unix seconds). */
export function foundingTrialCap(nowSec: number): number {
  return Math.floor(nowSec) + FOUNDING20_FREE_CAP_DAYS * DAY_SEC;
}

/**
 * When the free period should end, given the subscription start, its current
 * trial end and the account's first viewing booked ON OR AFTER the founding
 * checkout (earlier Free-plan bookings do not count, so every founder gets
 * their free time from the day they start). Returns:
 *   null  - leave it alone (no booking yet, or it already ends sooner)
 *   "now" - the first booking was 30 or more days ago: end the free period now
 *   a Unix time - first booking plus 30 days, capped at start plus 90 days
 */
export function foundingTrialEnd(input: {
  createdSec: number;
  trialEndSec: number | null;
  firstBookingSec: number | null;
  nowSec: number;
}): number | "now" | null {
  if (input.firstBookingSec == null || input.trialEndSec == null) return null;
  const cap = Math.floor(input.createdSec) + FOUNDING20_FREE_CAP_DAYS * DAY_SEC;
  const target = Math.min(cap, Math.floor(input.firstBookingSec) + FOUNDING20_AFTER_BOOKING_DAYS * DAY_SEC);
  // Only ever shorten, and skip changes under an hour (no churn on re-runs).
  if (target >= input.trialEndSec - 3600) return null;
  // Stripe needs a trial end at least a little in the future.
  if (target <= input.nowSec + 120) return "now";
  return target;
}
