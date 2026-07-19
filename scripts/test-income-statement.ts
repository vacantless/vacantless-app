// Unit tests for the pure actual-basis income-statement model.
// Run: npx tsx scripts/test-income-statement.ts
import {
  buildIncomeStatement,
  incomeStatementToCsv,
  netMarginLabel,
  type IncomeStatementRow,
} from "@/lib/income-statement";
import {
  buildOwnerStatement,
  type DateRange,
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

function sumRows(rows: IncomeStatementRow[], key: keyof IncomeStatementRow): number {
  return rows.reduce((sum, row) => sum + (row[key] as number), 0);
}

const RANGE: DateRange = { from: "2026-01-01", to: "2026-12-31" };
const PROP_A = "aaaaaaaa-0000-0000-0000-000000000001";
const PROP_B = "bbbbbbbb-0000-0000-0000-000000000002";
const PROP_C = "cccccccc-0000-0000-0000-000000000003";

const properties: PropertyRef[] = [
  { id: PROP_A, address: "10 Adelaide St" },
  { id: PROP_B, address: "20 Bay St" },
  { id: PROP_C, address: "30 College St" },
];

// --- A. Core P&L math -------------------------------------------------------
{
  const rentRows: RentRow[] = [
    { property_id: PROP_A, amount_cents: 300000, paid_on: "2026-02-01" },
  ];
  const costRows: WorkOrderCostRow[] = [
    expenseToCostRow({
      property_id: PROP_A,
      building_key: null,
      category: "property_tax",
      amount_cents: 40000,
      incurred_on: "2026-02-10",
    }),
    expenseToCostRow({
      property_id: PROP_A,
      building_key: null,
      category: "interest",
      amount_cents: 15000,
      incurred_on: "2026-02-10",
    }),
    expenseToCostRow({
      property_id: PROP_A,
      building_key: null,
      category: "mortgage",
      amount_cents: 50000,
      incurred_on: "2026-02-10",
    }),
  ];
  const statement = buildIncomeStatement(rentRows, costRows, properties, RANGE);
  const row = statement.rows.find((r) => r.propertyId === PROP_A)!;

  ok("core: revenue", row.revenueCents === 300000);
  ok("core: NOI = rent - operating", row.noiCents === 260000);
  ok("core: net income subtracts interest only", row.netIncomeCents === 245000);
  ok("core: principal excluded from net income", row.principalCents === 50000 && row.netIncomeCents === 245000);
  ok("core: net cash subtracts principal", row.netCashCents === 195000);
}

// --- B. Operating classification ------------------------------------------
{
  const statement = buildIncomeStatement(
    [],
    [
      expenseToCostRow({ property_id: PROP_A, building_key: null, category: "property_tax", amount_cents: 40000, incurred_on: "2026-03-01" }),
      expenseToCostRow({ property_id: PROP_A, building_key: null, category: "maintenance", amount_cents: 20000, incurred_on: "2026-03-02" }),
      expenseToCostRow({ property_id: PROP_A, building_key: null, category: "interest", amount_cents: 15000, incurred_on: "2026-03-03" }),
      expenseToCostRow({ property_id: PROP_A, building_key: null, category: "mortgage", amount_cents: 50000, incurred_on: "2026-03-04" }),
    ],
    properties,
    RANGE,
  );
  const categories = new Map(statement.operatingCategories.map((c) => [c.category, c.totalCents]));
  const row = statement.rows.find((r) => r.propertyId === PROP_A)!;

  ok("classification: operating excludes interest", !categories.has("interest"));
  ok("classification: operating excludes mortgage principal", !categories.has("mortgage"));
  ok("classification: operating includes property tax", categories.get("property_tax") === 40000);
  ok("classification: operating total excludes financing", row.operatingExpensesCents === 60000);
}

// --- C. Reconciliation invariant against owner statement --------------------
{
  const rentRows: RentRow[] = [
    { property_id: PROP_A, amount_cents: 250000, paid_on: "2026-04-01" },
    { property_id: PROP_B, amount_cents: 180000, paid_on: "2026-04-02" },
  ];
  const costRows: WorkOrderCostRow[] = [
    expenseToCostRow({ property_id: PROP_A, building_key: null, category: "utilities", amount_cents: 25000, incurred_on: "2026-04-03" }),
    expenseToCostRow({ property_id: PROP_A, building_key: null, category: "interest", amount_cents: 12000, incurred_on: "2026-04-03" }),
    expenseToCostRow({ property_id: PROP_A, building_key: null, category: "mortgage", amount_cents: 45000, incurred_on: "2026-04-03" }),
    expenseToCostRow({ property_id: PROP_B, building_key: null, category: "insurance", amount_cents: 20000, incurred_on: "2026-04-04" }),
    { property_id: PROP_B, building_key: null, category: "plumbing", status: "completed", cost_cents: 30000, completed_on: "2026-04-05" },
  ];
  const income = buildIncomeStatement(rentRows, costRows, properties, RANGE);
  const owner = buildOwnerStatement(rentRows, costRows, properties, RANGE);

  ok("reconcile: portfolio net cash = owner statement net", income.totals.netCashCents === owner.totals.netCents);
  for (const row of income.rows) {
    const ownerRow = owner.rows.find((r) => r.propertyId === row.propertyId);
    ok(`reconcile: ${row.address} net cash = owner net`, row.netCashCents === ownerRow?.netCents);
  }
}

// --- D. Multi-property, unassigned bucket, sorting, no-activity omitted ------
{
  const rentRows: RentRow[] = [
    { property_id: PROP_B, amount_cents: 180000, paid_on: "2026-05-01" },
    { property_id: PROP_A, amount_cents: 250000, paid_on: "2026-05-01" },
    { property_id: null, amount_cents: 10000, paid_on: "2026-05-03" },
  ];
  const costRows: WorkOrderCostRow[] = [
    expenseToCostRow({ property_id: null, building_key: null, category: "professional", amount_cents: 30000, incurred_on: "2026-05-05" }),
    { property_id: null, building_key: "20-bay-st", category: "landscaping", status: "completed", cost_cents: 20000, completed_on: "2026-05-06" },
  ];
  const statement = buildIncomeStatement(rentRows, costRows, properties, RANGE);

  ok("multi: no-activity property omitted", !statement.rows.some((r) => r.propertyId === PROP_C));
  ok("multi: sorted by address", statement.rows[0].propertyId === PROP_A && statement.rows[1].propertyId === PROP_B);
  ok("multi: unassigned last", statement.rows[statement.rows.length - 1].propertyId === null);
  ok("multi: building-scoped cost buckets to unassigned", statement.rows.find((r) => r.propertyId === null)?.operatingExpensesCents === 50000);
}

// --- E. Period filter -------------------------------------------------------
{
  const statement = buildIncomeStatement(
    [
      { property_id: PROP_A, amount_cents: 200000, paid_on: "2026-06-01" },
      { property_id: PROP_A, amount_cents: 999999, paid_on: "2025-12-31" },
      { property_id: PROP_A, amount_cents: 111111, paid_on: null },
    ],
    [
      expenseToCostRow({ property_id: PROP_A, building_key: null, category: "utilities", amount_cents: 20000, incurred_on: "2026-06-05" }),
      expenseToCostRow({ property_id: PROP_A, building_key: null, category: "utilities", amount_cents: 99999, incurred_on: "2027-01-01" }),
      { property_id: PROP_A, building_key: null, category: "plumbing", status: "completed", cost_cents: 55555, completed_on: null },
    ],
    properties,
    RANGE,
  );
  const row = statement.rows.find((r) => r.propertyId === PROP_A)!;

  ok("period: excludes out-of-range rent", row.revenueCents === 200000);
  ok("period: excludes undated rent", row.rentCount === 1);
  ok("period: excludes out-of-range and undated costs", row.operatingExpensesCents === 20000 && row.expenseCount === 1);
}

// --- F. Financing-only period ----------------------------------------------
{
  const statement = buildIncomeStatement(
    [],
    [
      expenseToCostRow({ property_id: PROP_A, building_key: null, category: "interest", amount_cents: 15000, incurred_on: "2026-07-01" }),
      expenseToCostRow({ property_id: PROP_A, building_key: null, category: "mortgage", amount_cents: 50000, incurred_on: "2026-07-01" }),
    ],
    properties,
    RANGE,
  );
  const row = statement.rows.find((r) => r.propertyId === PROP_A)!;

  ok("financing-only: zero operating NOI", row.noiCents === 0);
  ok("financing-only: net income = -interest", row.netIncomeCents === -15000);
  ok("financing-only: net cash = -interest - principal", row.netCashCents === -65000);
}

// --- G. Zero-revenue margin -------------------------------------------------
ok("margin: zero revenue shows dash", netMarginLabel(-15000, 0) === "—");
ok("margin: non-zero revenue formats percent", netMarginLabel(25000, 100000) === "25.0%");

// --- H. Totals equal sum of rows -------------------------------------------
{
  const statement = buildIncomeStatement(
    [
      { property_id: PROP_A, amount_cents: 250000, paid_on: "2026-08-01" },
      { property_id: PROP_B, amount_cents: 180000, paid_on: "2026-08-01" },
    ],
    [
      expenseToCostRow({ property_id: PROP_A, building_key: null, category: "property_tax", amount_cents: 30000, incurred_on: "2026-08-02" }),
      expenseToCostRow({ property_id: PROP_A, building_key: null, category: "interest", amount_cents: 12000, incurred_on: "2026-08-02" }),
      expenseToCostRow({ property_id: PROP_B, building_key: null, category: "mortgage", amount_cents: 45000, incurred_on: "2026-08-03" }),
      expenseToCostRow({ property_id: null, building_key: null, category: "professional", amount_cents: 15000, incurred_on: "2026-08-04" }),
    ],
    properties,
    RANGE,
  );

  ok("totals: revenue sums rows", statement.totals.revenueCents === sumRows(statement.rows, "revenueCents"));
  ok("totals: operating sums rows", statement.totals.operatingExpensesCents === sumRows(statement.rows, "operatingExpensesCents"));
  ok("totals: NOI sums rows", statement.totals.noiCents === sumRows(statement.rows, "noiCents"));
  ok("totals: interest sums rows", statement.totals.interestCents === sumRows(statement.rows, "interestCents"));
  ok("totals: net income sums rows", statement.totals.netIncomeCents === sumRows(statement.rows, "netIncomeCents"));
  ok("totals: principal sums rows", statement.totals.principalCents === sumRows(statement.rows, "principalCents"));
  ok("totals: net cash sums rows", statement.totals.netCashCents === sumRows(statement.rows, "netCashCents"));
  ok("totals: counts sum rows", statement.totals.rentCount === sumRows(statement.rows, "rentCount") && statement.totals.expenseCount === sumRows(statement.rows, "expenseCount"));

  const csv = incomeStatementToCsv(statement);
  ok("csv: title", csv.startsWith("Income statement"));
  ok("csv: period", csv.includes("Period,2026-01-01 to 2026-12-31"));
  ok("csv: total row", csv.includes("TOTAL,4300.00,450.00,3850.00,120.00,3730.00,450.00,3280.00,2,4"));
  ok("csv: principal note", csv.includes("Principal is a capital repayment, not an expense; only interest reduces net income."));
  ok("csv: newline", csv.endsWith("\n"));
}

const total = passed + failed;
console.log(`PASS ${passed}/${total}`);
if (failed > 0) process.exit(1);
