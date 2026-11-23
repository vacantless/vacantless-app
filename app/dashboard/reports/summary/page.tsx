import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { PageHeader } from "@/components/ui";
import { Icons } from "@/components/icons";
import { torontoDateHour } from "@/lib/health-digest";
import { currentMonthFor, reportMonthFor } from "@/lib/rental-report";
import { loadAccountReport } from "@/lib/account-report-server";

export const dynamic = "force-dynamic";

// S836b: the monthly account summary, the same one emailed on the 1st
// (lib/account-report.ts), for last month or this month so far.
export default async function ReportSummaryPage({ searchParams }: { searchParams: { m?: string } }) {
  const org = await getCurrentOrg();
  if (!org) return null;
  const { date: today } = torontoDateHour(new Date());
  const which = searchParams.m === "this" ? "this" : "last";
  const range = which === "this" ? currentMonthFor(today) : reportMonthFor(today);
  const report = await loadAccountReport(createClient(), { id: org.id, name: org.name, plan: org.plan }, range, today);

  const tab = (key: "last" | "this", label: string) => (
    <Link
      href={`/dashboard/reports/summary?m=${key}`}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
        which === key ? "border-transparent text-white shadow-sm" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
      }`}
      style={which === key ? { backgroundColor: "var(--brand-color)" } : undefined}
    >
      {label}
    </Link>
  );

  return (
    <div>
      <PageHeader
        icon={<Icons.chart />}
        title="Monthly summary"
        subtitle="The summary emailed to you on the 1st of each month."
        action={
          <div className="flex flex-wrap gap-1.5">
            {tab("last", "Last month")}
            {tab("this", "This month so far")}
          </div>
        }
      />
      <div className="mb-4 text-sm">
        <Link href="/dashboard/reports" className="text-gray-600 underline hover:text-gray-900">
          Back to Reports
        </Link>
      </div>
      {/* Built from our own records by lib/account-report.ts; every text value is escaped there. */}
      <div className="overflow-x-auto rounded-xl bg-white p-2 sm:p-4" dangerouslySetInnerHTML={{ __html: report.html }} />
    </div>
  );
}
