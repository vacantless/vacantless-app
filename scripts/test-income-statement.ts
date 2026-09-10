// Unit tests for the pure actual-basis income-statement model.
// Run: npx tsx scripts/test-income-statement.ts
import {
  buildIncomeStatement,
  incomeStatementToCsv,
  isStandaloneUnit,
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

/**
 * The CSV's money table must add up to its own TOTAL line. Top-level lines are
 * the ones that are NOT indented: a building subtotal, a standalone unit, or an
 * overhead row. Indented lines are the children already inside a subtotal, so
 * counting them too would double every building.
 */
function csvTableFoots(csv: string): boolean {
  const lines = csv.split("\n");
  const header = lines.findIndex((l) => l.startsWith("Building / unit,"));
  if (header < 0) return false;
  const cell = (line: string, i: number): string => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (quoted) {
        if (ch === '"' && line[c + 1] === '"') { cur += '"'; c++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out[i] ?? "";
  };
  const COLS = [1, 2, 3, 4, 5, 6, 7]; // revenue .. net cash
  const sums = COLS.map(() => 0);
  let total: number[] | null = null;
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") break;
    const label = cell(line, 0);
    if (label === "TOTAL") { total = COLS.map((c) => Math.round(Number(cell(line, c)) * 100)); break; }
    if (label.startsWith("  ")) continue; // a child of a subtotal above
    COLS.forEach((c, idx) => { sums[idx] += Math.round(Number(cell(line, c)) * 100); });
  }
  if (!total) return false;
  return total.every((t, idx) => t === sums[idx]);
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
  // v2: a building-scoped cost no longer lands in Unassigned. Unassigned now
  // means "tied to neither a unit nor a building", which is what the word says.
  ok("multi: unscoped cost stays in unassigned", statement.rows.find((r) => r.propertyId === null)?.operatingExpensesCents === 30000);
  ok("multi: building-scoped cost leaves the unit rows", sumRows(statement.rows, "operatingExpensesCents") === 30000);
  ok("multi: building-scoped cost lands on its building", statement.buildings.find((b) => b.buildingKey === "20-bay-st")?.shared.operatingExpensesCents === 20000);
  ok("multi: totals still count the building-scoped cost", statement.totals.operatingExpensesCents === 50000);
  ok("multi: hasBuildingShared true", statement.hasBuildingShared === true);
}

// --- D2. Building tier: a triplex whose shared costs belong to no single unit --
// This is the 506 Manning shape: three units each collecting rent, and the tax,
// water and gas bills arriving for the building.
{
  const U1 = "11111111-0000-0000-0000-000000000001";
  const U2 = "22222222-0000-0000-0000-000000000002";
  const U3 = "33333333-0000-0000-0000-000000000003";
  const BK = "506 manning avenue, toronto, on m6g 2v7";
  const triplex: PropertyRef[] = [
    { id: U1, address: "506 Manning Avenue, Unit 1 (Main), Toronto, ON", buildingKey: BK },
    { id: U2, address: "506 Manning Avenue, Unit 2 (Upper), Toronto, ON", buildingKey: BK },
    { id: U3, address: "506 Manning Avenue, Unit 3 (Lower), Toronto, ON", buildingKey: BK },
  ];
  const rentRows: RentRow[] = [
    { property_id: U1, amount_cents: 262000, paid_on: "2026-06-05" },
    { property_id: U2, amount_cents: 335200, paid_on: "2026-06-05" },
    { property_id: U3, amount_cents: 142400, paid_on: "2026-06-05" },
  ];
  const costRows: WorkOrderCostRow[] = [
    // Building-wide: nobody can honestly file these against one unit.
    expenseToCostRow({ property_id: null, building_key: BK, category: "property_tax", amount_cents: 93819, incurred_on: "2026-06-15" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "utilities", amount_cents: 69550, incurred_on: "2026-06-22" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "interest", amount_cents: 195069, incurred_on: "2026-06-22" }),
    expenseToCostRow({ property_id: null, building_key: BK, category: "mortgage", amount_cents: 420910, incurred_on: "2026-06-22" }),
    // Unit-scoped: a plumber in Unit 2.
    expenseToCostRow({ property_id: U2, building_key: null, category: "maintenance", amount_cents: 32770, incurred_on: "2026-06-09" }),
  ];
  const june: DateRange = { from: "2026-06-01", to: "2026-06-30" };
  const statement = buildIncomeStatement(rentRows, costRows, triplex, june);

  ok("triplex: one building group", statement.buildings.length === 1);
  const b = statement.buildings[0];
  ok("triplex: building keyed and labelled from the address", b.buildingKey === BK && b.label === "506 Manning Avenue, Toronto, ON");
  ok("triplex: three units nested under it", b.unitRows.length === 3);
  ok("triplex: not a standalone unit", isStandaloneUnit(b) === false);
  ok("triplex: shared operating held at the building", b.shared.operatingExpensesCents === 93819 + 69550);
  ok("triplex: shared interest held at the building", b.shared.interestCents === 195069);
  ok("triplex: shared principal held at the building", b.shared.principalCents === 420910);
  ok("triplex: unit keeps its own unit-scoped cost", b.unitRows.find((r) => r.propertyId === U2)?.operatingExpensesCents === 32770);
  ok("triplex: other units carry no shared cost", b.unitRows.find((r) => r.propertyId === U1)?.operatingExpensesCents === 0);
  ok("triplex: NO unassigned row", statement.hasUnassigned === false);
  ok("triplex: building revenue is the sum of its units", b.revenueCents === 739600);
  ok("triplex: building operating = units + shared", b.operatingExpensesCents === 32770 + 93819 + 69550);
  ok("triplex: building NOI = revenue - operating", b.noiCents === 739600 - (32770 + 93819 + 69550));
  ok("triplex: building net income subtracts interest only", b.netIncomeCents === b.noiCents - 195069);
  ok("triplex: building net cash subtracts principal", b.netCashCents === b.netIncomeCents - 420910);
  // The invariant the portfolio total must satisfy once shared costs exist.
  ok(
    "triplex: totals = sum(unit rows) + sum(shared)",
    statement.totals.operatingExpensesCents ===
      sumRows(statement.rows, "operatingExpensesCents") +
        statement.buildings.reduce((acc, x) => acc + x.shared.operatingExpensesCents, 0),
  );
  ok(
    "triplex: building subtotal reconciles to the portfolio total",
    b.revenueCents === statement.totals.revenueCents &&
      b.operatingExpensesCents === statement.totals.operatingExpensesCents &&
      b.netCashCents === statement.totals.netCashCents,
  );
  // A shared cost must never be silently split across units.
  ok(
    "triplex: shared cost is NOT pro-rated onto any unit",
    b.unitRows.every((r) => r.operatingExpensesCents === (r.propertyId === U2 ? 32770 : 0)),
  );
  // Every column of the invariant, not just operating expenses.
  const sharedSum = (pick: (x: (typeof statement.buildings)[number]) => number): number =>
    statement.buildings.reduce((acc, x) => acc + pick(x), 0);
  ok(
    "triplex: totals interest = rows + shared",
    statement.totals.interestCents === sumRows(statement.rows, "interestCents") + sharedSum((x) => x.shared.interestCents),
  );
  ok(
    "triplex: totals principal = rows + shared",
    statement.totals.principalCents === sumRows(statement.rows, "principalCents") + sharedSum((x) => x.shared.principalCents),
  );
  ok(
    "triplex: totals expense count = rows + shared",
    statement.totals.expenseCount === sumRows(statement.rows, "expenseCount") + sharedSum((x) => x.shared.expenseCount),
  );

  const csv = incomeStatementToCsv(statement);
  ok("triplex: csv nests the units and names the shared line", csv.includes("Building-wide (shared)") && csv.includes("  506 Manning Avenue, Unit 1 (Main), Toronto, ON"));
  ok("triplex: csv foots to its own TOTAL", csvTableFoots(csv));
}

// --- D2b. The CSV table must foot in every shape, not just the triplex ------
{
  const B1 = "55555555-0000-0000-0000-000000000005";
  const B2 = "66666666-0000-0000-0000-000000000006";
  const props: PropertyRef[] = [
    { id: B1, address: "9 Elm St, Unit A", buildingKey: "9-elm" },
    { id: B2, address: "9 Elm St, Unit B", buildingKey: "9-elm" },
    { id: PROP_C, address: "70 Church St", buildingKey: null },
  ];
  const statement = buildIncomeStatement(
    [
      { property_id: B1, amount_cents: 150000, paid_on: "2026-06-01" },
      { property_id: PROP_C, amount_cents: 90000, paid_on: "2026-06-01" },
      { property_id: null, amount_cents: 5000, paid_on: "2026-06-02" },
    ],
    [
      expenseToCostRow({ property_id: null, building_key: "9-elm", category: "insurance", amount_cents: 40000, incurred_on: "2026-06-03" }),
      expenseToCostRow({ property_id: null, building_key: "9-elm", category: "interest", amount_cents: 11000, incurred_on: "2026-06-03" }),
      expenseToCostRow({ property_id: B1, building_key: null, category: "maintenance", amount_cents: 7000, incurred_on: "2026-06-04" }),
      expenseToCostRow({ property_id: PROP_C, building_key: null, category: "utilities", amount_cents: 5000, incurred_on: "2026-06-05" }),
      expenseToCostRow({ property_id: null, building_key: null, category: "professional", amount_cents: 9000, incurred_on: "2026-06-06" }),
      // A building key no property carries: an orphan, which must still foot.
      expenseToCostRow({ property_id: null, building_key: "12-gone-st", category: "property_tax", amount_cents: 21000, incurred_on: "2026-06-07" }),
    ],
    props,
    { from: "2026-06-01", to: "2026-06-30" },
  );
  ok("mixed: csv foots to its own TOTAL", csvTableFoots(incomeStatementToCsv(statement)));
  ok("mixed: orphan building key gets its own group", statement.buildings.some((b) => b.buildingKey === "12-gone-st"));
  ok("mixed: orphan group has no units", statement.buildings.find((b) => b.buildingKey === "12-gone-st")?.unitRows.length === 0);
  ok("mixed: orphan group is not standalone, so it is never hidden", isStandaloneUnit(statement.buildings.find((b) => b.buildingKey === "12-gone-st")!) === false);
  ok("mixed: keyless property stands alone", statement.buildings.some((b) => b.buildingKey === `prop:${PROP_C}`));
  ok("mixed: overhead bucket still holds the truly unscoped cost", statement.buildings.find((b) => b.buildingKey == null)?.unitRows[0]?.operatingExpensesCents === 9000);
  ok(
    "mixed: totals operating = rows + shared",
    statement.totals.operatingExpensesCents ===
      sumRows(statement.rows, "operatingExpensesCents") +
        statement.buildings.reduce((acc, x) => acc + x.shared.operatingExpensesCents, 0),
  );
  const csv = incomeStatementToCsv(statement);
  ok("mixed: overhead gets no duplicate subtotal header", !csv.includes("Unassigned / overhead"));

  // The checker itself must be able to fail, or it proves nothing. Two ways a
  // real regression would show up: a wrong TOTAL, and the pre-v2 bug where the
  // building-wide lines were missing from the table entirely.
  const brokenTotal = csv.replace(/^TOTAL,[^,]+/m, "TOTAL,999999.00");
  ok("checker: a wrong TOTAL fails the footing check", csvTableFoots(brokenTotal) === false);
  // The exact shape the CSV had BEFORE this change: a flat list of unit rows
  // against a TOTAL computed over every cost, so the building-wide money was in
  // the TOTAL and in no line above it. That is the defect this check exists to
  // catch, so the check must reject it.
  const money = (r: IncomeStatementRow): string =>
    [
      r.revenueCents,
      r.operatingExpensesCents,
      r.noiCents,
      r.interestCents,
      r.netIncomeCents,
      r.principalCents,
      r.netCashCents,
    ]
      .map((c) => (c / 100).toFixed(2))
      .join(",");
  const flatOld = [
    "Building / unit,Rental revenue,Operating expenses,NOI,Mortgage interest,Net income,Mortgage principal (memo),Net cash after debt service,Rent payments,Expense items",
    ...statement.rows.map((r, i) => `unit-${i},${money(r)},${r.rentCount},${r.expenseCount}`),
    `TOTAL,${money(statement.totals)},${statement.totals.rentCount},${statement.totals.expenseCount}`,
    "",
  ].join("\n");
  ok("checker: the pre-v2 flat table fails the footing check", csvTableFoots(flatOld) === false);
  ok("checker: the unmodified csv still passes", csvTableFoots(csv) === true);
}

// --- D3. A single-unit property with no siblings renders as one line ---------
{
  const SOLO = "44444444-0000-0000-0000-000000000004";
  const solo: PropertyRef[] = [{ id: SOLO, address: "88 Bloor St", buildingKey: null }];
  const statement = buildIncomeStatement(
    [{ property_id: SOLO, amount_cents: 200000, paid_on: "2026-06-01" }],
    [expenseToCostRow({ property_id: SOLO, building_key: null, category: "utilities", amount_cents: 10000, incurred_on: "2026-06-02" })],
    solo,
    { from: "2026-06-01", to: "2026-06-30" },
  );
  ok("solo: stands alone, not merged into overhead", statement.buildings.length === 1 && statement.buildings[0].buildingKey === `prop:${SOLO}`);
  ok("solo: is a standalone unit", isStandaloneUnit(statement.buildings[0]) === true);
  ok("solo: no building shared", statement.hasBuildingShared === false);
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
