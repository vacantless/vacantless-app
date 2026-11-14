// Server-only: stop a tenancy's Stripe rent subscription, and read its payment
// summary (S796). Shared by the "Stop monthly rent" action and by End tenancy,
// so ending a tenancy can never leave a live monthly debit behind.
//
// NEVER import this into a client component.

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";
import {
  planRentStop,
  summarizeRentPayments,
  subscriptionIsLive,
  decideScheduledRentStop,
  upcomingChargeDates,
  type RentPaymentSummary,
} from "@/lib/stripe-connect";

export type StopRentResult =
  | { ok: true; stopped: boolean }
  | { ok: false; code: "notconfigured" | "notconnected" | "stopfail"; reason?: string };

type StopRow = {
  id: string;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  stripe_subscription_schedule_id: string | null;
};

function errReason(err: unknown): string {
  const r =
    err && typeof err === "object"
      ? ((err as { message?: string }).message ?? (err as { raw?: { message?: string } }).raw?.message)
      : String(err);
  return String(r || "unknown error").slice(0, 300);
}

/**
 * Cancel the tenancy's live Stripe rent subscription right away (no final
 * invoice, no proration: rent is a flat monthly amount). The bank
 * authorization and saved payment method are kept, so rent can be restarted
 * without the tenant authorizing again.
 *
 * `supabase` is the caller's RLS-scoped client, so the tenancy read and write
 * stay inside the signed-in org. Returns stopped:false when there was nothing
 * live to stop. Verifies with Stripe before writing "canceled": if the cancel
 * call errors but Stripe already shows the subscription canceled, that counts
 * as stopped.
 */
export async function stopTenancyStripeRent(
  supabase: SupabaseClient,
  orgId: string,
  tenancyId: string,
): Promise<StopRentResult> {
  const { data: tData } = await supabase
    .from("tenancies")
    .select("id, stripe_subscription_id, stripe_subscription_status, stripe_subscription_schedule_id")
    .eq("id", tenancyId)
    .maybeSingle();
  const tenancy = tData as StopRow | null;
  if (!tenancy) return { ok: true, stopped: false };

  const plan = planRentStop({
    subscriptionId: tenancy.stripe_subscription_id,
    subscriptionStatus: tenancy.stripe_subscription_status,
    scheduleId: tenancy.stripe_subscription_schedule_id,
  });
  if (plan === "none") return { ok: true, stopped: false };

  const stripe = getStripe();
  if (!stripe) return { ok: false, code: "notconfigured" };

  const { data: cData } = await supabase
    .from("stripe_connect_accounts")
    .select("connected_account_id")
    .eq("organization_id", orgId)
    .limit(1);
  const stripeAccount = (cData?.[0] as { connected_account_id: string } | undefined)?.connected_account_id;
  if (!stripeAccount) return { ok: false, code: "notconnected" };

  const subId = tenancy.stripe_subscription_id!;
  let lastErr: unknown = null;

  if (plan === "cancel_schedule_then_subscription") {
    try {
      await stripe.subscriptionSchedules.cancel(
        tenancy.stripe_subscription_schedule_id!,
        { invoice_now: false, prorate: false },
        { stripeAccount },
      );
    } catch (err) {
      // Already released or canceled schedule: fall through to the direct cancel.
      lastErr = err;
    }
  }

  let canceled = false;
  try {
    const sub = await stripe.subscriptions.retrieve(subId, { stripeAccount });
    if (sub.status === "canceled") {
      canceled = true;
    } else {
      const done = await stripe.subscriptions.cancel(
        subId,
        { invoice_now: false, prorate: false },
        { stripeAccount },
      );
      canceled = done.status === "canceled";
    }
  } catch (err) {
    lastErr = err;
    try {
      const again = await stripe.subscriptions.retrieve(subId, { stripeAccount });
      canceled = again.status === "canceled";
    } catch (err2) {
      lastErr = err2;
    }
  }

  if (!canceled) {
    const reason = errReason(lastErr);
    console.error("[stripe-rent] stop failed:", reason, lastErr);
    return { ok: false, code: "stopfail", reason };
  }

  const now = new Date().toISOString();
  await supabase
    .from("tenancies")
    .update({
      stripe_subscription_status: "canceled",
      stripe_subscription_synced_at: now,
      stripe_subscription_schedule_id: null,
      stripe_rent_amount_synced_cents: null,
      stripe_rent_amount_synced_at: null,
      rent_stop_after: null,
      updated_at: now,
    })
    .eq("id", tenancyId);
  return { ok: true, stopped: true };
}

/**
 * Next debit date and last real debit for a tenancy's rent subscription, read
 * live from Stripe. Returns null on any failure so the page still renders.
 */
export async function fetchRentPaymentSummary(
  stripeAccount: string | null | undefined,
  subscriptionId: string | null | undefined,
): Promise<RentPaymentSummary | null> {
  const stripe = getStripe();
  if (!stripe || !stripeAccount || !subscriptionId) return null;
  try {
    const [sub, invoices] = await Promise.all([
      stripe.subscriptions.retrieve(subscriptionId, { stripeAccount }),
      stripe.invoices.list({ subscription: subscriptionId, limit: 6 }, { stripeAccount }),
    ]);
    return summarizeRentPayments(
      sub as unknown as Parameters<typeof summarizeRentPayments>[0],
      (invoices.data ?? []) as unknown as Stripe.Invoice[] as unknown as Parameters<typeof summarizeRentPayments>[1],
    );
  } catch (err) {
    console.error("[stripe-rent] payment summary failed:", errReason(err));
    return null;
  }
}

export type ScheduleStopResult =
  | { ok: true; dateIso: string }
  | { ok: false; code: "nolive" | "notconnected" | "nonext" | "badlastdate" };

/**
 * S796b/c: schedule the stop for after a chosen LAST payment. The upcoming
 * payment dates are read from Stripe; the chosen date must be one of them
 * (never trusted from the form). No date = the next payment. Stored as
 * rent_stop_after. Nothing changes at Stripe: the rent-stop sweep cancels the
 * debit once that payment clears.
 */
export async function scheduleTenancyRentStopAfterNext(
  supabase: SupabaseClient,
  orgId: string,
  tenancyId: string,
  chosenIso?: string | null,
): Promise<ScheduleStopResult> {
  const { data: tData } = await supabase
    .from("tenancies")
    .select("id, stripe_subscription_id, stripe_subscription_status")
    .eq("id", tenancyId)
    .maybeSingle();
  const tenancy = tData as {
    id: string;
    stripe_subscription_id: string | null;
    stripe_subscription_status: string | null;
  } | null;
  if (!tenancy?.stripe_subscription_id || !subscriptionIsLive(tenancy.stripe_subscription_status)) {
    return { ok: false, code: "nolive" };
  }
  const { data: cData } = await supabase
    .from("stripe_connect_accounts")
    .select("connected_account_id")
    .eq("organization_id", orgId)
    .limit(1);
  const stripeAccount = (cData?.[0] as { connected_account_id: string } | undefined)?.connected_account_id;
  if (!stripeAccount) return { ok: false, code: "notconnected" };

  const summary = await fetchRentPaymentSummary(stripeAccount, tenancy.stripe_subscription_id);
  if (!summary?.nextChargeIso) return { ok: false, code: "nonext" };

  const wanted = (chosenIso ?? "").trim() || summary.nextChargeIso;
  const allowed = upcomingChargeDates(summary.nextChargeIso, summary.anchorDay, 24);
  if (!allowed.includes(wanted)) return { ok: false, code: "badlastdate" };

  const { error } = await supabase
    .from("tenancies")
    .update({ rent_stop_after: wanted, updated_at: new Date().toISOString() })
    .eq("id", tenancyId);
  if (error) return { ok: false, code: "nonext" };
  return { ok: true, dateIso: wanted };
}

/**
 * S796b sweep: carry out scheduled "stop after the last payment" stops.
 * Service-role client (no signed-in user). Safe to run twice: a stopped
 * tenancy has rent_stop_after cleared.
 */
export async function runScheduledRentStops(opts: { admin: SupabaseClient; todayIso?: string }) {
  const todayIso = opts.todayIso ?? new Date().toISOString().slice(0, 10);
  const out = { ok: true, checked: 0, stopped: 0, waiting: 0, cleared: 0, failed: 0 };
  const { data, error } = await opts.admin
    .from("tenancies")
    .select("id, organization_id, rent_stop_after, stripe_subscription_id, stripe_subscription_status")
    .not("rent_stop_after", "is", null)
    .limit(100);
  if (error) return { ...out, ok: false, error: error.message };
  type Row = {
    id: string;
    organization_id: string;
    rent_stop_after: string;
    stripe_subscription_id: string | null;
    stripe_subscription_status: string | null;
  };
  for (const row of (data ?? []) as Row[]) {
    out.checked++;
    if (!row.stripe_subscription_id || !subscriptionIsLive(row.stripe_subscription_status)) {
      // Nothing live any more (stopped by hand, or canceled at Stripe).
      await opts.admin.from("tenancies").update({ rent_stop_after: null }).eq("id", row.id);
      out.cleared++;
      continue;
    }
    const { data: cData } = await opts.admin
      .from("stripe_connect_accounts")
      .select("connected_account_id")
      .eq("organization_id", row.organization_id)
      .limit(1);
    const stripeAccount = (cData?.[0] as { connected_account_id: string } | undefined)?.connected_account_id;
    const summary = await fetchRentPaymentSummary(stripeAccount, row.stripe_subscription_id);
    const decision = decideScheduledRentStop({
      stopAfterIso: row.rent_stop_after,
      todayIso,
      nextChargeIso: summary?.nextChargeIso ?? null,
      lastPaymentIso: summary?.lastPaymentIso ?? null,
      lastPaymentState: summary?.lastPaymentState ?? null,
    });
    if (!decision.stop) {
      out.waiting++;
      continue;
    }
    const result = await stopTenancyStripeRent(opts.admin, row.organization_id, row.id);
    if (result.ok) {
      out.stopped++;
      console.log("[rent-stop] stopped", row.id, decision.reason);
    } else {
      out.failed++;
      out.ok = false;
      console.error("[rent-stop] stop failed", row.id, result.code, result.reason ?? "");
    }
  }
  return out;
}
