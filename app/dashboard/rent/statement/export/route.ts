import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import {
  STATEMENT_PRESETS,
  rangeForPreset,
  parseRangeBound,
  buildOwnerStatement,
  buildMonthlyStatement,
  statementToCsv,
  type RentRow,
  type PropertyRef,
  type DateRange,
} from "@/lib/statements";
import type { WorkOrderCostRow } from "@/lib/work-orders";

export const dynamic = "force-dynamic";

// Owner financial-statement CSV (work-order module Slice 5, S307). Streams the
// rent-in-minus-maintenance-out-per-property statement for a window as a CSV the
// owner hands to their accountant. Guarded on view_reports (owner reporting;
// owner_admin + operator hold it, not the viewing helper). Reads RLS-scoped
// rows only — same data the on-screen statement renders.

type RentQueryRow = {
  amount_cents: number;
  paid_on: string | null;
  tenancy: { property_id: string | null } | null;
};
type WoQueryRow = {
  property_id: string | null;
  category: string;
  status: string;
  cost_cents: number | null;
  completed_on: string | null;
  tenancy: { property_id: string | null } | null;
};

export async function GET(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

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
  const [{ data: rentData }, { data: woData }, { data: propData }] = await Promise.all([
    supabase.from("rent_payments").select("amount_cents, paid_on, tenancy:tenancies(property_id)"),
    supabase
      .from("work_orders")
      .select("property_id, category, status, cost_cents, completed_on, tenancy:tenancies(property_id)"),
    supabase.from("properties").select("id, address").order("address", { ascending: true }),
  ]);

  const properties = (propData ?? []) as PropertyRef[];
  const rentRows: RentRow[] = ((rentData ?? []) as unknown as RentQueryRow[]).map((r) => ({
    amount_cents: r.amount_cents,
    paid_on: r.paid_on,
    property_id: r.tenancy?.property_id ?? null,
  }));
  const woRows: WorkOrderCostRow[] = ((woData ?? []) as unknown as WoQueryRow[]).map((w) => ({
    property_id: w.property_id ?? w.tenancy?.property_id ?? null,
    category: w.category,
    status: w.status,
    cost_cents: w.cost_cents,
    completed_on: w.completed_on,
  }));

  const statement = buildOwnerStatement(rentRows, woRows, properties, range);
  const monthly = buildMonthlyStatement(rentRows, woRows, properties, range);
  const csv = statementToCsv(statement, monthly);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="owner-statement-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
