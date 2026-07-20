"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { getStripe, priceIdForPlan, depositPriceId } from "@/lib/stripe";
import {
  isPaidPlan,
  isPilotPlan,
  PILOT_DEPOSIT_CENTS,
  normalizeDepositStatus,
  canUseListingMarketing,
  CONCIERGE_PACK_PRICE_CENTS,
  CONCIERGE_PACK_QUANTITY,
} from "@/lib/billing";

// Start a 30-day, founder-led pilot ($0/month, refundable $200 setup deposit
// collected out-of-band). Records plan='pilot' + pilot_started_at=now via the
// RLS-scoped client (owner updates their own org). Idempotent + guarded: a paid
// org can't downgrade into a pilot, and an existing pilot is never restarted
// (which would extend the window). Redirect-based, per the S170 503 WATCH.
export async function startPilot() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  // Billing is owner-only (audit C1 + locked seat model): operators and showing
  // helpers can't start/cancel a subscription, pay the deposit, or open the portal.
  await requireCapability("manage_billing", "/dashboard/billing?forbidden=1");
  if (isPaidPlan(org.plan)) redirect("/dashboard/billing?error=already_paid");
  if (org.pilot_started_at) redirect("/dashboard/billing?pilot=already");

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ plan: "pilot", pilot_started_at: new Date().toISOString() })
    .eq("id", org.id);

  if (error) redirect("/dashboard/billing?error=pilot");
  redirect("/dashboard/billing?pilot=started");
}

// Public base URL for Stripe success/cancel/return redirects. Matches the
// helper in lib/email.ts; override with NEXT_PUBLIC_APP_URL in Vercel.
const APP_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app"
).replace(/\/+$/, "");

function currentUtcPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function propertyDistributeUrl(
  propertyId: string,
  query: string,
): string | null {
  const id = propertyId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  return `/dashboard/properties/${id}?${query}#distribute-header`;
}

// Ensure the org has a Stripe customer, creating one (and persisting the id)
// on first use. Returns the customer id, or null if Stripe isn't configured.
async function ensureCustomer(
  org: Awaited<ReturnType<typeof getCurrentOrg>>,
  ownerEmail: string | null,
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe || !org) return null;
  if (org.stripe_customer_id) return org.stripe_customer_id;

  const customer = await stripe.customers.create({
    name: org.name,
    email: ownerEmail || undefined,
    metadata: { org_id: org.id },
  });

  // Persist via the RLS-scoped client (owner updates their own org). The
  // webhook also backfills this from checkout.session.completed, so a failure
  // here is self-healing, but we write it now to avoid creating duplicates.
  const supabase = createClient();
  await supabase
    .from("organizations")
    .update({ stripe_customer_id: customer.id })
    .eq("id", org.id);

  return customer.id;
}

// Start a Stripe Checkout session for a subscription to the chosen tier and
// redirect the owner to Stripe's hosted page. Redirect-based (not
// revalidate-only) — consistent with the rest of the owner forms and the S170
// 503 WATCH.
export async function startCheckout(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  // Billing is owner-only (audit C1 + locked seat model): operators and showing
  // helpers can't start/cancel a subscription, pay the deposit, or open the portal.
  await requireCapability("manage_billing", "/dashboard/billing?forbidden=1");

  const plan = String(formData.get("plan") ?? "");
  if (!isPaidPlan(plan)) redirect("/dashboard/billing?error=plan");

  const stripe = getStripe();
  const priceId = priceIdForPlan(plan);
  if (!stripe || !priceId) redirect("/dashboard/billing?error=not_configured");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const customerId = await ensureCustomer(org, user?.email ?? null);
  if (!customerId) redirect("/dashboard/billing?error=not_configured");

  const session = await stripe!.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId!, quantity: 1 }],
    client_reference_id: org.id,
    subscription_data: { metadata: { org_id: org.id } },
    // Lets you apply a founding-customer / promo coupon at checkout without a
    // code change if you decide to keep list price high and discount instead.
    allow_promotion_codes: true,
    success_url: `${APP_BASE_URL}/dashboard/billing?checkout=success`,
    cancel_url: `${APP_BASE_URL}/dashboard/billing?checkout=cancel`,
  });

  if (!session.url) redirect("/dashboard/billing?error=checkout");
  redirect(session.url);
}

// Start a one-time Stripe Checkout for the refundable pilot setup deposit and
// redirect the owner to Stripe's hosted page. Only for an org on the pilot plan
// whose deposit isn't already paid. Uses a managed Price (STRIPE_PRICE_PILOT_DEPOSIT)
// when set, else an inline price built from PILOT_DEPOSIT_CENTS (CAD) so the
// flow works without a dashboard step. The webhook records the result on the org
// (mode='payment' + metadata.kind='pilot_deposit'). Redirect-based per the S170
// 503 WATCH.
export async function startDepositCheckout() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  // Billing is owner-only (audit C1 + locked seat model): operators and showing
  // helpers can't start/cancel a subscription, pay the deposit, or open the portal.
  await requireCapability("manage_billing", "/dashboard/billing?forbidden=1");
  if (!isPilotPlan(org.plan)) redirect("/dashboard/billing?error=deposit_not_pilot");
  if (normalizeDepositStatus(org.pilot_deposit_status) === "paid") {
    redirect("/dashboard/billing?deposit=already");
  }

  const stripe = getStripe();
  if (!stripe) redirect("/dashboard/billing?error=not_configured");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const customerId = await ensureCustomer(org, user?.email ?? null);
  if (!customerId) redirect("/dashboard/billing?error=not_configured");

  const managedPrice = depositPriceId();
  const lineItem = managedPrice
    ? { price: managedPrice, quantity: 1 }
    : {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: PILOT_DEPOSIT_CENTS,
          product_data: {
            name: "Vacantless pilot setup deposit (refundable)",
          },
        },
      };

  const session = await stripe!.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [lineItem],
    client_reference_id: org.id,
    // Metadata on BOTH the session and the resulting PaymentIntent: the session
    // metadata lets the webhook recognize the deposit on checkout.session.completed;
    // the PaymentIntent metadata travels with a later refund event.
    metadata: { kind: "pilot_deposit", org_id: org.id },
    payment_intent_data: {
      metadata: { kind: "pilot_deposit", org_id: org.id },
      description: "Vacantless pilot setup deposit (refundable)",
    },
    success_url: `${APP_BASE_URL}/dashboard/billing?deposit=success`,
    cancel_url: `${APP_BASE_URL}/dashboard/billing?deposit=cancel`,
  });

  if (!session.url) redirect("/dashboard/billing?error=deposit");
  redirect(session.url);
}

// One-time concierge capacity pack (+3 done-for-you lease-ups for the current
// UTC month). Dark behind CONCIERGE_DESK_ENABLED and owner-only because it
// creates a Stripe payment.
export async function startConciergePackCheckout(formData: FormData) {
  const propertyId = String(formData.get("property_id") ?? "").trim();
  const successPath = propertyDistributeUrl(propertyId, "run=packsuccess");
  const cancelPath = propertyDistributeUrl(propertyId, "run=packcancel");
  const fallbackPath = successPath
    ? `/dashboard/properties/${propertyId}?runerr=packcheckout#distribute-header`
    : "/dashboard/billing?error=checkout";

  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_billing", fallbackPath);
  if (!successPath || !cancelPath) redirect("/dashboard/billing?error=checkout");
  if (process.env.CONCIERGE_DESK_ENABLED !== "true") {
    redirect(`/dashboard/properties/${propertyId}?runerr=packdisabled#distribute-header`);
  }
  if (!canUseListingMarketing(org.plan)) {
    redirect(`/dashboard/properties/${propertyId}?run=conciergeupgrade#distribute-header`);
  }

  const stripe = getStripe();
  if (!stripe) {
    redirect(`/dashboard/properties/${propertyId}?runerr=packcheckout#distribute-header`);
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const customerId = await ensureCustomer(org, user?.email ?? null);
  if (!customerId) {
    redirect(`/dashboard/properties/${propertyId}?runerr=packcheckout#distribute-header`);
  }

  const packPrice = process.env.STRIPE_PRICE_CONCIERGE_PACK || null;
  const lineItem = packPrice
    ? { price: packPrice, quantity: 1 }
    : {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: CONCIERGE_PACK_PRICE_CENTS,
          product_data: {
            name: `Vacantless concierge ${CONCIERGE_PACK_QUANTITY}-pack (${CONCIERGE_PACK_QUANTITY} done-for-you lease-ups)`,
          },
        },
      };
  const period = currentUtcPeriod();
  const metadata = {
    kind: "concierge_pack",
    org_id: org.id,
    period,
    quantity: String(CONCIERGE_PACK_QUANTITY),
  };

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [lineItem],
    client_reference_id: org.id,
    metadata,
    payment_intent_data: {
      metadata,
      description: `Vacantless concierge ${CONCIERGE_PACK_QUANTITY}-pack`,
    },
    success_url: `${APP_BASE_URL}${successPath}`,
    cancel_url: `${APP_BASE_URL}${cancelPath}`,
  });

  if (!session.url) {
    redirect(`/dashboard/properties/${propertyId}?runerr=packcheckout#distribute-header`);
  }
  redirect(session.url);
}

// Open the Stripe Customer Portal so the owner can update card, change plan, or
// cancel. Requires an existing Stripe customer.
export async function openBillingPortal() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  // Billing is owner-only (audit C1 + locked seat model): operators and showing
  // helpers can't start/cancel a subscription, pay the deposit, or open the portal.
  await requireCapability("manage_billing", "/dashboard/billing?forbidden=1");

  const stripe = getStripe();
  if (!stripe || !org.stripe_customer_id) {
    redirect("/dashboard/billing?error=portal");
  }

  const session = await stripe!.billingPortal.sessions.create({
    customer: org.stripe_customer_id!,
    return_url: `${APP_BASE_URL}/dashboard/billing`,
  });

  redirect(session.url);
}
