// Pure actual-basis income-statement model (no I/O) so it can be unit-tested in
// isolation. This is the Premium accounting bridge between the cash owner
// statement and the forward rent roll: for a chosen period, per property and for
// the portfolio, RENTAL REVENUE minus OPERATING EXPENSES = NOI; mortgage
// interest then reduces net income, while mortgage principal stays a memo line
// because it is capital repayment, not an expense.
//
// We only REPORT on ledgers the owner already keeps. Rent comes from
// rent_payments (cash basis: paid_on). Costs come from work_orders + expenses
// mapped to WorkOrderCostRow (actual basis: completed_on / incurred_on). No
// rows are inserted, updated, or deleted here.
//
// v2 adds the BUILDING TIER. A cost scoped to a building (property tax, water,
// gas, the roof) belongs to no single unit, so it is held out of the per-unit
// rows and carried on its building instead, with the units nested underneath and
// a subtotal of the two. It is deliberately NOT pro-rated across the units: an
// allocated figure is an estimate, and every per-unit number here is meant to be
// literally true. Same rule, same shape as buildOwnerStatement's `buildings`.

import {
  describeRange,
  groupRentByProperty,
  sumRentCents,
  type DateRange,
  type PropertyRef,
  type RentRow,
} from "./statements";
import {
  expenseCategoryLabel,
  isExpenseCategory,
  isOperatingCategory,
} from "./expenses";
import {
  workOrderCategoryLabel,
  workOrderScope,
  type WorkOrderCostRow,
} from "./work-orders";
import { splitAddressUnit } from "./address-unit";

export type IncomeStatementRow = {
  propertyId: string | null;
  address: string;
  revenueCents: number;
  operatingExpensesCents: number;
  noiCents: number;
  interestCents: number;
  netIncomeCents: number;
  principalCents: number;
  netCashCents: number;
  rentCount: number;
  expenseCount: number;
};

export type IncomeStatementCategoryRow = {
  category: string;
  totalCents: number;
  count: number;
};

/**
 * The building-wide (shared) half of a building tier: costs that belong to the
 * BUILDING and not to any one unit: property tax, water, gas, insurance, the
 * roof. They are deliberately NOT pro-rated onto the units, for the same reason
 * the owner statement does not pro-rate: an allocated figure is an estimate, and
 * every per-unit number in this report is meant to be literally true. The unit
 * rows and this line add up to the building subtotal.
 */
export type IncomeStatementShared = {
  operatingExpensesCents: number;
  interestCents: number;
  principalCents: number;
  expenseCount: number;
};

/**
 * A building tier: the per-unit rows nested under one building, the building-wide
 * shared line, and the subtotal of the two. `buildingKey == null` is the catch-all
 * "Unassigned / overhead" bucket for rent or costs tied to neither a unit nor a
 * building. A unit whose property carries no building key stands alone under a
 * synthetic key so it is never merged into overhead.
 */
export type IncomeStatementBuildingRow = {
  buildingKey: string | null;
  label: string;
  unitRows: IncomeStatementRow[];
  shared: IncomeStatementShared;
  revenueCents: number;
  operatingExpensesCents: number;
  noiCents: number;
  interestCents: number;
  netIncomeCents: number;
  principalCents: number;
  netCashCents: number;
  rentCount: number;
  expenseCount: number;
};

export type IncomeStatement = {
  range: DateRange;
  rows: IncomeStatementRow[];
  /** Unit rows nested under their building, with the shared line and subtotal. */
  buildings: IncomeStatementBuildingRow[];
  totals: IncomeStatementRow;
  operatingCategories: IncomeStatementCategoryRow[];
  financing: { interestCents: number; principalCents: number };
  hasUnassigned: boolean;
  /** True when any building carries a building-wide cost this period. */
  hasBuildingShared: boolean;
};

/**
 * True when a building group is really just ONE standalone unit: a single unit
 * row, no siblings, and no building-wide cost. Renderers show these as one column
 * instead of a building header plus a nested unit column for identical figures.
 * The overhead bucket (buildingKey == null) is excluded: it is a catch-all, not a
 * building.
 */
export function isStandaloneUnit(b: IncomeStatementBuildingRow): boolean {
  return (
    b.buildingKey != null &&
    b.unitRows.length === 1 &&
    b.shared.operatingExpensesCents === 0 &&
    b.shared.interestCents === 0 &&
    b.shared.principalCents === 0
  );
}

const UNASSIGNED_LABEL = "Unassigned";
const OVERHEAD_LABEL = "Unassigned / overhead";
const TOTAL_LABEL = "Total";

type CostAccumulator = {
  operatingExpensesCents: number;
  interestCents: number;
  principalCents: number;
  expenseCount: number;
};

function emptyCostAccumulator(): CostAccumulator {
  return {
    operatingExpensesCents: 0,
    interestCents: 0,
    principalCents: 0,
    expenseCount: 0,
  };
}

function costInRange(row: WorkOrderCostRow, range: DateRange): boolean {
  if (row.cost_cents == null) return false;
  const d = row.completed_on;
  if (!d) return false;
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

function statementPropertyKey(row: WorkOrderCostRow): string | null {
  // v1 intentionally buckets building-scoped costs into Unassigned/overhead at
  // the portfolio level. Per-building P&L nesting is a later slice.
  return workOrderScope(row) === "unit" ? row.property_id ?? null : null;
}

function addCost(acc: CostAccumulator, category: string, cents: number): void {
  acc.expenseCount += 1;
  if (category === "interest") {
    acc.interestCents += cents;
  } else if (category === "mortgage") {
    acc.principalCents += cents;
  } else if (isOperatingCategory(category)) {
    acc.operatingExpensesCents += cents;
  }
}

function buildRow(
  propertyId: string | null,
  address: string,
  revenueCents: number,
  rentCount: number,
  costs: CostAccumulator,
): IncomeStatementRow {
  const noiCents = revenueCents - costs.operatingExpensesCents;
  const netIncomeCents = noiCents - costs.interestCents;
  const netCashCents = netIncomeCents - costs.principalCents;
  return {
    propertyId,
    address,
    revenueCents,
    operatingExpensesCents: costs.operatingExpensesCents,
    noiCents,
    interestCents: costs.interestCents,
    netIncomeCents,
    principalCents: costs.principalCents,
    netCashCents,
    rentCount,
    expenseCount: costs.expenseCount,
  };
}

function categoryLabel(category: string): string {
  return isExpenseCategory(category)
    ? expenseCategoryLabel(category)
    : workOrderCategoryLabel(category);
}

/** Net margin label for the income-statement headline. */
export function netMarginLabel(netIncomeCents: number, revenueCents: number): string {
  if (revenueCents === 0) return "—";
  return `${((netIncomeCents / revenueCents) * 100).toFixed(1)}%`;
}

export function buildIncomeStatement(
  rentRows: RentRow[],
  costRows: WorkOrderCostRow[],
  properties: PropertyRef[],
  range: DateRange = { from: null, to: null },
): IncomeStatement {
  const addressOf = new Map(properties.map((p) => [p.id, p.address]));
  const rentBuckets = groupRentByProperty(rentRows, range);
  const rentByProperty = new Map(rentBuckets.map((b) => [b.propertyId, b]));
  const costByProperty = new Map<string | null, CostAccumulator>();
  const sharedByBuilding = new Map<string, CostAccumulator>();
  const operatingByCategory = new Map<string, { totalCents: number; count: number }>();

  const totalsCost = emptyCostAccumulator();
  for (const row of costRows) {
    if (!costInRange(row, range)) continue;
    const cents = row.cost_cents ?? 0;
    addCost(totalsCost, row.category, cents);

    // A building-scoped cost is held OUT of the per-unit rows and carried on the
    // building tier instead. Before v2 it fell into "Unassigned", which put a
    // triplex's property tax and water bills in the same bucket as costs that
    // belong to no property at all, and left every unit row showing revenue with
    // no costs beneath it.
    const buildingKey = typeof row.building_key === "string" ? row.building_key.trim() : "";
    if (workOrderScope(row) === "building" && buildingKey) {
      const sharedCosts = sharedByBuilding.get(buildingKey) ?? emptyCostAccumulator();
      addCost(sharedCosts, row.category, cents);
      sharedByBuilding.set(buildingKey, sharedCosts);
    } else {
      const key = statementPropertyKey(row);
      const propertyCosts = costByProperty.get(key) ?? emptyCostAccumulator();
      addCost(propertyCosts, row.category, cents);
      costByProperty.set(key, propertyCosts);
    }

    if (isOperatingCategory(row.category)) {
      const cur = operatingByCategory.get(row.category) ?? { totalCents: 0, count: 0 };
      cur.totalCents += cents;
      cur.count += 1;
      operatingByCategory.set(row.category, cur);
    }
  }

  const keys = new Set<string | null>([
    ...rentBuckets.map((b) => b.propertyId),
    ...costByProperty.keys(),
  ]);

  const rows: IncomeStatementRow[] = [];
  for (const key of keys) {
    const rent = rentByProperty.get(key);
    const costs = costByProperty.get(key) ?? emptyCostAccumulator();
    const revenueCents = rent?.totalCents ?? 0;
    rows.push(
      buildRow(
        key,
        key == null ? UNASSIGNED_LABEL : addressOf.get(key) ?? "Deleted unit",
        revenueCents,
        rent?.count ?? 0,
        costs,
      ),
    );
  }

  rows.sort((a, b) => {
    if (a.propertyId == null) return 1;
    if (b.propertyId == null) return -1;
    return a.address.localeCompare(b.address);
  });

  const revenueCents = sumRentCents(rentRows, range);
  const rentCount = rentBuckets.reduce((sum, row) => sum + row.count, 0);
  const totals = buildRow(null, TOTAL_LABEL, revenueCents, rentCount, totalsCost);

  const operatingCategories: IncomeStatementCategoryRow[] = [...operatingByCategory.entries()]
    .map(([category, value]) => ({
      category,
      totalCents: value.totalCents,
      count: value.count,
    }))
    .sort((a, b) => b.totalCents - a.totalCents || categoryLabel(a.category).localeCompare(categoryLabel(b.category)));

  // --- Building tier: nest the unit rows under their building, plus the shared
  // line. Mirrors buildOwnerStatement's `buildings` tier so the two reports group
  // the portfolio the same way. Shared costs are NOT pro-rated onto units.
  const buildingLabelOf = new Map<string, string>();
  for (const p of properties) {
    const bk = p.buildingKey ?? null;
    if (bk && !buildingLabelOf.has(bk)) {
      buildingLabelOf.set(bk, splitAddressUnit(p.address).street ?? p.address);
    }
  }
  const propBuildingKey = new Map(properties.map((p) => [p.id, p.buildingKey ?? null]));

  type BuildingAcc = {
    unitRows: IncomeStatementRow[];
    shared: CostAccumulator;
    label: string;
  };
  const buildingAcc = new Map<string | null, BuildingAcc>();
  const ensureBuilding = (key: string | null, label: string): BuildingAcc => {
    let a = buildingAcc.get(key);
    if (!a) {
      a = { unitRows: [], shared: emptyCostAccumulator(), label };
      buildingAcc.set(key, a);
    }
    return a;
  };

  for (const row of rows) {
    if (row.propertyId == null) {
      ensureBuilding(null, OVERHEAD_LABEL).unitRows.push(row);
      continue;
    }
    const bk = propBuildingKey.get(row.propertyId) ?? null;
    if (bk) ensureBuilding(bk, buildingLabelOf.get(bk) ?? bk).unitRows.push(row);
    // A unit with no building key stands alone under a synthetic key so it is
    // never merged into the overhead bucket.
    else ensureBuilding(`prop:${row.propertyId}`, row.address).unitRows.push(row);
  }

  for (const [bk, shared] of sharedByBuilding) {
    ensureBuilding(bk, buildingLabelOf.get(bk) ?? bk).shared = shared;
  }

  const buildings: IncomeStatementBuildingRow[] = [...buildingAcc.entries()].map(([key, a]) => {
    const unitRows = [...a.unitRows].sort((x, y) => {
      if (x.propertyId == null) return 1;
      if (y.propertyId == null) return -1;
      return x.address.localeCompare(y.address);
    });
    const sum = (pick: (r: IncomeStatementRow) => number): number =>
      unitRows.reduce((acc, r) => acc + pick(r), 0);

    const revenueCents = sum((r) => r.revenueCents);
    const operatingExpensesCents =
      sum((r) => r.operatingExpensesCents) + a.shared.operatingExpensesCents;
    const interestCents = sum((r) => r.interestCents) + a.shared.interestCents;
    const principalCents = sum((r) => r.principalCents) + a.shared.principalCents;
    const noiCents = revenueCents - operatingExpensesCents;
    const netIncomeCents = noiCents - interestCents;

    return {
      buildingKey: key,
      label: a.label,
      unitRows,
      shared: {
        operatingExpensesCents: a.shared.operatingExpensesCents,
        interestCents: a.shared.interestCents,
        principalCents: a.shared.principalCents,
        expenseCount: a.shared.expenseCount,
      },
      revenueCents,
      operatingExpensesCents,
      noiCents,
      interestCents,
      netIncomeCents,
      principalCents,
      netCashCents: netIncomeCents - principalCents,
      rentCount: sum((r) => r.rentCount),
      expenseCount: sum((r) => r.expenseCount) + a.shared.expenseCount,
    };
  });
  buildings.sort((a, b) => {
    if (a.buildingKey == null) return 1; // overhead bucket last
    if (b.buildingKey == null) return -1;
    return a.label.localeCompare(b.label);
  });

  return {
    range,
    rows,
    buildings,
    totals,
    operatingCategories,
    financing: {
      interestCents: totals.interestCents,
      principalCents: totals.principalCents,
    },
    hasUnassigned: rows.some((row) => row.propertyId == null),
    hasBuildingShared: buildings.some(
      (b) =>
        b.shared.operatingExpensesCents !== 0 ||
        b.shared.interestCents !== 0 ||
        b.shared.principalCents !== 0,
    ),
  };
}

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function incomeStatementToCsv(statement: IncomeStatement): string {
  const lines: string[] = [];
  const row = (cells: (string | number)[]) => lines.push(cells.map(csvField).join(","));

  row(["Income statement"]);
  row(["Period", describeRange(statement.range)]);
  lines.push("");

  row([
    "Building / unit",
    "Rental revenue",
    "Operating expenses",
    "NOI",
    "Mortgage interest",
    "Net income",
    "Mortgage principal (memo)",
    "Net cash after debt service",
    "Rent payments",
    "Expense items",
  ]);
  // Grouped exactly like the table an owner reads: each building, its units
  // indented beneath it, then the building-wide line. A single unit with no
  // siblings and no shared cost is one line, not a header plus an identical
  // child. The overhead bucket is a catch-all, not a building, so it gets no
  // subtotal header. Building rows + overhead rows == TOTAL, so the table foots.
  const csvRow = (label: string, r: IncomeStatementRow) =>
    row([
      label,
      dollars(r.revenueCents),
      dollars(r.operatingExpensesCents),
      dollars(r.noiCents),
      dollars(r.interestCents),
      dollars(r.netIncomeCents),
      dollars(r.principalCents),
      dollars(r.netCashCents),
      r.rentCount,
      r.expenseCount,
    ]);

  for (const b of statement.buildings) {
    if (b.buildingKey == null) {
      // Unassigned / overhead: flat, no subtotal line.
      for (const u of b.unitRows) csvRow(u.address, u);
      continue;
    }
    if (isStandaloneUnit(b)) {
      csvRow(b.unitRows[0].address, b.unitRows[0]);
      continue;
    }
    row([
      b.label,
      dollars(b.revenueCents),
      dollars(b.operatingExpensesCents),
      dollars(b.noiCents),
      dollars(b.interestCents),
      dollars(b.netIncomeCents),
      dollars(b.principalCents),
      dollars(b.netCashCents),
      b.rentCount,
      b.expenseCount,
    ]);
    for (const u of b.unitRows) csvRow(`  ${u.address}`, u);
    if (
      b.shared.operatingExpensesCents !== 0 ||
      b.shared.interestCents !== 0 ||
      b.shared.principalCents !== 0
    ) {
      const sharedNoi = -b.shared.operatingExpensesCents;
      const sharedNet = sharedNoi - b.shared.interestCents;
      row([
        "  Building-wide (shared)",
        dollars(0),
        dollars(b.shared.operatingExpensesCents),
        dollars(sharedNoi),
        dollars(b.shared.interestCents),
        dollars(sharedNet),
        dollars(b.shared.principalCents),
        dollars(sharedNet - b.shared.principalCents),
        0,
        b.shared.expenseCount,
      ]);
    }
  }
  row([
    "TOTAL",
    dollars(statement.totals.revenueCents),
    dollars(statement.totals.operatingExpensesCents),
    dollars(statement.totals.noiCents),
    dollars(statement.totals.interestCents),
    dollars(statement.totals.netIncomeCents),
    dollars(statement.totals.principalCents),
    dollars(statement.totals.netCashCents),
    statement.totals.rentCount,
    statement.totals.expenseCount,
  ]);

  if (statement.hasBuildingShared) {
    lines.push("");
    row([
      "Note",
      "Building-wide costs are not split across the units; they sit on the building so every per-unit figure stays literally true.",
    ]);
  }

  lines.push("");
  row(["Operating expenses by category", "Amount", "Items"]);
  for (const c of statement.operatingCategories) {
    row([categoryLabel(c.category), dollars(c.totalCents), c.count]);
  }

  lines.push("");
  row(["Financing", "Amount"]);
  row(["Mortgage interest", dollars(statement.financing.interestCents)]);
  row(["Mortgage principal (memo)", dollars(statement.financing.principalCents)]);
  row([
    "Note",
    "Principal is a capital repayment, not an expense; only interest reduces net income.",
  ]);

  return lines.join("\n") + "\n";
}
