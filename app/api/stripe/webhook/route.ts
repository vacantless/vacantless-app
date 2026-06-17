import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, priceMap } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { planForPriceId, subscriptionPeriodEndSeconds, shouldApplyStatus } from "@/lib/billing";
import {
  isRentReconcileEvent,
  rentStatusFromEvent,
  shouldApplyRentStatus,
  subscriptionIdOfInvoice,
} from "@/lib/stripe-connect";

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
// customer.subscription.updated, customer.subscription.deleted, charge.refunded
// (the last for the refundable pilot deposit).

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

// Record a paid pilot deposit on its org (one-time payment Checkout).
// Idempotent: a replayed event just re-writes the same paid state. Never
// un-refunds — if the org's deposit was already refunded, a late/duplicate
// completed event is ignored.
async function applyDepositPaid(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  session: Stripe.Checkout.Session,
) {
  const orgId =
    (session.metadata?.org_id as string | undefined) ||
    session.client_reference_id ||
    null;
  if (!orgId) return { matched: false as const };

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const { data: rows } = await admin
    .from("organizations")
    .select("pilot_deposit_status")
    .eq("id", orgId)
    .limit(1);
  const current = (rows?.[0]?.pilot_deposit_status as string | undefined) ?? "none";
  if (current === "refunded") return { matched: true as const, orgId, skipped: true };

  await admin
    .from("organizations")
    .update({
      pilot_deposit_status: "paid",
      pilot_deposit_payment_intent_id: paymentIntentId,
      pilot_deposit_amount_cents: session.amount_total ?? null,
      pilot_deposit_paid_at: new Date().toISOString(),
    })
    .eq("id", orgId);
  return { matched: true as const, orgId };
}

// Flip a paid deposit to 'refunded' when its charge is fully refunded. Matches
// the org by the stored PaymentIntent id. Order-independent (audit C4): it acts
// on any matched org whose deposit isn't already 'refunded', regardless of the
// current status string, so a refund event delivered out of order (e.g. after a
// later status write) can't leave the org stuck on 'paid'. Idempotent: a replay
// once 'refunded' is a no-op. A partial refund leaves the deposit 'paid'.
//
// Residual (acceptable): the PI id is only stored at deposit-paid time, so a
// refund delivered strictly BEFORE the deposit-paid write matches nothing. In
// practice the refund is a manual end-of-pilot action months after payment, so
// that ordering does not occur; if it ever did, re-driving the refund event
// (Stripe dashboard "resend") after the paid row lands resolves it.
async function applyDepositRefund(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  charge: Stripe.Charge,
) {
  const fullyRefunded =
    charge.refunded === true ||
    (typeof charge.amount_refunded === "number" &&
      typeof charge.amount === "number" &&
      charge.amount_refunded >= charge.amount &&
      charge.amount > 0);
  if (!fullyRefunded) return { matched: false as const };

  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;
  if (!paymentIntentId) return { matched: false as const };

  const { data: rows } = await admin
    .from("organizations")
    .select("id, pilot_deposit_status")
    .eq("pilot_deposit_payment_intent_id", paymentIntentId)
    .limit(1);
  const org = rows?.[0] as { id?: string; pilot_deposit_status?: string } | undefined;
  if (!org?.id) return { matched: false as const };
  // Already refunded: idempotent no-op (don't re-write).
  if (org.pilot_deposit_status === "refunded") {
    return { matched: true as const, orgId: org.id, skipped: true };
  }

  await admin
    .from("organizations")
    .update({ pilot_deposit_status: "refunded" })
    .eq("id", org.id);
  return { matched: true as const, orgId: org.id };
}

// ---------------------------------------------------------------------------
// Increment 4 — reconcile a CONNECTED-account (rent rail) event onto its
// tenancy. These events arrive with `event.account` set; the POST handler
// routes them here BEFORE the platform-billing switch so a rent event can never
// be misread as a platform event. We match the tenancy by stripe_subscription_id
// and write the rent status + synced_at via the service-role admin client (the
// webhook is not an RLS user session). Idempotent: every handler is a plain
// status UPSERT, so Stripe retries are harmless. The shouldApplyRentStatus
// guard stops a late invoice event from resurrecting a canceled subscription.
// ---------------------------------------------------------------------------
async function reconcileRent(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  event: Stripe.Event,
) {
  if (!isRentReconcileEvent(event.type)) return { matched: false as const, reason: "ignored" };

  // Resolve the subscription id + (for subscription events) its current status.
  let subscriptionId: string | null = null;
  let subStatus: string | null = null;
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    subscriptionId = typeof sub.id === "string" ? sub.id : null;
    subStatus = typeof sub.status === "string" ? sub.status : null;
  } else {
    // invoice.paid / invoice.payment_failed
    const invoice = event.data.object as Stripe.Invoice;
    subscriptionId = subscriptionIdOfInvoice(
      invoice as unknown as Parameters<typeof subscriptionIdOfInvoice>[0],
    );
  }
  if (!subscriptionId) return { matched: false as const, reason: "no_subscription_id" };

  const nextStatus = rentStatusFromEvent(event.type, subStatus);
  if (!nextStatus) return { matched: false as const, reason: "no_status" };

  const { data: rows } = await admin
    .from("tenancies")
    .select("id, stripe_subscription_status")
    .eq("stripe_subscription_id", subscriptionId)
    .limit(1);
  const tenancy = rows?.[0] as
    | { id?: string; stripe_subscription_status?: string | null }
    | undefined;
  if (!tenancy?.id) return { matched: false as const, reason: "no_tenancy" };

  // Don't let a straggling invoice event flip a terminal 'canceled' sub.
  if (!shouldApplyRentStatus(tenancy.stripe_subscription_status, event.type)) {
    return { matched: true as const, tenancyId: tenancy.id, skipped: true };
  }

  await admin
    .from("tenancies")
    .update({
      stripe_subscription_status: nextStatus,
      stripe_subscription_synced_at: new Date().toISOString(),
    })
    .eq("id", tenancy.id);
  return { matched: true as const, tenancyId: tenancy.id, status: nextStatus };
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  // Two webhook surfaces, two destinations, two signing secrets:
  //   STRIPE_WEBHOOK_SECRET          — the PLATFORM "Your account" destination
  //                                    (org billing: checkout, subscriptions).
  //   STRIPE_CONNECT_WEBHOOK_SECRET  — the CONNECTED-accounts destination
  //                                    (the rent rail: per-landlord acct events).
  // Stripe signs each destination's payloads with that destination's own secret,
  // so we try each configured secret in turn (constructEvent throws on a secret
  // mismatch). Connect secret is OPTIONAL — if unset we behave exactly as before
  // (platform-only), so this stays backward compatible until the connect
  // destination is created + its secret added to env.
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ].filter((s): s is string => !!s);
  if (!stripe || secrets.length === 0) {
    // Not configured yet — acknowledge so Stripe doesn't disable the endpoint.
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 200 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ ok: false, reason: "no_signature" }, { status: 400 });
  }

  let event: Stripe.Event | null = null;
  let lastError = "invalid signature";
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(body, sig, secret);
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "invalid signature";
    }
  }
  if (!event) {
    return NextResponse.json({ ok: false, reason: `bad_signature:${lastError}` }, { status: 400 });
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
    // CONNECTED-account (rent rail) events carry event.account (the acct_... id).
    // They are a different surface from the PLATFORM billing events below (org
    // plans, no event.account), so route them to tenancy reconciliation and
    // return BEFORE the platform switch — a rent event must never be read as a
    // platform-billing event.
    if (event.account) {
      const r = await reconcileRent(admin, event);
      return NextResponse.json(
        { ok: true, type: event.type, account: event.account, rent: r },
        { status: 200 },
      );
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // The one-time pilot deposit is recognized SOLELY by its stamped kind
        // (audit C3). startDepositCheckout always sets metadata.kind='pilot_deposit'
        // on the session, so this is precise; a future one-time payment Checkout
        // for anything else won't be misrouted to applyDepositPaid (it would fall
        // through, find no subscription, and be a harmless no-op).
        if (session.metadata?.kind === "pilot_deposit") {
          await applyDepositPaid(admin, session);
          break;
        }
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
      case "charge.refunded": {
        await applyDepositRefund(admin, event.data.object as Stripe.Charge);
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
