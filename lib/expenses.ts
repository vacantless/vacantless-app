// Pure expense domain model (no I/O) so it can be unit-tested in isolation.
// Run: npx tsx scripts/test-expenses.ts
//
// An `expense` (migration 0058) is the owner's NON-maintenance property cost —
// mortgage, property tax, utilities, insurance, ... — captured from the bank feed
// (or entered manually / imported). It is the sibling of a work_order: the
// work-order module records what the owner SPENT ON MAINTENANCE, this records
// every OTHER property cost. Both attach to exactly ONE scope level (unit XOR
// building, the 0057 discipline) and both roll up through the same owner
// statement. To get that for free, an expense maps to a WorkOrderCostRow
// (expenseToCostRow) so groupCostBy* / buildOwnerStatement consume it unchanged.
//
// This file is the capture + triage brain: the category whitelist, validation,
// the txn -> expense draft, and the cost-row mapping. It deliberately REUSES the
// scope helpers from lib/work-orders rather than re-deriving unit-vs-building.

import { workOrderScope, type WorkOrderScope, type WorkOrderCostRow } from "./work-orders";

// --- Categories -------------------------------------------------------------
//
// Broader than the maintenance-only work-order categories: an owner's expense
// ledger spans financing (mortgage, interest), statutory (property tax),
// operating (utilities, insurance, condo fees), and overhead (management,
// professional, advertising). Matches the CHECK whitelist in migration 0058.
// Free-ish text + whitelist, NOT a pg enum, so adding one later is a one-line
// CHECK change (same rule as work_orders / rent_payments).

export const EXPENSE_CATEGORIES = [
  "mortgage",
  "property_tax",
  "insurance",
  "utilities",
  "maintenance",
  "management",
  "interest",
  "condo_fees",
  "supplies",
  "professional",
  "advertising",
  "travel",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  mortgage: "Mortgage",
  property_tax: "Property Tax",
  insurance: "Insurance",
  utilities: "Utilities",
  maintenance: "Maintenance & Repairs",
  management: "Management",
  interest: "Interest",
  condo_fees: "Condo / HOA Fees",
  supplies: "Supplies",
  professional: "Professional Fees",
  advertising: "Advertising",
  travel: "Travel",
  other: "Other",
};

export function isExpenseCategory(v: string): v is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(v);
}

export function expenseCategoryLabel(category: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}

// --- DB row + cost-row mapping ----------------------------------------------

export type ExpenseRow = {
  property_id: string | null;
  building_key?: string | null;
  category: string;
  amount_cents: number;
  incurred_on: string; // "YYYY-MM-DD"
};

/**
 * Map an expense to the WorkOrderCostRow shape so it flows through the existing
 * cost rollups + owner statement (lib/statements.ts) with no new reporting code.
 * incurred_on -> completed_on (the dated, counted field); amount_cents ->
 * cost_cents; status is a constant non-empty value ('confirmed') because an
 * expense is, by definition, already incurred — there is no pending/cancelled
 * lifecycle to filter on the way a work order has.
 */
export function expenseToCostRow(e: ExpenseRow): WorkOrderCostRow {
  return {
    property_id: e.property_id,
    building_key: e.building_key ?? null,
    category: e.category,
    status: "confirmed",
    cost_cents: e.amount_cents,
    completed_on: e.incurred_on,
  };
}

/** Scope (unit / building / unscoped) of an expense — reuses the 0057 helper. */
export function expenseScope(e: {
  property_id: string | null;
  building_key?: string | null;
}): WorkOrderScope {
  return workOrderScope(e);
}

// --- Validation -------------------------------------------------------------

export type ExpenseInput = {
  category?: string;
  amountCents?: number | null;
  incurredOn?: string | null;
  propertyId?: string | null;
  buildingKey?: string | null;
  merchant?: string | null;
  note?: string | null;
  source?: string | null;
  bankTransactionId?: string | null;
};

export type ExpenseValue = {
  category: ExpenseCategory;
  amountCents: number;
  incurredOn: string;
  propertyId: string | null;
  buildingKey: string | null;
  merchant: string | null;
  note: string | null;
  source: "manual" | "bank" | "import";
  bankTransactionId: string | null;
};

export type ExpenseValidation =
  | { ok: true; value: ExpenseValue }
  | { ok: false; code: "category" | "amount" | "date" | "scope" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXPENSE_SOURCES = ["manual", "bank", "import"] as const;

function nonEmpty(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/**
 * Validate a create/edit expense submission. Amount is required and must be a
 * non-negative integer cents value; date required + ISO; category defaults to
 * "other" but must be a known one; scope must be at most ONE level (unit XOR
 * building) so the DB CHECK (expenses_scope_chk) can never fire from the app —
 * same guard pattern as the work-order resolveScope.
 */
export function validateExpenseInput(v: ExpenseInput): ExpenseValidation {
  const rawCat = (v.category ?? "").trim();
  const category = rawCat === "" ? "other" : rawCat;
  if (!isExpenseCategory(category)) return { ok: false, code: "category" };

  const amountCents = v.amountCents;
  if (amountCents == null || !Number.isInteger(amountCents) || amountCents < 0) {
    return { ok: false, code: "amount" };
  }

  const incurredOn = (v.incurredOn ?? "").trim();
  if (!ISO_DATE.test(incurredOn)) return { ok: false, code: "date" };

  const propertyId = nonEmpty(v.propertyId);
  const buildingKey = nonEmpty(v.buildingKey);
  // exactly-one-of OR neither — never both (mirrors expenses_scope_chk).
  if (propertyId != null && buildingKey != null) return { ok: false, code: "scope" };

  const rawSource = (v.source ?? "manual").trim();
  const source = (EXPENSE_SOURCES as readonly string[]).includes(rawSource)
    ? (rawSource as "manual" | "bank" | "import")
    : "manual";

  return {
    ok: true,
    value: {
      category,
      amountCents,
      incurredOn,
      propertyId,
      buildingKey,
      merchant: nonEmpty(v.merchant),
      note: nonEmpty(v.note),
      source,
      bankTransactionId: nonEmpty(v.bankTransactionId),
    },
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  category: "Pick a valid expense category.",
  amount: "Enter a valid amount.",
  date: "Enter a valid date.",
  scope: "An expense can be for a unit or the whole building, not both.",
  forbidden: "You don't have permission to manage expenses.",
  notfound: "That expense could not be found.",
};

export function expenseErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please check the form.";
}

// --- Bank transaction -> expense draft --------------------------------------
//
// When the owner triages a staged debit, we pre-fill an expense from it. The
// amount + date + merchant come straight off the transaction; the category is a
// best-effort hint from the aggregator's generic category (advisory — the owner
// confirms). Scope is NOT guessed: the owner assigns the unit/building.

export type TransactionDraftSource = {
  amount_cents: number;
  posted_on: string;
  merchant?: string | null;
  raw_category?: string | null;
  id?: string | null;
};

/**
 * Best-effort map of an aggregator's free-text category to one of ours. Advisory
 * only — defaults to "other" and is always overridable by the owner. Kept
 * deliberately small + keyword-based; the aggregator's taxonomy is not ours.
 */
export function categoryFromRawHint(raw: string | null | undefined): ExpenseCategory {
  const s = (raw ?? "").toLowerCase();
  if (s === "") return "other";
  if (/(mortgage|loan payment)/.test(s)) return "mortgage";
  if (/(property tax|municipal|city of)/.test(s)) return "property_tax";
  if (/(insurance)/.test(s)) return "insurance";
  if (/(utilit|hydro|electric|gas|water|enbridge|energy)/.test(s)) return "utilities";
  if (/(repair|maintenance|plumb|hvac|roof|contractor|hardware|lumber)/.test(s)) return "maintenance";
  if (/(interest|bank fee|service charge)/.test(s)) return "interest";
  if (/(condo|hoa|strata)/.test(s)) return "condo_fees";
  if (/(advertis|marketing|listing)/.test(s)) return "advertising";
  if (/(legal|account|professional)/.test(s)) return "professional";
  if (/(supplies|office)/.test(s)) return "supplies";
  return "other";
}

/**
 * Build an ExpenseInput draft from a staged bank transaction, ready to hand to
 * validateExpenseInput once the owner picks a scope. source is fixed to "bank"
 * and the originating transaction id is carried so the expense links back.
 */
export function draftExpenseFromTransaction(
  txn: TransactionDraftSource,
  scope: { propertyId?: string | null; buildingKey?: string | null } = {},
): ExpenseInput {
  return {
    category: categoryFromRawHint(txn.raw_category),
    amountCents: txn.amount_cents,
    incurredOn: txn.posted_on,
    merchant: txn.merchant ?? null,
    propertyId: scope.propertyId ?? null,
    buildingKey: scope.buildingKey ?? null,
    source: "bank",
    bankTransactionId: txn.id ?? null,
  };
}
