"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { hasEntitlement } from "@/lib/billing";
import { requireCapability } from "@/lib/membership";
import {
  buildCategorizationImportPlan,
  mapSourceCategory,
  parseFreshbooksCsv,
  type PlanningBankTxn,
  type PlannedAction,
} from "@/lib/accounting-import";
import {
  draftRuleFromAssignment,
  validateRuleInput,
  type CategorizationRule,
} from "@/lib/categorization-rules";
import { isExpenseCategory } from "@/lib/expenses";
import { normalizePeriodMonth } from "@/lib/payments";
import { railPaymentLinkCandidatesForTransaction } from "@/lib/rent-classify";
import { autoApplyRules, insertExpenseAndAssign } from "../../expenses/triage-core";

const BASE = "/dashboard/money/import-history";
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const RAIL_PAYMENT_SOURCES = ["stripe", "rotessa"];
const APPLYING_ACTIONS = new Set<PlannedAction>([
  "rule_seed",
  "direct_expense",
  "rent_link",
  "exclude",
]);

type Supabase = ReturnType<typeof createClient>;

type BankTxnRow = {
  id: string;
  amount_cents: number;
  posted_on: string;
  direction: "debit" | "credit";
  merchant: string | null;
  description: string | null;
  raw_category?: string | null;
  triage_status: string;
  merchant_entity_id: string | null;
  stream_id: string | null;
  account_external_id: string | null;
};

type PropertyRow = {
  id: string;
  address: string;
  building_key: string | null;
};

type ImportBatchRow = {
  id: string;
  status: string;
};

type ImportRow = {
  id: string;
  row_no: number | null;
  txn_date: string | null;
  amount_cents: number | null;
  direction: "debit" | "credit" | null;
  description: string | null;
  source_category: string | null;
  client_tag: string | null;
  matched_transaction_id: string | null;
  planned_action: PlannedAction | null;
  planned_category: string | null;
  planned_property_id: string | null;
  planned_building_key: string | null;
  status: string;
};

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function orNull(formData: FormData, name: string): string | null {
  const value = s(formData, name);
  return value === "" ? null : value;
}

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

async function requireAccountingOrg() {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!hasEntitlement(org.plan, "accounting")) redirect(`${BASE}?locked=1`);
  return org;
}

function toPlanningTxn(row: BankTxnRow): PlanningBankTxn {
  return {
    id: row.id,
    amountCents: row.amount_cents,
    postedOn: row.posted_on,
    direction: row.direction,
    merchant: row.merchant,
    description: row.description,
    triageStatus: row.triage_status,
    merchantEntityId: row.merchant_entity_id,
    streamId: row.stream_id,
    accountExternalId: row.account_external_id,
  };
}

function asAction(raw: string): PlannedAction | null {
  if (
    raw === "rule_seed" ||
    raw === "direct_expense" ||
    raw === "rent_link" ||
    raw === "exclude" ||
    raw === "needs_review"
  ) {
    return raw;
  }
  return null;
}

function rowMapsExcluded(row: Pick<ImportRow, "source_category" | "direction">): boolean {
  return !!row.direction && mapSourceCategory(row.source_category, row.direction).kind === "excluded";
}

async function propertyBelongsToOrg(
  supabase: Supabase,
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
  supabase: Supabase,
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

function ruleKey(rule: CategorizationRule): string {
  return [
    rule.scopeKind,
    rule.merchantEntityId ?? "",
    rule.streamId ?? "",
    rule.merchantNorm ?? "",
    rule.accountExternalId ?? "",
    rule.amountMinCents ?? "",
    rule.amountMaxCents ?? "",
    rule.dayMin ?? "",
    rule.dayMax ?? "",
    rule.category,
    rule.propertyId ?? "",
    rule.buildingKey ?? "",
  ].join("|");
}

function withNullableEq(query: any, column: string, value: string | number | null) {
  return value == null ? query.is(column, null) : query.eq(column, value);
}

async function findEquivalentRule(
  supabase: Supabase,
  orgId: string,
  rule: CategorizationRule,
): Promise<string | null> {
  let query = supabase
    .from("categorization_rules")
    .select("id")
    .eq("organization_id", orgId)
    .eq("scope_kind", rule.scopeKind)
    .eq("category", rule.category);
  query = withNullableEq(query, "merchant_entity_id", rule.merchantEntityId);
  query = withNullableEq(query, "stream_id", rule.streamId);
  query = withNullableEq(query, "merchant_norm", rule.merchantNorm);
  query = withNullableEq(query, "account_external_id", rule.accountExternalId);
  query = withNullableEq(query, "amount_min_cents", rule.amountMinCents);
  query = withNullableEq(query, "amount_max_cents", rule.amountMaxCents);
  query = withNullableEq(query, "day_min", rule.dayMin);
  query = withNullableEq(query, "day_max", rule.dayMax);
  query = withNullableEq(query, "property_id", rule.propertyId);
  query = withNullableEq(query, "building_key", rule.buildingKey);
  const { data } = await query.limit(1);
  return (data?.[0] as { id?: string } | undefined)?.id ?? null;
}

async function markImportRow(
  supabase: Supabase,
  orgId: string,
  rowId: string,
  status: "applied" | "skipped",
  appliedRef: string | null,
) {
  await supabase
    .from("categorization_import_rows")
    .update({ status, applied_ref: appliedRef })
    .eq("organization_id", orgId)
    .eq("id", rowId)
    .eq("status", "pending");
}

async function bankTxn(
  supabase: Supabase,
  orgId: string,
  txnId: string | null,
): Promise<BankTxnRow | null> {
  if (!txnId) return null;
  const { data } = await supabase
    .from("bank_transactions")
    .select(
      "id, amount_cents, posted_on, direction, merchant, description, raw_category, triage_status, merchant_entity_id, stream_id, account_external_id",
    )
    .eq("organization_id", orgId)
    .eq("id", txnId)
    .maybeSingle();
  return (data as BankTxnRow | null) ?? null;
}

export async function stageCategorizationImport(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?error=forbidden`);
  const org = await requireAccountingOrg();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`${BASE}?import=nofile`);
  if (file.size > MAX_IMPORT_BYTES) redirect(`${BASE}?import=toobig`);
  if (!file.name.toLowerCase().endsWith(".csv")) redirect(`${BASE}?import=not_csv`);

  let content = "";
  try {
    content = await file.text();
  } catch {
    redirect(`${BASE}?import=unreadable`);
  }

  const parsed = parseFreshbooksCsv(content);
  if (!parsed.ok) redirect(`${BASE}?import=${parsed.reason}`);

  const dates = parsed.rows.map((row) => row.date).sort();
  const from = addDaysIso(dates[0], -4);
  const to = addDaysIso(dates[dates.length - 1], 4);
  const supabase = createClient();
  const [{ data: txnData }, { data: propData }, { data: userData }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select(
        "id, amount_cents, posted_on, direction, merchant, description, triage_status, merchant_entity_id, stream_id, account_external_id",
      )
      .eq("organization_id", org.id)
      .gte("posted_on", from)
      .lte("posted_on", to)
      .limit(5000),
    supabase
      .from("properties")
      .select("id, address, building_key")
      .eq("organization_id", org.id),
    supabase.auth.getUser(),
  ]);

  const plan = buildCategorizationImportPlan(
    parsed.rows,
    ((txnData ?? []) as BankTxnRow[]).map(toPlanningTxn),
    ((propData ?? []) as PropertyRow[]).map((property) => ({
      id: property.id,
      address: property.address,
      buildingKey: property.building_key,
    })),
  );

  const { data: batch, error: batchErr } = await supabase
    .from("categorization_import_batches")
    .insert({
      organization_id: org.id,
      source: "freshbooks",
      filename: file.name.slice(0, 180),
      row_count: plan.length,
      created_by: userData.user?.id ?? null,
    })
    .select("id")
    .single();
  if (batchErr || !batch) redirect(`${BASE}?import=save`);

  const { error: rowErr } = await supabase.from("categorization_import_rows").insert(
    plan.map((row) => ({
      organization_id: org.id,
      batch_id: batch.id,
      row_no: row.rowNo,
      txn_date: row.date,
      amount_cents: row.amountCents,
      direction: row.direction,
      description: row.description,
      source_category: row.sourceCategory,
      client_tag: row.clientTag,
      matched_transaction_id: row.matchedTransactionId,
      planned_action: row.plannedAction,
      planned_category: row.plannedCategory,
      planned_property_id: row.plannedPropertyId,
      planned_building_key: row.plannedBuildingKey,
    })),
  );
  if (rowErr) {
    await supabase
      .from("categorization_import_batches")
      .update({ status: "discarded" })
      .eq("organization_id", org.id)
      .eq("id", batch.id);
    redirect(`${BASE}?import=save`);
  }

  revalidatePath(BASE);
  redirect(`${BASE}?batch=${batch.id}&staged=${plan.length}&skipped=${parsed.skipped}`);
}

export async function updatePlannedRow(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?error=forbidden`);
  const org = await requireAccountingOrg();
  const rowId = s(formData, "row_id");
  const batchId = s(formData, "batch_id");
  const action = asAction(s(formData, "planned_action"));
  if (!rowId || !batchId || !action) redirect(`${BASE}?error=badrow`);
  if (action === "rent_link") {
    await requireCapability("manage_tenancies", `${BASE}?error=forbidden`);
  }

  const categoryRaw = orNull(formData, "planned_category");
  const propertyId = orNull(formData, "planned_property_id");
  const buildingKey = orNull(formData, "planned_building_key");
  const category =
    action === "rule_seed" || action === "direct_expense"
      ? categoryRaw
      : null;
  if ((action === "rule_seed" || action === "direct_expense") && (!category || !isExpenseCategory(category))) {
    redirect(`${BASE}?batch=${batchId}&error=category`);
  }

  const supabase = createClient();
  const { data: batch } = await supabase
    .from("categorization_import_batches")
    .select("id, status")
    .eq("organization_id", org.id)
    .eq("id", batchId)
    .maybeSingle();
  if (!batch || batch.status !== "staged") redirect(`${BASE}?error=notfound`);
  const { data: importRow } = await supabase
    .from("categorization_import_rows")
    .select("id, source_category, direction, status")
    .eq("organization_id", org.id)
    .eq("batch_id", batchId)
    .eq("id", rowId)
    .maybeSingle();
  if (!importRow || importRow.status !== "pending") redirect(`${BASE}?error=badrow`);
  if (
    rowMapsExcluded(importRow as Pick<ImportRow, "source_category" | "direction">) &&
    action !== "exclude" &&
    action !== "needs_review"
  ) {
    redirect(`${BASE}?batch=${batchId}&error=personal`);
  }
  if (!(await propertyBelongsToOrg(supabase, org.id, propertyId))) {
    redirect(`${BASE}?batch=${batchId}&error=property`);
  }
  if (!(await buildingBelongsToOrg(supabase, org.id, buildingKey))) {
    redirect(`${BASE}?batch=${batchId}&error=property`);
  }

  await supabase
    .from("categorization_import_rows")
    .update({
      planned_action: action,
      planned_category: category,
      planned_property_id: propertyId,
      planned_building_key: buildingKey,
    })
    .eq("organization_id", org.id)
    .eq("batch_id", batchId)
    .eq("id", rowId)
    .eq("status", "pending");

  revalidatePath(BASE);
  redirect(`${BASE}?batch=${batchId}&updated=1`);
}

async function applyDirectExpense(
  supabase: Supabase,
  orgId: string,
  row: ImportRow,
): Promise<string | null> {
  if (!row.matched_transaction_id || !row.planned_category || !isExpenseCategory(row.planned_category)) {
    return null;
  }
  if (!(await propertyBelongsToOrg(supabase, orgId, row.planned_property_id))) return null;
  if (!(await buildingBelongsToOrg(supabase, orgId, row.planned_building_key))) return null;
  const txn = await bankTxn(supabase, orgId, row.matched_transaction_id);
  if (!txn || txn.direction !== "debit" || txn.triage_status !== "pending") return null;
  const expenseId = await insertExpenseAndAssign(supabase, orgId, txn, {
    category: row.planned_category,
    propertyId: row.planned_property_id,
    buildingKey: row.planned_building_key,
  });
  return expenseId ? `expense:${expenseId}` : null;
}

async function applyExclude(
  supabase: Supabase,
  orgId: string,
  row: ImportRow,
): Promise<string | null> {
  if (!row.matched_transaction_id) return null;
  const { data } = await supabase
    .from("bank_transactions")
    .update({ triage_status: "excluded" })
    .eq("organization_id", orgId)
    .eq("id", row.matched_transaction_id)
    .eq("triage_status", "pending")
    .select("id");
  return data && data.length > 0 ? `excluded:${row.matched_transaction_id}` : null;
}

async function applyRentLink(
  supabase: Supabase,
  orgId: string,
  row: ImportRow,
): Promise<string | null> {
  if (!row.matched_transaction_id || !row.planned_property_id) return null;
  const [{ data: txn }, { data: tenancy }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id, amount_cents, posted_on, direction, merchant, description, raw_category, triage_status")
      .eq("organization_id", orgId)
      .eq("id", row.matched_transaction_id)
      .maybeSingle(),
    supabase
      .from("tenancies")
      .select("id, rent_cents, status")
      .eq("organization_id", orgId)
      .eq("property_id", row.planned_property_id)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  const credit = txn as BankTxnRow | null;
  const activeTenancy = tenancy as { id: string; rent_cents: number | null; status: string } | null;
  if (!credit || !activeTenancy) return null;
  if (credit.direction !== "credit" || credit.triage_status !== "pending") return null;

  const periodMonth = normalizePeriodMonth(credit.posted_on);
  const { data: railData } = await supabase
    .from("rent_payments")
    .select("id, tenancy_id, amount_cents, period_month, source, bank_transaction_id")
    .eq("organization_id", orgId)
    .eq("tenancy_id", activeTenancy.id)
    .eq("amount_cents", credit.amount_cents)
    .eq("period_month", periodMonth)
    .in("source", RAIL_PAYMENT_SOURCES)
    .is("bank_transaction_id", null);
  const railLinks = railPaymentLinkCandidatesForTransaction(
    {
      amountCents: credit.amount_cents,
      postedOn: credit.posted_on,
      description: credit.description,
      source: [credit.merchant, credit.raw_category].filter(Boolean).join(" "),
    },
    [{ tenancyId: activeTenancy.id, rentCents: activeTenancy.rent_cents, label: "Tenancy" }],
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

  const { data: claimed } = await supabase
    .from("bank_transactions")
    .update({ triage_status: "rent" })
    .eq("organization_id", orgId)
    .eq("id", credit.id)
    .eq("triage_status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return null;

  if (railLinks[0]) {
    const { data: linked, error } = await supabase
      .from("rent_payments")
      .update({ bank_transaction_id: credit.id })
      .eq("organization_id", orgId)
      .eq("id", railLinks[0].paymentId)
      .in("source", RAIL_PAYMENT_SOURCES)
      .is("bank_transaction_id", null)
      .select("id")
      .maybeSingle();
    if (error || !linked) {
      await supabase
        .from("bank_transactions")
        .update({ triage_status: "pending" })
        .eq("organization_id", orgId)
        .eq("id", credit.id);
      return null;
    }
    return `rent_payment:${linked.id}`;
  }

  const { data: payment, error } = await supabase
    .from("rent_payments")
    .insert({
      organization_id: orgId,
      tenancy_id: activeTenancy.id,
      amount_cents: credit.amount_cents,
      method: "other",
      paid_on: credit.posted_on,
      period_month: periodMonth,
      source: "bank",
      bank_transaction_id: credit.id,
      note: "Recorded from FreshBooks history import",
    })
    .select("id")
    .single();
  if (error || !payment) {
    await supabase
      .from("bank_transactions")
      .update({ triage_status: "pending" })
      .eq("organization_id", orgId)
      .eq("id", credit.id);
    return null;
  }
  return `rent_payment:${payment.id}`;
}

async function ensureRuleForRow(
  supabase: Supabase,
  orgId: string,
  row: ImportRow,
  memo: Map<string, string>,
): Promise<string | null> {
  if (!row.matched_transaction_id || !row.planned_category || !isExpenseCategory(row.planned_category)) {
    return null;
  }
  if (!(await propertyBelongsToOrg(supabase, orgId, row.planned_property_id))) return null;
  if (!(await buildingBelongsToOrg(supabase, orgId, row.planned_building_key))) return null;
  const txn = await bankTxn(supabase, orgId, row.matched_transaction_id);
  if (!txn || txn.direction !== "debit" || txn.triage_status !== "pending") return null;
  const draft = draftRuleFromAssignment(
    {
      merchantEntityId: txn.merchant_entity_id,
      streamId: txn.stream_id,
      merchant: txn.merchant ?? txn.description,
      accountExternalId: txn.account_external_id,
      amountCents: txn.amount_cents,
    },
    {
      scopeKind: "stream",
      category: row.planned_category,
      propertyId: row.planned_property_id,
      buildingKey: row.planned_building_key,
      amountToleranceCents: Math.max(200, Math.round(txn.amount_cents * 0.05)),
    },
  );
  if (!draft) return null;
  const checked = validateRuleInput(draft);
  if (!checked.ok) return null;

  const key = ruleKey(checked.value);
  const seen = memo.get(key);
  if (seen) return seen;

  const existing = await findEquivalentRule(supabase, orgId, checked.value);
  if (existing) {
    memo.set(key, existing);
    return existing;
  }

  const { data: inserted, error } = await supabase
    .from("categorization_rules")
    .insert({
      organization_id: orgId,
      scope_kind: checked.value.scopeKind,
      merchant_entity_id: checked.value.merchantEntityId,
      stream_id: checked.value.streamId,
      merchant_norm: checked.value.merchantNorm,
      account_external_id: checked.value.accountExternalId,
      amount_min_cents: checked.value.amountMinCents,
      amount_max_cents: checked.value.amountMaxCents,
      day_min: checked.value.dayMin,
      day_max: checked.value.dayMax,
      category: checked.value.category,
      property_id: checked.value.propertyId,
      building_key: checked.value.buildingKey,
    })
    .select("id")
    .single();
  if (error || !inserted) return null;
  memo.set(key, inserted.id);
  return inserted.id;
}

export async function commitCategorizationImport(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?error=forbidden`);
  const org = await requireAccountingOrg();
  const batchId = s(formData, "batch_id");
  if (!batchId) redirect(`${BASE}?error=notfound`);

  const supabase = createClient();
  const { data: batch } = await supabase
    .from("categorization_import_batches")
    .select("id, status")
    .eq("organization_id", org.id)
    .eq("id", batchId)
    .maybeSingle();
  const batchRow = batch as ImportBatchRow | null;
  if (!batchRow) redirect(`${BASE}?error=notfound`);
  if (batchRow.status === "committed") redirect(`${BASE}?batch=${batchId}&committed=0&noop=1`);
  if (batchRow.status !== "staged") redirect(`${BASE}?error=notfound`);

  const { data: rowData } = await supabase
    .from("categorization_import_rows")
    .select(
      "id, row_no, txn_date, amount_cents, direction, description, source_category, client_tag, matched_transaction_id, planned_action, planned_category, planned_property_id, planned_building_key, status",
    )
    .eq("organization_id", org.id)
    .eq("batch_id", batchId)
    .eq("status", "pending")
    .order("row_no", { ascending: true });
  const rows = ((rowData ?? []) as ImportRow[]).filter(
    (row) => row.planned_action && APPLYING_ACTIONS.has(row.planned_action),
  );
  if (rows.some((row) => row.planned_action === "rent_link")) {
    await requireCapability("manage_tenancies", `${BASE}?error=forbidden`);
  }

  let applied = 0;
  let skipped = 0;
  const ruleRows: ImportRow[] = [];

  for (const row of rows) {
    let ref: string | null = null;
    if (rowMapsExcluded(row) && row.planned_action !== "exclude") {
      skipped += 1;
      await markImportRow(supabase, org.id, row.id, "skipped", null);
      continue;
    }
    if (row.planned_action === "direct_expense") {
      ref = await applyDirectExpense(supabase, org.id, row);
    } else if (row.planned_action === "exclude") {
      ref = await applyExclude(supabase, org.id, row);
    } else if (row.planned_action === "rent_link") {
      ref = await applyRentLink(supabase, org.id, row);
    } else if (row.planned_action === "rule_seed") {
      ruleRows.push(row);
      continue;
    }

    if (ref) {
      applied += 1;
      await markImportRow(supabase, org.id, row.id, "applied", ref);
    } else {
      skipped += 1;
      await markImportRow(supabase, org.id, row.id, "skipped", null);
    }
  }

  const ruleMemo = new Map<string, string>();
  const seeded: Array<{ row: ImportRow; ruleId: string }> = [];
  for (const row of ruleRows) {
    const ruleId = await ensureRuleForRow(supabase, org.id, row, ruleMemo);
    if (ruleId) {
      seeded.push({ row, ruleId });
    } else {
      skipped += 1;
      await markImportRow(supabase, org.id, row.id, "skipped", null);
    }
  }

  if (seeded.length > 0) {
    await autoApplyRules(org.id);
    for (const seed of seeded) {
      const txn = await bankTxn(supabase, org.id, seed.row.matched_transaction_id);
      if (txn && txn.triage_status !== "pending") {
        applied += 1;
        await markImportRow(supabase, org.id, seed.row.id, "applied", `rule:${seed.ruleId}`);
      } else {
        skipped += 1;
        await markImportRow(supabase, org.id, seed.row.id, "skipped", `rule:${seed.ruleId}`);
      }
    }
  }

  await supabase
    .from("categorization_import_batches")
    .update({ status: "committed", committed_at: new Date().toISOString() })
    .eq("organization_id", org.id)
    .eq("id", batchId)
    .eq("status", "staged");

  revalidatePath(BASE);
  revalidatePath("/dashboard/expenses");
  revalidatePath("/dashboard/money/reconcile");
  revalidatePath("/dashboard/rent/statement");
  redirect(`${BASE}?batch=${batchId}&committed=${applied}&skipped=${skipped}`);
}

export async function discardCategorizationImportBatch(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?error=forbidden`);
  const org = await requireAccountingOrg();
  const batchId = s(formData, "batch_id");
  if (!batchId) redirect(`${BASE}?error=notfound`);

  const supabase = createClient();
  await supabase
    .from("categorization_import_batches")
    .update({ status: "discarded" })
    .eq("organization_id", org.id)
    .eq("id", batchId)
    .eq("status", "staged");

  revalidatePath(BASE);
  redirect(`${BASE}?discarded=1`);
}
