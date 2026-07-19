// Unit tests for the pure T776 tax-package model.
// Run: npx tsx scripts/test-t776.ts
import {
  T776_LINES,
  buildT776Statement,
  t776LineForCategory,
  t776ToCsv,
  type T776StatementRow,
} from "@/lib/t776";
import { buildIncomeStatement } from "@/lib/income-statement";
import {
  type PropertyRef,
  type RentRow,
} from "@/lib/statements";
import { expenseToCostRow } from "@/lib/expenses";
import type { WorkOrderCostRow } from "@/lib/work-orders";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function lineAmount(row: T776StatementRow, line: string): number {
  return row.lines.find((item) => item.line === line)?.amountCents ?? 0;
}

function deductibleLineTotal(row: T776StatementRow): number {
  return row.lines
    .filter((line) => line.line !== "8299")
    .reduce((sum, line) => sum + line.amountCents, 0);
}

const PROP_A = "aaaaaaaa-0000-0000-0000-000000000001";
const PROP_B = "bbbbbbbb-0000-0000-0000-000000000002";
const PROP_C = "cccccccc-0000-0000-0000-000000000003";

const properties: PropertyRef[] = [
  { id: PROP_A, address: "10 Adelaide St" },
  { id: PROP_B, address: "20 Bay St" },
  { id: PROP_C, address: "30 College St" },
];

// --- Category -> T776 line mapping -----------------------------------------
ok("mapping: gross rent line present", T776_LINES[0].line === "8299");
ok("mapping: advertising -> 8521", t776LineForCategory("advertising") === "8521");
ok("mapping: insurance -> 8690", t776LineForCategory("insurance") === "8690");
ok("mapping: interest -> 8710", t776LineForCategory("interest") === "8710");
ok("mapping: supplies -> 8810", t776LineForCategory("supplies") === "8810");
ok("mapping: professional -> 8860", t776LineForCategory("professional") === "8860");
ok("mapping: management -> 8871", t776LineForCategory("management") === "8871");
ok("mapping: maintenance -> 8960", t776LineForCategory("maintenance") === "8960");
ok("mapping: work-order category -> 8960", t776LineForCategory("plumbing") === "8960");
ok("mapping: roof-like work-order category -> 8960", t776LineForCategory("roof") === "8960");
ok("mapping: property tax -> 9180", t776LineForCategory("property_tax") === "9180");
ok("mapping: travel -> 9200", t776LineForCategory("travel") === "9200");
ok("mapping: utilities -> 9220", t776LineForCategory("utilities") === "9220");
ok("mapping: condo fees -> 9270", t776LineForCategory("condo_fees") === "9270");
ok("mapping: unknown -> 9270", t776LineForCategory("mystery") === "9270");
ok("mapping: mortgage principal excluded", t776LineForCategory("mortgage") === null);

// --- Main fixture -----------------------------------------------------------
const rentRows: RentRow[] = [
  { property_id: PROP_A, amount_cents: 250000, paid_on: "2026-01-05" },
  { property_id: PROP_A, amount_cents: 250000, paid_on: "2026-02-05" },
  { property_id: PROP_B, amount_cents: 180000, paid_on: "2026-01-04" },
  { property_id: null, amount_cents: 30000, paid_on: "2026-01-10" },
  { property_id: PROP_A, amount_cents: 999999, paid_on: "2025-12-31" },
  { property_id: PROP_A, amount_cents: 111111, paid_on: null },
];

const costRows: WorkOrderCostRow[] = [
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "advertising", amount_cents: 10000, incurred_on: "2026-01-10" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "insurance", amount_cents: 20000, incurred_on: "2026-01-11" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "interest", amount_cents: 15000, incurred_on: "2026-01-12" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "supplies", amount_cents: 8000, incurred_on: "2026-01-13" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "professional", amount_cents: 12000, incurred_on: "2026-01-14" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "management", amount_cents: 14000, incurred_on: "2026-01-15" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "property_tax", amount_cents: 40000, incurred_on: "2026-01-16" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "travel", amount_cents: 6000, incurred_on: "2026-01-17" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "utilities", amount_cents: 18000, incurred_on: "2026-01-18" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "condo_fees", amount_cents: 22000, incurred_on: "2026-01-19" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "mortgage", amount_cents: 50000, incurred_on: "2026-01-20" }),
  { property_id: PROP_A, building_key: null, category: "plumbing", status: "completed", cost_cents: 30000, completed_on: "2026-01-21" },
  { property_id: PROP_B, building_key: null, category: "hvac", status: "completed", cost_cents: 35000, completed_on: "2026-02-01" },
  expenseToCostRow({ property_id: PROP_B, building_key: null, category: "interest", amount_cents: 9000, incurred_on: "2026-02-02" }),
  expenseToCostRow({ property_id: PROP_B, building_key: null, category: "mortgage", amount_cents: 30000, incurred_on: "2026-02-02" }),
  expenseToCostRow({ property_id: null, building_key: null, category: "other", amount_cents: 7000, incurred_on: "2026-02-03" }),
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "utilities", amount_cents: 99999, incurred_on: "2025-06-01" }),
  { property_id: PROP_A, building_key: null, category: "electrical", status: "completed", cost_cents: 55555, completed_on: null },
];

const statement = buildT776Statement(rentRows, costRows, properties, 2026);
const rowA = statement.rows.find((row) => row.propertyId === PROP_A)!;
const rowB = statement.rows.find((row) => row.propertyId === PROP_B)!;
const rowU = statement.rows.find((row) => row.propertyId === null)!;

// --- Gross rent, line totals, principal memo, 9369 --------------------------
ok("8299: A gross rent", rowA.grossRentCents === 500000 && lineAmount(rowA, "8299") === 500000);
ok("8299: portfolio gross rent excludes out-of-year and undated", statement.totals.grossRentCents === 710000);
ok("line 8960: combines maintenance and work-order repairs", lineAmount(rowA, "8960") === 30000);
ok("line 9270: other expense bucket", lineAmount(rowA, "9270") === 22000);
ok("total expenses: sum of line amounts", rowA.totalExpensesCents === deductibleLineTotal(rowA));
ok("principal: separate memo", rowA.principalMemoCents === 50000);
ok("principal: never in total expenses", rowA.totalExpensesCents === 195000);
ok("9369: gross rent - total expenses", rowA.netBeforeAdjustmentsCents === 305000);

// --- Per-property + portfolio ----------------------------------------------
ok("rows: no-activity property omitted", !statement.rows.some((row) => row.propertyId === PROP_C));
ok("rows: sorted by address", statement.rows[0].propertyId === PROP_A && statement.rows[1].propertyId === PROP_B);
ok("rows: unassigned last", statement.rows[statement.rows.length - 1].propertyId === null);
ok("unassigned: other expense and rent", rowU.grossRentCents === 30000 && rowU.totalExpensesCents === 7000);
ok("portfolio: gross rent sums rows", statement.totals.grossRentCents === rowA.grossRentCents + rowB.grossRentCents + rowU.grossRentCents);
ok("portfolio: expenses recomputed", statement.totals.totalExpensesCents === rowA.totalExpensesCents + rowB.totalExpensesCents + rowU.totalExpensesCents);
ok("portfolio: principal memo", statement.totals.principalMemoCents === 80000);
ok("portfolio: net before adjustments", statement.totals.netBeforeAdjustmentsCents === statement.totals.grossRentCents - statement.totals.totalExpensesCents);

// --- Year filter ------------------------------------------------------------
const year2025 = buildT776Statement(rentRows, costRows, properties, 2025);
ok("year filter: includes 2025 rent", year2025.totals.grossRentCents === 999999);
ok("year filter: includes 2025 expenses", year2025.totals.totalExpensesCents === 99999);
ok("year filter: excludes undated cost", !year2025.rows.some((row) => lineAmount(row, "8960") === 55555));

// --- Reconciliation to Slice B net income pre-CCA ---------------------------
const income = buildIncomeStatement(rentRows, costRows, properties, statement.range);
ok("reconcile: portfolio T776 net = Slice B net income", statement.totals.netBeforeAdjustmentsCents === income.totals.netIncomeCents);
for (const row of statement.rows) {
  const incomeRow = income.rows.find((item) => item.propertyId === row.propertyId);
  ok(`reconcile: ${row.address} T776 net = Slice B net income`, row.netBeforeAdjustmentsCents === incomeRow?.netIncomeCents);
}

// --- CSV --------------------------------------------------------------------
const csv = t776ToCsv(statement);
ok("csv: title", csv.startsWith("T776 tax package"));
ok("csv: tax year", csv.includes("Tax year,2026"));
ok("csv: 8299 row", csv.includes("8299,Total gross rental income,5000.00"));
ok("csv: total expenses", csv.includes(",Total expenses,1950.00"));
ok("csv: 9369 row", csv.includes("9369,Net income (loss) before adjustments,3050.00"));
ok("csv: principal memo", csv.includes("Memo,Mortgage principal excluded from deductible expenses,500.00"));
ok("csv: CCA placeholder", csv.includes("9936,Capital cost allowance,enter with your accountant"));
ok("csv: 9946 row", csv.includes("9946,Your net income (loss),3050.00"));
ok("csv: footer note", csv.includes("This is an accountant-ready summary, not a filed return."));
ok("csv: newline", csv.endsWith("\n"));

const total = passed + failed;
console.log(`PASS ${passed}/${total}`);
if (failed > 0) process.exit(1);
