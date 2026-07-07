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
  groupCostByBuilding,
  workOrderScope,
  sumCostCents,
  type WorkOrderCostRow,
  type CostFilter,
} from "./work-orders";
import { splitAddressUnit } from "./listing-fill-sheet";

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

/**
 * A property reference for labelling the statement rows. `buildingKey` (the
 * normalized building identity, properties.building_key) is optional: when
 * supplied it lets the statement nest units under their building and roll up a
 * building tier. Absent/null = the property stands alone (back-compatible).
 */
export type PropertyRef = { id: string; address: string; buildingKey?: string | null };

/**
 * An inclusive date window. Either bound may be null (open-ended). A statement
 * with both bounds null is "all time".
 */
export type DateRange = { from: string | null; to: string | null };

// --- Range presets ----------------------------------------------------------

export const STATEMENT_PRESETS = [
  "this_year",
  "last_year",
  "last_30",
  "last_60",
  "last_90",
  "all",
  "custom",
] as const;
export type StatementPreset = (typeof STATEMENT_PRESETS)[number];

const PRESET_LABELS: Record<StatementPreset, string> = {
  this_year: "This year",
  last_year: "Last year",
  last_30: "Last 30 days",
  last_60: "Last 60 days",
  last_90: "Last 90 days",
  all: "All time",
  custom: "Custom range",
};

export function statementPresetLabel(preset: string): string {
  return (PRESET_LABELS as Record<string, string>)[preset] ?? preset;
}

function yearRange(year: number): DateRange {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

const PRESET_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Add (or subtract) whole days to an ISO "YYYY-MM-DD" date in UTC, returning a
 * new ISO date. Deterministic from its inputs (no ambient `now`), so the rolling
 * presets below stay pure + testable. Invalid input passes through unchanged.
 */
function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || "").trim());
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a preset to a concrete range. `todayIso` ("YYYY-MM-DD") is passed in
 * so this stays pure (the only `new Date()` is the invalid-input fallback). For
 * "custom", the caller supplies the range via `customRange` (already-validated
 * bounds); a missing/invalid custom range falls back to the current year.
 *
 * The rolling presets (`last_30/60/90`) are an N-day window ending today
 * inclusive: from = today − N days, to = today.
 */
export function rangeForPreset(
  preset: string,
  todayIso: string,
  customRange?: DateRange,
): DateRange {
  const today = PRESET_DATE.test(todayIso) ? todayIso : new Date().toISOString().slice(0, 10);
  const year = parseInt(today.slice(0, 4), 10);
  const thisYear = Number.isFinite(year) ? year : new Date().getUTCFullYear();
  switch (preset) {
    case "last_year":
      return yearRange(thisYear - 1);
    case "last_30":
      return { from: addDaysIso(today, -30), to: today };
    case "last_60":
      return { from: addDaysIso(today, -60), to: today };
    case "last_90":
      return { from: addDaysIso(today, -90), to: today };
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

/**
 * A building tier: the per-unit rows nested under one building, plus a single
 * "Building-wide (shared)" maintenance figure for that building's shared costs
 * (gardening, snow, roof). The subtotal is units + shared. Shared costs are NOT
 * pro-rated onto the units (v1); they sit at the building level so every per-unit
 * figure stays truthful. `buildingKey == null` is the catch-all "Unassigned /
 * overhead" bucket: rent or costs not tied to any unit or building.
 */
export type StatementBuildingRow = {
  buildingKey: string | null;
  label: string;
  unitRows: StatementRow[];
  sharedMaintenanceCents: number;
  sharedWorkOrderCount: number;
  rentInCents: number; // sum of unit rents (there is no building-level rent)
  maintenanceOutCents: number; // sum(unit maintenance) + shared
  netCents: number;
};

export type OwnerStatement = {
  range: DateRange;
  rows: StatementRow[];
  /** Unit rows nested under their building, with the shared line and subtotal. */
  buildings: StatementBuildingRow[];
  totals: StatementTotals;
  /** Maintenance spend broken out by category, for the year-end detail. */
  categories: CategoryRow[];
  hasUnassigned: boolean;
};

/**
 * True when a building group is really just ONE standalone unit — a single unit
 * row, no siblings, and no building-wide shared cost. The By-building table
 * renders these as a single line instead of a bold building-header row PLUS a
 * nested unit row for the identical figures (the "double-row" of KI631, S433).
 * The "Unassigned / overhead" bucket (buildingKey == null) is excluded: it is a
 * special catch-all, not a building, and keeps its own header treatment.
 */
export function isStandaloneUnit(b: StatementBuildingRow): boolean {
  return (
    b.buildingKey != null &&
    b.unitRows.length === 1 &&
    b.sharedMaintenanceCents === 0
  );
}

const UNASSIGNED_LABEL = "Unassigned";
const OVERHEAD_LABEL = "Unassigned / overhead";

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

  // The per-property (unit) rows count UNIT and UNSCOPED maintenance only —
  // building-scoped (shared) costs are pulled out so they never land on a unit
  // or in the "Unassigned" row; they roll up at the building tier below instead.
  const unitAndUnscopedWO = workOrderRows.filter((w) => workOrderScope(w) !== "building");

  const rentBuckets = groupRentByProperty(rentRows, range);
  const costBuckets = groupCostByProperty(unitAndUnscopedWO, costFilter);

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

  // --- Building tier: nest unit rows under their building + the shared line ---
  //
  // A unit row rolls up under its property's buildingKey; the "Unassigned" row
  // (no property) goes in the null overhead bucket. A unit whose property has no
  // buildingKey stands alone (synthetic key) so it isn't merged into overhead.
  // Shared (building-scoped) costs add a "Building-wide" figure to their building.
  const buildingLabelOf = new Map<string, string>();
  for (const p of properties) {
    const bk = p.buildingKey ?? null;
    if (bk && !buildingLabelOf.has(bk)) {
      buildingLabelOf.set(bk, splitAddressUnit(p.address).street ?? p.address);
    }
  }
  const propBuildingKey = new Map(properties.map((p) => [p.id, p.buildingKey ?? null]));

  type Acc = { unitRows: StatementRow[]; shared: number; sharedCount: number; label: string };
  const acc = new Map<string | null, Acc>();
  const ensure = (key: string | null, label: string): Acc => {
    let a = acc.get(key);
    if (!a) {
      a = { unitRows: [], shared: 0, sharedCount: 0, label };
      acc.set(key, a);
    }
    return a;
  };

  for (const r of rows) {
    if (r.propertyId == null) {
      ensure(null, OVERHEAD_LABEL).unitRows.push(r);
      continue;
    }
    const bk = propBuildingKey.get(r.propertyId) ?? null;
    if (bk) ensure(bk, buildingLabelOf.get(bk) ?? bk).unitRows.push(r);
    else ensure(`prop:${r.propertyId}`, r.address).unitRows.push(r); // keyless unit stands alone
  }

  // Building-scoped (shared) costs resolve to their own building_key.
  const buildingWO = workOrderRows.filter((w) => workOrderScope(w) === "building");
  for (const b of groupCostByBuilding(buildingWO, {}, costFilter)) {
    if (b.key == null) continue; // a building-scoped row always carries a key
    const a = ensure(b.key, buildingLabelOf.get(b.key) ?? b.key);
    a.shared += b.totalCents;
    a.sharedCount += b.count;
  }

  const buildings: StatementBuildingRow[] = [...acc.entries()].map(([key, a]) => {
    const rentInCents = a.unitRows.reduce((s, r) => s + r.rentInCents, 0);
    const unitMaint = a.unitRows.reduce((s, r) => s + r.maintenanceOutCents, 0);
    const maintenanceOutCents = unitMaint + a.shared;
    const unitRows = [...a.unitRows].sort((x, y) => {
      if (x.propertyId == null) return 1;
      if (y.propertyId == null) return -1;
      return x.address.localeCompare(y.address);
    });
    return {
      buildingKey: key,
      label: a.label,
      unitRows,
      sharedMaintenanceCents: a.shared,
      sharedWorkOrderCount: a.sharedCount,
      rentInCents,
      maintenanceOutCents,
      netCents: rentInCents - maintenanceOutCents,
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

  // Summary, grouped by building: a subtotal line per building, its unit lines,
  // and a "Building-wide (shared)" line; then the overhead bucket; then TOTAL.
  // The Scope column carries unit vs building-wide so the accountant can tell a
  // shared cost from a unit cost.
  row(["Property / building", "Scope", "Rent collected", "Expenses", "Net"]);
  for (const b of statement.buildings) {
    if (b.buildingKey == null) {
      // Overhead bucket: flat rows, no subtotal header.
      for (const u of b.unitRows) {
        row([u.address, "Unassigned", dollars(u.rentInCents), dollars(u.maintenanceOutCents), dollars(u.netCents)]);
      }
      continue;
    }
    row([b.label, "Building subtotal", dollars(b.rentInCents), dollars(b.maintenanceOutCents), dollars(b.netCents)]);
    for (const u of b.unitRows) {
      row([u.address, "Unit", dollars(u.rentInCents), dollars(u.maintenanceOutCents), dollars(u.netCents)]);
    }
    if (b.sharedMaintenanceCents > 0) {
      row([
        "Building-wide (shared)",
        "Shared",
        dollars(0),
        dollars(b.sharedMaintenanceCents),
        dollars(-b.sharedMaintenanceCents),
      ]);
    }
  }
  row([
    "TOTAL",
    "",
    dollars(statement.totals.rentInCents),
    dollars(statement.totals.maintenanceOutCents),
    dollars(statement.totals.netCents),
  ]);

  // Expenses by category
  if (statement.categories.length > 0) {
    lines.push("");
    row(["Expenses by category", "Amount", "Items"]);
    for (const c of statement.categories) {
      row([c.category, dollars(c.totalCents), c.count]);
    }
  }

  // Month-by-month detail
  if (monthly.length > 0) {
    lines.push("");
    row(["Month", "Property", "Rent collected", "Expenses", "Net"]);
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
