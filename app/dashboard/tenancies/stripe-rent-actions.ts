"use server";

import type Stripe from "stripe";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { getStripe } from "@/lib/stripe";
import {
  validateStripeTenant,
  buildCustomerCreateParams,
  buildSetupSessionParams,
  parseSetupSession,
  validateRentSubscriptionPrereqs,
  buildSubscriptionParams,
  parseSubscription,
  isoToUnixSeconds,
} from "@/lib/stripe-connect";
import { isValidProcessDate } from "@/lib/rotessa";

// Stripe Connect rent mandate actions for a tenancy (platform pivot step 2,
// ALT provider, increment 2; S215). Sibling of rotessa-actions.ts.
//
// Collects a PAD/ACH mandate from the tenancy's PRIMARY tenant on the
// LANDLORD's connected account (all Stripe calls carry the Stripe-Account
// header = direct charges; the tenant authorizes the landlord directly). We
// store only Stripe identifiers + a mandate status — never bank numbers.
// Guarded on manage_rent (owner_admin + operator). REDIRECT-based (S170 WATCH).

const APP_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app"
).replace(/\/+$/, "");

function tenancyPath(id: string): string {
  return `/dashboard/tenancies/${id}`;
}

type PrimaryTenant = { name: string | null; email: string | null; phone: string | null };
type TenancyRow = {
  id: string;
  stripe_customer_id: string | null;
  stripe_setup_session_id: string | null;
  tenants: PrimaryTenant[];
};

// Start (or restart) tenant bank authorization: ensure a Stripe customer on the
// connected account, create a hosted Checkout SETUP session for the right
// bank-debit method, store the references, and redirect to the hosted URL. The
// operator can complete it as a walkthrough or copy the URL to send the tenant.
export async function startStripeRentMandate(formData: FormData) {
  const tenancyId = String(formData.get("tenancy_id") ?? "").trim();
  if (!tenancyId) redirect("/dashboard/tenancies");

  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rent", `${tenancyPath(tenancyId)}?striperent=forbidden`);

  const stripe = getStripe();
  if (!stripe) redirect(`${tenancyPath(tenancyId)}?striperent=notconfigured`);

  const supabase = createClient();

  // The org's connected account must be onboarded + able to charge.
  const { data: cData } = await supabase
    .from("stripe_connect_accounts")
    .select("connected_account_id, country, charges_enabled")
    .eq("organization_id", org.id)
    .limit(1);
  const connect = cData?.[0] as
    | { connected_account_id: string; country: string | null; charges_enabled: boolean }
    | undefined;
  if (!connect?.connected_account_id) redirect(`${tenancyPath(tenancyId)}?striperent=notconnected`);
  if (!connect.charges_enabled) redirect(`${tenancyPath(tenancyId)}?striperent=notready`);

  // Tenancy + primary tenant (RLS scopes to this org).
  const { data: tData } = await supabase
    .from("tenancies")
    .select("id, stripe_customer_id, stripe_setup_session_id, tenants!inner(name, email, phone, is_primary)")
    .eq("id", tenancyId)
    .eq("tenants.is_primary", true)
    .maybeSingle();
  const tenancy = tData as unknown as TenancyRow | null;
  if (!tenancy) redirect(`${tenancyPath(tenancyId)}?striperent=noprimary`);

  const primary = tenancy.tenants?.[0];
  const check = validateStripeTenant({ name: primary?.name, email: primary?.email, phone: primary?.phone });
  if (!check.ok) {
    const code = !primary?.email ? "noemail" : "noname";
    redirect(`${tenancyPath(tenancyId)}?striperent=${code}`);
  }
  // `check` is the ok branch past this point.
  const tenant = check.ok ? check.value : null!;

  const stripeAccount = connect.connected_account_id;

  try {
    // Reuse an existing customer on the connected account, else create one.
    let customerId = tenancy.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe!.customers.create(
        buildCustomerCreateParams(tenant, tenancyId),
        { stripeAccount },
      );
      customerId = customer.id;
    }

    const session = await stripe!.checkout.sessions.create(
      buildSetupSessionParams({
        country: connect.country,
        customerId: customerId!,
        successUrl: `${APP_BASE_URL}/rent-authorized`,
        cancelUrl: `${APP_BASE_URL}/rent-authorized?canceled=1`,
      }),
      { stripeAccount },
    );

    await supabase
      .from("tenancies")
      .update({
        stripe_customer_id: customerId,
        stripe_setup_session_id: session.id,
        stripe_mandate_status: "pending",
        stripe_rent_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenancyId);

    if (!session.url) redirect(`${tenancyPath(tenancyId)}?striperent=linkfail`);
    redirect(session.url);
  } catch (err) {
    // redirect() throws a special digest error — re-throw so Next navigates.
    if (err && typeof err === "object" && "digest" in err) throw err;
    redirect(`${tenancyPath(tenancyId)}?striperent=createfail`);
  }
}

// Refresh the mandate status: re-read the setup session (with its SetupIntent)
// on the connected account and store the resulting payment method + status.
export async function refreshStripeRentMandate(formData: FormData) {
  const tenancyId = String(formData.get("tenancy_id") ?? "").trim();
  if (!tenancyId) redirect("/dashboard/tenancies");

  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rent", `${tenancyPath(tenancyId)}?striperent=forbidden`);

  const stripe = getStripe();
  if (!stripe) redirect(`${tenancyPath(tenancyId)}?striperent=notconfigured`);

  const supabase = createClient();

  const { data: cData } = await supabase
    .from("stripe_connect_accounts")
    .select("connected_account_id")
    .eq("organization_id", org.id)
    .limit(1);
  const stripeAccount = (cData?.[0] as { connected_account_id: string } | undefined)?.connected_account_id;
  if (!stripeAccount) redirect(`${tenancyPath(tenancyId)}?striperent=notconnected`);

  const { data: tData } = await supabase
    .from("tenancies")
    .select("id, stripe_setup_session_id")
    .eq("id", tenancyId)
    .maybeSingle();
  const tenancy = tData as { id: string; stripe_setup_session_id: string | null } | null;
  if (!tenancy?.stripe_setup_session_id) redirect(`${tenancyPath(tenancyId)}?striperent=nosession`);

  try {
    const session = await stripe!.checkout.sessions.retrieve(
      tenancy.stripe_setup_session_id,
      { expand: ["setup_intent"] },
      { stripeAccount },
    );
    const parsed = parseSetupSession(session as Parameters<typeof parseSetupSession>[0]);
    if (!parsed.ok) redirect(`${tenancyPath(tenancyId)}?striperent=syncfail`);

    await supabase
      .from("tenancies")
      .update({
        stripe_payment_method_id: parsed.paymentMethodId,
        stripe_mandate_status: parsed.mandateStatus,
        stripe_rent_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenancyId);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    redirect(`${tenancyPath(tenancyId)}?striperent=syncfail`);
  }

  revalidatePath(tenancyPath(tenancyId));
  redirect(`${tenancyPath(tenancyId)}?striperent=synced`);
}

// ===========================================================================
// Increment 3 — create a monthly rent subscription off the saved payment
// method. Requires an active mandate (increment 2) + a rent amount. Idempotent
// on stripe_subscription_id. Bills the tenant monthly at the tenancy rent,
// starting on the chosen first-charge date.
// ===========================================================================

type SubTenancyRow = {
  id: string;
  rent_cents: number | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  stripe_mandate_status: string | null;
  stripe_subscription_id: string | null;
};

export async function createStripeRentSubscription(formData: FormData) {
  const tenancyId = String(formData.get("tenancy_id") ?? "").trim();
  if (!tenancyId) redirect("/dashboard/tenancies");
  const firstChargeIso = String(formData.get("first_charge_date") ?? "").trim();

  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rent", `${tenancyPath(tenancyId)}?striperent=forbidden`);

  const stripe = getStripe();
  if (!stripe) redirect(`${tenancyPath(tenancyId)}?striperent=notconfigured`);

  const supabase = createClient();

  const { data: cData } = await supabase
    .from("stripe_connect_accounts")
    .select("connected_account_id, country, charges_enabled")
    .eq("organization_id", org.id)
    .limit(1);
  const connect = cData?.[0] as
    | { connected_account_id: string; country: string | null; charges_enabled: boolean }
    | undefined;
  if (!connect?.connected_account_id) redirect(`${tenancyPath(tenancyId)}?striperent=notconnected`);
  if (!connect.charges_enabled) redirect(`${tenancyPath(tenancyId)}?striperent=notready`);

  const { data: tData } = await supabase
    .from("tenancies")
    .select("id, rent_cents, stripe_customer_id, stripe_payment_method_id, stripe_mandate_status, stripe_subscription_id")
    .eq("id", tenancyId)
    .maybeSingle();
  const tenancy = tData as SubTenancyRow | null;
  if (!tenancy) redirect("/dashboard/tenancies");
  if (tenancy.stripe_subscription_id) redirect(`${tenancyPath(tenancyId)}?striperent=subalready`);
  if (!tenancy.stripe_customer_id) redirect(`${tenancyPath(tenancyId)}?striperent=nocustomer`);

  const prereq = validateRentSubscriptionPrereqs({
    mandateStatus: tenancy.stripe_mandate_status,
    paymentMethodId: tenancy.stripe_payment_method_id,
    amountCents: tenancy.rent_cents,
  });
  if (!prereq.ok) {
    const code = prereq.code === "no_mandate" ? "nomandate" : prereq.code === "no_rent" ? "norent" : "nopm";
    redirect(`${tenancyPath(tenancyId)}?striperent=${code}`);
  }
  // past this point prereq is the ok branch
  const ok = prereq.ok ? prereq : null!;

  // First-charge date: must be at least 2 business days out (same rule as the
  // Rotessa rail). Convert to a future billing_cycle_anchor.
  const todayIso = new Date().toISOString().slice(0, 10);
  if (!isValidProcessDate(firstChargeIso, todayIso)) {
    redirect(`${tenancyPath(tenancyId)}?striperent=baddate`);
  }
  const anchorUnix = isoToUnixSeconds(firstChargeIso);

  try {
    // Subscription items' price_data needs an existing Product id (inline
    // product_data is rejected by the Subscriptions API), so create a rent
    // Product on the connected account first.
    const product = await stripe!.products.create(
      { name: "Monthly rent", metadata: { source: "vacantless_rent", tenancy_id: tenancyId } },
      { stripeAccount: connect.connected_account_id },
    );
    const sub = await stripe!.subscriptions.create(
      buildSubscriptionParams({
        customerId: tenancy.stripe_customer_id!,
        paymentMethodId: ok.paymentMethodId,
        productId: product.id,
        country: connect.country,
        amountCents: ok.amountCents,
        anchorUnix,
      }) as unknown as Stripe.SubscriptionCreateParams,
      { stripeAccount: connect.connected_account_id },
    );
    const parsed = parseSubscription(sub as Parameters<typeof parseSubscription>[0]);
    if (!parsed.ok) redirect(`${tenancyPath(tenancyId)}?striperent=subfail`);

    await supabase
      .from("tenancies")
      .update({
        stripe_subscription_id: parsed.subscriptionId,
        stripe_subscription_status: parsed.status,
        stripe_subscription_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenancyId);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    // Surface the real Stripe error instead of swallowing it (S216 pattern):
    // log it server-side AND pass a short reason to the page via the redirect.
    const reason =
      (err && typeof err === "object"
        ? ((err as { message?: string }).message ??
            (err as { raw?: { message?: string } }).raw?.message)
        : String(err)) || "unknown error";
    console.error("[stripe-rent] subscriptions.create failed:", reason, err);
    redirect(
      `${tenancyPath(tenancyId)}?striperent=subfail&reason=${encodeURIComponent(
        String(reason).slice(0, 300),
      )}`,
    );
  }

  revalidatePath(tenancyPath(tenancyId));
  redirect(`${tenancyPath(tenancyId)}?striperent=subscribed`);
}

// Refresh the subscription status from Stripe (until the webhook reconciliation
// in increment 4, this is the manual pull).
export async function refreshStripeRentSubscription(formData: FormData) {
  const tenancyId = String(formData.get("tenancy_id") ?? "").trim();
  if (!tenancyId) redirect("/dashboard/tenancies");

  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rent", `${tenancyPath(tenancyId)}?striperent=forbidden`);

  const stripe = getStripe();
  if (!stripe) redirect(`${tenancyPath(tenancyId)}?striperent=notconfigured`);

  const supabase = createClient();

  const { data: cData } = await supabase
    .from("stripe_connect_accounts")
    .select("connected_account_id")
    .eq("organization_id", org.id)
    .limit(1);
  const stripeAccount = (cData?.[0] as { connected_account_id: string } | undefined)?.connected_account_id;
  if (!stripeAccount) redirect(`${tenancyPath(tenancyId)}?striperent=notconnected`);

  const { data: tData } = await supabase
    .from("tenancies")
    .select("id, stripe_subscription_id")
    .eq("id", tenancyId)
    .maybeSingle();
  const tenancy = tData as { id: string; stripe_subscription_id: string | null } | null;
  if (!tenancy?.stripe_subscription_id) redirect(`${tenancyPath(tenancyId)}?striperent=nosub`);

  try {
    const sub = await stripe!.subscriptions.retrieve(tenancy.stripe_subscription_id, { stripeAccount });
    const parsed = parseSubscription(sub as Parameters<typeof parseSubscription>[0]);
    if (!parsed.ok) redirect(`${tenancyPath(tenancyId)}?striperent=syncfail`);

    await supabase
      .from("tenancies")
      .update({
        stripe_subscription_status: parsed.status,
        stripe_subscription_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenancyId);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    redirect(`${tenancyPath(tenancyId)}?striperent=syncfail`);
  }

  revalidatePath(tenancyPath(tenancyId));
  redirect(`${tenancyPath(tenancyId)}?striperent=subsynced`);
}
