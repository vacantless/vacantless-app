import Link from "next/link";
import { redirect } from "next/navigation";
import { canUseBooks } from "@/lib/billing";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { BrandBanner, Card, EmptyState, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { Icons } from "@/components/icons";
import { STATEMENT_PRESETS, statementPresetLabel, describeRange } from "@/lib/statements";
import { buildExpenseReport } from "@/lib/expense-report";
import { loadExpenseLines } from "@/lib/expense-report-server";
import { readExpenseReportParams, expenseReportQuery } from "@/lib/expense-report-params";
import { dollars } from "@/lib/channel-costs";

export const dynamic = "force-dynamic";

// S836e: every cost line by category with subtotals, after the FreshBooks
// Expense Report. Same lines and totals as Money > Income statement.
export default async function ExpenseReportPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!canUseBooks(org)) {
    return (
      <div className="mx-auto max-w-3xl">
        <BrandBanner eyebrow="Money" title="Expense report" subtitle="Every cost, by category, with a total for each." icon={<Icons.list className="h-6 w-6" />} />
        <EmptyState
          icon={<Icons.list className="h-5 w-5" />}
          title="Part of Starter and up, from $29 a month"
          description="Lists every expense and repair cost by category, with a total for each and a CSV for your accountant."
          cta={{ href: "/dashboard/billing", label: "See prices" }}
        />
      </div>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const params = readExpenseReportParams((k) => searchParams[k], todayIso);
  const { lines, units } = await loadExpenseLines(createClient(), org.id);
  const report = buildExpenseReport(lines, params.range, { propertyId: params.propertyId, category: params.category });
  const categories = [...new Map(lines.map((l) => [l.category, l.categoryLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const inputCls = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm";

  return (
    <div className="mx-auto max-w-4xl">
      <BrandBanner
        eyebrow="Money"
        title="Expense report"
        subtitle="Every expense and repair cost, by category, with a total for each. The same lines your income statement counts."
        icon={<Icons.list className="h-6 w-6" />}
      />

      <Card className="mb-5 bg-gray-50">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600">Dates</label>
            <select name="preset" defaultValue={params.preset} className={inputCls}>
              {STATEMENT_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {statementPresetLabel(p)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">From (custom)</label>
            <input type="date" name="from" defaultValue={params.preset === "custom" ? params.range.from ?? "" : ""} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">To (custom)</label>
            <input type="date" name="to" defaultValue={params.preset === "custom" ? params.range.to ?? "" : ""} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Unit</label>
            <select name="unit" defaultValue={params.propertyId ?? ""} className={inputCls}>
              <option value="">All units</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Category</label>
            <select name="category" defaultValue={params.category ?? ""} className={inputCls}>
              <option value="">All categories</option>
              {categories.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ background: "var(--brand-color)" }}>
            Show
          </button>
          <a href={`/dashboard/money/expense-report/export?${expenseReportQuery(params)}`} className={SECONDARY_ACTION_CLASS}>
            Download CSV
          </a>
        </form>
      </Card>

      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-gray-900">Total expenses</span>
          <span className="text-lg font-bold text-gray-900">{dollars(report.operatingCents)}</span>
        </div>
        <p className="text-xs text-gray-500">
          {describeRange(params.range)}. {report.count === 1 ? "1 line" : `${report.count} lines`}.
          {report.financingCents ? ` Mortgage lines (${dollars(report.financingCents)}) are listed last and not counted, as on the income statement.` : ""}
        </p>
      </div>

      {report.groups.length === 0 ? (
        <EmptyState
          icon={<Icons.list className="h-5 w-5" />}
          title="No costs in these dates"
          description="Add expenses on the Expenses page, or a cost on a finished repair, and they show here."
          cta={{ href: "/dashboard/expenses", label: "Go to Expenses" }}
        />
      ) : (
        report.groups.map((g) => (
          <div key={g.category} className="mb-5 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <div className="flex items-baseline justify-between border-b border-gray-100 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-gray-900">
                {g.label}
                {!g.operating && <span className="ml-2 text-xs font-normal text-gray-500">for reference, not counted</span>}
              </h2>
              <span className="text-sm font-semibold text-gray-900">{dollars(g.subtotalCents)}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Merchant or repair</th>
                  <th className="px-4 py-2 font-medium">Unit</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l, i) => (
                  <tr key={`${l.day}-${i}`} className="border-t border-gray-50">
                    <td className="whitespace-nowrap px-4 py-2 text-gray-700">{l.day}</td>
                    <td className="px-4 py-2 text-gray-900">
                      {l.merchant ?? (l.source === "repair" ? "Repair" : "No merchant")}
                      {l.detail && <span className="block text-xs text-gray-500">{l.detail}</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{l.where}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-gray-900">{dollars(l.amountCents)}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-gray-700">
                    Total for {g.label}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-gray-900">{dollars(g.subtotalCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))
      )}

      <p className="mt-2 text-xs text-gray-500">
        Expenses count on the day they were paid; repairs on the day they were finished.{" "}
        <Link href="/dashboard/money/income-statement" className="underline">
          Income statement
        </Link>
      </p>
    </div>
  );
}
