"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { getStripe } from "@/lib/stripe";
import {
  rentCapabilityRequest,
  normalizeConnectCountry,
  summarizeStripeAccount,
} from "@/lib/stripe-connect";

// Stripe Connect rent-collection actions (platform pivot step 2, ALT provider; S215).
//
// Sibling to rotessa-actions.ts. MODEL: STANDARD connected account + DIRECT
// charges — the LANDLORD is the merchant of record, funds settle to them, the
// platform never holds funds. We store only the connected account id + a cached
// status snapshot (NO secret key, NO bank numbers). The Stripe SDK is called
// directly here, exactly like billing/actions.ts; the pure mapping lives in
// lib/stripe-connect.ts.
//
// All actions guard on manage_rent (owner_admin + operator). Redirect-based, per
// the S170 Vercel-edge revalidate-503 WATCH.

const SETTINGS = "/dashboard/settings";

// Public base URL for Stripe onboarding return/refresh redirects. Matches
// billing/actions.ts; override with NEXT_PUBLIC_APP_URL in Vercel.
const APP_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app"
).replace(/\/+$/, "");

type ConnectRow = {
  connected_account_id: string;
  country: string | null;
};

// Load the org's existing Stripe Connect row (RLS-scoped), if any.
async function loadConnectRow(orgId: string): Promise<ConnectRow | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("stripe_connect_accounts")
    .select("connected_account_id, country")
    .eq("organization_id", orgId)
    .limit(1);
  return (data?.[0] as ConnectRow | undefined) ?? null;
}

// Persist a fresh status snapshot for an account id (insert or update). Pulled
// out so both the create flow and the explicit refresh write the same shape.
async function saveSnapshot(
  orgId: string,
  accountId: string,
  account: Parameters<typeof summarizeStripeAccount>[0],
) {
  const s = summarizeStripeAccount(account);
  const supabase = createClient();
  await supabase.from("stripe_connect_accounts").upsert(
    {
      organization_id: orgId,
      connected_account_id: accountId,
      country: s.country,
      charges_enabled: s.chargesEnabled,
      payouts_enabled: s.payoutsEnabled,
      details_submitted: s.detailsSubmitted,
      acss_status: s.acssStatus,
      ach_status: s.achStatus,
      onboarding_state: s.onboardingState,
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
}

// Start (or resume) Stripe Connect onboarding. Creates a Standard connected
// account on first use, requests both rent capabilities (acss_debit + ACH),
// persists the account id, then creates a single-use Account Link and redirects
// the landlord to Stripe's hosted onboarding. Returning lands back on Settings,
// where they hit "Refresh status".
export async function startStripeConnect(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rent", `${SETTINGS}?forbidden=1`);

  const stripe = getStripe();
  if (!stripe) redirect(`${SETTINGS}?stripeconnect=notconfigured#stripe-rent`);

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let row = await loadConnectRow(org.id);
  let accountId = row?.connected_account_id ?? null;

  // First time: create the connected account.
  if (!accountId) {
    const country = normalizeConnectCountry(String(formData.get("country") ?? "CA"));
    try {
      const account = await stripe!.accounts.create({
        type: "standard",
        country,
        email: user?.email || undefined,
        capabilities: rentCapabilityRequest(),
        metadata: { org_id: org.id },
      });
      accountId = account.id;
      await saveSnapshot(org.id, account.id, account);
    } catch {
      redirect(`${SETTINGS}?stripeconnect=createfail#stripe-rent`);
    }
  }

  // Create a single-use onboarding link and send them to Stripe.
  try {
    const link = await stripe!.accountLinks.create({
      account: accountId!,
      refresh_url: `${APP_BASE_URL}${SETTINGS}?stripeconnect=refresh#stripe-rent`,
      return_url: `${APP_BASE_URL}${SETTINGS}?stripeconnect=returned#stripe-rent`,
      type: "account_onboarding",
      collection_options: { fields: "eventually_due" },
    });
    if (!link.url) redirect(`${SETTINGS}?stripeconnect=linkfail#stripe-rent`);
    redirect(link.url);
  } catch (err) {
    // redirect() throws internally; re-throw so Next handles the navigation.
    if (err && typeof err === "object" && "digest" in err) throw err;
    redirect(`${SETTINGS}?stripeconnect=linkfail#stripe-rent`);
  }
}

// Refresh the cached status from Stripe (the connected account is the source of
// truth). Called after the landlord returns from onboarding.
export async function refreshStripeConnect() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rent", `${SETTINGS}?forbidden=1`);

  const stripe = getStripe();
  if (!stripe) redirect(`${SETTINGS}?stripeconnect=notconfigured#stripe-rent`);

  const row = await loadConnectRow(org.id);
  if (!row?.connected_account_id) redirect(`${SETTINGS}?stripeconnect=norow#stripe-rent`);

  try {
    const account = await stripe!.accounts.retrieve(row.connected_account_id);
    await saveSnapshot(org.id, row.connected_account_id, account);
  } catch {
    const supabase = createClient();
    await supabase
      .from("stripe_connect_accounts")
      .update({ last_error: "Couldn't reach Stripe to refresh status.", updated_at: new Date().toISOString() })
      .eq("organization_id", org.id);
    redirect(`${SETTINGS}?stripeconnect=syncfail#stripe-rent`);
  }

  redirect(`${SETTINGS}?stripeconnect=synced#stripe-rent`);
}

// Disconnect: remove our stored link to the connected account. The Stripe
// account itself (and any tenant authorizations) is untouched — this only
// severs Vacantless's stored connection.
export async function disconnectStripeConnect() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rent", `${SETTINGS}?forbidden=1`);

  const supabase = createClient();
  await supabase.from("stripe_connect_accounts").delete().eq("organization_id", org.id);

  redirect(`${SETTINGS}?stripeconnect=disconnected#stripe-rent`);
}
