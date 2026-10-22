// founding-offer.ts (S731). The Founding 20 offer for the first outside
// landlords: pay nothing until Vacantless books your first viewing, then 30
// more days free, then Growth at 50% off ($49) for the rest of the first year.
// Card at checkout, at most 90 days free, 20 spots. Noam went with this on
// 2026-10-22 after the offer research (card trials convert 2 to 3 times
// better; rental demand bottoms in Nov to Dec, so a calendar trial would bill
// landlords who saw no renters). Everything here is pure so it is unit tested
// (scripts/test-founding-offer.ts); checkout, the Billing card and the daily
// free-period job call it.

// S731e: a flat $50 off ($99 to $49), not 50% (which Stripe showed as $49.50
// while every page said $49). The first coupon, FOUNDING20-50X12, was made
// once on 2026-10-22 during the test checkout and is never used again; it is
// still recognised so nothing made with it is missed.
export const FOUNDING20_COUPON_ID = "FOUNDING20-49X12";
export const FOUNDING20_COUPON_IDS = [FOUNDING20_COUPON_ID, "FOUNDING20-50X12"] as const;
export const FOUNDING20_AMOUNT_OFF_CENTS = 5000;
/** Shown on Stripe checkout and invoices; Stripe allows at most 40 characters. */
export const FOUNDING20_COUPON_NAME = "Founding 20: $49/month, first year";
export const FOUNDING20_CURRENCY = "cad";
export const FOUNDING20_OFFER = "founding20";
export const FOUNDING20_SPOTS = 20;
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

/** The checkout page line under the button, so the free time is never a surprise. */
export const FOUNDING20_CHECKOUT_NOTE =
  "Your free time ends 30 days after Vacantless books your first viewing, or after 90 days, whichever comes first. Then $49 a month until a year from today, then $99 a month. We email you the date before the first charge.";

// S732: the founding offer with the Posting add-on in the same checkout. The
// $50 coupon comes off the invoice total, so Growth $99 + Posting $49 - $50 =
// $98 in the first year, then $148. Posting is free during the free time too,
// since posting is what brings the first viewing (Noam's call, S732).
export const FOUNDING20_WITH_POSTING_CHECKOUT_NOTE =
  "Your free time ends 30 days after Vacantless books your first viewing, or after 90 days, whichever comes first. Then $98 a month (Growth $49 plus Posting $49) until a year from today, then $148 a month. We email you the date before the first charge.";

/** The founding monthly price in cents for the first year, with or without
 * Posting. Pure, so the Billing card and the checkout note cannot drift. */
export function foundingMonthlyCents(input: {
  growthCents: number;
  postingCents: number;
  withPosting: boolean;
}): { firstYear: number; after: number } {
  const list = input.growthCents + (input.withPosting ? input.postingCents : 0);
  return { firstYear: Math.max(0, list - FOUNDING20_AMOUNT_OFF_CENTS), after: list };
}

/** The price sentence in the founding emails. S732: with Posting the first
 * year is $98 and after it $148. */
export function foundingPriceLine(withPosting: boolean | undefined, tense: "is" | "is now"): string {
  return withPosting
    ? `Growth with Posting ${tense} $98 a month until a year from when you started, then $148 a month.`
    : `Growth ${tense} $49 a month until a year from when you started, then $99 a month.`;
}

/** The email sent when the first booking sets the end of the free time. */
export function foundingTrialEmail(input: {
  endSec: number | "now";
  nowSec: number;
  timeZone?: string | null;
  withPosting?: boolean;
}): { subject: string; body: string } {
  const endMs = (input.endSec === "now" ? input.nowSec : input.endSec) * 1000;
  let day: string;
  try {
    day = new Intl.DateTimeFormat("en-CA", {
      timeZone: input.timeZone || "America/Toronto",
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(endMs));
  } catch {
    day = new Date(endMs).toISOString().slice(0, 10);
  }
  if (input.endSec === "now") {
    return {
      subject: "Your founding free time has ended",
      body:
        "Vacantless booked your first viewing more than 30 days ago, so your founding free time ends today. " +
        `${foundingPriceLine(input.withPosting, "is now")} ` +
        "You can cancel anytime from Billing.",
    };
  }
  return {
    subject: `Your first viewing is booked: free until ${day}`,
    body:
      `Vacantless booked your first viewing, so your founding free time now ends on ${day}. ` +
      `After that, ${foundingPriceLine(input.withPosting, "is")} ` +
      "You can cancel anytime from Billing before then and you will not be charged.",
  };
}

/** Days before the end of the free time that the reminder goes out. */
export const FOUNDING20_REMINDER_DAYS = 7;

/** True when the 7-day reminder is due and has not been sent. */
export function foundingReminderDue(input: {
  trialEndSec: number | null;
  nowSec: number;
  alreadySent: boolean;
}): boolean {
  if (input.alreadySent || input.trialEndSec == null) return false;
  const left = input.trialEndSec - input.nowSec;
  return left > 0 && left <= FOUNDING20_REMINDER_DAYS * 86_400;
}

/** The reminder a week before the first charge. */
export function foundingReminderEmail(input: {
  trialEndSec: number;
  timeZone?: string | null;
  withPosting?: boolean;
}): {
  subject: string;
  body: string;
} {
  let day: string;
  try {
    day = new Intl.DateTimeFormat("en-CA", {
      timeZone: input.timeZone || "America/Toronto",
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(input.trialEndSec * 1000));
  } catch {
    day = new Date(input.trialEndSec * 1000).toISOString().slice(0, 10);
  }
  return {
    subject: `Your founding free time ends ${day}`,
    body:
      `A reminder: your Vacantless founding free time ends on ${day}. ` +
      `Then ${foundingPriceLine(input.withPosting, "is")} ` +
      "To stop before then, cancel from Billing and you will not be charged.",
  };
}
