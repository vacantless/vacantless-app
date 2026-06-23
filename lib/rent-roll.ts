// Pure investor rent-roll + cap-rate model (no I/O) so it can be unit-tested in
// isolation. Run: npx tsx scripts/test-rent-roll.ts
//
// This is the PREMIUM accounting-depth report a landlord hands a buyer or lender:
//
//   * a RENT ROLL — every unit, its current tenant / lease dates / monthly rent /
//     occupancy status, grouped by building with subtotals; the snapshot a buyer
//     reads first.
//   * NET OPERATING INCOME (NOI) — annualized in-place rent MINUS operating
//     expenses (NOI deliberately EXCLUDES financing: mortgage + interest — see
//     lib/expenses isOperatingCategory). A property's value is judged on what it
//     earns from operations, independent of how the current owner financed it.
//   * CAP RATE — NOI / an operator-entered property value; plus the gross rent
//     multiplier. The operator flexes the value to test prices.
//
// It REUSES the existing pieces rather than re-deriving them: the owner-statement
// rollup (lib/statements) supplies operating expenses per building when fed
// operating-only cost rows; splitAddressUnit supplies the building label. This
// module only RECORDS + REPORTS; no money moves. v1 = export (CSV + a print-ready
// page); per-building valuation + a live shareable link are v2.

import { splitAddressUnit } from "./listing-fill-sheet";

// --- Inputs -----------------------------------------------------------------

/**
 * A property (unit) reference. `buildingKey` (properties.building_key) groups
 * units under one building; absent/null = the unit stands alone. `askingRentCents`
 * is the unit's marketed rent, used as the displayed rent for a VACANT unit (it
 * never counts toward in-place income).
 */
export type RentRollPropertyRef = {
  id: string;
  address: string;
  buildingKey?: string | null;
  askingRentCents?: number | null;
};

/**
 * A tenancy row (lib/tenancy / migration 0028). One per lease: a unit + the
 * signed monthly rent + dates + status. The rent roll resolves each unit's
 * CURRENT tenancy from these (active wins; else upcoming).
 */
export type RentRollTenancyInput = {
  propertyId: string | null;
  status: string; // "upcoming" | "active" | "ended"
  rentCents: number | null;
  startDate: string | null; // "YYYY-MM-DD"
  endDate: string | null; // "YYYY-MM-DD" | null (month-to-month)
  primaryTenantName: string | null;
  coTenantCount: number; // tenants beyond the primary (0 for a single tenant)
};

// --- Rent roll --------------------------------------------------------------

export type RentRollUnitStatus = "occupied" | "upcoming" | "vacant";

const STATUS_LABELS: Record<RentRollUnitStatus, string> = {
  occupied: "Occupied",
  upcoming: "Upcoming",
  vacant: "Vacant",
};

export function rentRollStatusLabel(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? status;
}

export type RentRollUnit = {
  propertyId: string;
  address: string;
  buildingKey: string | null;
  status: RentRollUnitStatus;
  /** Primary tenant + co-tenant count, or null when vacant. */
  tenantLabel: string | null;
  /** Displayed monthly rent: the lease rent when tenanted, else the asking rent. */
  monthlyRentCents: number | null;
  /** True only for an OCCUPIED unit — the income the cap rate is built on. */
  inPlace: boolean;
  leaseStart: string | null;
  leaseEnd: string | null;
};

export type RentRollBuilding = {
  buildingKey: string | null;
  label: string;
  units: RentRollUnit[];
  unitCount: number;
  occupiedCount: number;
  /** Sum of OCCUPIED units' monthly rent (in-place). */
  inPlaceMonthlyRentCents: number;
  /** ×12 of the above — the building's annualized in-place rent. */
  inPlaceAnnualRentCents: number;
};

export type RentRoll = {
  buildings: RentRollBuilding[];
  totalUnits: number;
  occupiedUnits: number;
  upcomingUnits: number;
  vacantUnits: number;
  inPlaceMonthlyRentCents: number;
  inPlaceAnnualRentCents: number;
  /** Occupied / total, 0-100 integer (0 when there are no units). */
  occupancyPct: number;
};

/** Build the "+N co-tenant(s)" tenant summary, or null when there's no name. */
function tenantLabelOf(name: string | null, coTenants: number): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  if (coTenants <= 0) return n;
  return `${n} +${coTenants} ${coTenants === 1 ? "co-tenant" : "co-tenants"}`;
}

/**
 * Resolve one unit's CURRENT tenancy from its candidates. An ACTIVE tenancy wins
 * (latest start, if more than one); otherwise the soonest UPCOMING one; ended
 * tenancies never represent the current state. Returns null = vacant.
 */
function currentTenancy(rows: RentRollTenancyInput[]): RentRollTenancyInput | null {
  const active = rows
    .filter((r) => r.status === "active")
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  if (active.length > 0) return active[0];
  const upcoming = rows
    .filter((r) => r.status === "upcoming")
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  if (upcoming.length > 0) return upcoming[0];
  return null;
}

/**
 * Build the rent roll: every property resolved to its current tenancy, grouped by
 * building with subtotals + a portfolio summary. Units with a buildingKey nest
 * together; a keyless unit stands alone (its own single-unit "building"). Sorted
 * by building label, then unit address; the keyless/overhead grouping sorts by
 * the unit's own address.
 */
export function buildRentRoll(
  properties: RentRollPropertyRef[],
  tenancies: RentRollTenancyInput[],
): RentRoll {
  const byProp = new Map<string, RentRollTenancyInput[]>();
  for (const t of tenancies) {
    if (!t.propertyId) continue;
    const arr = byProp.get(t.propertyId) ?? [];
    arr.push(t);
    byProp.set(t.propertyId, arr);
  }

  const units: RentRollUnit[] = properties.map((p) => {
    const cur = currentTenancy(byProp.get(p.id) ?? []);
    const buildingKey = p.buildingKey ?? null;
    if (!cur) {
      return {
        propertyId: p.id,
        address: p.address,
        buildingKey,
        status: "vacant",
        tenantLabel: null,
        monthlyRentCents: p.askingRentCents ?? null,
        inPlace: false,
        leaseStart: null,
        leaseEnd: null,
      };
    }
    const status: RentRollUnitStatus = cur.status === "active" ? "occupied" : "upcoming";
    return {
      propertyId: p.id,
      address: p.address,
      buildingKey,
      status,
      tenantLabel: tenantLabelOf(cur.primaryTenantName, cur.coTenantCount),
      monthlyRentCents: cur.rentCents ?? p.askingRentCents ?? null,
      inPlace: status === "occupied",
      leaseStart: cur.startDate,
      leaseEnd: cur.endDate,
    };
  });

  // Group units into buildings. Keyed units share a building; keyless units each
  // get a synthetic per-unit key so they never merge with one another.
  const labelOf = new Map<string, string>();
  for (const p of properties) {
    const bk = p.buildingKey ?? null;
    if (bk && !labelOf.has(bk)) labelOf.set(bk, splitAddressUnit(p.address).street ?? p.address);
  }

  type Acc = { key: string | null; label: string; units: RentRollUnit[] };
  const acc = new Map<string, Acc>();
  for (const u of units) {
    const groupKey = u.buildingKey ?? `prop:${u.propertyId}`;
    let a = acc.get(groupKey);
    if (!a) {
      a = {
        key: u.buildingKey,
        label: u.buildingKey ? labelOf.get(u.buildingKey) ?? u.buildingKey : u.address,
        units: [],
      };
      acc.set(groupKey, a);
    }
    a.units.push(u);
  }

  const buildings: RentRollBuilding[] = [...acc.values()].map((a) => {
    const sorted = [...a.units].sort((x, y) => x.address.localeCompare(y.address));
    const occupiedCount = sorted.filter((u) => u.status === "occupied").length;
    const inPlaceMonthly = sorted
      .filter((u) => u.inPlace)
      .reduce((s, u) => s + (u.monthlyRentCents ?? 0), 0);
    return {
      buildingKey: a.key,
      label: a.label,
      units: sorted,
      unitCount: sorted.length,
      occupiedCount,
      inPlaceMonthlyRentCents: inPlaceMonthly,
      inPlaceAnnualRentCents: inPlaceMonthly * 12,
    };
  });
  buildings.sort((a, b) => a.label.localeCompare(b.label));

  const totalUnits = units.length;
  const occupiedUnits = units.filter((u) => u.status === "occupied").length;
  const upcomingUnits = units.filter((u) => u.status === "upcoming").length;
  const vacantUnits = units.filter((u) => u.status === "vacant").length;
  const inPlaceMonthly = buildings.reduce((s, b) => s + b.inPlaceMonthlyRentCents, 0);

  return {
    buildings,
    totalUnits,
    occupiedUnits,
    upcomingUnits,
    vacantUnits,
    inPlaceMonthlyRentCents: inPlaceMonthly,
    inPlaceAnnualRentCents: inPlaceMonthly * 12,
    occupancyPct: totalUnits === 0 ? 0 : Math.round((occupiedUnits / totalUnits) * 100),
  };
}

// --- Cap rate / NOI ---------------------------------------------------------

/**
 * Inclusive day count of a "YYYY-MM-DD" window, or null when either bound is
 * open (an unbounded window can't be annualized). Used to scale a period's
 * operating expenses to an annual figure for the cap rate.
 */
export function rangeDays(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1; // inclusive
}

/** Round to `dp` decimal places, returning a finite number. */
function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export type CapRateInput = {
  /** Annualized in-place rent (rent roll occupied × 12), in cents. */
  annualOperatingIncomeCents: number;
  /** Operating-only expenses over the chosen window, in cents (financing excluded upstream). */
  operatingExpensesCents: number;
  /** Inclusive days the expenses span; null = unbounded (no annualization). */
  windowDays: number | null;
  /** Operator-entered property value in cents, or null (no cap rate then). */
  propertyValueCents: number | null;
};

export type CapRateResult = {
  /** Operating expenses scaled to a 12-month figure (= input when window ≈ 1yr / unbounded). */
  annualOperatingExpensesCents: number;
  /** Net operating income = annual income − annual operating expenses. */
  noiCents: number;
  /** NOI / value, as a percent rounded to 2dp; null when no/zero value. */
  capRatePct: number | null;
  /** value / annual income, rounded to 2dp; null when no value or no income. */
  grossRentMultiplier: number | null;
  /** True when the operating expenses were scaled (window ≠ ~365 days). */
  annualized: boolean;
};

/**
 * NOI + cap rate from annualized in-place income and period operating expenses.
 * Operating expenses are scaled to an annual figure by 365 / windowDays so NOI is
 * a like-for-like annual number; an unbounded window (windowDays null) is taken as
 * already annual. Cap rate = NOI / value; GRM = value / annual income. All money
 * stays in integer cents; only the ratios are rounded.
 */
export function computeCapRate(input: CapRateInput): CapRateResult {
  const { annualOperatingIncomeCents, operatingExpensesCents, windowDays, propertyValueCents } =
    input;
  const factor = windowDays && windowDays > 0 ? 365 / windowDays : 1;
  const annualOpex = Math.round(operatingExpensesCents * factor);
  const noi = annualOperatingIncomeCents - annualOpex;
  const value = propertyValueCents != null && propertyValueCents > 0 ? propertyValueCents : null;
  return {
    annualOperatingExpensesCents: annualOpex,
    noiCents: noi,
    capRatePct: value == null ? null : round((noi / value) * 100, 2),
    grossRentMultiplier:
      value == null || annualOperatingIncomeCents <= 0
        ? null
        : round(value / annualOperatingIncomeCents, 2),
    annualized: factor !== 1,
  };
}

// --- CSV export -------------------------------------------------------------

/** Quote a CSV field (wrap + double inner quotes only when needed). */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Plain dollars, two decimals, no symbol/grouping — clean for spreadsheets. */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export type RentRollCsvMeta = {
  /** Human label for the expense window, e.g. "Jan 1 to Dec 31, 2026". */
  expensePeriod: string;
  propertyValueCents: number | null;
  cap: CapRateResult;
  operatingExpensesCents: number;
};

/**
 * The full investor package as CSV: a rent-roll block (per building → units, with
 * subtotals + a portfolio TOTAL), then a valuation block (in-place income, NOI,
 * cap rate, GRM). Pure string assembly (no Date), so it can't drift across time
 * zones.
 */
export function rentRollToCsv(roll: RentRoll, meta: RentRollCsvMeta): string {
  const lines: string[] = [];
  const row = (cells: (string | number)[]) => lines.push(cells.map(csvField).join(","));

  row(["Rent roll"]);
  row(["Occupancy", `${roll.occupiedUnits} of ${roll.totalUnits} units (${roll.occupancyPct}%)`]);
  lines.push("");

  row(["Building / unit", "Tenant", "Status", "Lease start", "Lease end", "Monthly rent"]);
  for (const b of roll.buildings) {
    if (b.buildingKey != null && b.units.length > 1) {
      row([b.label, "", `${b.occupiedCount}/${b.unitCount} occupied`, "", "", dollars(b.inPlaceMonthlyRentCents)]);
    }
    for (const u of b.units) {
      row([
        u.address,
        u.tenantLabel ?? "—",
        rentRollStatusLabel(u.status),
        u.leaseStart ?? "",
        u.leaseEnd ?? (u.status === "vacant" ? "" : "month-to-month"),
        u.monthlyRentCents == null ? "" : dollars(u.monthlyRentCents),
      ]);
    }
  }
  row(["TOTAL (in-place)", "", `${roll.occupiedUnits}/${roll.totalUnits} occupied`, "", "", dollars(roll.inPlaceMonthlyRentCents)]);

  // Valuation block
  lines.push("");
  row(["Valuation"]);
  row(["Annualized in-place rent", dollars(roll.inPlaceAnnualRentCents)]);
  row([`Operating expenses (${meta.expensePeriod})`, dollars(meta.operatingExpensesCents)]);
  if (meta.cap.annualized) {
    row(["Operating expenses (annualized)", dollars(meta.cap.annualOperatingExpensesCents)]);
  }
  row(["Net operating income (NOI, annual)", dollars(meta.cap.noiCents)]);
  row(["Property value", meta.propertyValueCents == null ? "(not set)" : dollars(meta.propertyValueCents)]);
  row(["Cap rate", meta.cap.capRatePct == null ? "(enter a value)" : `${meta.cap.capRatePct}%`]);
  row(["Gross rent multiplier", meta.cap.grossRentMultiplier == null ? "—" : String(meta.cap.grossRentMultiplier)]);
  row(["Note", "NOI excludes financing (mortgage, interest). Cap rate = NOI / value."]);

  return lines.join("\n") + "\n";
}
