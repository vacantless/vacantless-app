import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { planEntitlements } from "@/lib/billing";
import { expenseToCostRow, type ExpenseRow } from "@/lib/expenses";
import {
  type RentRow,
  type PropertyRef,
} from "@/lib/statements";
import type { WorkOrderCostRow } from "@/lib/work-orders";
import {
  buildT776Statement,
  t776ToCsv,
} from "@/lib/t776";

export const dynamic = "force-dynamic";

// T776 tax-package CSV (Premium accounting) + view_reports capability. Reads
// RLS-scoped rows only, then delegates all tax-line mapping to the pure T776
// model.

type RentQueryRow = {
  amount_cents: number;
  paid_on: string | null;
  tenancy: { property_id: string | null } | null;
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

function parseYear(raw: string | null): number {
  if (raw && /^\d{4}$/.test(raw)) {
    const year = Number(raw);
    if (year >= 1900 && year <= 9999) return year;
  }
  return new Date().getFullYear();
}

export async function GET(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

  if (!planEntitlements(org.plan).accounting) {
    return new NextResponse("Upgrade to Premium to export the tax package.", { status: 403 });
  }
  if (!(await currentUserCan("view_reports"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const year = parseYear(req.nextUrl.searchParams.get("year"));
  const supabase = createClient();
  const [{ data: rentData }, { data: woData }, { data: expData }, { data: propData }] = await Promise.all([
    supabase
      .from("rent_payments")
      .select("amount_cents, paid_on, tenancy:tenancies(property_id)"),
    supabase
      .from("work_orders")
      .select("property_id, building_key, category, status, cost_cents, completed_on, tenancy:tenancies(property_id)"),
    supabase
      .from("expenses")
      .select("property_id, building_key, category, amount_cents, incurred_on"),
    supabase
      .from("properties")
      .select("id, address, building_key")
      .order("address", { ascending: true }),
  ]);

  const properties = ((propData ?? []) as { id: string; address: string; building_key: string | null }[]).map(
    (p) => ({ id: p.id, address: p.address, buildingKey: p.building_key }),
  ) as PropertyRef[];

  const rentRows: RentRow[] = ((rentData ?? []) as unknown as RentQueryRow[]).map((r) => ({
    amount_cents: r.amount_cents,
    paid_on: r.paid_on,
    property_id: r.tenancy?.property_id ?? null,
  }));

  const woRows: WorkOrderCostRow[] = ((woData ?? []) as unknown as WoQueryRow[]).map((w) => ({
    property_id: w.property_id ?? w.tenancy?.property_id ?? null,
    building_key: w.building_key,
    category: w.category,
    status: w.status,
    cost_cents: w.cost_cents,
    completed_on: w.completed_on,
  }));

  const expenseRows: WorkOrderCostRow[] = ((expData ?? []) as unknown as ExpenseRow[]).map(
    (e) => expenseToCostRow(e),
  );
  const statement = buildT776Statement(rentRows, [...woRows, ...expenseRows], properties, year);
  const csv = t776ToCsv(statement);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="t776-${year}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
