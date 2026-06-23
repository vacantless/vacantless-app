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
import {
  bestRuleForTxn,
  ruleAutoFiles,
  resolveRuleAssignment,
  draftRuleFromAssignment,
  validateRuleInput,
  type CategorizationRule,
  type MatchableTxn,
} from "@/lib/categorization-rules";

type DbClient = ReturnType<typeof createClient>;

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
      merchant_entity_id: t.merchantEntityId,
      stream_id: t.streamId,
    }));
    await supabase.from("bank_transactions").insert(rows);

    // Auto-apply saved categorization rules to the freshly-staged debits.
    await autoApplyRules(orgId);
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

// --- Categorization rules: shared helpers ------------------------------------

type RuleRow = {
  id: string;
  scope_kind: string;
  merchant_entity_id: string | null;
  stream_id: string | null;
  merchant_norm: string | null;
  account_external_id: string | null;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  day_min: number | null;
  day_max: number | null;
  category: string;
  property_id: string | null;
  building_key: string | null;
  times_applied: number;
  last_applied_at: string | null;
  created_at: string | null;
};

const RULE_COLUMNS =
  "id, scope_kind, merchant_entity_id, stream_id, merchant_norm, account_external_id, amount_min_cents, amount_max_cents, day_min, day_max, category, property_id, building_key, times_applied, last_applied_at, created_at";

function mapRuleRow(r: RuleRow): CategorizationRule {
  return {
    id: r.id,
    scopeKind: r.scope_kind === "stream" ? "stream" : "merchant",
    merchantEntityId: r.merchant_entity_id,
    streamId: r.stream_id,
    merchantNorm: r.merchant_norm,
    accountExternalId: r.account_external_id,
    amountMinCents: r.amount_min_cents,
    amountMaxCents: r.amount_max_cents,
    dayMin: r.day_min,
    dayMax: r.day_max,
    category: r.category,
    propertyId: r.property_id,
    buildingKey: r.building_key,
    lastAppliedAt: r.last_applied_at,
    createdAt: r.created_at,
  };
}

type StagedTxn = {
  id: string;
  amount_cents: number;
  posted_on: string;
  merchant: string | null;
};

/**
 * Insert an expense from a staged transaction and mark the transaction assigned.
 * Shared by manual triage (assignTransaction) and rule auto-filing
 * (autoApplyRules). Returns the new expense id, or null when validation/insert
 * fails. Does NOT re-check property/building ownership — callers that take a raw
 * form value must (assignTransaction does); rule values were validated on save.
 */
async function insertExpenseAndAssign(
  supabase: DbClient,
  orgId: string,
  txn: StagedTxn,
  value: { category: string; propertyId: string | null; buildingKey: string | null },
): Promise<string | null> {
  const check = validateExpenseInput({
    category: value.category,
    amountCents: txn.amount_cents,
    incurredOn: txn.posted_on,
    propertyId: value.propertyId,
    buildingKey: value.buildingKey,
    merchant: txn.merchant,
    source: "bank",
    bankTransactionId: txn.id,
  });
  if (!check.ok) return null;

  const { data: expense, error } = await supabase
    .from("expenses")
    .insert({
      organization_id: orgId,
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
  if (error || !expense) return null;

  await supabase
    .from("bank_transactions")
    .update({ triage_status: "assigned", expense_id: expense.id })
    .eq("id", txn.id);
  return expense.id;
}

/**
 * Auto-file pending debits that match a saved rule. Only rules with a definite
 * scope (property/building) auto-file — broad merchant→category rules just
 * pre-fill at triage (the page computes that, so the owner still confirms the
 * unit). Bumps times_applied/last_applied_at on each rule that fires. Best-effort
 * and idempotent: a txn already assigned is skipped because we only read pending.
 */
async function autoApplyRules(orgId: string): Promise<void> {
  const supabase = createClient();

  const { data: ruleData } = await supabase
    .from("categorization_rules")
    .select(RULE_COLUMNS);
  const ruleRows = (ruleData ?? []) as RuleRow[];
  if (ruleRows.length === 0) return;
  const rules = ruleRows.map(mapRuleRow);
  const baseCount = new Map(ruleRows.map((r) => [r.id, r.times_applied]));

  const { data: pendData } = await supabase
    .from("bank_transactions")
    .select("id, amount_cents, posted_on, merchant, merchant_entity_id, stream_id, account_external_id")
    .eq("triage_status", "pending")
    .eq("direction", "debit");
  const pending = (pendData ?? []) as (StagedTxn & {
    merchant_entity_id: string | null;
    stream_id: string | null;
    account_external_id: string | null;
  })[];

  const fired = new Map<string, number>();
  for (const t of pending) {
    const matchTxn: MatchableTxn = {
      merchantEntityId: t.merchant_entity_id,
      streamId: t.stream_id,
      merchant: t.merchant,
      accountExternalId: t.account_external_id,
      amountCents: t.amount_cents,
      postedOn: t.posted_on,
    };
    const rule = bestRuleForTxn(rules, matchTxn);
    if (!rule || !rule.id || !ruleAutoFiles(rule)) continue; // only scoped rules auto-file
    const asg = resolveRuleAssignment(rule);
    const expId = await insertExpenseAndAssign(supabase, orgId, t, asg);
    if (expId) fired.set(rule.id, (fired.get(rule.id) ?? 0) + 1);
  }

  const now = new Date().toISOString();
  for (const [ruleId, count] of fired) {
    await supabase
      .from("categorization_rules")
      .update({ times_applied: (baseCount.get(ruleId) ?? 0) + count, last_applied_at: now })
      .eq("id", ruleId);
  }
}

// --- Triage: assign a staged debit into an expense ---------------------------
export async function assignTransaction(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?bank=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const txnId = s(formData, "transaction_id");
  if (!txnId) redirect(`${BASE}?bank=notfound`);

  const supabase = createClient();
  // Load the staged txn (RLS scopes to the org); must be a pending debit. Pull
  // the categorization signals too so a "remember" can build a precise rule.
  const { data: txn } = await supabase
    .from("bank_transactions")
    .select(
      "id, amount_cents, posted_on, merchant, direction, triage_status, merchant_entity_id, stream_id, account_external_id",
    )
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

  const expenseId = await insertExpenseAndAssign(supabase, org.id, txn, {
    category: check.value.category,
    propertyId: check.value.propertyId,
    buildingKey: check.value.buildingKey,
  });
  if (!expenseId) redirect(`${BASE}?exp=save`);

  // "Remember": save a categorization rule so future matching debits auto-file
  // (scoped) or pre-fill (broad). Scope is INFERRED to keep it one click — if the
  // owner filed to a unit/building, remember it as "this recurring charge → that
  // scope" (auto-files next time); if category-only, remember it as a broad
  // "this merchant → that category" (pre-fills). Best-effort; never blocks assign.
  if (s(formData, "remember") !== "") {
    const scopeKind =
      check.value.propertyId != null || check.value.buildingKey != null ? "stream" : "merchant";
    const amount = txn.amount_cents;
    const draft = draftRuleFromAssignment(
      {
        merchantEntityId: txn.merchant_entity_id ?? null,
        streamId: txn.stream_id ?? null,
        merchant: txn.merchant,
        accountExternalId: txn.account_external_id ?? null,
        amountCents: amount,
      },
      {
        scopeKind,
        category: check.value.category,
        propertyId: check.value.propertyId,
        buildingKey: check.value.buildingKey,
        amountToleranceCents: Math.max(200, Math.round(amount * 0.05)),
      },
    );
    if (draft) {
      const rule = validateRuleInput(draft);
      if (rule.ok) {
        await supabase.from("categorization_rules").insert({
          organization_id: org.id,
          scope_kind: rule.value.scopeKind,
          merchant_entity_id: rule.value.merchantEntityId,
          stream_id: rule.value.streamId,
          merchant_norm: rule.value.merchantNorm,
          account_external_id: rule.value.accountExternalId,
          amount_min_cents: rule.value.amountMinCents,
          amount_max_cents: rule.value.amountMaxCents,
          day_min: rule.value.dayMin,
          day_max: rule.value.dayMax,
          category: rule.value.category,
          property_id: rule.value.propertyId,
          building_key: rule.value.buildingKey,
        });
      }
    }
  }

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
