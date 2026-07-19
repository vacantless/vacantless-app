import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { planEntitlements } from "@/lib/billing";
import {
  BrandBanner,
  Card,
  EmptyState,
  SectionHeading,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import {
  formatMoneyCents,
  type RentRow,
  type PropertyRef,
} from "@/lib/statements";
import { expenseToCostRow, type ExpenseRow } from "@/lib/expenses";
import type { WorkOrderCostRow } from "@/lib/work-orders";
import {
  buildT776Statement,
  type T776StatementRow,
} from "@/lib/t776";
import { PrintButton } from "../../rent/rent-roll/print-button";

export const dynamic = "force-dynamic";

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

function taxPackageHref(year: number): string {
  return `/dashboard/money/tax-package?year=${year}`;
}

function exportHref(year: number): string {
  return `/dashboard/money/tax-package/export?year=${year}`;
}

function yearFromDate(date: string | null | undefined): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec((date ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : null;
}

function parseYearParam(raw: string | undefined): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= 1900 && year <= 9999 ? year : null;
}

function availableYears(
  rentRows: RentQueryRow[],
  woRows: WoQueryRow[],
  expenseRows: ExpenseRow[],
  currentYear: number,
): number[] {
  const years = new Set<number>([currentYear]);
  for (const row of rentRows) {
    const year = yearFromDate(row.paid_on);
    if (year) years.add(year);
  }
  for (const row of woRows) {
    const year = yearFromDate(row.completed_on);
    if (year) years.add(year);
  }
  for (const row of expenseRows) {
    const year = yearFromDate(row.incurred_on);
    if (year) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

function defaultTaxYear(years: number[], currentYear: number): number {
  return years.find((year) => year !== currentYear) ?? currentYear;
}

function moneyClass(cents: number, muted = false): string {
  if (muted) return cents < 0 ? "text-red-500" : "text-gray-500";
  return cents < 0 ? "text-red-600" : "text-gray-900";
}

function AmountCell({
  cents,
  muted = false,
}: {
  cents: number;
  muted?: boolean;
}) {
  return (
    <td className={`px-4 py-3 text-right tabular-nums ${moneyClass(cents, muted)}`}>
      {formatMoneyCents(cents)}
    </td>
  );
}

function TaxTable({
  row,
  portfolio = false,
}: {
  row: T776StatementRow;
  portfolio?: boolean;
}) {
  return (
    <Card padded={false} className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="w-24 px-4 py-3 font-medium">Line</th>
            <th className="px-4 py-3 font-medium">{portfolio ? "Portfolio line item" : row.address}</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {row.lines.map((line) => (
            <tr key={line.line} className="border-b border-gray-50 last:border-0">
              <td className="px-4 py-3 tabular-nums text-gray-500">{line.line}</td>
              <td className="px-4 py-3 text-gray-700">{line.label}</td>
              <AmountCell cents={line.amountCents} />
            </tr>
          ))}
          <tr className="border-b border-gray-100 bg-gray-50/70 font-semibold text-gray-900">
            <td className="px-4 py-3" />
            <td className="px-4 py-3">Total expenses</td>
            <AmountCell cents={row.totalExpensesCents} />
          </tr>
          <tr className="border-b border-gray-50 font-semibold">
            <td className="px-4 py-3 tabular-nums text-gray-500">9369</td>
            <td className="px-4 py-3 text-gray-900">Net income (loss) before adjustments</td>
            <AmountCell cents={row.netBeforeAdjustmentsCents} />
          </tr>
          <tr className="border-b border-gray-50">
            <td className="px-4 py-3 text-gray-400">Memo</td>
            <td className="px-4 py-3 text-gray-500">Mortgage principal excluded from deductible expenses</td>
            <AmountCell cents={row.principalMemoCents} muted />
          </tr>
          <tr className="border-b border-gray-50">
            <td className="px-4 py-3 tabular-nums text-gray-400">9936</td>
            <td className="px-4 py-3 text-gray-500">Capital cost allowance</td>
            <td className="px-4 py-3 text-right text-gray-400">Enter with your accountant</td>
          </tr>
          <tr className="font-semibold">
            <td className="px-4 py-3 tabular-nums text-gray-500">9946</td>
            <td className="px-4 py-3 text-gray-900">Your net income (loss)</td>
            <AmountCell cents={row.netBeforeAdjustmentsCents} />
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

export default async function TaxPackagePage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  if (!planEntitlements(org.plan).accounting) {
    return (
      <div className="mx-auto max-w-3xl">
        <BrandBanner
          eyebrow="Money"
          title="Tax package"
          subtitle="A T776-ready year-end summary that maps rent and expenses to the rental tax lines your accountant expects."
          icon={<Icons.chart className="h-6 w-6" />}
        />
        <EmptyState
          icon={<Icons.chart className="h-5 w-5" />}
          title="Tax package is a Premium feature"
          description="Premium adds an accountant-ready T776 summary by property, with gross rents, deductible expense lines, principal memo lines, and CSV export."
          cta={{ href: "/dashboard/billing", label: "See plans" }}
        />
      </div>
    );
  }

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

  const rawRentRows = (rentData ?? []) as unknown as RentQueryRow[];
  const rawWoRows = (woData ?? []) as unknown as WoQueryRow[];
  const rawExpenseRows = (expData ?? []) as unknown as ExpenseRow[];
  const currentYear = new Date().getFullYear();
  const years = availableYears(rawRentRows, rawWoRows, rawExpenseRows, currentYear);
  const requestedYear = parseYearParam(searchParams.year);
  const year = requestedYear ?? defaultTaxYear(years, currentYear);

  const properties = ((propData ?? []) as { id: string; address: string; building_key: string | null }[]).map(
    (p) => ({ id: p.id, address: p.address, buildingKey: p.building_key }),
  ) as PropertyRef[];

  const rentRows: RentRow[] = rawRentRows.map((r) => ({
    amount_cents: r.amount_cents,
    paid_on: r.paid_on,
    property_id: r.tenancy?.property_id ?? null,
  }));

  const woRows: WorkOrderCostRow[] = rawWoRows.map((w) => ({
    property_id: w.property_id ?? w.tenancy?.property_id ?? null,
    building_key: w.building_key,
    category: w.category,
    status: w.status,
    cost_cents: w.cost_cents,
    completed_on: w.completed_on,
  }));
  const expenseRows: WorkOrderCostRow[] = rawExpenseRows.map((e) => expenseToCostRow(e));
  const statement = buildT776Statement(rentRows, [...woRows, ...expenseRows], properties, year);

  return (
    <div>
      <BrandBanner
        eyebrow={`Money · ${org.name}`}
        title={`Tax package (${year})`}
        subtitle="A T776-ready Statement of Real Estate Rentals summary by property and portfolio. Vacantless reports what you logged; your accountant confirms adjustments."
        icon={<Icons.chart className="h-6 w-6" />}
        action={
          <div className="print:hidden flex flex-wrap items-center gap-2">
            <PrintButton />
            <a href={exportHref(year)} className={SECONDARY_ACTION_CLASS}>
              Download CSV
            </a>
          </div>
        }
      />

      <div className="print:hidden mb-5 flex flex-wrap items-center gap-1.5">
        {years.map((candidate) => {
          const active = candidate === year;
          return (
            <Link
              key={candidate}
              href={taxPackageHref(candidate)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                active
                  ? "bg-brand text-white ring-transparent"
                  : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
              }`}
              style={active ? { background: "var(--brand-color)" } : undefined}
            >
              {candidate}
            </Link>
          );
        })}
      </div>

      <p className="mb-4 text-sm text-gray-500">
        Showing tax year <span className="font-medium text-gray-700">{year}</span>. Rent is counted by
        paid date; expenses by incurred/completed date.
      </p>

      {statement.rows.length === 0 ? (
        <EmptyState
          icon={<Icons.chart className="h-5 w-5" />}
          title="Nothing in this tax year"
          description="No rent payments, expenses, or completed maintenance fall in this calendar year."
        />
      ) : (
        <div className="space-y-6">
          <div>
            <SectionHeading>By property</SectionHeading>
            <div className="space-y-4">
              {statement.rows.map((row) => (
                <div key={row.propertyId ?? "unassigned"}>
                  <h2 className="mb-2 text-sm font-semibold text-gray-900">{row.address}</h2>
                  <TaxTable row={row} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionHeading>Portfolio roll-up</SectionHeading>
            <TaxTable row={statement.totals} portfolio />
          </div>
        </div>
      )}

      {statement.rows.length > 0 && statement.hasUnassigned && (
        <p className="mt-3 text-xs text-gray-500">
          Unassigned includes rent or costs not tied to a unit.
        </p>
      )}
      <p className="mt-5 text-xs leading-relaxed text-gray-500">
        This is an accountant-ready summary, not a filed return. CCA, personal-use portion,
        and co-ownership splits are adjustments to confirm with your accountant; verify the
        current-year T776.
      </p>
    </div>
  );
}
