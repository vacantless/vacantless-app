import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { planEntitlements } from "@/lib/billing";
import { expenseToCostRow, type ExpenseRow } from "@/lib/expenses";
import {
  STATEMENT_PRESETS,
  rangeForPreset,
  parseRangeBound,
  type RentRow,
  type PropertyRef,
  type DateRange,
} from "@/lib/statements";
import type { WorkOrderCostRow } from "@/lib/work-orders";
import {
  buildIncomeStatement,
  incomeStatementToCsv,
} from "@/lib/income-statement";

export const dynamic = "force-dynamic";

// Actual-basis income-statement CSV (Premium accounting). Reads RLS-scoped
// rent, work-order, expense, and property rows only; all math happens in the
// pure income-statement builder.

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

function filenameRange(range: DateRange): string {
  return `${range.from ?? "start"}-${range.to ?? "end"}`;
}

export async function GET(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

  if (!planEntitlements(org.plan).accounting) {
    return new NextResponse("Upgrade to Premium to export the income statement.", { status: 403 });
  }
  if (!(await currentUserCan("view_reports"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const presetRaw = sp.get("preset") ?? "this_year";
  const preset = (STATEMENT_PRESETS as readonly string[]).includes(presetRaw)
    ? presetRaw
    : "this_year";
  const customRange: DateRange = {
    from: parseRangeBound(sp.get("from")),
    to: parseRangeBound(sp.get("to")),
  };
  const todayIso = new Date().toISOString().slice(0, 10);
  const range = rangeForPreset(preset, todayIso, customRange);

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
  const statement = buildIncomeStatement(rentRows, [...woRows, ...expenseRows], properties, range);
  const csv = incomeStatementToCsv(statement);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="income-statement-${filenameRange(range)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
