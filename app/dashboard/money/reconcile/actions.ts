"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { hasEntitlement } from "@/lib/billing";
import { requireCapability } from "@/lib/membership";
import {
  bestRuleForTxn,
  ruleAutoFiles,
  resolveRuleAssignment,
  type MatchableTxn,
} from "@/lib/categorization-rules";
import { normalizePeriodMonth } from "@/lib/payments";
import { rentMatchCandidatesForTransaction } from "@/lib/reconciliation";
import {
  insertExpenseAndAssign,
  mapRuleRow,
  RULE_COLUMNS,
  type RuleRow,
} from "../../expenses/triage-core";

const BASE = "/dashboard/money/reconcile";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function requireAccountingOrg() {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!hasEntitlement(org.plan, "accounting")) redirect(`${BASE}?locked=1`);
  return org;
}

export async function reconcileDebitAsExpense(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?error=forbidden`);
  const org = await requireAccountingOrg();
  const txnId = s(formData, "transaction_id");
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
  const assignment =
    rule && ruleAutoFiles(rule)
      ? resolveRuleAssignment(rule)
      : {
          category: rule?.category ?? "other",
          propertyId: null,
          buildingKey: null,
        };
  const expenseId = await insertExpenseAndAssign(supabase, org.id, txn, assignment);
  if (!expenseId) redirect(`${BASE}?error=save`);

  revalidatePath(BASE);
  revalidatePath("/dashboard/expenses");
  revalidatePath("/dashboard/rent/statement");
  redirect(`${BASE}?reconciled=expense`);
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
