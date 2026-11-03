// lib/referral-credit.ts (S746b). The referral credit, pure half.
//
// The referral loop (lib/referrals.ts, S355) records who referred whom but paid
// nothing for it. The subscriber plan (2026-11-03) adds the reward: when the
// referred landlord pays their first Growth invoice, the referrer and the
// referred account each get one month of Growth as a Stripe customer-balance
// credit. A balance credit stacks with any coupon (founding, FOUNDING10) and
// simply lowers the next invoice, so no coupon juggling and no second trial rule.
//
// PURE: the decision and the copy. The Stripe and database calls live in
// lib/referral-credit-server.ts. Tests: scripts/test-referral-credit.ts.

/** One month of Growth, CA$99. */
export const REFERRAL_CREDIT_CENTS = 9900;
export const REFERRAL_CREDIT_LABEL = "$99";
export const REFERRAL_CREDIT_CURRENCY = "cad";

export type ReferralInviteRow = {
  id: string;
  status: string;
  source: string;
  referred_by_org_id: string | null;
  provisioned_org_id: string | null;
  referral_credit_at: string | null;
};

export type CreditDecision =
  | { grant: true; inviteId: string; referrerOrgId: string }
  | { grant: false; reason: string };

/**
 * Should this paid invoice earn the referral credit?
 * - the invoice must be a real payment (amount paid above zero), not a $0 trial
 *   or 100%-coupon invoice, or the referee could earn a credit without paying;
 * - the invite must be an accepted referral for this org, not yet credited;
 * - a landlord cannot refer themselves (same org on both sides).
 */
export function referralCreditDecision(input: {
  amountPaidCents: number | null | undefined;
  refereeOrgId: string;
  invite: ReferralInviteRow | null;
}): CreditDecision {
  const paid = Math.round(Number(input.amountPaidCents ?? 0));
  if (!(paid > 0)) return { grant: false, reason: "nothing_paid" };
  const inv = input.invite;
  if (!inv) return { grant: false, reason: "no_referral" };
  if (inv.source !== "referral") return { grant: false, reason: "not_a_referral" };
  if (inv.status !== "accepted") return { grant: false, reason: "not_accepted" };
  if (inv.provisioned_org_id !== input.refereeOrgId) return { grant: false, reason: "org_mismatch" };
  if (!inv.referred_by_org_id) return { grant: false, reason: "no_referrer" };
  if (inv.referred_by_org_id === input.refereeOrgId) return { grant: false, reason: "self_referral" };
  if (inv.referral_credit_at) return { grant: false, reason: "already_credited" };
  return { grant: true, inviteId: inv.id, referrerOrgId: inv.referred_by_org_id };
}

/** The line Stripe shows on the balance transaction and the next invoice. */
export function creditDescription(side: "referrer" | "referee", otherName: string | null): string {
  const who = (otherName ?? "").trim();
  if (side === "referrer") {
    return who ? `Referral credit: ${who} joined Vacantless` : "Referral credit: a landlord you referred joined Vacantless";
  }
  return who ? `Welcome credit: referred by ${who}` : "Welcome credit: you joined through a referral";
}

/** Plain copy for the Refer a landlord page. One source for the number. */
export const REFERRAL_CREDIT_COPY = {
  headline: `You both get ${REFERRAL_CREDIT_LABEL} off.`,
  body: `When a landlord you refer pays for their first month of Growth, you each get a ${REFERRAL_CREDIT_LABEL} credit, one month of Growth, taken off your next bill.`,
  statusCredited: "Credit applied",
} as const;
