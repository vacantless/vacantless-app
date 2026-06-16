"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { getStripe, priceIdForPlan } from "@/lib/stripe";
import { isPaidPlan } from "@/lib/billing";

// Start a 30-day, founder-led pilot ($0/month, refundable $200 setup deposit
// collected out-of-band). Records plan='pilot' + pilot_started_at=now via the
// RLS-scoped client (owner updates their own org). Idempotent + guarded: a paid
// org can't downgrade into a pilot, and an existing pilot is never restarted
// (which would extend the window). Redirect-based, per the S170 503 WATCH.
export async function startPilot() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
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

// Open the Stripe Customer Portal so the owner can update card, change plan, or
// cancel. Requires an existing Stripe customer.
export async function openBillingPortal() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");

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
