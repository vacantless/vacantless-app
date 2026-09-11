// The investment package: the outward-facing document a seller hands to the
// market and a buyer's lender reads, for ONE building. Pure (no I/O) so it can
// be unit-tested, same as every other report in this folder.
//
// It assembles rather than recomputes. The rent roll comes from
// lib/rent-roll.ts, the operating numbers from lib/income-statement.ts (v2
// building tier), the cap rate from computeCapRate. Nothing here invents a
// figure the ledger does not hold.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE. Every other report in this codebase is
// read by the OWNER, who knows what is missing from their own books. This one is
// read by a BUYER and their lender, who do not. So the package states the basis
// for every number, and it REFUSES to publish a cap rate it cannot stand behind
// rather than quietly annualizing one month of costs into a year. A number that
// is not supportable comes back null with a warning attached, never as a
// confident figure.

import {
  computeCapRate,
  rentRollStatusLabel,
  type CapRateResult,
  type RentRollBuilding,
  type RentRollUnit,
} from "./rent-roll";
import { expenseCategoryLabel, isOperatingCategory } from "./expenses";
import { workOrderScope, type WorkOrderCostRow } from "./work-orders";
import type { IncomeStatement, IncomeStatementBuildingRow } from "./income-statement";
import { describeRange, type DateRange } from "./statements";
import { splitAddressUnit } from "./address-unit";

/**
 * Fewer than this many distinct months of recorded cost makes an annualized
 * operating figure guesswork, so the cap rate is withheld. Three is the smallest
 * window that can show a seasonal utility swing at all; it is a floor, not a
 * standard.
 */
export const MIN_EXPENSE_MONTHS_FOR_CAP_RATE = 3;

/** Months of lease remaining that counts as "rolling soon" for a buyer. */
export const EXPIRY_HORIZON_MONTHS = 12;

/**
 * A window shorter than this cannot support an annual figure however many
 * calendar months it happens to touch. Three cost rows on Jan 31, Feb 1 and
 * Mar 2 span "three months" and thirty-one days; scaling them by 365/31 is
 * invention. Measured in days so it cannot be gamed by month boundaries.
 */
export const MIN_WINDOW_DAYS_FOR_CAP_RATE = 90;

export type LeaseKind = "fixed" | "month_to_month" | "vacant" | "upcoming" | "expired";

export type PackageUnitRow = {
  propertyId: string;
  address: string;
  /** "Unit 2 (Upper)" when the address carries one, else the whole address. */
  unitLabel: string;
  status: string;
  statusLabel: string;
  tenantLabel: string | null;
  monthlyRentCents: number | null;
  inPlace: boolean;
  leaseStart: string | null;
  leaseEnd: string | null;
  leaseKind: LeaseKind;
  /** Whole months from asOf to leaseEnd; null when vacant or month to month. */
  monthsToExpiry: number | null;
  marketRentCents: number | null;
  /** market minus current, for OCCUPIED units that have a market figure. */
  gapCents: number | null;
};

export type ExpiryBucket = { month: string; units: number; monthlyRentCents: number };

export type ExpirySchedule = {
  monthToMonthUnits: number;
  monthToMonthMonthlyRentCents: number;
  /** Fixed terms that already ended while the tenancy is still active. */
  expiredUnits: number;
  expiredMonthlyRentCents: number;
  expiringWithinHorizonUnits: number;
  expiringWithinHorizonMonthlyRentCents: number;
  /** One bucket per month that actually has an expiry, inside the horizon. */
  byMonth: ExpiryBucket[];
};

export type RentGap = {
  unitsPriced: number;
  unitsUnpriced: number;
  currentMonthlyCents: number;
  marketMonthlyCents: number;
  monthlyGapCents: number;
  annualGapCents: number;
};

export type PackageWarning = { code: string; message: string };

export type PackageBasis = {
  periodLabel: string;
  windowDays: number | null;
  /** Distinct calendar months in the window that carry at least one cost row. */
  expenseMonthsObserved: number;
  expenseItems: number;
  rentPaymentsObserved: number;
  operatingExpensesAnnualized: boolean;
  /** Costs that reached neither a unit nor this building; excluded on purpose. */
  excludedUnassignedCents: number;
  warnings: PackageWarning[];
};

export type PackageHeadline = {
  unitCount: number;
  occupiedCount: number;
  vacantCount: number;
  occupancyPct: number;
  inPlaceMonthlyRentCents: number;
  inPlaceAnnualRentCents: number;
  askingPriceCents: number | null;
  annualOperatingExpensesCents: number;
  noiCents: number;
  /** Null whenever the basis cannot support it. Never a guess. */
  capRatePct: number | null;
  grossRentMultiplier: number | null;
};

export type OperatingLine = { category: string; label: string; totalCents: number; count: number };

export type InvestmentPackage = {
  buildingKey: string | null;
  label: string;
  asOf: string;
  range: DateRange;
  headline: PackageHeadline;
  units: PackageUnitRow[];
  expiry: ExpirySchedule;
  rentGap: RentGap;
  operatingLines: OperatingLine[];
  basis: PackageBasis;
};

export type InvestmentPackageInput = {
  building: RentRollBuilding;
  statement: IncomeStatement;
  range: DateRange;
  /** "YYYY-MM-DD". Passed in so this module stays pure. */
  asOf: string;
  askingPriceCents?: number | null;
  /** Per-property market rent in cents, where a figure exists. */
  marketRentByPropertyId?: Record<string, number | null | undefined>;
  /** Inclusive days the cost window spans; null = unbounded (already annual). */
  windowDays?: number | null;
  /**
   * Every cost row the org has. The package works out for itself which of them
   * belong to this building, so the cap-rate gate and the category breakdown can
   * never be measured over a different set of rows than the money is summed
   * from. Passing summaries instead of rows was how both of the first review's
   * P1 defects got in.
   */
  costRows?: WorkOrderCostRow[];
  rentPaymentsObserved?: number;
};

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Whole months between two ISO dates, floored at 0. Calendar months, not days. */
export function wholeMonthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.split("-").map((n) => Number(n));
  const [ty, tm] = toIso.split("-").map((n) => Number(n));
  if (!fy || !fm || !ty || !tm) return 0;
  const months = (ty - fy) * 12 + (tm - fm);
  return months > 0 ? months : 0;
}

function leaseKindOf(unit: RentRollUnit, asOf: string): LeaseKind {
  if (unit.status === "vacant") return "vacant";
  // A signed-but-not-started lease is neither in place nor rolling; it would
  // otherwise land in the expiry totals while being excluded from in-place rent.
  if (unit.status === "upcoming") return "upcoming";
  // A tenanted unit with no end date is month to month, which a buyer prices
  // very differently from a fixed term: it can be ended, or raised, sooner.
  if (!unit.leaseEnd) return "month_to_month";
  // A term that has already run out but whose tenancy is still active is a
  // hold-over. It is NOT "rolling soon"; it has already rolled.
  return unit.leaseEnd < asOf ? "expired" : "fixed";
}

function unitLabelOf(address: string): string {
  const split = splitAddressUnit(address);
  return split.unit ? `Unit ${split.unit}` : address;
}

/**
 * Whether a cost row belongs to THIS building: scoped to one of its units, or
 * scoped to the building itself. Mirrors exactly how buildIncomeStatement
 * attributes a row, so the two can never disagree.
 */
export function costBelongsToBuilding(
  row: WorkOrderCostRow,
  buildingKey: string | null,
  unitIds: Set<string>,
): boolean {
  const scope = workOrderScope(row);
  if (scope === "unit") return row.property_id != null && unitIds.has(row.property_id);
  if (scope === "building") {
    const key = typeof row.building_key === "string" ? row.building_key.trim() : "";
    return buildingKey != null && key === buildingKey;
  }
  return false;
}

function costInRange(row: WorkOrderCostRow, range: DateRange): boolean {
  const d = row.completed_on;
  if (!d) return false;
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

/**
 * The days of the window that have actually HAPPENED. "This year" runs to
 * December 31, but on September 11 only 254 days of cost exist, and scaling by
 * 365/365 would publish nine months of spending as a full year. Clamped to asOf.
 */
export function effectiveWindowDays(
  range: DateRange,
  asOf: string,
  windowDays: number | null,
): number | null {
  if (windowDays == null) return null;
  if (!range.from) return windowDays;
  const end = range.to && range.to < asOf ? range.to : asOf;
  if (end < range.from) return windowDays;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000) + 1;
  if (!Number.isFinite(days) || days <= 0) return windowDays;
  return Math.min(days, windowDays);
}

/** The building tier row for this building, or null when the period has none. */
function buildingRow(
  statement: IncomeStatement,
  buildingKey: string | null,
  unitIds: Set<string>,
): IncomeStatementBuildingRow | null {
  if (buildingKey != null) {
    return statement.buildings.find((b) => b.buildingKey === buildingKey) ?? null;
  }
  // A unit with no building key stands alone in the statement under a synthetic
  // `prop:<id>` key, while `null` there means the Unassigned / overhead bucket.
  // Matching on null would bind this building to the org's overhead, which is
  // somebody else's money.
  for (const id of unitIds) {
    const row = statement.buildings.find((b) => b.buildingKey === `prop:${id}`);
    if (row) return row;
  }
  return null;
}

export function buildInvestmentPackage(input: InvestmentPackageInput): InvestmentPackage {
  const {
    building,
    statement,
    range,
    asOf,
    askingPriceCents = null,
    marketRentByPropertyId = {},
    windowDays = null,
    costRows = [],
    rentPaymentsObserved = 0,
  } = input;

  const unitIds = new Set(building.units.map((u) => u.propertyId));
  const row = buildingRow(statement, building.buildingKey, unitIds);
  const operatingExpensesCents = row?.operatingExpensesCents ?? 0;

  // This building's OPERATING cost rows, in range. Everything the gate and the
  // category breakdown are measured from, derived from the same predicate the
  // income statement uses to attribute money.
  const ownOperatingRows = costRows.filter(
    (r) =>
      r.cost_cents != null &&
      isOperatingCategory(r.category) &&
      costInRange(r, range) &&
      costBelongsToBuilding(r, building.buildingKey, unitIds),
  );
  const expenseItems = ownOperatingRows.length;
  const expenseMonthsObserved = new Set(
    ownOperatingRows.map((r) => (r.completed_on as string).slice(0, 7)),
  ).size;

  // --- Units -----------------------------------------------------------------
  const units: PackageUnitRow[] = building.units.map((u) => {
    const kind = leaseKindOf(u, asOf);
    const market = marketRentByPropertyId[u.propertyId] ?? null;
    const gap =
      u.inPlace && u.monthlyRentCents != null && market != null
        ? market - u.monthlyRentCents
        : null;
    return {
      propertyId: u.propertyId,
      address: u.address,
      unitLabel: unitLabelOf(u.address),
      status: u.status,
      statusLabel: rentRollStatusLabel(u.status),
      tenantLabel: u.tenantLabel,
      monthlyRentCents: u.monthlyRentCents,
      inPlace: u.inPlace,
      leaseStart: u.leaseStart,
      leaseEnd: u.leaseEnd,
      leaseKind: kind,
      monthsToExpiry: kind === "fixed" && u.leaseEnd ? wholeMonthsBetween(asOf, u.leaseEnd) : null,
      marketRentCents: market,
      gapCents: gap,
    };
  });

  // --- Expiry schedule -------------------------------------------------------
  const buckets = new Map<string, ExpiryBucket>();
  let m2mUnits = 0;
  let m2mRent = 0;
  let expiredUnits = 0;
  let expiredRent = 0;
  let horizonUnits = 0;
  let horizonRent = 0;
  for (const u of units) {
    const rent = u.monthlyRentCents ?? 0;
    if (u.leaseKind === "month_to_month") {
      m2mUnits += 1;
      m2mRent += rent;
      continue;
    }
    if (u.leaseKind === "expired") {
      expiredUnits += 1;
      expiredRent += rent;
      continue;
    }
    if (u.leaseKind !== "fixed" || !u.leaseEnd || u.monthsToExpiry == null) continue;
    if (u.monthsToExpiry > EXPIRY_HORIZON_MONTHS) continue;
    horizonUnits += 1;
    horizonRent += rent;
    const key = monthKey(u.leaseEnd);
    const bucket = buckets.get(key) ?? { month: key, units: 0, monthlyRentCents: 0 };
    bucket.units += 1;
    bucket.monthlyRentCents += rent;
    buckets.set(key, bucket);
  }
  const expiry: ExpirySchedule = {
    monthToMonthUnits: m2mUnits,
    monthToMonthMonthlyRentCents: m2mRent,
    expiredUnits,
    expiredMonthlyRentCents: expiredRent,
    expiringWithinHorizonUnits: horizonUnits,
    expiringWithinHorizonMonthlyRentCents: horizonRent,
    byMonth: [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };

  // --- Rent gap --------------------------------------------------------------
  // Only OCCUPIED units with a market figure count. A vacant unit has no current
  // rent to compare, and counting its asking rent as upside would double count.
  let priced = 0;
  let unpriced = 0;
  let currentMonthly = 0;
  let marketMonthly = 0;
  for (const u of units) {
    if (!u.inPlace) continue;
    if (u.marketRentCents == null || u.monthlyRentCents == null) {
      unpriced += 1;
      continue;
    }
    priced += 1;
    currentMonthly += u.monthlyRentCents;
    marketMonthly += u.marketRentCents;
  }
  const rentGap: RentGap = {
    unitsPriced: priced,
    unitsUnpriced: unpriced,
    currentMonthlyCents: currentMonthly,
    marketMonthlyCents: marketMonthly,
    monthlyGapCents: marketMonthly - currentMonthly,
    annualGapCents: (marketMonthly - currentMonthly) * 12,
  };

  // --- Headline --------------------------------------------------------------
  // Scale by the days that have actually elapsed, not the days the period
  // nominally spans, or year-to-date cost is published as a full year (P1).
  const effectiveDays = effectiveWindowDays(range, asOf, windowDays);
  const cap: CapRateResult = computeCapRate({
    annualOperatingIncomeCents: building.inPlaceAnnualRentCents,
    operatingExpensesCents,
    windowDays: effectiveDays,
    propertyValueCents: askingPriceCents,
  });

  // An unbounded period ("all time") has no window to scale by, so computeCapRate
  // treats whatever it is given as already annual. Three years of costs would be
  // set against one year of income and the cap rate would come out wrong. We
  // cannot know the window, so we do not publish the number.
  const unboundedPeriod = effectiveDays == null;
  const windowTooShort = effectiveDays != null && effectiveDays < MIN_WINDOW_DAYS_FOR_CAP_RATE;
  const basisSupportsCapRate =
    expenseItems > 0 &&
    expenseMonthsObserved >= MIN_EXPENSE_MONTHS_FOR_CAP_RATE &&
    !unboundedPeriod &&
    !windowTooShort &&
    building.inPlaceAnnualRentCents > 0;

  const headline: PackageHeadline = {
    unitCount: building.unitCount,
    occupiedCount: building.occupiedCount,
    vacantCount: building.unitCount - building.occupiedCount,
    occupancyPct:
      building.unitCount === 0
        ? 0
        : Math.round((building.occupiedCount / building.unitCount) * 100),
    inPlaceMonthlyRentCents: building.inPlaceMonthlyRentCents,
    inPlaceAnnualRentCents: building.inPlaceAnnualRentCents,
    askingPriceCents,
    annualOperatingExpensesCents: cap.annualOperatingExpensesCents,
    noiCents: cap.noiCents,
    capRatePct: basisSupportsCapRate ? cap.capRatePct : null,
    grossRentMultiplier: cap.grossRentMultiplier,
  };

  // --- Operating lines -------------------------------------------------------
  // From THIS building's rows only. statement.operatingCategories covers the
  // whole organization, so using it here published another property's spend in
  // a one-building document and disagreed with the headline (review P1).
  const byCategory = new Map<string, { totalCents: number; count: number }>();
  for (const r of ownOperatingRows) {
    const cur = byCategory.get(r.category) ?? { totalCents: 0, count: 0 };
    cur.totalCents += r.cost_cents ?? 0;
    cur.count += 1;
    byCategory.set(r.category, cur);
  }
  const operatingLines: OperatingLine[] = [...byCategory.entries()]
    .map(([category, v]) => ({
      category,
      label: expenseCategoryLabel(category),
      totalCents: v.totalCents,
      count: v.count,
    }))
    .sort((a, b) => b.totalCents - a.totalCents || a.label.localeCompare(b.label));

  // --- Basis and warnings ----------------------------------------------------
  const unassigned = statement.rows
    .filter((r) => r.propertyId == null)
    .reduce((sum, r) => sum + r.operatingExpensesCents, 0);

  const warnings: PackageWarning[] = [];
  if (expenseItems === 0) {
    warnings.push({
      code: "no_expenses",
      message:
        "No operating costs are recorded for this building in the period, so net operating income is the rent with nothing taken off. It is not a result.",
    });
  } else if (expenseMonthsObserved < MIN_EXPENSE_MONTHS_FOR_CAP_RATE) {
    warnings.push({
      code: "thin_expense_history",
      message: `Costs are recorded in only ${expenseMonthsObserved} month${expenseMonthsObserved === 1 ? "" : "s"}. A yearly figure built from that is a guess, so the cap rate is withheld.`,
    });
  }
  if (windowTooShort && expenseItems > 0) {
    warnings.push({
      code: "window_too_short",
      message: `The period covers ${effectiveDays} day${effectiveDays === 1 ? "" : "s"}. That is too short to build a yearly figure from, so the cap rate is withheld.`,
    });
  }
  if (building.inPlaceAnnualRentCents <= 0) {
    warnings.push({
      code: "no_in_place_income",
      message:
        "No unit is occupied, so there is no in place income. Every income figure here is zero and the cap rate is withheld.",
    });
  }
  if (expiry.expiredUnits > 0) {
    warnings.push({
      code: "holding_over",
      message: `${expiry.expiredUnits} lease${expiry.expiredUnits === 1 ? " has" : "s have"} already run past the end date with the tenancy still active.`,
    });
  }
  if (unboundedPeriod && expenseItems > 0) {
    warnings.push({
      code: "unbounded_period",
      message:
        "The period has no start or end, so there is no way to know what span the costs cover. Pick a year and the cap rate can be shown.",
    });
  }
  if (cap.annualized && expenseItems > 0) {
    warnings.push({
      code: "expenses_annualized",
      message: "Operating costs are scaled up to a full year from a shorter period.",
    });
  }
  if (rentPaymentsObserved === 0) {
    warnings.push({
      code: "rent_not_recorded",
      message:
        "No rent payments are recorded in the period. Income here is the rent on the leases, not money seen arriving.",
    });
  }
  if (row && row.interestCents === 0 && row.principalCents > 0) {
    warnings.push({
      code: "no_interest_split",
      message:
        "Mortgage payments are recorded with no interest split, so the interest deduction is missing. Operating income is unaffected; net income after financing is not.",
    });
  }
  if (unassigned > 0) {
    warnings.push({
      code: "unassigned_costs_excluded",
      message:
        "Some recorded costs are tied to no unit and no building, so they are left out of this package.",
    });
  }
  if (rentGap.unitsUnpriced > 0 && rentGap.unitsPriced > 0) {
    warnings.push({
      code: "market_rent_partial",
      message: `A market rent is set for ${rentGap.unitsPriced} of ${rentGap.unitsPriced + rentGap.unitsUnpriced} occupied units, so the gap below covers only those.`,
    });
  }
  if (askingPriceCents == null) {
    warnings.push({
      code: "no_asking_price",
      message: "No asking price is set, so cap rate and gross rent multiplier cannot be shown.",
    });
  }

  const basis: PackageBasis = {
    periodLabel: describeRange(range),
    windowDays: effectiveDays,
    expenseMonthsObserved,
    expenseItems,
    rentPaymentsObserved,
    operatingExpensesAnnualized: cap.annualized,
    excludedUnassignedCents: unassigned,
    warnings,
  };

  return {
    buildingKey: building.buildingKey,
    label: building.label,
    asOf,
    range,
    headline,
    units,
    expiry,
    rentGap,
    operatingLines,
    basis,
  };
}

// --- CSV --------------------------------------------------------------------

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function investmentPackageToCsv(pkg: InvestmentPackage): string {
  const lines: string[] = [];
  const row = (cells: (string | number)[]) => lines.push(cells.map(csvField).join(","));

  row(["Investment package"]);
  row(["Building", pkg.label]);
  row(["Period", pkg.basis.periodLabel]);
  row(["As of", pkg.asOf]);
  lines.push("");

  row(["Summary", "Value"]);
  row(["Units", pkg.headline.unitCount]);
  row(["Occupied", pkg.headline.occupiedCount]);
  row(["Vacant", pkg.headline.vacantCount]);
  row(["Occupancy", `${pkg.headline.occupancyPct}%`]);
  row(["In place monthly rent", dollars(pkg.headline.inPlaceMonthlyRentCents)]);
  row(["In place annual rent", dollars(pkg.headline.inPlaceAnnualRentCents)]);
  row(["Annual operating expenses", dollars(pkg.headline.annualOperatingExpensesCents)]);
  row(["Net operating income", dollars(pkg.headline.noiCents)]);
  row([
    "Asking price",
    pkg.headline.askingPriceCents == null ? "not set" : dollars(pkg.headline.askingPriceCents),
  ]);
  row(["Cap rate", pkg.headline.capRatePct == null ? "withheld" : `${pkg.headline.capRatePct}%`]);
  row([
    "Gross rent multiplier",
    pkg.headline.grossRentMultiplier == null ? "not available" : pkg.headline.grossRentMultiplier,
  ]);
  lines.push("");

  row([
    "Unit",
    "Status",
    "Tenant",
    "Monthly rent",
    "Lease start",
    "Lease end",
    "Lease type",
    "Months to expiry",
    "Market rent",
    "Gap",
  ]);
  for (const u of pkg.units) {
    row([
      u.unitLabel,
      u.statusLabel,
      u.tenantLabel ?? "",
      u.monthlyRentCents == null ? "" : dollars(u.monthlyRentCents),
      u.leaseStart ?? "",
      u.leaseEnd ?? "",
      u.leaseKind === "month_to_month" ? "Month to month" : u.leaseKind === "vacant" ? "Vacant" : "Fixed",
      u.monthsToExpiry == null ? "" : u.monthsToExpiry,
      u.marketRentCents == null ? "" : dollars(u.marketRentCents),
      u.gapCents == null ? "" : dollars(u.gapCents),
    ]);
  }
  lines.push("");

  row(["Lease expiry", "Units", "Monthly rent"]);
  row([
    "Month to month",
    pkg.expiry.monthToMonthUnits,
    dollars(pkg.expiry.monthToMonthMonthlyRentCents),
  ]);
  row([
    "Already past the end date",
    pkg.expiry.expiredUnits,
    dollars(pkg.expiry.expiredMonthlyRentCents),
  ]);
  for (const b of pkg.expiry.byMonth) {
    row([b.month, b.units, dollars(b.monthlyRentCents)]);
  }
  row([
    `Rolling within ${EXPIRY_HORIZON_MONTHS} months`,
    pkg.expiry.expiringWithinHorizonUnits,
    dollars(pkg.expiry.expiringWithinHorizonMonthlyRentCents),
  ]);
  lines.push("");

  row(["Operating expenses by category", "Amount", "Items"]);
  for (const line of pkg.operatingLines) {
    row([line.label, dollars(line.totalCents), line.count]);
  }
  lines.push("");

  row(["Rent gap", "Value"]);
  if (pkg.rentGap.unitsPriced === 0) {
    row(["Not measured", "No market rent is set on any occupied unit. This is not a finding of no upside."]);
  }
  row(["Units priced", pkg.rentGap.unitsPriced]);
  row(["Units without a market rent", pkg.rentGap.unitsUnpriced]);
  row(["Current monthly", dollars(pkg.rentGap.currentMonthlyCents)]);
  row(["Market monthly", dollars(pkg.rentGap.marketMonthlyCents)]);
  row(["Monthly gap", dollars(pkg.rentGap.monthlyGapCents)]);
  row(["Annual gap", dollars(pkg.rentGap.annualGapCents)]);
  lines.push("");

  row(["Basis"]);
  row(["Months with recorded costs", pkg.basis.expenseMonthsObserved]);
  row(["Cost items", pkg.basis.expenseItems]);
  row(["Rent payments recorded", pkg.basis.rentPaymentsObserved]);
  row(["Operating costs scaled to a year", pkg.basis.operatingExpensesAnnualized ? "yes" : "no"]);
  for (const w of pkg.basis.warnings) {
    row(["Note", w.message]);
  }
  row([
    "Note",
    "Prepared from the owner's own records. It is not an appraisal and it is not audited.",
  ]);

  return lines.join("\n") + "\n";
}
