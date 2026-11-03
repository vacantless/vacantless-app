// lib/referral-credit-server.ts (S746b). The referral credit, impure half.
// Called from the Stripe webhook on invoice.paid. Never throws: a credit that
// fails must not make Stripe retry the whole event, so every outcome is returned
// for the log and the row is only stamped after both credits landed.
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  creditDescription,
  REFERRAL_CREDIT_CENTS,
  REFERRAL_CREDIT_CURRENCY,
  referralCreditDecision,
  type ReferralInviteRow,
} from "./referral-credit";

export type GrantOutcome =
  | { granted: true; inviteId: string; referrerOrgId: string; refereeOrgId: string }
  | { granted: false; reason: string };

type OrgRow = { id: string; name: string | null; stripe_customer_id: string | null };

async function readOrg(admin: SupabaseClient, orgId: string): Promise<OrgRow | null> {
  const { data } = await admin
    .from("organizations")
    .select("id, name, stripe_customer_id")
    .eq("id", orgId)
    .maybeSingle();
  return (data as OrgRow | null) ?? null;
}

/** The referrer may never have opened Billing; give them a customer so the credit has a home. */
async function customerFor(stripe: Stripe, admin: SupabaseClient, org: OrgRow): Promise<string> {
  if (org.stripe_customer_id) return org.stripe_customer_id;
  const customer = await stripe.customers.create({
    name: org.name ?? undefined,
    metadata: { org_id: org.id },
  });
  await admin.from("organizations").update({ stripe_customer_id: customer.id }).eq("id", org.id);
  return customer.id;
}

/**
 * Grant the two credits for a paid invoice, once. `refereeOrgId` is the org the
 * webhook already resolved for the subscription; `invoice` is the paid invoice.
 */
export async function grantReferralCredit(
  stripe: Stripe,
  admin: SupabaseClient,
  refereeOrgId: string,
  invoice: { amount_paid?: number | null },
): Promise<GrantOutcome> {
  try {
    const { data } = await admin
      .from("org_invites")
      .select("id, status, source, referred_by_org_id, provisioned_org_id, referral_credit_at")
      .eq("provisioned_org_id", refereeOrgId)
      .eq("source", "referral")
      .order("accepted_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const invite = (data as ReferralInviteRow | null) ?? null;

    const decision = referralCreditDecision({
      amountPaidCents: invoice.amount_paid,
      refereeOrgId,
      invite,
    });
    if (!decision.grant) return { granted: false, reason: decision.reason };

    const [referee, referrer] = await Promise.all([
      readOrg(admin, refereeOrgId),
      readOrg(admin, decision.referrerOrgId),
    ]);
    if (!referee || !referrer) return { granted: false, reason: "org_missing" };

    // Claim the row first so two near-simultaneous invoice events cannot both pay.
    const { data: claimed } = await admin
      .from("org_invites")
      .update({
        referral_credit_at: new Date().toISOString(),
        referral_credit_cents: REFERRAL_CREDIT_CENTS,
      })
      .eq("id", decision.inviteId)
      .is("referral_credit_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) return { granted: false, reason: "already_credited" };

    // Referee first. If this fails nothing has been paid, so release the claim
    // and let the next invoice event try again.
    try {
      const refereeCustomer = await customerFor(stripe, admin, referee);
      await stripe.customers.createBalanceTransaction(refereeCustomer, {
        amount: -REFERRAL_CREDIT_CENTS,
        currency: REFERRAL_CREDIT_CURRENCY,
        description: creditDescription("referee", referrer.name),
        metadata: { kind: "referral_credit", invite_id: decision.inviteId, side: "referee" },
      });
    } catch (err) {
      await admin
        .from("org_invites")
        .update({ referral_credit_at: null, referral_credit_cents: null })
        .eq("id", decision.inviteId);
      return { granted: false, reason: err instanceof Error ? err.message : "stripe_failed" };
    }

    // Referrer second. The referee is already paid, so the claim stays (never
    // pay the referee twice); a failure here is reported for a hand fix.
    try {
      const referrerCustomer = await customerFor(stripe, admin, referrer);
      await stripe.customers.createBalanceTransaction(referrerCustomer, {
        amount: -REFERRAL_CREDIT_CENTS,
        currency: REFERRAL_CREDIT_CURRENCY,
        description: creditDescription("referrer", referee.name),
        metadata: { kind: "referral_credit", invite_id: decision.inviteId, side: "referrer" },
      });
    } catch (err) {
      await admin
        .from("org_invites")
        .update({ notes: `referral credit: referrer side failed, ${err instanceof Error ? err.message : "stripe_failed"}` })
        .eq("id", decision.inviteId);
      return { granted: false, reason: "referrer_credit_failed" };
    }

    return {
      granted: true,
      inviteId: decision.inviteId,
      referrerOrgId: decision.referrerOrgId,
      refereeOrgId,
    };
  } catch (err) {
    return { granted: false, reason: err instanceof Error ? err.message : "exception" };
  }
}
