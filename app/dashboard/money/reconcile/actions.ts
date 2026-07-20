"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { hasEntitlement } from "@/lib/billing";
import { requireCapability } from "@/lib/membership";
import {
  bestRuleForTxn,
  draftRuleFromAssignment,
  ruleAutoFiles,
  resolveRuleAssignment,
  validateRuleInput,
  type MatchableTxn,
} from "@/lib/categorization-rules";
import { chooseReconcileAssignment, type ResolvedAssignment } from "@/lib/reconcile-assign";
import { normalizePeriodMonth } from "@/lib/payments";
import {
  expenseMatchCandidateForTransaction,
  rentMatchCandidatesForTransaction,
} from "@/lib/reconciliation";
import {
  autoApplyRules,
  insertExpenseAndAssign,
  mapRuleRow,
  RULE_COLUMNS,
  type RuleRow,
} from "../../expenses/triage-core";

const BASE = "/dashboard/money/reconcile";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
function orNull(formData: FormData, name: string): string | null {
  const value = s(formData, name);
  return value === "" ? null : value;
}

function dateDistanceDays(a: string | null | undefined, b: string | null | undefined): number | null {
  const left = Date.parse(String(a ?? "").slice(0, 10));
  const right = Date.parse(String(b ?? "").slice(0, 10));
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  return Math.abs(left - right) / 86_400_000;
}

async function requireAccountingOrg() {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!hasEntitlement(org.plan, "accounting")) redirect(`${BASE}?locked=1`);
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

export async function reconcileDebitAsExpense(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?error=forbidden`);
  const org = await requireAccountingOrg();
  const txnId = s(formData, "transaction_id");
  const category = s(formData, "category");
  const propertyId = orNull(formData, "property_id");
  const buildingKey = orNull(formData, "building_key");
  if (!txnId) redirect(`${BASE}?error=notfound`);

  const supabase = createClient();
  const { data: txn } = await supabase
    .from("bank_transactions")
    .select(
      "id, amount_cents, posted_on, merchant, direction, triage_status, merchant_entity_id, stream_id, account_external_id",
    )
    .eq("organization_id", org.id)
    .eq("id", txnId)
    .maybeSingle();
  if (!txn) redirect(`${BASE}?error=notfound`);
  if (txn.direction !== "debit" || txn.triage_status !== "pending") {
    redirect(`${BASE}?error=already`);
  }

  const { data: ruleData } = await supabase
    .from("categorization_rules")
    .select(RULE_COLUMNS)
    .eq("organization_id", org.id);
  const rules = ((ruleData ?? []) as RuleRow[]).map(mapRuleRow);
  const matchTxn: MatchableTxn = {
    merchantEntityId: txn.merchant_entity_id ?? null,
    streamId: txn.stream_id ?? null,
    merchant: txn.merchant ?? null,
    accountExternalId: txn.account_external_id ?? null,
    amountCents: txn.amount_cents,
    postedOn: txn.posted_on,
  };
  const rule = bestRuleForTxn(rules, matchTxn);
  const ruleSuggestion: ResolvedAssignment | null =
    rule && ruleAutoFiles(rule)
      ? resolveRuleAssignment(rule)
      : rule?.category
        ? { category: rule.category, propertyId: null, buildingKey: null }
        : null;
  const assignment = chooseReconcileAssignment(
    { category, propertyId, buildingKey },
    ruleSuggestion,
  );
  if (!(await propertyBelongsToOrg(supabase, org.id, assignment.propertyId))) {
    redirect(`${BASE}?error=notfound`);
  }
  if (!(await buildingBelongsToOrg(supabase, org.id, assignment.buildingKey))) {
    redirect(`${BASE}?error=notfound`);
  }
  const expenseId = await insertExpenseAndAssign(supabase, org.id, txn, assignment);
  if (!expenseId) redirect(`${BASE}?error=save`);

  let savedScopedRule = false;
  if (s(formData, "remember") !== "") {
    try {
      const scopeKind =
        assignment.propertyId != null || assignment.buildingKey != null ? "stream" : "merchant";
      const draft = draftRuleFromAssignment(
        {
          merchantEntityId: txn.merchant_entity_id ?? null,
          streamId: txn.stream_id ?? null,
          merchant: txn.merchant ?? null,
          accountExternalId: txn.account_external_id ?? null,
          amountCents: txn.amount_cents,
        },
        {
          scopeKind,
          category: assignment.category,
          propertyId: assignment.propertyId,
          buildingKey: assignment.buildingKey,
          amountToleranceCents: Math.max(200, Math.round(txn.amount_cents * 0.05)),
        },
      );
      if (draft) {
        const ruleInput = validateRuleInput(draft);
        if (ruleInput.ok) {
          const { error: ruleErr } = await supabase.from("categorization_rules").insert({
            organization_id: org.id,
            scope_kind: ruleInput.value.scopeKind,
            merchant_entity_id: ruleInput.value.merchantEntityId,
            stream_id: ruleInput.value.streamId,
            merchant_norm: ruleInput.value.merchantNorm,
            account_external_id: ruleInput.value.accountExternalId,
            amount_min_cents: ruleInput.value.amountMinCents,
            amount_max_cents: ruleInput.value.amountMaxCents,
            day_min: ruleInput.value.dayMin,
            day_max: ruleInput.value.dayMax,
            category: ruleInput.value.category,
            property_id: ruleInput.value.propertyId,
            building_key: ruleInput.value.buildingKey,
          });
          if (!ruleErr && (ruleInput.value.propertyId != null || ruleInput.value.buildingKey != null)) {
            savedScopedRule = true;
          }
        }
      }
    } catch {
      savedScopedRule = false;
    }
  }

  if (savedScopedRule) {
    try {
      await autoApplyRules(org.id);
    } catch {
      // Best-effort sweep; the expense itself was already logged above.
    }
  }

  revalidatePath(BASE);
  revalidatePath("/dashboard/expenses");
  revalidatePath("/dashboard/rent/statement");
  redirect(`${BASE}?reconciled=expense`);
}

export async function linkExistingExpenseToTransaction(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?error=forbidden`);
  const org = await requireAccountingOrg();
  const txnId = s(formData, "transaction_id");
  const expenseId = s(formData, "expense_id");
  if (!txnId || !expenseId) redirect(`${BASE}?error=notfound`);

  const supabase = createClient();
  const [{ data: txn }, { data: expense }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id, amount_cents, posted_on, direction, triage_status")
      .eq("organization_id", org.id)
      .eq("id", txnId)
      .maybeSingle(),
    supabase
      .from("expenses")
      .select("id, amount_cents, incurred_on, category, property_id, building_key, bank_transaction_id")
      .eq("organization_id", org.id)
      .eq("id", expenseId)
      .maybeSingle(),
  ]);
  if (!txn || !expense) redirect(`${BASE}?error=notfound`);
  if (txn.direction !== "debit" || txn.triage_status !== "pending") {
    redirect(`${BASE}?error=already`);
  }
  if (expense.bank_transaction_id || expense.amount_cents !== txn.amount_cents) {
    redirect(`${BASE}?error=link_mismatch`);
  }
  const days = dateDistanceDays(txn.posted_on, expense.incurred_on);
  if (days == null || days > 14) redirect(`${BASE}?error=link_mismatch`);

  const candidate = expenseMatchCandidateForTransaction(txn, {
    category: expense.category,
    propertyId: expense.property_id,
    buildingKey: expense.building_key,
  });
  if (!candidate) redirect(`${BASE}?error=link_mismatch`);

  const { data: claimed } = await supabase
    .from("bank_transactions")
    .update({ triage_status: "assigned" })
    .eq("organization_id", org.id)
    .eq("id", txn.id)
    .eq("triage_status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) redirect(`${BASE}?error=already`);

  const { data: linked, error: linkErr } = await supabase
    .from("expenses")
    .update({ bank_transaction_id: txn.id })
    .eq("organization_id", org.id)
    .eq("id", expense.id)
    .is("bank_transaction_id", null)
    .select("id")
    .maybeSingle();
  if (linkErr || !linked) {
    await supabase
      .from("bank_transactions")
      .update({ triage_status: "pending" })
      .eq("organization_id", org.id)
      .eq("id", txn.id);
    redirect(`${BASE}?error=link_taken`);
  }

  const { error: txnErr } = await supabase
    .from("bank_transactions")
    .update({ expense_id: expense.id })
    .eq("organization_id", org.id)
    .eq("id", txn.id);
  if (txnErr) {
    await supabase
      .from("expenses")
      .update({ bank_transaction_id: null })
      .eq("organization_id", org.id)
      .eq("id", expense.id);
    await supabase
      .from("bank_transactions")
      .update({ triage_status: "pending" })
      .eq("organization_id", org.id)
      .eq("id", txn.id);
    redirect(`${BASE}?error=save`);
  }

  revalidatePath(BASE);
  revalidatePath("/dashboard/expenses");
  revalidatePath("/dashboard/rent/statement");
  redirect(`${BASE}?reconciled=expense_linked`);
}

export async function reconcileCreditAsRent(formData: FormData) {
  await requireCapability("manage_tenancies", `${BASE}?error=forbidden`);
  const org = await requireAccountingOrg();
  const txnId = s(formData, "transaction_id");
  const tenancyId = s(formData, "tenancy_id");
  if (!txnId || !tenancyId) redirect(`${BASE}?error=notfound`);

  const supabase = createClient();
  const [{ data: txn }, { data: tenancy }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id, amount_cents, posted_on, direction, triage_status")
      .eq("organization_id", org.id)
      .eq("id", txnId)
      .maybeSingle(),
    supabase
      .from("tenancies")
      .select("id, rent_cents, status")
      .eq("organization_id", org.id)
      .eq("id", tenancyId)
      .maybeSingle(),
  ]);

  if (!txn || !tenancy) redirect(`${BASE}?error=notfound`);
  if (txn.direction !== "credit" || txn.triage_status !== "pending") {
    redirect(`${BASE}?error=already`);
  }
  if (tenancy.status !== "active") redirect(`${BASE}?error=notfound`);

  const candidates = rentMatchCandidatesForTransaction(
    { amountCents: txn.amount_cents, direction: "credit" },
    [{ tenancyId: tenancy.id, rentCents: tenancy.rent_cents, label: "Tenancy" }],
  );
  if (candidates.length === 0) redirect(`${BASE}?error=no_rent_match`);

  // Claim first, then write the rent ledger row. If the insert fails, release
  // the claim so the transaction remains retryable.
  const { data: claimed } = await supabase
    .from("bank_transactions")
    .update({ triage_status: "rent" })
    .eq("organization_id", org.id)
    .eq("id", txn.id)
    .eq("triage_status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) redirect(`${BASE}?error=already`);

  const { error } = await supabase.from("rent_payments").insert({
    organization_id: org.id,
    tenancy_id: tenancy.id,
    amount_cents: txn.amount_cents,
    method: "other",
    paid_on: txn.posted_on,
    period_month: normalizePeriodMonth(txn.posted_on),
    source: "bank",
    bank_transaction_id: txn.id,
    note: "Reconciled from a bank deposit",
  });
  if (error) {
    await supabase
      .from("bank_transactions")
      .update({ triage_status: "pending" })
      .eq("organization_id", org.id)
      .eq("id", txn.id);
    redirect(`${BASE}?error=save`);
  }

  revalidatePath(BASE);
  revalidatePath("/dashboard/expenses");
  revalidatePath("/dashboard/rent/statement");
  redirect(`${BASE}?reconciled=rent`);
}

export async function excludeTransaction(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?error=forbidden`);
  const org = await requireAccountingOrg();
  const txnId = s(formData, "transaction_id");
  if (!txnId) redirect(`${BASE}?error=notfound`);

  const supabase = createClient();
  const { data: updated } = await supabase
    .from("bank_transactions")
    .update({ triage_status: "excluded" })
    .eq("organization_id", org.id)
    .eq("id", txnId)
    .eq("triage_status", "pending")
    .select("id")
    .maybeSingle();
  if (!updated) redirect(`${BASE}?error=already`);

  revalidatePath(BASE);
  revalidatePath("/dashboard/expenses");
  redirect(`${BASE}?reconciled=excluded`);
}
