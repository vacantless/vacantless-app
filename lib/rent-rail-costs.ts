// ============================================================================
// rent-rail-costs (S807). What a landlord pays Stripe or Rotessa to collect
// rent by pre-authorized debit, one payment per rental a month. Vacantless adds
// no fee on top: rent goes into the landlord's own Stripe or Rotessa account
// (lib/stripe-connect.ts sets no application fee).
//
// Figures read from each provider's own pricing page on 2026-11-16 [verified
// via Chrome + WebFetch]:
//   Stripe  https://stripe.com/en-ca/pricing/local-payment-methods
//           Canadian pre-authorized debit: 1% + CA$0.40 a payment, capped at
//           CA$5.00; failed payment CA$5.00; instant bank check CA$1.00.
//   Rotessa https://rotessa.com/pricing/
//           $25 a month + $0.50 a payment; $30 for each NSF or stopped
//           payment; $2 for an online bank check when required.
// Re-read both pages before changing a number here; the homepage and the
// Money page both print these.
// ============================================================================

export const RAIL_COSTS_CHECKED = "November 2026";

/** S834b: the pages the figures come from, linked under every cost table. */
export const RAIL_COST_SOURCES = {
  stripe: "https://stripe.com/en-ca/pricing/local-payment-methods",
  rotessa: "https://rotessa.com/pricing/",
} as const;

export const STRIPE_PAD = {
  pct: 0.01,
  fixedCents: 40,
  capCents: 500,
  failedCents: 500,
  bankCheckCents: 100,
} as const;

export const ROTESSA = {
  monthlyCents: 2500,
  perPaymentCents: 50,
  nsfCents: 3000,
  bankCheckCents: 200,
} as const;

/** Stripe's fee on one rent payment, in cents. */
export function stripeFeeCents(rentCents: number): number {
  const raw = Math.round(rentCents * STRIPE_PAD.pct) + STRIPE_PAD.fixedCents;
  return Math.min(raw, STRIPE_PAD.capCents);
}

/** A month of rent from `rentals` units, one payment each, on each rail. */
export function monthlyRailCosts(rentals: number, rentCents: number): { stripeCents: number; rotessaCents: number } {
  const n = Math.max(0, Math.floor(rentals));
  return {
    stripeCents: n * stripeFeeCents(rentCents),
    rotessaCents: n === 0 ? 0 : ROTESSA.monthlyCents + n * ROTESSA.perPaymentCents,
  };
}

/** The smallest rental count where Rotessa costs less than Stripe a month. */
export function rotessaCheaperFrom(rentCents: number): number | null {
  for (let n = 1; n <= 500; n++) {
    const c = monthlyRailCosts(n, rentCents);
    if (c.rotessaCents < c.stripeCents) return n;
  }
  return null;
}

export const RAIL_TABLE_RENT_CENTS = 150000; // a typical rent; Stripe's cap applies from $460
export const RAIL_TABLE_ROWS = [1, 5, 10, 25, 50] as const;

export function dollars(cents: number): string {
  const v = cents / 100;
  return `$${v.toLocaleString("en-CA", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
