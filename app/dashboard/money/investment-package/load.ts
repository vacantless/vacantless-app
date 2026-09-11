// One loader for the investment package, shared by the page and the CSV export
// so the two can never drift. Reads are RLS scoped; nothing is written.
import { createClient } from "@/lib/supabase/server";
import { expenseToCostRow, type ExpenseRow } from "@/lib/expenses";
import { buildIncomeStatement } from "@/lib/income-statement";
import { buildRentRoll, rangeDays, type RentRollPropertyRef, type RentRollTenancyInput } from "@/lib/rent-roll";
import { buildInvestmentPackage, type InvestmentPackage } from "@/lib/investment-package";
import type { DateRange, PropertyRef, RentRow } from "@/lib/statements";
import type { WorkOrderCostRow } from "@/lib/work-orders";

type TenancyQueryRow = {
  status: string;
  rent_cents: number | null;
  start_date: string | null;
  end_date: string | null;
  property_id: string | null;
  tenants: { name: string | null; is_primary: boolean | null }[] | null;
};

type WoQueryRow = {
  property_id: string | null;
  building_key: string | null;
  category: string;
  status: string;
  cost_cents: number | null;
  completed_on: string | null;
  tenancy: { property_id: string | null } | null;
};

type RentQueryRow = { amount_cents: number; paid_on: string; tenancy: { property_id: string | null } | null };

export type BuildingChoice = { buildingKey: string | null; label: string; unitCount: number };

export type PackageLoad = {
  buildings: BuildingChoice[];
  /** Null when the org has no buildings, or the requested key matches none. */
  pkg: InvestmentPackage | null;
};

function inRange(date: string | null, range: DateRange): boolean {
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

export async function loadInvestmentPackage(
  organizationId: string,
  range: DateRange,
  asOf: string,
  requestedBuildingKey: string | null,
  askingPriceCents: number | null,
): Promise<PackageLoad> {
  const supabase = createClient();
  const [{ data: tenData }, { data: propData }, { data: woData }, { data: expData }, { data: rentData }] =
    await Promise.all([
      supabase
        .from("tenancies")
        .select("status, rent_cents, start_date, end_date, property_id, tenants(name, is_primary)")
        .eq("organization_id", organizationId),
      supabase
        .from("properties")
        .select("id, address, building_key, rent_cents")
        .eq("organization_id", organizationId)
        .order("address", { ascending: true }),
      supabase
        .from("work_orders")
        .select("property_id, building_key, category, status, cost_cents, completed_on, tenancy:tenancies(property_id)")
        .eq("organization_id", organizationId),
      supabase
        .from("expenses")
        .select("property_id, building_key, category, amount_cents, incurred_on")
        .eq("organization_id", organizationId),
      supabase
        .from("rent_payments")
        .select("amount_cents, paid_on, tenancy:tenancies(property_id)")
        .eq("organization_id", organizationId),
    ]);

  const propRows = (propData ?? []) as {
    id: string;
    address: string;
    building_key: string | null;
    rent_cents: number | null;
  }[];

  const rollProps: RentRollPropertyRef[] = propRows.map((p) => ({
    id: p.id,
    address: p.address,
    buildingKey: p.building_key,
    askingRentCents: p.rent_cents,
  }));
  const statementProps: PropertyRef[] = propRows.map((p) => ({
    id: p.id,
    address: p.address,
    buildingKey: p.building_key,
  }));

  const tenancies: RentRollTenancyInput[] = ((tenData ?? []) as unknown as TenancyQueryRow[]).map((t) => {
    const tenants = t.tenants ?? [];
    const primary = tenants.find((x) => x.is_primary) ?? tenants[0] ?? null;
    return {
      propertyId: t.property_id,
      status: t.status,
      rentCents: t.rent_cents,
      startDate: t.start_date,
      endDate: t.end_date,
      primaryTenantName: primary?.name ?? null,
      coTenantCount: Math.max(0, tenants.length - 1),
    };
  });

  const roll = buildRentRoll(rollProps, tenancies);
  const buildings: BuildingChoice[] = roll.buildings.map((b) => ({
    buildingKey: b.buildingKey,
    label: b.label,
    unitCount: b.unitCount,
  }));

  const building =
    roll.buildings.find((b) => b.buildingKey === requestedBuildingKey) ?? roll.buildings[0] ?? null;
  if (!building) return { buildings, pkg: null };

  const woRows: WorkOrderCostRow[] = ((woData ?? []) as unknown as WoQueryRow[]).map((w) => ({
    property_id: w.property_id ?? w.tenancy?.property_id ?? null,
    building_key: w.building_key,
    category: w.category,
    status: w.status,
    cost_cents: w.cost_cents,
    completed_on: w.completed_on,
  }));
  const expenseRows: WorkOrderCostRow[] = ((expData ?? []) as ExpenseRow[]).map((e) => expenseToCostRow(e));
  const costRows: WorkOrderCostRow[] = [...woRows, ...expenseRows];

  const rentRows: RentRow[] = ((rentData ?? []) as unknown as RentQueryRow[]).map((r) => ({
    property_id: r.tenancy?.property_id ?? null,
    amount_cents: r.amount_cents,
    paid_on: r.paid_on,
  }));

  const statement = buildIncomeStatement(rentRows, costRows, statementProps, range);

  // The package works out for itself which costs belong to this building, so
  // the loader hands over the rows rather than a summary of them.
  const unitIds = new Set(building.units.map((u) => u.propertyId));

  const rentPaymentsObserved = rentRows.filter(
    (r) => r.property_id != null && unitIds.has(r.property_id) && inRange(r.paid_on, range),
  ).length;

  const pkg = buildInvestmentPackage({
    building,
    statement,
    range,
    asOf,
    askingPriceCents,
    windowDays: rangeDays(range.from, range.to),
    costRows,
    rentPaymentsObserved,
  });

  return { buildings, pkg };
}
