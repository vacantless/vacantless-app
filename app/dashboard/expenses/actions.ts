"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { canUseCaptureEmailIn, planEntitlements } from "@/lib/billing";
import { providerForPlan, filterNewTransactions } from "@/lib/bank-feed";
import { getBankFeedProvider } from "@/lib/bank-feed/plaid";
import { validateExpenseInput } from "@/lib/expenses";
import { draftRuleFromAssignment, validateRuleInput } from "@/lib/categorization-rules";
import { normalizePeriodMonth, parseAmountToCents, validatePaymentInput } from "@/lib/payments";
import { isRentFromBankEnabled, validateRentSplit } from "@/lib/rent-from-bank";
import { railPaymentLinkCandidatesForTransaction } from "@/lib/rent-classify";
import { autoApplyRules, insertExpenseAndAssign } from "./triage-core";

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
const RAIL_PAYMENT_SOURCES = ["stripe", "rotessa"];

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
function orNull(formData: FormData, name: string): string | null {
  const v = s(formData, name);
  return v === "" ? null : v;
}

type EtransferCaptureRow = {
  id: string;
  direction: "received" | "sent";
  counterparty_name: string;
  amount_cents: number;
  txn_date: string;
  status: string;
};

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
  // A synthetic import connection ('csv') has no aggregator and no secret row —
  // it is fed by file upload, never by this pull path. Skip it defensively so a
  // stray "Sync now" can't reach getBankFeedProvider('csv').
  if (conn.provider !== "plaid" && conn.provider !== "flinks") return 0;

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
  // A scoped rule (unit/building) auto-files matching debits; a broad
  // merchant→category rule only pre-fills. Track whether we saved a scoped rule
  // so we can retroactively sweep the rest of the queue below.
  let savedScopedRule = false;
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
        const { error: ruleErr } = await supabase.from("categorization_rules").insert({
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
        if (!ruleErr && (rule.value.propertyId != null || rule.value.buildingKey != null)) {
          savedScopedRule = true;
        }
      }
    }
  }

  // Retroactive apply: a scoped Remember-this used to help only FUTURE imports;
  // the sibling lines already in the queue stayed manual (the busy-first-import
  // pain). Now sweep the pending queue immediately so every other line matching
  // the new rule files in one action. The just-assigned txn is already `assigned`
  // so the sweep (pending-only) never touches it. Best-effort; never blocks.
  let swept = 0;
  if (savedScopedRule) {
    swept = await autoApplyRules(org.id);
  }

  revalidatePath(BASE);
  redirect(`${BASE}?assigned=1&swept=${swept}`);
}

// --- Triage: apply saved rules to the lines already in the queue -------------
// "Remember this" auto-files matching debits at IMPORT time, so the very first
// import of a busy account is all-manual (no rules exist yet). Once the owner
// has taught a few rules, this button re-runs the same scoped auto-file over the
// pending queue so every already-staged line a rule now matches files at once.
// Same engine as the import-time sweep (autoApplyRules); pending-only + scoped-
// only, so it never re-touches assigned lines or guesses a unit. Never moves money.
export async function applyRulesToQueue() {
  await requireCapability("manage_work_orders", `${BASE}?bank=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const swept = await autoApplyRules(org.id);

  revalidatePath(BASE);
  redirect(`${BASE}?swept=${swept}`);
}

async function gateEtransferCapture() {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!canUseCaptureEmailIn(org.plan)) redirect(`${BASE}?etransfer=locked`);
  return org;
}

async function propertyBelongsToOrg(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  propertyId: string | null,
): Promise<boolean> {
  if (!propertyId) return true;
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", propertyId)
    .maybeSingle();
  return !!data;
}

async function buildingBelongsToOrg(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  buildingKey: string | null,
): Promise<boolean> {
  if (!buildingKey) return true;
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("organization_id", orgId)
    .eq("building_key", buildingKey)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function loadEtransferCapture(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  id: string,
): Promise<EtransferCaptureRow | null> {
  const { data } = await supabase
    .from("etransfer_captures")
    .select("id, direction, counterparty_name, amount_cents, txn_date, status")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as EtransferCaptureRow | null;
}

async function claimEtransferCapture(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("etransfer_captures")
    .update({ status: "confirmed", updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  return !!data;
}

async function releaseEtransferClaim(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  id: string,
) {
  await supabase
    .from("etransfer_captures")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", id)
    .eq("status", "confirmed")
    .is("rent_payment_id", null)
    .is("expense_id", null);
}

export async function confirmEtransferRent(formData: FormData) {
  await requireCapability("manage_tenancies", `${BASE}?etransfer=forbidden`);
  const org = await gateEtransferCapture();
  const captureId = s(formData, "capture_id");
  const tenancyId = s(formData, "tenancy_id");
  if (!captureId || !tenancyId) redirect(`${BASE}?etransfer=missing`);

  const supabase = createClient();
  const capture = await loadEtransferCapture(supabase, org.id, captureId);
  if (!capture || capture.status !== "pending" || capture.direction !== "received") {
    redirect(`${BASE}?etransfer=gone`);
  }

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, status")
    .eq("organization_id", org.id)
    .eq("id", tenancyId)
    .maybeSingle();
  if (!tenancy || tenancy.status !== "active") redirect(`${BASE}?etransfer=notfound`);

  const check = validatePaymentInput({
    amountCents: capture.amount_cents,
    method: "e_transfer",
    paidOn: capture.txn_date,
  });
  if (!check.ok) redirect(`${BASE}?etransfer=${check.code}`);

  if (!(await claimEtransferCapture(supabase, org.id, capture.id))) {
    redirect(`${BASE}?etransfer=gone`);
  }

  const { data: payment, error } = await supabase
    .from("rent_payments")
    .insert({
      organization_id: org.id,
      tenancy_id: tenancy.id,
      amount_cents: check.value.amountCents,
      method: check.value.method,
      paid_on: check.value.paidOn,
      period_month: normalizePeriodMonth(check.value.paidOn),
      reference: null,
      // S531: optional operator note leads; provenance kept as a suffix.
      note: (() => {
        const operatorNote = (s(formData, "note") ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        return operatorNote
          ? `${operatorNote} (recorded from forwarded e-Transfer)`
          : `Recorded from forwarded e-Transfer from ${capture.counterparty_name}`;
      })(),
    })
    .select("id")
    .single();
  if (error || !payment) {
    await releaseEtransferClaim(supabase, org.id, capture.id);
    redirect(`${BASE}?etransfer=save`);
  }

  await supabase
    .from("etransfer_captures")
    .update({
      rent_payment_id: payment.id,
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", org.id)
    .eq("id", capture.id);

  revalidatePath(BASE);
  revalidatePath("/dashboard/rent/statement");
  redirect(`${BASE}?etransfer=rent`);
}

export async function confirmEtransferExpense(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?etransfer=forbidden`);
  const org = await gateEtransferCapture();
  const captureId = s(formData, "capture_id");
  if (!captureId) redirect(`${BASE}?etransfer=missing`);

  const supabase = createClient();
  const capture = await loadEtransferCapture(supabase, org.id, captureId);
  if (!capture || capture.status !== "pending" || capture.direction !== "sent") {
    redirect(`${BASE}?etransfer=gone`);
  }

  const propertyId = orNull(formData, "property_id");
  const buildingKey = orNull(formData, "building_key");
  // S531: optional operator note ("506 Manning toilet unit 2") leads the memo;
  // the e-Transfer provenance is kept as a suffix either way.
  const operatorNote = (s(formData, "note") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const check = validateExpenseInput({
    category: s(formData, "category"),
    amountCents: capture.amount_cents,
    incurredOn: capture.txn_date,
    propertyId,
    buildingKey,
    merchant: capture.counterparty_name,
    note: operatorNote
      ? `${operatorNote} (recorded from forwarded e-Transfer)`
      : `Recorded from forwarded e-Transfer to ${capture.counterparty_name}`,
    source: "manual",
    bankTransactionId: null,
  });
  if (!check.ok) redirect(`${BASE}?etransfer=${check.code}`);

  if (!(await propertyBelongsToOrg(supabase, org.id, check.value.propertyId))) {
    redirect(`${BASE}?etransfer=notfound`);
  }
  if (!(await buildingBelongsToOrg(supabase, org.id, check.value.buildingKey))) {
    redirect(`${BASE}?etransfer=notfound`);
  }

  if (!(await claimEtransferCapture(supabase, org.id, capture.id))) {
    redirect(`${BASE}?etransfer=gone`);
  }

  const { data: expense, error } = await supabase
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
      source: check.value.source,
      bank_transaction_id: null,
    })
    .select("id")
    .single();
  if (error || !expense) {
    await releaseEtransferClaim(supabase, org.id, capture.id);
    redirect(`${BASE}?etransfer=save`);
  }

  await supabase
    .from("etransfer_captures")
    .update({
      expense_id: expense.id,
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", org.id)
    .eq("id", capture.id);

  revalidatePath(BASE);
  revalidatePath("/dashboard/rent/statement");
  redirect(`${BASE}?etransfer=expense`);
}

export async function dismissEtransferCapture(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?etransfer=forbidden`);
  const org = await gateEtransferCapture();
  const captureId = s(formData, "capture_id");
  if (!captureId) redirect(`${BASE}?etransfer=missing`);

  const supabase = createClient();
  const { data: dismissed } = await supabase
    .from("etransfer_captures")
    .update({
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", org.id)
    .eq("id", captureId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!dismissed) redirect(`${BASE}?etransfer=gone`);

  revalidatePath(BASE);
  redirect(`${BASE}?etransfer=dismissed`);
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

// --- Triage: bulk-ignore every pending debit still in the queue --------------
// A commingled personal account (an OFX import of a chequing account that mixes
// household + rental spend) dumps dozens of personal debits into the queue with
// no way to clear them at once (KI631a, S433 item (c)). The operator's workflow
// is: file the few real property costs first (manual, or via a saved rule /
// "Apply saved rules"), then clear the personal remainder in one action.
// "Ignore" is a SOFT status — no expense is created and nothing is deleted; a
// line can still be reconsidered later.
//
// SCOPED TO THE VISIBLE IDS the form submits (S433b P2): the queue only renders
// the 100 most recent pending debits, so ignoring "all pending debits for the
// org" could silently clear lines the operator never saw — which might include
// real property costs. Instead the button submits exactly the on-screen line IDs
// and we ignore only those. The org + pending + debit predicates still apply as
// defense in depth, so a stale or foreign id can never flip: another org's row,
// a credit, or an already-filed line is untouched.
export async function ignoreAllPending(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?bank=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) redirect(BASE);

  const supabase = createClient();
  const { data: cleared } = await supabase
    .from("bank_transactions")
    .update({ triage_status: "ignored" })
    .eq("organization_id", org.id)
    .eq("triage_status", "pending")
    .eq("direction", "debit")
    .in("id", ids)
    .select("id");

  revalidatePath(BASE);
  redirect(`${BASE}?ignored_bulk=${cleared?.length ?? 0}`);
}

// --- Triage: record a CREDIT (money in) as rent income -----------------------
// A rent deposit lands as one bank credit but can cover several tenancies (a
// Rotessa lump), so the operator splits it across the org's active tenancies
// into `rent_payments` rows that the owner statement already sums as "Rent
// collected". We never move money — this only records what already arrived.
// Dark behind RENT_FROM_BANK; guarded on manage_tenancies + the bank_feed plan.
export async function recordRentFromTransaction(formData: FormData) {
  await requireCapability("manage_tenancies", `${BASE}?rent=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!isRentFromBankEnabled() || providerForPlan(planEntitlements(org.plan)) === null) {
    redirect(`${BASE}?rent=locked`);
  }

  const txnId = s(formData, "transaction_id");
  if (!txnId) redirect(`${BASE}?bank=notfound`);

  const supabase = createClient();
  // Must be a PENDING CREDIT in the caller's org (RLS scopes the read).
  const { data: txn } = await supabase
    .from("bank_transactions")
    .select("id, amount_cents, posted_on, merchant, description, raw_category, direction, triage_status")
    .eq("id", txnId)
    .maybeSingle();
  if (!txn) redirect(`${BASE}?bank=notfound`);
  if (txn.direction !== "credit" || txn.triage_status !== "pending") {
    redirect(`${BASE}?bank=already`);
  }

  // The org's active tenancies (RLS-scoped) are the only valid split targets.
  const { data: tenData } = await supabase
    .from("tenancies")
    .select("id, rent_cents")
    .eq("status", "active");
  const activeTenancies = ((tenData ?? []) as { id: string; rent_cents: number | null }[]).map((t) => ({
    tenancyId: t.id,
    rentCents: t.rent_cents,
    label: "Tenancy",
  }));
  const validIds = new Set(activeTenancies.map((t) => t.tenancyId));

  // Close the server-side double-count hole too: if a Stripe/Rotessa-looking
  // bank deposit already has a matching unlinked rail ledger row, the operator
  // must link that row instead of creating a second rent_payments row.
  const { data: railData } = await supabase
    .from("rent_payments")
    .select("id, tenancy_id, amount_cents, period_month, source, bank_transaction_id")
    .eq("organization_id", org.id)
    .in("source", RAIL_PAYMENT_SOURCES)
    .is("bank_transaction_id", null);
  const railLinks = railPaymentLinkCandidatesForTransaction(
    {
      amountCents: txn.amount_cents,
      postedOn: txn.posted_on,
      description: txn.description,
      source: [txn.merchant, txn.raw_category].filter(Boolean).join(" "),
    },
    activeTenancies,
    ((railData ?? []) as {
      id: string;
      tenancy_id: string | null;
      amount_cents: number;
      period_month: string | null;
      source: string | null;
      bank_transaction_id: string | null;
    }[]).map((payment) => ({
      id: payment.id,
      tenancyId: payment.tenancy_id,
      amountCents: payment.amount_cents,
      periodMonth: payment.period_month,
      source: payment.source,
      bankTransactionId: payment.bank_transaction_id,
    })),
  );
  if (railLinks.length > 0) redirect(`${BASE}?rent=rail_duplicate`);

  // Per-tenancy allocations arrive as alloc_<tenancyId> dollar amounts.
  const allocations: { tenancyId: string; amountCents: number }[] = [];
  for (const id of validIds) {
    const cents = parseAmountToCents(s(formData, `alloc_${id}`));
    if (cents && cents > 0) allocations.push({ tenancyId: id, amountCents: cents });
  }

  const check = validateRentSplit(txn.amount_cents, allocations);
  if (!check.ok) redirect(`${BASE}?rent=${check.code}`);

  // Claim the credit (pending -> assigned) FIRST so a double submit can't
  // double-record it; expense_id stays null because this is income, not a cost.
  const { data: claimed } = await supabase
    .from("bank_transactions")
    .update({ triage_status: "assigned" })
    .eq("id", txn.id)
    .eq("triage_status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) redirect(`${BASE}?bank=already`);

  const periodMonth = normalizePeriodMonth(txn.posted_on);
  const rows = check.value.map((a) => ({
    organization_id: org.id,
    tenancy_id: a.tenancyId,
    amount_cents: a.amountCents,
    method: "other",
    paid_on: txn.posted_on,
    period_month: periodMonth,
    source: "bank",
    bank_transaction_id: txn.id,
    note: "Recorded from a bank deposit",
  }));
  const { error } = await supabase.from("rent_payments").insert(rows);
  if (error) {
    // Roll the claim back so the operator can retry.
    await supabase.from("bank_transactions").update({ triage_status: "pending" }).eq("id", txn.id);
    redirect(`${BASE}?rent=save`);
  }

  revalidatePath(BASE);
  redirect(`${BASE}?rent=${check.value.length}`);
}

export async function linkRailRentPaymentToTransaction(formData: FormData) {
  await requireCapability("manage_tenancies", `${BASE}?rent=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!isRentFromBankEnabled() || providerForPlan(planEntitlements(org.plan)) === null) {
    redirect(`${BASE}?rent=locked`);
  }

  const txnId = s(formData, "transaction_id");
  const paymentId = s(formData, "rent_payment_id");
  if (!txnId || !paymentId) redirect(`${BASE}?bank=notfound`);

  const supabase = createClient();
  const [{ data: txn }, { data: payment }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id, amount_cents, posted_on, merchant, description, raw_category, direction, triage_status")
      .eq("organization_id", org.id)
      .eq("id", txnId)
      .maybeSingle(),
    supabase
      .from("rent_payments")
      .select("id, tenancy_id, amount_cents, period_month, source, bank_transaction_id")
      .eq("organization_id", org.id)
      .eq("id", paymentId)
      .maybeSingle(),
  ]);
  if (!txn || !payment) redirect(`${BASE}?bank=notfound`);
  if (txn.direction !== "credit" || txn.triage_status !== "pending") {
    redirect(`${BASE}?bank=already`);
  }

  const { data: tenancy } = await supabase
    .from("tenancies")
    .select("id, rent_cents, status")
    .eq("organization_id", org.id)
    .eq("id", payment.tenancy_id)
    .maybeSingle();
  if (!tenancy || tenancy.status !== "active") redirect(`${BASE}?rent=link_mismatch`);

  const railLinks = railPaymentLinkCandidatesForTransaction(
    {
      amountCents: txn.amount_cents,
      postedOn: txn.posted_on,
      description: txn.description,
      source: [txn.merchant, txn.raw_category].filter(Boolean).join(" "),
    },
    [{ tenancyId: tenancy.id, rentCents: tenancy.rent_cents, label: "Tenancy" }],
    [
      {
        id: payment.id,
        tenancyId: payment.tenancy_id,
        amountCents: payment.amount_cents,
        periodMonth: payment.period_month,
        source: payment.source,
        bankTransactionId: payment.bank_transaction_id,
      },
    ],
  );
  if (railLinks.length === 0) redirect(`${BASE}?rent=link_mismatch`);

  const { data: claimed } = await supabase
    .from("bank_transactions")
    .update({ triage_status: "assigned" })
    .eq("organization_id", org.id)
    .eq("id", txn.id)
    .eq("triage_status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) redirect(`${BASE}?bank=already`);

  const { data: linked, error } = await supabase
    .from("rent_payments")
    .update({ bank_transaction_id: txn.id })
    .eq("organization_id", org.id)
    .eq("id", payment.id)
    .in("source", RAIL_PAYMENT_SOURCES)
    .is("bank_transaction_id", null)
    .select("id")
    .maybeSingle();
  if (error || !linked) {
    await supabase
      .from("bank_transactions")
      .update({ triage_status: "pending" })
      .eq("organization_id", org.id)
      .eq("id", txn.id);
    redirect(`${BASE}?rent=${error ? "save" : "link_taken"}`);
  }

  revalidatePath(BASE);
  revalidatePath("/dashboard/rent/statement");
  redirect(`${BASE}?rent=linked`);
}
