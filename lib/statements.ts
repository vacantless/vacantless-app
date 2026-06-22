// Pure owner financial-statement model (no I/O) so it can be unit-tested in
// isolation. This is the year-end package the self-managed owner (and their
// accountant) wants: for a chosen period, per property, RENT IN minus
// MAINTENANCE OUT = net. It joins two existing ledgers:
//
//   * rent_payments (lib/payments.ts, migration 0032) — money the owner RECEIVED
//     against a tenancy (cash basis: counted by paid_on).
//   * work_orders   (lib/work-orders.ts, migration 0054) — what the owner SPENT
//     on maintenance (cash basis: counted by completed_on; only completed,
//     costed jobs land in a period).
//
// We only RECORD — we never move money. This module is pure reporting on top of
// what the owner already logged. The maintenance side reuses the cost rollups
// already built (and tested) in lib/work-orders.ts; this module adds the rent
// side and the join, plus the CSV the accountant downloads.

import { formatMoneyCents, formatPeriodMonth } from "./payments";
import {
  groupCostByProperty,
  groupCostByCategory,
  sumCostCents,
  type WorkOrderCostRow,
  type CostFilter,
} from "./work-orders";

export { formatMoneyCents };

// --- Inputs -----------------------------------------------------------------

/**
 * A rent payment, with the property resolved at query time (rent_payments link
 * to a tenancy, and every tenancy has a property — so property_id is normally
 * present; null is tolerated and buckets under "Unassigned").
 */
export type RentRow = {
  amount_cents: number;
  paid_on: string | null; // "YYYY-MM-DD"
  property_id: string | null;
};

/** A property reference for labelling the statement rows. */
export type PropertyRef = { id: string; address: string };

/**
 * An inclusive date window. Either bound may be null (open-ended). A statement
 * with both bounds null is "all time".
 */
export type DateRange = { from: string | null; to: string | null };

// --- Range presets ----------------------------------------------------------

export const STATEMENT_PRESETS = ["this_year", "last_year", "all", "custom"] as const;
export type StatementPreset = (typeof STATEMENT_PRESETS)[number];

const PRESET_LABELS: Record<StatementPreset, string> = {
  this_year: "This year",
  last_year: "Last year",
  all: "All time",
  custom: "Custom range",
};

export function statementPresetLabel(preset: string): string {
  return (PRESET_LABELS as Record<string, string>)[preset] ?? preset;
}

function yearRange(year: number): DateRange {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * Resolve a preset to a concrete range. `todayIso` ("YYYY-MM-DD") is passed in
 * so this stays pure (no `new Date()` inside). For "custom", the caller supplies
 * the range via `customRange` (already-validated bounds); a missing/invalid
 * custom range falls back to the current year.
 */
export function rangeForPreset(
  preset: string,
  todayIso: string,
  customRange?: DateRange,
): DateRange {
  const year = parseInt((todayIso || "").slice(0, 4), 10);
  const thisYear = Number.isFinite(year) ? year : new Date().getUTCFullYear();
  switch (preset) {
    case "last_year":
      return yearRange(thisYear - 1);
    case "all":
      return { from: null, to: null };
    case "custom":
      return customRange ?? yearRange(thisYear);
    case "this_year":
    default:
      return yearRange(thisYear);
  }
}

/** Validate an "YYYY-MM-DD" bound, returning it or null. */
export function parseRangeBound(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** A short human label for a window, e.g. "Jan 1 – Dec 31, 2026" / "All time". */
export function describeRange(range: DateRange): string {
  if (!range.from && !range.to) return "All time";
  if (range.from && range.to) return `${range.from} to ${range.to}`;
  if (range.from) return `From ${range.from}`;
  return `Up to ${range.to}`;
}

// --- Rent side (the new half; maintenance side is reused from work-orders) ---

function rentInRange(row: RentRow, range: DateRange): boolean {
  const d = row.paid_on;
  if (!d) return false; // undated payment can't be placed in a period
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

/** Total rent collected within a window. */
export function sumRentCents(rows: RentRow[], range: DateRange = { from: null, to: null }): number {
  let total = 0;
  for (const r of rows) {
    if (!rentInRange(r, range)) continue;
    total += r.amount_cents;
  }
  return total;
}

export type RentBucket = { propertyId: string | null; totalCents: number; count: number };

/** Rent collected grouped by property (null property buckets under null). */
export function groupRentByProperty(
  rows: RentRow[],
  range: DateRange = { from: null, to: null },
): RentBucket[] {
  const by = new Map<string | null, { total: number; count: number }>();
  for (const r of rows) {
    if (!rentInRange(r, range)) continue;
    const key = r.property_id ?? null;
    const cur = by.get(key) ?? { total: 0, count: 0 };
    cur.total += r.amount_cents;
    cur.count += 1;
    by.set(key, cur);
  }
  return [...by.entries()].map(([propertyId, v]) => ({
    propertyId,
    totalCents: v.total,
    count: v.count,
  }));
}

// --- The statement (rent in − maintenance out, per property) ----------------

export type StatementRow = {
  propertyId: string | null;
  address: string; // "Unassigned" when propertyId is null
  rentInCents: number;
  maintenanceOutCents: number;
  netCents: number; // rentIn − maintenanceOut
  rentCount: number;
  workOrderCount: number;
};

export type StatementTotals = {
  rentInCents: number;
  maintenanceOutCents: number;
  netCents: number;
  rentCount: number;
  workOrderCount: number;
};

export type CategoryRow = { category: string; totalCents: number; count: number };

export type OwnerStatement = {
  range: DateRange;
  rows: StatementRow[];
  totals: StatementTotals;
  /** Maintenance spend broken out by category, for the year-end detail. */
  categories: CategoryRow[];
  hasUnassigned: boolean;
};

const UNASSIGNED_LABEL = "Unassigned";

/**
 * Build the per-property owner statement for a window. `rentRows` carry a
 * resolved property_id; `workOrderRows` are the same WorkOrderCostRow the
 * work-orders cost rollups already consume (counted by completed_on, cost-only).
 * Properties with NO activity in the window are omitted; properties present in
 * either ledger appear. Rows are sorted by address, with Unassigned last.
 */
export function buildOwnerStatement(
  rentRows: RentRow[],
  workOrderRows: WorkOrderCostRow[],
  properties: PropertyRef[],
  range: DateRange = { from: null, to: null },
): OwnerStatement {
  const addressOf = new Map(properties.map((p) => [p.id, p.address]));
  const costFilter: CostFilter = { from: range.from ?? undefined, to: range.to ?? undefined };

  const rentBuckets = groupRentByProperty(rentRows, range);
  const costBuckets = groupCostByProperty(workOrderRows, costFilter);

  const rentByProp = new Map(rentBuckets.map((b) => [b.propertyId, b]));
  const costByProp = new Map(costBuckets.map((b) => [b.key, b]));

  const keys = new Set<string | null>([
    ...rentBuckets.map((b) => b.propertyId),
    ...costBuckets.map((b) => b.key),
  ]);

  const rows: StatementRow[] = [];
  for (const key of keys) {
    const rent = rentByProp.get(key);
    const cost = costByProp.get(key);
    const rentInCents = rent?.totalCents ?? 0;
    const maintenanceOutCents = cost?.totalCents ?? 0;
    rows.push({
      propertyId: key,
      address: key == null ? UNASSIGNED_LABEL : addressOf.get(key) ?? "Deleted unit",
      rentInCents,
      maintenanceOutCents,
      netCents: rentInCents - maintenanceOutCents,
      rentCount: rent?.count ?? 0,
      workOrderCount: cost?.count ?? 0,
    });
  }

  rows.sort((a, b) => {
    if (a.propertyId == null) return 1; // Unassigned last
    if (b.propertyId == null) return -1;
    return a.address.localeCompare(b.address);
  });

  const totals: StatementTotals = {
    rentInCents: sumRentCents(rentRows, range),
    maintenanceOutCents: sumCostCents(workOrderRows, costFilter),
    netCents: 0,
    rentCount: rows.reduce((s, r) => s + r.rentCount, 0),
    workOrderCount: rows.reduce((s, r) => s + r.workOrderCount, 0),
  };
  totals.netCents = totals.rentInCents - totals.maintenanceOutCents;

  const categories: CategoryRow[] = groupCostByCategory(workOrderRows, costFilter)
    .map((b) => ({ category: b.key, totalCents: b.totalCents, count: b.count }))
    .sort((a, b) => b.totalCents - a.totalCents);

  return {
    range,
    rows,
    totals,
    categories,
    hasUnassigned: rows.some((r) => r.propertyId == null),
  };
}

// --- Monthly breakdown (per month × property, for the accountant's detail) ---

export type MonthlyStatementRow = {
  period: string; // "YYYY-MM-01"
  monthLabel: string; // "June 2026"
  propertyId: string | null;
  address: string;
  rentInCents: number;
  maintenanceOutCents: number;
  netCents: number;
};

/** First-of-month key for a "YYYY-MM-DD" date, or null. */
function monthKey(date: string | null): string | null {
  const v = (date ?? "").trim();
  const m = v.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/**
 * Per-(month, property) breakdown across the window — the detail rows that turn
 * the annual summary into a month-by-month statement. Sorted by month
 * (earliest first), then address (Unassigned last within a month).
 */
export function buildMonthlyStatement(
  rentRows: RentRow[],
  workOrderRows: WorkOrderCostRow[],
  properties: PropertyRef[],
  range: DateRange = { from: null, to: null },
): MonthlyStatementRow[] {
  const addressOf = new Map(properties.map((p) => [p.id, p.address]));
  const cells = new Map<string, { rent: number; maint: number }>();
  const cellKey = (period: string, prop: string | null) => `${period}|${prop ?? ""}`;

  for (const r of rentRows) {
    if (!rentInRange(r, range)) continue;
    const period = monthKey(r.paid_on);
    if (!period) continue;
    const k = cellKey(period, r.property_id ?? null);
    const cur = cells.get(k) ?? { rent: 0, maint: 0 };
    cur.rent += r.amount_cents;
    cells.set(k, cur);
  }

  for (const w of workOrderRows) {
    if (w.cost_cents == null) continue;
    const d = w.completed_on;
    if (!d) continue;
    if (range.from && d < range.from) continue;
    if (range.to && d > range.to) continue;
    const period = monthKey(d);
    if (!period) continue;
    const k = cellKey(period, w.property_id ?? null);
    const cur = cells.get(k) ?? { rent: 0, maint: 0 };
    cur.maint += w.cost_cents;
    cells.set(k, cur);
  }

  const out: MonthlyStatementRow[] = [];
  for (const [k, v] of cells.entries()) {
    const sep = k.indexOf("|");
    const period = k.slice(0, sep);
    const propRaw = k.slice(sep + 1);
    const propertyId = propRaw === "" ? null : propRaw;
    out.push({
      period,
      monthLabel: formatPeriodMonth(period),
      propertyId,
      address: propertyId == null ? UNASSIGNED_LABEL : addressOf.get(propertyId) ?? "Deleted unit",
      rentInCents: v.rent,
      maintenanceOutCents: v.maint,
      netCents: v.rent - v.maint,
    });
  }

  out.sort((a, b) => {
    if (a.period !== b.period) return a.period.localeCompare(b.period);
    if (a.propertyId == null) return 1;
    if (b.propertyId == null) return -1;
    return a.address.localeCompare(b.address);
  });

  return out;
}

// --- CSV export -------------------------------------------------------------

/** Quote a CSV field (wrap + double inner quotes only when needed). */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Plain dollars with two decimals, no symbol/grouping — clean for spreadsheets. */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * The full year-end CSV: a header block (period), a per-property summary with a
 * TOTAL row, a maintenance-by-category block, then a month-by-month detail block
 * when the window spans activity. Pure string assembly (no Date), so it can't
 * drift across time zones.
 */
export function statementToCsv(
  statement: OwnerStatement,
  monthly: MonthlyStatementRow[],
): string {
  const lines: string[] = [];
  const row = (cells: (string | number)[]) => lines.push(cells.map(csvField).join(","));

  row(["Owner financial statement"]);
  row(["Period", describeRange(statement.range)]);
  lines.push("");

  // Per-property summary
  row(["Property", "Rent collected", "Maintenance spent", "Net"]);
  for (const r of statement.rows) {
    row([r.address, dollars(r.rentInCents), dollars(r.maintenanceOutCents), dollars(r.netCents)]);
  }
  row([
    "TOTAL",
    dollars(statement.totals.rentInCents),
    dollars(statement.totals.maintenanceOutCents),
    dollars(statement.totals.netCents),
  ]);

  // Maintenance by category
  if (statement.categories.length > 0) {
    lines.push("");
    row(["Maintenance by category", "Amount", "Jobs"]);
    for (const c of statement.categories) {
      row([c.category, dollars(c.totalCents), c.count]);
    }
  }

  // Month-by-month detail
  if (monthly.length > 0) {
    lines.push("");
    row(["Month", "Property", "Rent collected", "Maintenance spent", "Net"]);
    for (const m of monthly) {
      row([
        m.monthLabel,
        m.address,
        dollars(m.rentInCents),
        dollars(m.maintenanceOutCents),
        dollars(m.netCents),
      ]);
    }
  }

  return lines.join("\n") + "\n";
}
