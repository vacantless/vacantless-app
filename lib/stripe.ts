// Server-only Stripe client + env-driven price lookup (M4 billing).
//
// DEGRADES GRACEFULLY: getStripe() returns null when STRIPE_SECRET_KEY is not
// set, so the app keeps building/running and the billing UI can show a clear
// "billing not configured yet" state instead of throwing. This mirrors
// lib/email.ts (Brevo) and lib/supabase/admin.ts (service role): a feature that
// activates the moment its key lands in Vercel — no code change needed.
//
// NEVER import this into a client component; it must stay server-only.
// Env (all server-only, NO NEXT_PUBLIC_):
//   STRIPE_SECRET_KEY      — sk_test_… (sandbox) or sk_live_… (production)
//   STRIPE_WEBHOOK_SECRET  — whsec_…  (used by app/api/stripe/webhook)
//   STRIPE_PRICE_GROWTH    — the Stripe price id for the Growth tier ($99/mo CAD)
//   STRIPE_PRICE_PREMIUM   — the Stripe price id for the Premium tier ($249/mo CAD)
//   STRIPE_PRICE_MANAGED   — the Stripe price id for the Managed tier ($399/mo CAD)
//   STRIPE_PRICE_CONCIERGE_PACK — (optional) a one-time Price for the $49
//                            concierge 3-pack. If unset, pack Checkout falls
//                            back to an inline price built in the server action.
//   STRIPE_PRICE_PILOT_DEPOSIT — (optional) a one-time Price for the refundable
//                            pilot setup deposit. If unset, the deposit Checkout
//                            falls back to an inline price built from
//                            PILOT_DEPOSIT_CENTS (CAD), so the feature works
//                            without a dashboard step; set this to manage the
//                            amount/currency in the Stripe dashboard instead.

import Stripe from "stripe";
import { TIERS, PAID_PLAN_KEYS, type PaidPlanKey } from "@/lib/billing";

let _stripe: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (_stripe !== undefined) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  _stripe = key ? new Stripe(key) : null;
  return _stripe;
}

// The configured Stripe price id for a given paid plan (from env), or null if
// that tier's price env var isn't set. Reads the price-id env name straight off
// the live TIERS config (growth/premium/managed each carry their `priceEnv`).
export function priceIdForPlan(plan: PaidPlanKey): string | null {
  const env = TIERS[plan].priceEnv;
  return env ? process.env[env] || null : null;
}

// Reverse lookup: { [priceId]: planKey } built from the configured env vars.
// Used by the webhook to turn a subscription's price back into a plan. Skips any
// paid tier whose price env var isn't set.
export function priceMap(): Record<string, PaidPlanKey> {
  const map: Record<string, PaidPlanKey> = {};
  PAID_PLAN_KEYS.forEach((plan) => {
    const env = TIERS[plan].priceEnv;
    const id = env ? process.env[env] : undefined;
    if (id) map[id] = plan;
  });
  return map;
}

// True when both the secret key and at least one price id are configured —
// i.e. checkout can actually run. The UI uses this to decide whether to show
// the subscribe buttons or a "billing not configured" notice.
export function isBillingConfigured(): boolean {
  return !!getStripe() && Object.keys(priceMap()).length > 0;
}

// The optional managed Price id for the one-time pilot deposit, or null. When
// null, the deposit Checkout uses an inline price (PILOT_DEPOSIT_CENTS, CAD).
export function depositPriceId(): string | null {
  return process.env.STRIPE_PRICE_PILOT_DEPOSIT || null;
}

// Deposit Checkout can run whenever Stripe is configured — the amount has an
// inline fallback, so it needs no dedicated Price env var.
export function isDepositConfigured(): boolean {
  return !!getStripe();
}
