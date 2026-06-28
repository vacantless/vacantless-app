// Unit tests for the pure expense domain model. Run: npx tsx scripts/test-expenses.ts
import {
  EXPENSE_CATEGORIES,
  isExpenseCategory,
  expenseCategoryLabel,
  expenseToCostRow,
  expenseScope,
  validateExpenseInput,
  expenseErrorMessage,
  categoryFromRawHint,
  draftExpenseFromTransaction,
  draftExpenseFromReceipt,
  type ExpenseRow,
} from "../lib/expenses";
import {
  groupCostByProperty,
  groupCostByCategory,
  sumCostCents,
  type WorkOrderCostRow,
} from "../lib/work-orders";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Categories -------------------------------------------------------------
ok("categories include mortgage + property_tax", EXPENSE_CATEGORIES.includes("mortgage") && EXPENSE_CATEGORIES.includes("property_tax"));
ok("isExpenseCategory true", isExpenseCategory("utilities"));
ok("isExpenseCategory false", !isExpenseCategory("zzz"));
ok("label known", expenseCategoryLabel("property_tax") === "Property Tax");
ok("label passthrough", expenseCategoryLabel("zzz") === "zzz");

// --- Validation -------------------------------------------------------------
const good = validateExpenseInput({ category: "utilities", amountCents: 19880, incurredOn: "2026-06-01", propertyId: "p1" });
ok("valid expense ok", good.ok === true);
ok("valid expense scope unit", good.ok && good.value.propertyId === "p1" && good.value.buildingKey === null);

ok("default category -> other", (() => { const r = validateExpenseInput({ amountCents: 100, incurredOn: "2026-01-01" }); return r.ok && r.value.category === "other"; })());
ok("bad category rejected", validateExpenseInput({ category: "zzz", amountCents: 100, incurredOn: "2026-01-01" }).ok === false);
ok("missing amount rejected", validateExpenseInput({ category: "other", incurredOn: "2026-01-01" }).ok === false);
ok("negative amount rejected", validateExpenseInput({ category: "other", amountCents: -5, incurredOn: "2026-01-01" }).ok === false);
ok("non-integer amount rejected", validateExpenseInput({ category: "other", amountCents: 1.5, incurredOn: "2026-01-01" }).ok === false);
ok("bad date rejected", validateExpenseInput({ category: "other", amountCents: 100, incurredOn: "06/01/2026" }).ok === false);
ok("missing date rejected", validateExpenseInput({ category: "other", amountCents: 100 }).ok === false);

// scope: both set is rejected (mirrors expenses_scope_chk); neither is allowed (unscoped overhead)
ok("both-scope rejected", validateExpenseInput({ category: "other", amountCents: 100, incurredOn: "2026-01-01", propertyId: "p1", buildingKey: "b1" }).ok === false);
const unscoped = validateExpenseInput({ category: "mortgage", amountCents: 100, incurredOn: "2026-01-01" });
ok("neither-scope allowed (unscoped)", unscoped.ok === true && unscoped.ok && unscoped.value.propertyId === null && unscoped.value.buildingKey === null);
const bldg = validateExpenseInput({ category: "maintenance", amountCents: 100, incurredOn: "2026-01-01", buildingKey: "100 king st" });
ok("building-scope allowed", bldg.ok === true && bldg.ok && bldg.value.buildingKey === "100 king st");

// blank strings normalize to null scope (not "both")
ok("blank scope strings -> null", (() => { const r = validateExpenseInput({ category: "other", amountCents: 1, incurredOn: "2026-01-01", propertyId: "  ", buildingKey: "" }); return r.ok && r.value.propertyId === null && r.value.buildingKey === null; })());

// source defaulting + whitelist
ok("source defaults manual", (() => { const r = validateExpenseInput({ amountCents: 1, incurredOn: "2026-01-01" }); return r.ok && r.value.source === "manual"; })());
ok("source bank preserved", (() => { const r = validateExpenseInput({ amountCents: 1, incurredOn: "2026-01-01", source: "bank" }); return r.ok && r.value.source === "bank"; })());
ok("bad source -> manual", (() => { const r = validateExpenseInput({ amountCents: 1, incurredOn: "2026-01-01", source: "hack" }); return r.ok && r.value.source === "manual"; })());

ok("error message known", expenseErrorMessage("scope") === "An expense can be for a unit or the whole building, not both.");
ok("error message none", expenseErrorMessage(undefined) === null);

// --- Scope helper -----------------------------------------------------------
ok("scope unit", expenseScope({ property_id: "p1" }) === "unit");
ok("scope building", expenseScope({ property_id: null, building_key: "b1" }) === "building");
ok("scope unscoped", expenseScope({ property_id: null, building_key: null }) === "unscoped");

// --- Cost-row mapping: expenses flow through the statement rollups -----------
const expenses: ExpenseRow[] = [
  { property_id: "p1", building_key: null, category: "utilities", amount_cents: 19880, incurred_on: "2026-06-01" },
  { property_id: "p1", building_key: null, category: "mortgage", amount_cents: 100000, incurred_on: "2026-06-02" },
  { property_id: null, building_key: "100 king st", category: "maintenance", amount_cents: 50000, incurred_on: "2026-06-03" }, // shared
  { property_id: null, building_key: null, category: "interest", amount_cents: 3162, incurred_on: "2026-06-04" }, // overhead
];
const costRows: WorkOrderCostRow[] = expenses.map(expenseToCostRow);

ok("expenseToCostRow maps incurred_on -> completed_on", costRows[0].completed_on === "2026-06-01");
ok("expenseToCostRow maps amount -> cost_cents", costRows[0].cost_cents === 19880);
ok("expenseToCostRow status confirmed (counted)", costRows[0].status === "confirmed");

ok("sum across all expenses", sumCostCents(costRows) === 19880 + 100000 + 50000 + 3162);

const byProp = groupCostByProperty(costRows);
const p1 = byProp.find((b) => b.key === "p1");
ok("p1 unit total (utilities + mortgage)", !!p1 && p1.totalCents === 119880 && p1.count === 2);
const nullProp = byProp.find((b) => b.key === null);
ok("null-property bucket (shared + overhead)", !!nullProp && nullProp.totalCents === 53162);

const byCat = groupCostByCategory(costRows);
ok("category rollup mortgage", byCat.find((b) => b.key === "mortgage")?.totalCents === 100000);
ok("category rollup utilities", byCat.find((b) => b.key === "utilities")?.totalCents === 19880);

// date window filter works the same as work orders
ok("date filter excludes out-of-range", sumCostCents(costRows, { from: "2026-06-02", to: "2026-06-03" }) === 100000 + 50000);

// --- Raw-category hint mapping (advisory) -----------------------------------
ok("hint hydro -> utilities", categoryFromRawHint("Utilities - Hydro One") === "utilities");
ok("hint mortgage", categoryFromRawHint("MORTGAGE PAYMENT") === "mortgage");
ok("hint lumber -> maintenance", categoryFromRawHint("New Canadian Lumber") === "maintenance");
ok("hint property tax", categoryFromRawHint("City of Windsor property tax") === "property_tax");
ok("hint empty -> other", categoryFromRawHint("") === "other");
ok("hint unknown -> other", categoryFromRawHint("Coffee shop") === "other");

// --- Draft from transaction -------------------------------------------------
const draft = draftExpenseFromTransaction(
  { amount_cents: 19880, posted_on: "2026-06-01", merchant: "Enbridge", raw_category: "Utilities", id: "txn_1" },
  { propertyId: "p1" },
);
ok("draft carries amount + date", draft.amountCents === 19880 && draft.incurredOn === "2026-06-01");
ok("draft category hinted", draft.category === "utilities");
ok("draft source bank", draft.source === "bank");
ok("draft links txn", draft.bankTransactionId === "txn_1");
ok("draft carries scope", draft.propertyId === "p1");
ok("draft then validates", validateExpenseInput(draft).ok === true);

// --- 'scan' source acceptance (S365 Phase 2) --------------------------------
const scanSrc = validateExpenseInput({
  category: "maintenance",
  amountCents: 129999,
  incurredOn: "2026-06-15",
  propertyId: "p1",
  source: "scan",
});
ok("scan source accepted + preserved", scanSrc.ok === true && scanSrc.value.source === "scan");
const badSrc = validateExpenseInput({
  category: "maintenance",
  amountCents: 100,
  incurredOn: "2026-06-15",
  source: "bogus",
});
ok("unknown source falls back to manual", badSrc.ok === true && badSrc.value.source === "manual");

// --- Draft from receipt (the receipt -> expense rail) -----------------------
const rDraft = draftExpenseFromReceipt(
  { merchant: "Home Depot", purchase_date: "2026-06-15", total_cents: 129999, appliance_type: "fridge", make: "Whirlpool" },
  { propertyId: "p1" },
);
ok("receipt draft carries amount + date", rDraft.amountCents === 129999 && rDraft.incurredOn === "2026-06-15");
ok("receipt naming an appliance => maintenance", rDraft.category === "maintenance");
ok("receipt draft source scan", rDraft.source === "scan");
ok("receipt draft no bank txn link", rDraft.bankTransactionId === null);
ok("receipt draft carries scope", rDraft.propertyId === "p1");
ok("receipt draft carries merchant", rDraft.merchant === "Home Depot");
ok("receipt draft then validates", validateExpenseInput(rDraft).ok === true);

// No appliance named => category falls back to the merchant hint.
const rUtil = draftExpenseFromReceipt({ merchant: "Enbridge Gas", purchase_date: "2026-05-01", total_cents: 8800 });
ok("receipt w/o appliance hints off merchant", rUtil.category === "utilities");

// Missing date => falls back to the provided 'today' (deterministic in test).
const rNoDate = draftExpenseFromReceipt({ merchant: "Lowe's", total_cents: 5000 }, {}, "2026-06-28");
ok("receipt missing date falls back to today", rNoDate.incurredOn === "2026-06-28");

// Missing total => amount null so validation prompts (rather than inventing one).
const rNoTotal = draftExpenseFromReceipt({ merchant: "Lowe's", purchase_date: "2026-06-01" });
ok("receipt missing total => amount null", rNoTotal.amountCents === null);
ok("receipt missing total fails validation on amount", validateExpenseInput(rNoTotal).ok === false);

console.log(`\nexpenses: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
