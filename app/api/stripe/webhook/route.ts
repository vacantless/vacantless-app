import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, priceMap } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { planForPriceId, subscriptionPeriodEndSeconds, shouldApplyStatus } from "@/lib/billing";

// Stripe webhook (M4 billing). Keeps each org's plan / subscription_status /
// current_period_end in sync with Stripe as the source of truth.
//
// Verifies the Stripe signature with STRIPE_WEBHOOK_SECRET, then on the
// subscription lifecycle events updates the org row via the SERVICE-ROLE admin
// client (the webhook is not an authenticated user session, so it can't use the
// RLS client). Idempotent: every handler is a plain UPSERT of the current
// state, so Stripe retries are harmless.
//
// Set the endpoint in Stripe → Developers → Webhooks to:
//   https://vacantless-app.vercel.app/api/stripe/webhook
// listening for: checkout.session.completed, customer.subscription.created,
// customer.subscription.updated, customer.subscription.deleted.

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // Stripe signature verification needs Node crypto

function customerIdOf(sub: Stripe.Subscription): string | null {
  return typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
}

// Apply a subscription's state to its org. `ended` is the cancellation path
// (subscription.deleted): drop the tier back to trial and clear the sub fields.
async function applySubscription(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  sub: Stripe.Subscription,
  ended: boolean,
) {
  const customerId = customerIdOf(sub);

  // Resolve the org: prefer the metadata stamped at checkout, else match the
  // Stripe customer id we stored.
  let orgId = (sub.metadata?.org_id as string | undefined) || null;
  if (!orgId && customerId) {
    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .limit(1);
    orgId = data?.[0]?.id ?? null;
  }
  if (!orgId) return { matched: false as const };

  if (ended) {
    await admin
      .from("organizations")
      .update({
        plan: "trial",
        subscription_status: "canceled",
        stripe_subscription_id: null,
        current_period_end: null,
      })
      .eq("id", orgId);
    return { matched: true as const, orgId, plan: "trial" };
  }

  // Read the org's current billing state so a stale, out-of-order `incomplete`
  // event can't clobber a subscription that has already advanced past it.
  const { data: existingRows } = await admin
    .from("organizations")
    .select("subscription_status, stripe_subscription_id")
    .eq("id", orgId)
    .limit(1);
  const existing = (existingRows?.[0] ?? {}) as {
    subscription_status?: string | null;
    stripe_subscription_id?: string | null;
  };

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const tier = planForPriceId(priceId, priceMap());
  // stripe v17 types lag the dahlia runtime, where current_period_end moved onto
  // the subscription item; cast so we can read it without fighting stale types.
  const periodEndSec = subscriptionPeriodEndSeconds(
    sub as unknown as Parameters<typeof subscriptionPeriodEndSeconds>[0],
  );

  const update: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
  };
  // Only write a period end when we actually have one, so a stale event with a
  // missing value can't wipe a good date (the cancel path nulls it explicitly).
  if (periodEndSec != null) {
    update.current_period_end = new Date(periodEndSec * 1000).toISOString();
  }
  if (customerId) update.stripe_customer_id = customerId;
  // Only set the tier when we recognize the price — an unknown price must not
  // wipe an existing plan.
  if (tier) update.plan = tier;
  // Apply the status unless it's a stale `incomplete` for a sub that already
  // advanced (see shouldApplyStatus).
  if (
    shouldApplyStatus(
      sub.status,
      existing.subscription_status,
      existing.stripe_subscription_id === sub.id,
    )
  ) {
    update.subscription_status = sub.status;
  }

  await admin.from("organizations").update(update).eq("id", orgId);
  return { matched: true as const, orgId, plan: tier ?? "(unchanged)" };
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    // Not configured yet — acknowledge so Stripe doesn't disable the endpoint.
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 200 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ ok: false, reason: "no_signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid signature";
    return NextResponse.json({ ok: false, reason: `bad_signature:${message}` }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    // Verified but we can't write — surface it (Stripe will retry).
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured" },
      { status: 500 },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          // Carry the org id from the checkout session if the sub lacks it.
          if (!sub.metadata?.org_id && session.client_reference_id) {
            sub.metadata = { ...(sub.metadata ?? {}), org_id: session.client_reference_id };
          }
          await applySubscription(admin, sub, false);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        await applySubscription(admin, event.data.object as Stripe.Subscription, false);
        break;
      }
      case "customer.subscription.deleted": {
        await applySubscription(admin, event.data.object as Stripe.Subscription, true);
        break;
      }
      default:
        // Ignore everything else; acknowledge so Stripe stops retrying.
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "handler_error";
    return NextResponse.json({ ok: false, reason: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, type: event.type }, { status: 200 });
}
