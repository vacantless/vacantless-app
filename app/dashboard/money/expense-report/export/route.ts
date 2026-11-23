import { NextRequest, NextResponse } from "next/server";
import { canUseBooks } from "@/lib/billing";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { postLeaseRouteWalled } from "@/lib/post-lease-surface";
import { buildExpenseReport, expenseReportToCsv } from "@/lib/expense-report";
import { loadExpenseLines } from "@/lib/expense-report-server";
import { readExpenseReportParams } from "@/lib/expense-report-params";

export const dynamic = "force-dynamic";

// S836e: the expense report as a CSV, the same lines and filters as the page.
export async function GET(req: NextRequest) {
  if (await postLeaseRouteWalled()) return new Response("Not found", { status: 404 });
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));
  if (!canUseBooks(org)) return new NextResponse("Part of Starter and up.", { status: 403 });
  if (!(await currentUserCan("view_reports"))) return new NextResponse("Forbidden", { status: 403 });

  const todayIso = new Date().toISOString().slice(0, 10);
  const params = readExpenseReportParams((k) => req.nextUrl.searchParams.get(k), todayIso);
  const { lines } = await loadExpenseLines(createClient(), org.id);
  const report = buildExpenseReport(lines, params.range, { propertyId: params.propertyId, category: params.category });
  const name = `expense-report-${params.range.from ?? "start"}-${params.range.to ?? "end"}.csv`;
  return new NextResponse(expenseReportToCsv(report), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
}
