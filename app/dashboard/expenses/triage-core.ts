// Shared triage internals for the bank-feed expense module. Extracted from
// actions.ts (S411) so BOTH the live-sync action file (actions.ts) and the
// file-import action file (import-actions.ts) reuse the exact same rule
// auto-filing without duplicating it — and without exporting it as a public
// server action (this is a plain module, not a "use server" file).
//
// Behavior is byte-identical to the versions that lived in actions.ts; only the
// location changed. See CSV-OFX-BANK-FEED-IMPORT-SPEC-2026-07-01.md.

import { createClient } from "@/lib/supabase/server";
import { validateExpenseInput } from "@/lib/expenses";
import {
  bestRuleForTxn,
  ruleAutoFiles,
  resolveRuleAssignment,
  type CategorizationRule,
  type MatchableTxn,
} from "@/lib/categorization-rules";

export type DbClient = ReturnType<typeof createClient>;

export type RuleRow = {
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

export const RULE_COLUMNS =
  "id, scope_kind, merchant_entity_id, stream_id, merchant_norm, account_external_id, amount_min_cents, amount_max_cents, day_min, day_max, category, property_id, building_key, times_applied, last_applied_at, created_at";

export function mapRuleRow(r: RuleRow): CategorizationRule {
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

export type StagedTxn = {
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
export async function insertExpenseAndAssign(
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
 *
 * Returns the number of pending debits it filed this run. The count powers the
 * "also filed N more matching lines" feedback when the sweep runs RETROACTIVELY
 * over lines already in the queue (a fresh Remember-this, or the standalone
 * "Apply saved rules" button), not just at import/sync time. Existing callers
 * ignore the return, so widening void→number is backward-compatible.
 */
export async function autoApplyRules(orgId: string): Promise<number> {
  const supabase = createClient();

  const { data: ruleData } = await supabase.from("categorization_rules").select(RULE_COLUMNS);
  const ruleRows = (ruleData ?? []) as RuleRow[];
  if (ruleRows.length === 0) return 0;
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
  let filed = 0;
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
    if (expId) {
      fired.set(rule.id, (fired.get(rule.id) ?? 0) + 1);
      filed += 1;
    }
  }

  const now = new Date().toISOString();
  for (const [ruleId, count] of fired) {
    await supabase
      .from("categorization_rules")
      .update({ times_applied: (baseCount.get(ruleId) ?? 0) + count, last_applied_at: now })
      .eq("id", ruleId);
  }
  return filed;
}
