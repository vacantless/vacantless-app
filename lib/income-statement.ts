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

export type IncomeStatement = {
  range: DateRange;
  rows: IncomeStatementRow[];
  totals: IncomeStatementRow;
  operatingCategories: IncomeStatementCategoryRow[];
  financing: { interestCents: number; principalCents: number };
  hasUnassigned: boolean;
};

const UNASSIGNED_LABEL = "Unassigned";
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
  const operatingByCategory = new Map<string, { totalCents: number; count: number }>();

  const totalsCost = emptyCostAccumulator();
  for (const row of costRows) {
    if (!costInRange(row, range)) continue;
    const cents = row.cost_cents ?? 0;
    const key = statementPropertyKey(row);
    const propertyCosts = costByProperty.get(key) ?? emptyCostAccumulator();
    addCost(propertyCosts, row.category, cents);
    addCost(totalsCost, row.category, cents);
    costByProperty.set(key, propertyCosts);

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

  return {
    range,
    rows,
    totals,
    operatingCategories,
    financing: {
      interestCents: totals.interestCents,
      principalCents: totals.principalCents,
    },
    hasUnassigned: rows.some((row) => row.propertyId == null),
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
    "Property",
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
  for (const r of statement.rows) {
    row([
      r.address,
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
