import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { planEntitlements } from "@/lib/billing";
import { isOperatingCategory, expenseToCostRow, type ExpenseRow } from "@/lib/expenses";
import { parseMoneyToCents } from "@/lib/tenancy";
import {
  STATEMENT_PRESETS,
  rangeForPreset,
  parseRangeBound,
  describeRange,
  buildOwnerStatement,
  type PropertyRef,
  type DateRange,
} from "@/lib/statements";
import type { WorkOrderCostRow } from "@/lib/work-orders";
import {
  buildRentRoll,
  computeCapRate,
  rangeDays,
  rentRollToCsv,
  type RentRollPropertyRef,
  type RentRollTenancyInput,
} from "@/lib/rent-roll";

export const dynamic = "force-dynamic";

// Investor rent-roll + cap-rate CSV (S313). Premium report (accounting
// entitlement) + view_reports capability. Reads RLS-scoped rows only — the same
// data the on-screen rent roll renders.

type TenantRow = { name: string | null; is_primary: boolean };
type TenancyQueryRow = {
  status: string;
  rent_cents: number | null;
  start_date: string | null;
  end_date: string | null;
  property_id: string | null;
  tenants: TenantRow[];
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

export async function GET(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

  if (!planEntitlements(org.plan).accounting) {
    return new NextResponse("Upgrade to Premium to export the rent roll.", { status: 403 });
  }
  if (!(await currentUserCan("view_reports"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const presetRaw = sp.get("preset") ?? "this_year";
  const preset = (STATEMENT_PRESETS as readonly string[]).includes(presetRaw) ? presetRaw : "this_year";
  const customRange: DateRange = { from: parseRangeBound(sp.get("from")), to: parseRangeBound(sp.get("to")) };
  const todayIso = new Date().toISOString().slice(0, 10);
  const range = rangeForPreset(preset, todayIso, customRange);
  const valueDollars = (sp.get("value") ?? "").trim();
  const propertyValueCents = parseMoneyToCents(valueDollars);

  const supabase = createClient();
  const [{ data: tenData }, { data: propData }, { data: woData }, { data: expData }] = await Promise.all([
    supabase
      .from("tenancies")
      .select("status, rent_cents, start_date, end_date, property_id, tenants(name, is_primary)"),
    supabase.from("properties").select("id, address, building_key, rent_cents").order("address", { ascending: true }),
    supabase
      .from("work_orders")
      .select("property_id, building_key, category, status, cost_cents, completed_on, tenancy:tenancies(property_id)"),
    supabase.from("expenses").select("property_id, building_key, category, amount_cents, incurred_on"),
  ]);

  const properties = ((propData ?? []) as { id: string; address: string; building_key: string | null; rent_cents: number | null }[]).map(
    (p) => ({ id: p.id, address: p.address, buildingKey: p.building_key, askingRentCents: p.rent_cents }),
  ) as RentRollPropertyRef[];

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

  const roll = buildRentRoll(properties, tenancies);

  const woRows: WorkOrderCostRow[] = ((woData ?? []) as unknown as WoQueryRow[]).map((w) => ({
    property_id: w.property_id ?? w.tenancy?.property_id ?? null,
    building_key: w.building_key,
    category: w.category,
    status: w.status,
    cost_cents: w.cost_cents,
    completed_on: w.completed_on,
  }));
  const expenseRows: WorkOrderCostRow[] = ((expData ?? []) as unknown as ExpenseRow[]).map((e) => expenseToCostRow(e));
  const operatingCostRows = [...woRows, ...expenseRows].filter((r) => isOperatingCategory(r.category));
  const opStatement = buildOwnerStatement([], operatingCostRows, properties as unknown as PropertyRef[], range);
  const operatingExpensesCents = opStatement.totals.maintenanceOutCents;

  const cap = computeCapRate({
    annualOperatingIncomeCents: roll.inPlaceAnnualRentCents,
    operatingExpensesCents,
    windowDays: rangeDays(range.from, range.to),
    propertyValueCents,
  });

  const csv = rentRollToCsv(roll, {
    expensePeriod: describeRange(range),
    propertyValueCents,
    operatingExpensesCents,
    cap,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rent-roll-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
