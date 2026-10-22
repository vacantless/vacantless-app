"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  getStripe,
  priceIdForPlan,
  depositPriceId,
  postingAddonPriceId,
} from "@/lib/stripe";
import { readRobotPostingAccess } from "@/lib/robot-posting-access";
import {
  FOUNDING20_COUPON_ID,
  FOUNDING20_DISCOUNT_MONTHS,
  FOUNDING20_OFFER,
  FOUNDING20_PERCENT_OFF,
  foundingChannel,
  foundingSpotsLeft,
  foundingTrialCap,
} from "@/lib/founding-offer";
import {
  isPaidPlan,
  isPilotPlan,
  PILOT_DEPOSIT_CENTS,
  normalizeDepositStatus,
  canUseListingMarketing,
  CONCIERGE_PACK_PRICE_CENTS,
  CONCIERGE_PACK_QUANTITY,
  shouldEnableSmsOnPlanChange,
  itemForPrice,
  subscriptionGrantsPlan,
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
    .update({
      plan: "pilot",
      pilot_started_at: new Date().toISOString(),
      // S712: the pilot includes renter texts, so switch them on, as the
      // Stripe webhook does for Growth. Only on the move onto a texting plan.
      ...(shouldEnableSmsOnPlanChange(org.plan, "pilot") ? { sms_enabled: true } : {}),
    })
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

  // S713: "Growth with Posting" from the Posting card sends with_posting=1.
  // Same checkout, one more line item. Only when the add-on price exists; the
  // webhook turns Posting on once Stripe says the subscription is paid for.
  const addonPriceId = postingAddonPriceId();
  const withPosting = String(formData.get("with_posting") ?? "") === "1";
  if (withPosting && !addonPriceId) redirect("/dashboard/billing?error=addon_not_configured");
  const lineItems: { price: string; quantity: number }[] = [{ price: priceId!, quantity: 1 }];
  if (withPosting && addonPriceId) lineItems.push({ price: addonPriceId, quantity: 1 });

  const session = await stripe!.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
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

// S731: the Founding 20 checkout. Growth with the founding coupon (50% off for
// 12 months) and a free period that starts at 90 days; the daily
// founding-trial job shortens it to 30 days after the first booked viewing.
// Card at checkout. Only for an account with a founding link that is not
// paying yet, and only while spots are left. Redirect-based like startCheckout.
export async function startFoundingCheckout(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_billing", "/dashboard/billing?forbidden=1");
  if (org.stripe_subscription_id || (org.plan ?? "free") !== "free") {
    redirect("/dashboard/billing?error=already_paid");
  }

  const supabase = createClient();
  const { data: srcRow } = await supabase
    .from("organizations")
    .select("signup_source")
    .eq("id", org.id)
    .maybeSingle();
  const channel = foundingChannel({
    param: String(formData.get("founding") ?? "") || null,
    signupSource: (srcRow as { signup_source?: unknown } | null)?.signup_source ?? null,
  });
  if (!channel) redirect("/dashboard/billing?error=founding_link");

  const stripe = getStripe();
  const priceId = priceIdForPlan("growth");
  if (!stripe || !priceId) redirect("/dashboard/billing?error=not_configured");

  // Spots: every founding subscription ever created counts, whatever its status.
  let used = 0;
  try {
    const found = await stripe!.subscriptions.search({
      query: `metadata['founding_offer']:'${FOUNDING20_OFFER}'`,
      limit: 100,
    });
    used = found.data.length;
  } catch (err) {
    console.error("[founding] spot count failed", err instanceof Error ? err.message : err);
    redirect("/dashboard/billing?error=checkout");
  }
  if (foundingSpotsLeft(used) < 1) redirect("/dashboard/billing?error=founding_full");

  // The coupon is made on first use, so there is no dashboard step.
  try {
    await stripe!.coupons.retrieve(FOUNDING20_COUPON_ID);
  } catch {
    await stripe!.coupons.create({
      id: FOUNDING20_COUPON_ID,
      name: "Founding 20: 50% off your first year",
      percent_off: FOUNDING20_PERCENT_OFF,
      duration: "repeating",
      duration_in_months: FOUNDING20_DISCOUNT_MONTHS,
    });
  }

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
    discounts: [{ coupon: FOUNDING20_COUPON_ID }],
    payment_method_collection: "always",
    subscription_data: {
      trial_end: foundingTrialCap(Math.floor(Date.now() / 1000)),
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      metadata: {
        org_id: org.id,
        founding_offer: FOUNDING20_OFFER,
        founding_channel: channel,
        founding_trial: "first_booking_plus_30_max_90",
      },
    },
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

// S713: add the Posting add-on (CA$49/mo) to an org's EXISTING paid
// subscription as a second item, prorated to the current period.
//
// We do NOT switch the flag on here. Stripe's customer.subscription.updated
// webhook (seconds later) sets posting_addon_active from the real subscription,
// through the same rule as every other event. That is the safe choice: the flag
// is an entitlement, so only Stripe's own record may grant it, and a
// signed-in owner cannot write it anyway (0244 guard trigger). The page says
// "switching on" until the webhook lands.
export async function addPostingAddon() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_billing", "/dashboard/billing?forbidden=1");

  const stripe = getStripe();
  const addonPriceId = postingAddonPriceId();
  if (!stripe || !addonPriceId) redirect("/dashboard/billing?error=addon_not_configured");
  // Needs a paid plan with a live subscription. Anyone else buys Growth with
  // Posting together at checkout (startCheckout with_posting=1).
  if (
    !isPaidPlan(org.plan) ||
    !org.stripe_subscription_id ||
    !subscriptionGrantsPlan(org.subscription_status)
  ) {
    redirect("/dashboard/billing?error=addon_needs_growth#posting-addon");
  }

  const access = await readRobotPostingAccess(createClient(), org.id);
  if (access.allowed) redirect("/dashboard/billing?addon=already#posting-addon");

  try {
    const sub = await stripe!.subscriptions.retrieve(org.stripe_subscription_id!);
    if (!subscriptionGrantsPlan(sub.status)) {
      redirect("/dashboard/billing?error=addon_needs_growth#posting-addon");
    }
    // Idempotent: a double click (or a webhook still in flight) must not add
    // a second CA$49 item.
    const already = itemForPrice(
      (sub.items?.data ?? []).map((it) => ({ id: it.id, price: { id: it.price?.id ?? null } })),
      addonPriceId,
    );
    if (!already) {
      await stripe!.subscriptionItems.create({
        subscription: sub.id,
        price: addonPriceId!,
        quantity: 1,
        proration_behavior: "create_prorations",
      });
    }
  } catch (err) {
    // redirect() throws a control-flow error; let it through.
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error("addPostingAddon: Stripe call failed", {
      organizationId: org.id,
      error: err instanceof Error ? err.message : String(err),
    });
    redirect("/dashboard/billing?error=addon#posting-addon");
  }
  redirect("/dashboard/billing?addon=added#posting-addon");
}

// S713: remove the Posting add-on. Deletes the subscription item (prorated
// credit); the webhook then switches the flag off. A grandfathered org has no
// item, so there is nothing to remove.
export async function removePostingAddon() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_billing", "/dashboard/billing?forbidden=1");

  const stripe = getStripe();
  if (!stripe) redirect("/dashboard/billing?error=addon_not_configured");
  const access = await readRobotPostingAccess(createClient(), org.id);
  if (!access.addonItemId) redirect("/dashboard/billing?addon=none#posting-addon");

  try {
    await stripe!.subscriptionItems.del(access.addonItemId!, {
      proration_behavior: "create_prorations",
    });
  } catch (err) {
    console.error("removePostingAddon: Stripe call failed", {
      organizationId: org.id,
      error: err instanceof Error ? err.message : String(err),
    });
    redirect("/dashboard/billing?error=addon#posting-addon");
  }
  redirect("/dashboard/billing?addon=removed#posting-addon");
}
