// Unit tests for the pure owner-statement model. Run: npx tsx scripts/test-statements.ts
import {
  STATEMENT_PRESETS,
  statementPresetLabel,
  rangeForPreset,
  parseRangeBound,
  describeRange,
  sumRentCents,
  groupRentByProperty,
  buildOwnerStatement,
  buildMonthlyStatement,
  statementToCsv,
  type RentRow,
  type PropertyRef,
} from "../lib/statements";
import type { WorkOrderCostRow } from "../lib/work-orders";
import { expenseToCostRow } from "../lib/expenses";

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

// --- Presets ----------------------------------------------------------------
ok(
  "presets list",
  STATEMENT_PRESETS.join(",") === "this_year,last_year,last_30,last_60,last_90,all,custom",
);
ok("preset label this_year", statementPresetLabel("this_year") === "This year");
ok("preset label last_30", statementPresetLabel("last_30") === "Last 30 days");
ok("preset label passthrough", statementPresetLabel("zzz") === "zzz");

const today = "2026-06-22";

// Rolling windows: N-day window ending today inclusive (from = today − N, to = today).
ok(
  "last_30 range",
  JSON.stringify(rangeForPreset("last_30", today)) ===
    JSON.stringify({ from: "2026-05-23", to: "2026-06-22" }),
);
ok(
  "last_60 range",
  JSON.stringify(rangeForPreset("last_60", today)) ===
    JSON.stringify({ from: "2026-04-23", to: "2026-06-22" }),
);
ok(
  "last_90 range",
  JSON.stringify(rangeForPreset("last_90", today)) ===
    JSON.stringify({ from: "2026-03-24", to: "2026-06-22" }),
);
ok(
  "this_year range",
  JSON.stringify(rangeForPreset("this_year", today)) ===
    JSON.stringify({ from: "2026-01-01", to: "2026-12-31" }),
);
ok(
  "last_year range",
  JSON.stringify(rangeForPreset("last_year", today)) ===
    JSON.stringify({ from: "2025-01-01", to: "2025-12-31" }),
);
ok(
  "all range is open",
  JSON.stringify(rangeForPreset("all", today)) === JSON.stringify({ from: null, to: null }),
);
ok(
  "custom uses provided range",
  JSON.stringify(
    rangeForPreset("custom", today, { from: "2026-03-01", to: "2026-03-31" }),
  ) === JSON.stringify({ from: "2026-03-01", to: "2026-03-31" }),
);
ok(
  "custom without range falls back to this year",
  JSON.stringify(rangeForPreset("custom", today)) ===
    JSON.stringify({ from: "2026-01-01", to: "2026-12-31" }),
);
ok(
  "unknown preset falls back to this year",
  JSON.stringify(rangeForPreset("zzz", today)) ===
    JSON.stringify({ from: "2026-01-01", to: "2026-12-31" }),
);

ok("parseRangeBound valid", parseRangeBound("2026-01-01") === "2026-01-01");
ok("parseRangeBound blank -> null", parseRangeBound("") === null);
ok("parseRangeBound junk -> null", parseRangeBound("2026/01/01") === null);

ok("describeRange all", describeRange({ from: null, to: null }) === "All time");
ok("describeRange both", describeRange({ from: "2026-01-01", to: "2026-12-31" }) === "2026-01-01 to 2026-12-31");
ok("describeRange from only", describeRange({ from: "2026-01-01", to: null }) === "From 2026-01-01");
ok("describeRange to only", describeRange({ from: null, to: "2026-12-31" }) === "Up to 2026-12-31");

// --- Sample data ------------------------------------------------------------
const PROP_A = "aaaaaaaa-0000-0000-0000-000000000001";
const PROP_B = "bbbbbbbb-0000-0000-0000-000000000002";
const properties: PropertyRef[] = [
  { id: PROP_A, address: "10 Adelaide St" },
  { id: PROP_B, address: "20 Bay St" },
];

const rent: RentRow[] = [
  { amount_cents: 200000, paid_on: "2026-01-05", property_id: PROP_A }, // Jan A
  { amount_cents: 200000, paid_on: "2026-02-05", property_id: PROP_A }, // Feb A
  { amount_cents: 150000, paid_on: "2026-01-03", property_id: PROP_B }, // Jan B
  { amount_cents: 999999, paid_on: "2025-12-31", property_id: PROP_A }, // out of 2026 window
  { amount_cents: 50000, paid_on: null, property_id: PROP_A }, // undated -> excluded
  { amount_cents: 75000, paid_on: "2026-03-01", property_id: null }, // unassigned property
];

const wos: WorkOrderCostRow[] = [
  { property_id: PROP_A, category: "plumbing", status: "completed", cost_cents: 30000, completed_on: "2026-01-20" },
  { property_id: PROP_A, category: "hvac", status: "completed", cost_cents: 50000, completed_on: "2026-02-15" },
  { property_id: PROP_B, category: "plumbing", status: "completed", cost_cents: 10000, completed_on: "2026-01-25" },
  { property_id: PROP_A, category: "general", status: "in_progress", cost_cents: 99999, completed_on: null }, // not completed -> excluded
  { property_id: PROP_A, category: "electrical", status: "completed", cost_cents: null, completed_on: "2026-02-10" }, // no cost -> excluded
  { property_id: PROP_B, category: "roofing", status: "completed", cost_cents: 80000, completed_on: "2025-11-01" }, // out of window
];

const year2026 = { from: "2026-01-01", to: "2026-12-31" };

// --- Rent helpers -----------------------------------------------------------
ok("sumRentCents windowed excludes out-of-range + undated", sumRentCents(rent, year2026) === 200000 + 200000 + 150000 + 75000);
ok("sumRentCents all-time still excludes undated", sumRentCents(rent, { from: null, to: null }) === 200000 + 200000 + 150000 + 999999 + 75000);

const rentByProp = groupRentByProperty(rent, year2026);
ok("groupRentByProperty buckets count", rentByProp.length === 3); // A, B, null
ok("rent A in window", (rentByProp.find((b) => b.propertyId === PROP_A)?.totalCents ?? 0) === 400000);
ok("rent A count in window", (rentByProp.find((b) => b.propertyId === PROP_A)?.count ?? 0) === 2);
ok("rent null bucket present", (rentByProp.find((b) => b.propertyId === null)?.totalCents ?? 0) === 75000);

// --- Statement --------------------------------------------------------------
const stmt = buildOwnerStatement(rent, wos, properties, year2026);
ok("statement rows count (A, B, Unassigned)", stmt.rows.length === 3);
ok("statement sorted, A first", stmt.rows[0].address === "10 Adelaide St");
ok("statement Unassigned last", stmt.rows[stmt.rows.length - 1].address === "Unassigned");
ok("hasUnassigned true", stmt.hasUnassigned === true);

const rowA = stmt.rows.find((r) => r.propertyId === PROP_A)!;
ok("A rent in", rowA.rentInCents === 400000);
ok("A maintenance out (30000+50000)", rowA.maintenanceOutCents === 80000);
ok("A net = rent − maintenance", rowA.netCents === 400000 - 80000);
ok("A rentCount 2", rowA.rentCount === 2);
ok("A workOrderCount 2", rowA.workOrderCount === 2);

const rowB = stmt.rows.find((r) => r.propertyId === PROP_B)!;
ok("B rent in", rowB.rentInCents === 150000);
ok("B maintenance out 10000", rowB.maintenanceOutCents === 10000);
ok("B net", rowB.netCents === 140000);

const rowU = stmt.rows.find((r) => r.propertyId === null)!;
ok("Unassigned rent only", rowU.rentInCents === 75000 && rowU.maintenanceOutCents === 0);

ok("totals rent in", stmt.totals.rentInCents === 625000);
ok("totals maintenance out", stmt.totals.maintenanceOutCents === 90000);
ok("totals net", stmt.totals.netCents === 535000);
ok("totals net = sum of row nets", stmt.rows.reduce((s, r) => s + r.netCents, 0) === stmt.totals.netCents);

// Category breakdown (descending by amount), within window + costed only
ok("categories: plumbing + hvac", stmt.categories.length === 2);
ok("categories sorted desc", stmt.categories[0].category === "hvac" && stmt.categories[0].totalCents === 50000);
ok("plumbing total across props", (stmt.categories.find((c) => c.category === "plumbing")?.totalCents ?? 0) === 40000);

// Deleted-unit label: rent/cost referencing a property not in the ref list
const stmtMissingRef = buildOwnerStatement(
  [{ amount_cents: 100, paid_on: "2026-05-01", property_id: "zzzzzzzz-dead" }],
  [],
  properties,
  year2026,
);
ok("missing property ref labelled", stmtMissingRef.rows[0].address === "Deleted unit");

// All-time statement counts the out-of-window rows too
const stmtAll = buildOwnerStatement(rent, wos, properties, { from: null, to: null });
ok("all-time A rent includes Dec-2025 row", (stmtAll.rows.find((r) => r.propertyId === PROP_A)?.rentInCents ?? 0) === 400000 + 999999);
ok("all-time B maintenance includes Nov-2025 roof", (stmtAll.rows.find((r) => r.propertyId === PROP_B)?.maintenanceOutCents ?? 0) === 10000 + 80000);

// --- Monthly breakdown ------------------------------------------------------
const monthly = buildMonthlyStatement(rent, wos, properties, year2026);
// Cells: Jan-A(rent+maint), Feb-A(rent+maint), Jan-B(rent+maint), Mar-Unassigned(rent)
ok("monthly cell count", monthly.length === 4);
ok("monthly sorted earliest first", monthly[0].period === "2026-01-01");
const janA = monthly.find((m) => m.period === "2026-01-01" && m.propertyId === PROP_A)!;
ok("Jan A rent", janA.rentInCents === 200000);
ok("Jan A maint", janA.maintenanceOutCents === 30000);
ok("Jan A net", janA.netCents === 170000);
ok("Jan A month label", janA.monthLabel === "January 2026");
const marU = monthly.find((m) => m.period === "2026-03-01")!;
ok("Mar unassigned row", marU.propertyId === null && marU.rentInCents === 75000 && marU.maintenanceOutCents === 0);

// monthly totals reconcile with the annual statement totals
const mRent = monthly.reduce((s, m) => s + m.rentInCents, 0);
const mMaint = monthly.reduce((s, m) => s + m.maintenanceOutCents, 0);
ok("monthly rent reconciles to annual", mRent === stmt.totals.rentInCents);
ok("monthly maintenance reconciles to annual", mMaint === stmt.totals.maintenanceOutCents);

// --- CSV --------------------------------------------------------------------
const csv = statementToCsv(stmt, monthly);
ok("csv has title", csv.startsWith("Owner financial statement"));
ok("csv has period line", csv.includes("Period,2026-01-01 to 2026-12-31"));
ok("csv has summary header", csv.includes("Property / building,Scope,Rent collected,Expenses,Net"));
ok("csv TOTAL row in dollars (with scope column)", csv.includes("TOTAL,,6250.00,900.00,5350.00"));
ok("csv A unit row carries Unit scope", csv.includes("10 Adelaide St,Unit,4000.00,800.00,3200.00"));
ok("csv category block", csv.includes("Expenses by category,Amount,Items"));
ok("csv monthly block header", csv.includes("Month,Property,Rent collected,Expenses,Net"));
ok("csv monthly Jan A row", csv.includes("January 2026,10 Adelaide St,2000.00,300.00,1700.00"));
ok("csv ends with newline", csv.endsWith("\n"));
// address with a comma must be quoted
const csvQuote = statementToCsv(
  buildOwnerStatement(
    [{ amount_cents: 100000, paid_on: "2026-04-01", property_id: PROP_A }],
    [],
    [{ id: PROP_A, address: "10 Adelaide St, Unit 4" }],
    year2026,
  ),
  [],
);
ok("csv quotes fields with commas (unit row)", csvQuote.includes('"10 Adelaide St, Unit 4",Unit,1000.00,0.00,1000.00'));

// Empty statement is well-formed
const empty = buildOwnerStatement([], [], properties, year2026);
ok("empty statement no rows", empty.rows.length === 0);
ok("empty statement no buildings", empty.buildings.length === 0);
ok("empty totals zeroed", empty.totals.netCents === 0 && empty.totals.rentInCents === 0);
ok("empty csv still has TOTAL", statementToCsv(empty, []).includes("TOTAL,,0.00,0.00,0.00"));

// --- Building tier (unit vs building-scoped shared costs) -------------------
const BLD = "100 king st"; // the building_key two units share
const U1 = "11111111-0000-0000-0000-000000000001";
const U2 = "11111111-0000-0000-0000-000000000002";
const bprops: PropertyRef[] = [
  { id: U1, address: "100 King St Unit 1", buildingKey: BLD },
  { id: U2, address: "100 King St Unit 2", buildingKey: BLD },
];
const brent: RentRow[] = [
  { amount_cents: 200000, paid_on: "2026-01-05", property_id: U1 },
  { amount_cents: 180000, paid_on: "2026-01-05", property_id: U2 },
];
const bwos: WorkOrderCostRow[] = [
  // unit cost on U1
  { property_id: U1, building_key: null, category: "plumbing", status: "completed", cost_cents: 30000, completed_on: "2026-01-20" },
  // shared building cost (gardening) — no unit
  { property_id: null, building_key: BLD, category: "landscaping", status: "completed", cost_cents: 50000, completed_on: "2026-02-01" },
  // unscoped overhead
  { property_id: null, building_key: null, category: "general", status: "completed", cost_cents: 7000, completed_on: "2026-03-01" },
];
const bstmt = buildOwnerStatement(brent, bwos, bprops, year2026);

ok("building tier: one building + overhead bucket", bstmt.buildings.length === 2);
const bRow = bstmt.buildings.find((b) => b.buildingKey === BLD)!;
ok("building labelled by stripped street", bRow.label === "100 King St");
ok("building has both units nested", bRow.unitRows.length === 2);
ok("building shared maintenance is the gardening cost", bRow.sharedMaintenanceCents === 50000);
ok("building shared count 1", bRow.sharedWorkOrderCount === 1);
ok("building rent = sum of unit rents", bRow.rentInCents === 380000);
ok("building maintenance = units + shared", bRow.maintenanceOutCents === 30000 + 50000);
ok("building net = rent − (units + shared)", bRow.netCents === 380000 - 80000);

const u1Row = bRow.unitRows.find((r) => r.propertyId === U1)!;
ok("shared cost is NOT pushed onto a unit", u1Row.maintenanceOutCents === 30000);

const overhead = bstmt.buildings.find((b) => b.buildingKey === null)!;
ok("overhead bucket label", overhead.label === "Unassigned / overhead");
ok("overhead holds only the unscoped cost", overhead.maintenanceOutCents === 7000 && overhead.rentInCents === 0);
ok("overhead has no shared line", overhead.sharedMaintenanceCents === 0);

// the per-property Unassigned row carries ONLY the unscoped cost (not the shared)
const bUnassigned = bstmt.rows.find((r) => r.propertyId === null)!;
ok("Unassigned row excludes the building-scoped shared cost", bUnassigned.maintenanceOutCents === 7000);

// totals still count everything; building subtotals reconcile to the grand total
ok("building tier totals: rent", bstmt.totals.rentInCents === 380000);
ok("building tier totals: maintenance (unit+shared+overhead)", bstmt.totals.maintenanceOutCents === 87000);
ok(
  "sum of building maintenance reconciles to total",
  bstmt.buildings.reduce((s, b) => s + b.maintenanceOutCents, 0) === bstmt.totals.maintenanceOutCents,
);
ok(
  "sum of building rent reconciles to total",
  bstmt.buildings.reduce((s, b) => s + b.rentInCents, 0) === bstmt.totals.rentInCents,
);

// CSV carries the scope column: building subtotal, unit, and shared lines
const bcsv = statementToCsv(bstmt, []);
ok("csv building subtotal line", bcsv.includes("100 King St,Building subtotal,3800.00,800.00,3000.00"));
ok("csv unit line under building", bcsv.includes("100 King St Unit 1,Unit,2000.00,300.00,1700.00"));
ok("csv building-wide shared line", bcsv.includes("Building-wide (shared),Shared,0.00,500.00,-500.00"));
ok("csv overhead unscoped line", bcsv.includes("Unassigned,Unassigned,0.00,70.00,-70.00"));
ok("csv building tier TOTAL", bcsv.includes("TOTAL,,3800.00,870.00,2930.00"));

// --- Expenses fold into the statement (the bank-feed wiring contract) --------
//
// The page + export route concat expenseToCostRow(expense) rows with the
// work_orders rows before calling buildOwnerStatement, so the "spent" side spans
// the full expense set (mortgage/tax/...) — not just maintenance. Prove that an
// expense mapped to a cost row rolls up exactly like a work order, including the
// scope discipline (unit vs building) and the by-category breakdown.
const expCostRows: WorkOrderCostRow[] = [
  // Unit-scoped mortgage on A.
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "mortgage", amount_cents: 200000, incurred_on: "2026-03-01" }),
  // Building-shared property tax (no unit) — must land at the building tier, not on a unit.
  expenseToCostRow({ property_id: null, building_key: "100-king-st", category: "property_tax", amount_cents: 120000, incurred_on: "2026-04-01" }),
  // Out-of-window expense — excluded by the date filter.
  expenseToCostRow({ property_id: PROP_A, building_key: null, category: "insurance", amount_cents: 90000, incurred_on: "2025-06-01" }),
];
const mixWO: WorkOrderCostRow[] = [
  { property_id: PROP_A, category: "hvac", status: "completed", cost_cents: 50000, completed_on: "2026-02-15" },
];
const mixProps: PropertyRef[] = [{ id: PROP_A, address: "100 King St Unit 1", buildingKey: "100-king-st" }];
const mixStmt = buildOwnerStatement([], [...mixWO, ...expCostRows], mixProps, year2026);

const aRowMix = mixStmt.rows.find((r) => r.propertyId === PROP_A)!;
ok("expense folds into unit spend (hvac 50000 + mortgage 200000)", aRowMix.maintenanceOutCents === 250000);
ok("expense + WO counted as entries on the unit", aRowMix.workOrderCount === 2);
ok("out-of-window expense excluded", mixStmt.totals.maintenanceOutCents === 250000 + 120000);

const catMap = new Map(mixStmt.categories.map((c) => [c.category, c.totalCents]));
ok("by-category spans expense categories (mortgage)", catMap.get("mortgage") === 200000);
ok("by-category spans expense categories (property_tax)", catMap.get("property_tax") === 120000);
ok("by-category still has the work-order category (hvac)", catMap.get("hvac") === 50000);

const kingBuilding = mixStmt.buildings.find((b) => b.buildingKey === "100-king-st")!;
ok("building-shared expense lands at building tier", kingBuilding.sharedMaintenanceCents === 120000);
ok("building-shared expense is NOT pushed onto the unit", aRowMix.maintenanceOutCents === 250000);

console.log(`\nstatements: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
