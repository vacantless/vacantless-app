"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { planEntitlements } from "@/lib/billing";
import { providerForPlan, filterNewTransactions } from "@/lib/bank-feed";
import { getBankFeedProvider } from "@/lib/bank-feed/plaid";
import { validateExpenseInput } from "@/lib/expenses";

// Bank-feed + expense triage actions (bank-feed module, Slice 2b — see
// VACANTLESS-BANK-FEED-DECISION-2026-06-22.md).
//
// The aggregator (Plaid for Growth, Flinks for Premium) is reached only through
// the lib/bank-feed seam; this file never imports the Plaid SDK directly except
// via the factory. We connect read-only accounts, stage transactions, and let
// the owner triage a debit into an `expenses` row — we never move money.
//
// Gating: every action requires the manage_work_orders capability AND the org's
// plan must route to a live provider (providerForPlan != null). The bank PULL +
// the access-token read/write run through the service-role admin client because
// bank_connection_secrets has NO authenticated grant (migration 0058).

const BASE = "/dashboard/expenses";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
function orNull(formData: FormData, name: string): string | null {
  const v = s(formData, name);
  return v === "" ? null : v;
}

// 90 days back, ISO date — the default first-pull window (Plaid often caps here).
function ninetyDaysAgoIso(): string {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Resolve the org's live provider key, or null if its plan has no live feed.
async function liveProviderKey(): Promise<"plaid" | "flinks" | null> {
  const org = await getCurrentOrg();
  if (!org) return null;
  return providerForPlan(planEntitlements(org.plan));
}

// --- Connect: mint a Plaid Link token (called by the client connect button) ---
// Returns a plain object (not a redirect) because the browser needs the token to
// open Plaid Link. Still capability-guarded.
export async function createPlaidLinkToken(): Promise<
  { ok: true; linkToken: string } | { ok: false; error: string }
> {
  await requireCapability("manage_work_orders", `${BASE}?bank=forbidden`);
  const org = await getCurrentOrg();
  if (!org) return { ok: false, error: "No organization." };

  const provider = providerForPlan(planEntitlements(org.plan));
  if (provider !== "plaid") {
    return { ok: false, error: "Bank sync isn't available on this plan." };
  }
  try {
    const handoff = await getBankFeedProvider("plaid").startConnect(org.id);
    return { ok: true, linkToken: handoff.token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not start bank connect." };
  }
}

// --- Connect: exchange the Plaid public_token, store the connection + secret ---
// Called from Plaid Link's onSuccess. Stores the durable connection (RLS-scoped)
// and its access token (service-role only), then does a first sync.
export async function exchangePublicToken(
  publicToken: string,
): Promise<{ ok: true; synced: number } | { ok: false; error: string }> {
  await requireCapability("manage_work_orders", `${BASE}?bank=forbidden`);
  const org = await getCurrentOrg();
  if (!org) return { ok: false, error: "No organization." };
  if (providerForPlan(planEntitlements(org.plan)) !== "plaid") {
    return { ok: false, error: "Bank sync isn't available on this plan." };
  }
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Server is not configured for bank sync." };

  let exchanged;
  try {
    exchanged = await getBankFeedProvider("plaid").completeConnect(publicToken);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bank connect failed." };
  }

  const supabase = createClient();
  // Upsert the connection (re-link of the same item updates in place).
  const { data: conn, error: connErr } = await supabase
    .from("bank_connections")
    .upsert(
      {
        organization_id: org.id,
        provider: "plaid",
        external_id: exchanged.externalId,
        institution_name: exchanged.institutionName,
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,provider,external_id" },
    )
    .select("id")
    .single();
  if (connErr || !conn) {
    return { ok: false, error: "Could not save the bank connection." };
  }

  // Store the access token with the service-role client (secrets are not readable
  // by the authenticated/dashboard role).
  const { error: secretErr } = await admin
    .from("bank_connection_secrets")
    .upsert(
      { connection_id: conn.id, access_token: exchanged.accessToken, updated_at: new Date().toISOString() },
      { onConflict: "connection_id" },
    );
  if (secretErr) {
    return { ok: false, error: "Could not store the bank credentials securely." };
  }

  const synced = await syncConnectionById(conn.id, org.id, ninetyDaysAgoIso());
  revalidatePath(BASE);
  return { ok: true, synced };
}

// --- Sync: pull new transactions for one connection into the staging ledger ---
// Shared by the first sync (above) and the manual "Sync now" form action (below).
// Returns the count of newly-staged transactions.
async function syncConnectionById(
  connectionId: string,
  orgId: string,
  fallbackSince: string,
): Promise<number> {
  const supabase = createClient();
  const admin = createAdminClient();
  if (!admin) return 0;

  // Confirm the connection belongs to the caller's org (RLS scopes this read).
  const { data: conn } = await supabase
    .from("bank_connections")
    .select("id, provider, last_synced_at")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) return 0;

  // Access token via the service-role client (no authenticated grant on secrets).
  const { data: secret } = await admin
    .from("bank_connection_secrets")
    .select("access_token")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (!secret?.access_token) return 0;

  const since = conn.last_synced_at ? String(conn.last_synced_at).slice(0, 10) : fallbackSince;
  const provider = getBankFeedProvider(conn.provider as "plaid" | "flinks");

  let pulled;
  try {
    pulled = await provider.pullTransactions(secret.access_token, since);
  } catch {
    await supabase.from("bank_connections").update({ status: "error" }).eq("id", connectionId);
    return 0;
  }

  // Dedupe against what's already staged for this connection.
  const { data: existing } = await supabase
    .from("bank_transactions")
    .select("external_id")
    .eq("connection_id", connectionId);
  const existingIds = new Set((existing ?? []).map((r) => r.external_id as string));
  const fresh = filterNewTransactions(pulled, existingIds);

  if (fresh.length > 0) {
    const rows = fresh.map((t) => ({
      organization_id: orgId,
      connection_id: connectionId,
      external_id: t.externalId,
      account_external_id: t.accountExternalId,
      account_name: t.accountName,
      posted_on: t.postedOn,
      amount_cents: t.amountCents,
      direction: t.direction,
      merchant: t.merchant,
      description: t.description,
      raw_category: t.rawCategory,
      currency: t.currency,
    }));
    await supabase.from("bank_transactions").insert(rows);
  }

  await supabase
    .from("bank_connections")
    .update({ status: "active", last_synced_at: new Date().toISOString() })
    .eq("id", connectionId);

  return fresh.length;
}

export async function syncConnection(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?bank=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (providerForPlan(planEntitlements(org.plan)) === null) redirect(`${BASE}?bank=locked`);

  const connectionId = s(formData, "connection_id");
  if (!connectionId) redirect(`${BASE}?bank=notfound`);

  const count = await syncConnectionById(connectionId, org.id, ninetyDaysAgoIso());
  revalidatePath(BASE);
  redirect(`${BASE}?synced=${count}`);
}

// --- Triage: assign a staged debit into an expense ---------------------------
export async function assignTransaction(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?bank=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const txnId = s(formData, "transaction_id");
  if (!txnId) redirect(`${BASE}?bank=notfound`);

  const supabase = createClient();
  // Load the staged txn (RLS scopes to the org); must be a pending debit.
  const { data: txn } = await supabase
    .from("bank_transactions")
    .select("id, amount_cents, posted_on, merchant, direction, triage_status")
    .eq("id", txnId)
    .maybeSingle();
  if (!txn) redirect(`${BASE}?bank=notfound`);
  if (txn.direction !== "debit" || txn.triage_status !== "pending") {
    redirect(`${BASE}?bank=already`);
  }

  // Resolve scope (unit / building / none) from the form.
  const scope = s(formData, "scope") || "unit";
  let propertyId: string | null = null;
  let buildingKey: string | null = null;
  if (scope === "unit") propertyId = orNull(formData, "property_id");
  else if (scope === "building") buildingKey = orNull(formData, "building_key");

  const check = validateExpenseInput({
    category: s(formData, "category"),
    amountCents: txn.amount_cents,
    incurredOn: txn.posted_on,
    propertyId,
    buildingKey,
    merchant: txn.merchant,
    source: "bank",
    bankTransactionId: txn.id,
  });
  if (!check.ok) redirect(`${BASE}?exp=${check.code}`);

  // Confirm an attached property/building belongs to the org (RLS scopes reads).
  if (check.value.propertyId) {
    const { data } = await supabase
      .from("properties")
      .select("id")
      .eq("id", check.value.propertyId)
      .maybeSingle();
    if (!data) redirect(`${BASE}?bank=notfound`);
  }
  if (check.value.buildingKey) {
    const { data } = await supabase
      .from("properties")
      .select("id")
      .eq("building_key", check.value.buildingKey)
      .limit(1);
    if (!data || data.length === 0) redirect(`${BASE}?bank=notfound`);
  }

  const { data: expense, error: expErr } = await supabase
    .from("expenses")
    .insert({
      organization_id: org.id,
      property_id: check.value.propertyId,
      building_key: check.value.buildingKey,
      category: check.value.category,
      amount_cents: check.value.amountCents,
      incurred_on: check.value.incurredOn,
      merchant: check.value.merchant,
      note: check.value.note,
      source: "bank",
      bank_transaction_id: txn.id,
    })
    .select("id")
    .single();
  if (expErr || !expense) redirect(`${BASE}?exp=save`);

  await supabase
    .from("bank_transactions")
    .update({ triage_status: "assigned", expense_id: expense.id })
    .eq("id", txn.id);

  revalidatePath(BASE);
  redirect(`${BASE}?assigned=1`);
}

// --- Triage: ignore a staged transaction (not an expense) --------------------
export async function ignoreTransaction(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?bank=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const txnId = s(formData, "transaction_id");
  if (!txnId) redirect(`${BASE}?bank=notfound`);

  const supabase = createClient();
  await supabase
    .from("bank_transactions")
    .update({ triage_status: "ignored" })
    .eq("id", txnId)
    .eq("triage_status", "pending");

  revalidatePath(BASE);
  redirect(`${BASE}?ignored=1`);
}
