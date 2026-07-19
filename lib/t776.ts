// Pure T776 year-end tax-package model (no I/O) so it can be unit-tested in
// isolation. This is the Premium accountant-facing rental summary: gross rents
// on line 8299, deductible expenses mapped to their T776 lines, mortgage
// principal kept as a memo only, and net income before accountant adjustments.
//
// We only REPORT on ledgers the owner already keeps. Rent comes from
// rent_payments (cash basis: paid_on). Costs come from work_orders + expenses
// mapped to WorkOrderCostRow (actual basis: completed_on / incurred_on). No
// rows are inserted, updated, or deleted here.

import {
  groupRentByProperty,
  sumRentCents,
  type DateRange,
  type PropertyRef,
  type RentRow,
} from "./statements";
import { EXPENSE_CATEGORIES } from "./expenses";
import type { WorkOrderCostRow } from "./work-orders";

export const T776_LINES = [
  { line: "8299", label: "Total gross rental income" },
  { line: "8521", label: "Advertising" },
  { line: "8690", label: "Insurance" },
  { line: "8710", label: "Interest and bank charges" },
  { line: "8810", label: "Office expenses" },
  { line: "8860", label: "Professional fees" },
  { line: "8871", label: "Management and administration fees" },
  { line: "8960", label: "Repairs and maintenance" },
  { line: "9180", label: "Property taxes" },
  { line: "9200", label: "Travel" },
  { line: "9220", label: "Utilities" },
  { line: "9270", label: "Other expenses" },
] as const;

export type T776LineNumber = (typeof T776_LINES)[number]["line"];

export type T776LineAmount = {
  line: string;
  label: string;
  amountCents: number;
};

export type T776StatementRow = {
  propertyId: string | null;
  address: string;
  grossRentCents: number;
  lines: T776LineAmount[];
  totalExpensesCents: number;
  netBeforeAdjustmentsCents: number;
  principalMemoCents: number;
};

export type T776Statement = {
  year: number;
  range: DateRange;
  rows: T776StatementRow[];
  totals: T776StatementRow;
  hasUnassigned: boolean;
};

const UNASSIGNED_LABEL = "Unassigned";
const PORTFOLIO_LABEL = "Portfolio total";

const LINE_LABELS = new Map<string, string>(T776_LINES.map((line) => [line.line, line.label]));
const EXPENSE_CATEGORY_SET = new Set<string>(EXPENSE_CATEGORIES);

const CATEGORY_LINE: Record<string, string | null> = {
  advertising: "8521",
  insurance: "8690",
  interest: "8710",
  supplies: "8810",
  professional: "8860",
  management: "8871",
  maintenance: "8960",
  property_tax: "9180",
  travel: "9200",
  utilities: "9220",
  condo_fees: "9270",
  other: "9270",
  mortgage: null,
};

const WORK_ORDER_REPAIR_CATEGORIES = new Set<string>([
  "plumbing",
  "electrical",
  "hvac",
  "appliance",
  "structural",
  "pest",
  "landscaping",
  "cleaning",
  "general",
  "roof",
  "roofing",
]);

function yearRange(year: number): DateRange {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function validYear(year: number): number {
  return Number.isInteger(year) && year >= 1900 && year <= 9999
    ? year
    : 1970;
}

function costInRange(row: WorkOrderCostRow, range: DateRange): boolean {
  if (row.cost_cents == null) return false;
  const d = row.completed_on;
  if (!d) return false;
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

function lineLabel(line: string): string {
  return LINE_LABELS.get(line) ?? line;
}

export function t776LineForCategory(category: string): string | null {
  const key = (category ?? "").trim();
  if (WORK_ORDER_REPAIR_CATEGORIES.has(key)) return "8960";
  if (Object.prototype.hasOwnProperty.call(CATEGORY_LINE, key)) return CATEGORY_LINE[key];
  if (EXPENSE_CATEGORY_SET.has(key)) return CATEGORY_LINE[key] ?? "9270";
  return "9270";
}

function makeLineMap(): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of T776_LINES) {
    if (line.line !== "8299") map.set(line.line, 0);
  }
  return map;
}

function addLine(map: Map<string, number>, line: string, cents: number): void {
  map.set(line, (map.get(line) ?? 0) + cents);
}

function linesFor(grossRentCents: number, lineAmounts: Map<string, number>): T776LineAmount[] {
  return T776_LINES.map((line) => ({
    line: line.line,
    label: line.label,
    amountCents: line.line === "8299" ? grossRentCents : lineAmounts.get(line.line) ?? 0,
  }));
}

function expenseTotal(lineAmounts: Map<string, number>): number {
  let total = 0;
  for (const line of T776_LINES) {
    if (line.line === "8299") continue;
    total += lineAmounts.get(line.line) ?? 0;
  }
  return total;
}

function buildRow(
  propertyId: string | null,
  address: string,
  grossRentCents: number,
  lineAmounts: Map<string, number>,
  principalMemoCents: number,
): T776StatementRow {
  const totalExpensesCents = expenseTotal(lineAmounts);
  return {
    propertyId,
    address,
    grossRentCents,
    lines: linesFor(grossRentCents, lineAmounts),
    totalExpensesCents,
    netBeforeAdjustmentsCents: grossRentCents - totalExpensesCents,
    principalMemoCents,
  };
}

export function buildT776Statement(
  rentRows: RentRow[],
  costRows: WorkOrderCostRow[],
  properties: PropertyRef[],
  year: number,
): T776Statement {
  const taxYear = validYear(year);
  const range = yearRange(taxYear);
  const addressOf = new Map(properties.map((p) => [p.id, p.address]));
  const rentBuckets = groupRentByProperty(rentRows, range);
  const rentByProperty = new Map(rentBuckets.map((bucket) => [bucket.propertyId, bucket]));
  const linesByProperty = new Map<string | null, Map<string, number>>();
  const principalByProperty = new Map<string | null, number>();
  const totalLineAmounts = makeLineMap();
  let totalPrincipalMemoCents = 0;

  for (const row of costRows) {
    if (!costInRange(row, range)) continue;
    const propertyId = row.property_id ?? null;
    const cents = row.cost_cents ?? 0;
    const line = t776LineForCategory(row.category);

    if (line == null) {
      principalByProperty.set(propertyId, (principalByProperty.get(propertyId) ?? 0) + cents);
      totalPrincipalMemoCents += cents;
      continue;
    }

    const lineAmounts = linesByProperty.get(propertyId) ?? makeLineMap();
    addLine(lineAmounts, line, cents);
    addLine(totalLineAmounts, line, cents);
    linesByProperty.set(propertyId, lineAmounts);
  }

  const keys = new Set<string | null>([
    ...rentBuckets.map((bucket) => bucket.propertyId),
    ...linesByProperty.keys(),
    ...principalByProperty.keys(),
  ]);

  const rows: T776StatementRow[] = [];
  for (const key of keys) {
    const rent = rentByProperty.get(key);
    const grossRentCents = rent?.totalCents ?? 0;
    rows.push(
      buildRow(
        key,
        key == null ? UNASSIGNED_LABEL : addressOf.get(key) ?? "Deleted unit",
        grossRentCents,
        linesByProperty.get(key) ?? makeLineMap(),
        principalByProperty.get(key) ?? 0,
      ),
    );
  }

  rows.sort((a, b) => {
    if (a.propertyId == null) return 1;
    if (b.propertyId == null) return -1;
    return a.address.localeCompare(b.address);
  });

  const totals = buildRow(
    null,
    PORTFOLIO_LABEL,
    sumRentCents(rentRows, range),
    totalLineAmounts,
    totalPrincipalMemoCents,
  );

  return {
    year: taxYear,
    range,
    rows,
    totals,
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

function writeT776Block(row: (cells: (string | number)[]) => void, item: T776StatementRow): void {
  row(["Property", item.address]);
  row(["Line", "Label", "Amount"]);
  for (const line of item.lines) {
    row([line.line, line.label, dollars(line.amountCents)]);
  }
  row(["", "Total expenses", dollars(item.totalExpensesCents)]);
  row(["9369", "Net income (loss) before adjustments", dollars(item.netBeforeAdjustmentsCents)]);
  row(["Memo", "Mortgage principal excluded from deductible expenses", dollars(item.principalMemoCents)]);
  row(["9936", "Capital cost allowance", "enter with your accountant"]);
  row(["9946", "Your net income (loss)", dollars(item.netBeforeAdjustmentsCents)]);
}

export function t776ToCsv(statement: T776Statement): string {
  const lines: string[] = [];
  const row = (cells: (string | number)[]) => lines.push(cells.map(csvField).join(","));

  row(["T776 tax package"]);
  row(["Tax year", statement.year]);
  row(["Period", `${statement.range.from} to ${statement.range.to}`]);

  for (const item of statement.rows) {
    lines.push("");
    writeT776Block(row, item);
  }

  lines.push("");
  row(["Portfolio summary"]);
  writeT776Block(row, statement.totals);

  lines.push("");
  row([
    "Note",
    "This is an accountant-ready summary, not a filed return. CCA, personal-use portion, and co-ownership splits are adjustments to confirm with your accountant; verify the current-year T776.",
  ]);

  return lines.join("\n") + "\n";
}

export function t776LabelForLine(line: string): string {
  return lineLabel(line);
}
