import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { planEntitlements } from "@/lib/billing";
import {
  BrandBanner,
  Card,
  StatCard,
  EmptyState,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { workOrderCategoryLabel, workOrderScope, type WorkOrderCostRow } from "@/lib/work-orders";
import {
  expenseToCostRow,
  isExpenseCategory,
  expenseCategoryLabel,
  isOperatingCategory,
  type ExpenseRow,
} from "@/lib/expenses";
import {
  STATEMENT_PRESETS,
  statementPresetLabel,
  rangeForPreset,
  parseRangeBound,
  describeRange,
  formatMoneyCents,
  type RentRow,
  type PropertyRef,
  type DateRange,
} from "@/lib/statements";
import {
  buildIncomeStatement,
  netMarginLabel,
  type IncomeStatementRow,
} from "@/lib/income-statement";

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

type CategoryMatrix = Map<string, Map<string, number>>;

function exportHref(preset: string, range: DateRange): string {
  const p = new URLSearchParams();
  p.set("preset", preset);
  if (range.from) p.set("from", range.from);
  if (range.to) p.set("to", range.to);
  return `/dashboard/money/income-statement/export?${p.toString()}`;
}

function reportHref(preset: string, range: DateRange): string {
  const p = new URLSearchParams();
  p.set("preset", preset);
  if (range.from) p.set("from", range.from);
  if (range.to) p.set("to", range.to);
  return `/dashboard/money/income-statement?${p.toString()}`;
}

function costInRange(row: WorkOrderCostRow, range: DateRange): boolean {
  if (row.cost_cents == null) return false;
  const d = row.completed_on;
  if (!d) return false;
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

function propertyKey(row: WorkOrderCostRow): string {
  return workOrderScope(row) === "unit" && row.property_id ? row.property_id : "__unassigned__";
}

function categoryMatrix(costRows: WorkOrderCostRow[], range: DateRange): CategoryMatrix {
  const matrix: CategoryMatrix = new Map();
  for (const row of costRows) {
    if (!costInRange(row, range)) continue;
    if (!isOperatingCategory(row.category)) continue;
    const byProperty = matrix.get(row.category) ?? new Map<string, number>();
    const key = propertyKey(row);
    byProperty.set(key, (byProperty.get(key) ?? 0) + (row.cost_cents ?? 0));
    matrix.set(row.category, byProperty);
  }
  return matrix;
}

function rowKey(row: IncomeStatementRow): string {
  return row.propertyId ?? "__unassigned__";
}

function costCategoryLabel(category: string): string {
  return isExpenseCategory(category)
    ? expenseCategoryLabel(category)
    : workOrderCategoryLabel(category);
}

function moneyClass(cents: number, muted = false): string {
  if (muted) return cents < 0 ? "text-red-500" : "text-gray-500";
  return cents < 0 ? "text-red-600" : "text-gray-900";
}

function MoneyCell({ cents, muted = false }: { cents: number; muted?: boolean }) {
  return (
    <td className={`px-4 py-3 text-right tabular-nums ${moneyClass(cents, muted)}`}>
      {formatMoneyCents(cents)}
    </td>
  );
}

function LineRow({
  label,
  rows,
  total,
  value,
  totalValue,
  strong = false,
  muted = false,
  indented = false,
}: {
  label: string;
  rows: IncomeStatementRow[];
  total: IncomeStatementRow;
  value: (row: IncomeStatementRow) => number;
  totalValue?: number;
  strong?: boolean;
  muted?: boolean;
  indented?: boolean;
}) {
  const totalCents = totalValue ?? value(total);
  return (
    <tr className={`border-b border-gray-50 last:border-0 ${strong ? "bg-gray-50/70" : ""}`}>
      <td
        className={`sticky left-0 bg-white px-4 py-3 ${
          strong ? "font-semibold text-gray-900" : muted ? "text-gray-500" : "text-gray-700"
        } ${indented ? "pl-8 text-sm" : ""}`}
      >
        {label}
      </td>
      {rows.map((row) => (
        <MoneyCell key={rowKey(row)} cents={value(row)} muted={muted} />
      ))}
      <MoneyCell cents={totalCents} muted={muted} />
    </tr>
  );
}

export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: { preset?: string; from?: string; to?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  if (!planEntitlements(org.plan).accounting) {
    return (
      <div className="mx-auto max-w-3xl">
        <BrandBanner
          eyebrow="Money"
          title="Income statement"
          subtitle="An actual-basis P&L: rental revenue, operating expenses, NOI, interest, net income, and debt-service cash flow."
          icon={<Icons.chart className="h-6 w-6" />}
        />
        <EmptyState
          icon={<Icons.chart className="h-5 w-5" />}
          title="Income statement is a Premium feature"
          description="Premium adds a property-by-property P&L with NOI, interest, net income, principal memo lines, and CSV export for your accountant."
          cta={{ href: "/dashboard/billing", label: "See plans" }}
        />
      </div>
    );
  }

  const presetRaw = searchParams.preset ?? "this_year";
  const preset = (STATEMENT_PRESETS as readonly string[]).includes(presetRaw)
    ? presetRaw
    : "this_year";
  const customRange: DateRange = {
    from: parseRangeBound(searchParams.from),
    to: parseRangeBound(searchParams.to),
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
  const costRows: WorkOrderCostRow[] = [...woRows, ...expenseRows];
  const statement = buildIncomeStatement(rentRows, costRows, properties, range);
  const categoryCells = categoryMatrix(costRows, range);

  const showCustom = preset === "custom";
  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

  return (
    <div>
      <BrandBanner
        eyebrow={`Money · ${org.name}`}
        title="Income statement"
        subtitle="Actual rent collected minus operating expenses gives NOI; interest reduces net income; principal stays below the line as cash debt service."
        icon={<Icons.chart className="h-6 w-6" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* S528: the statement trio should reciprocally link — the T776
                package reconciles to this P&L. */}
            <Link href="/dashboard/money/tax-package" className={SECONDARY_ACTION_CLASS}>
              Tax package
            </Link>
            <Link href="/dashboard/rent/statement" className={SECONDARY_ACTION_CLASS}>
              Owner statement
            </Link>
            <Link href="/dashboard/rent/rent-roll" className={SECONDARY_ACTION_CLASS}>
              Rent roll & cap rate
            </Link>
            <a href={exportHref(preset, range)} className={SECONDARY_ACTION_CLASS}>
              Download CSV
            </a>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {STATEMENT_PRESETS.map((p) => {
          const active = preset === p;
          const href =
            p === "custom"
              ? "/dashboard/money/income-statement?preset=custom"
              : reportHref(p, rangeForPreset(p, todayIso));
          return (
            <Link
              key={p}
              href={href}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                active
                  ? "bg-brand text-white ring-transparent"
                  : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
              }`}
              style={active ? { background: "var(--brand-color)" } : undefined}
            >
              {statementPresetLabel(p)}
            </Link>
          );
        })}
      </div>

      {showCustom && (
        <Card className="mb-5 bg-gray-50">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="preset" value="custom" />
            <div>
              <label className="block text-xs font-medium text-gray-600">From</label>
              <input type="date" name="from" defaultValue={range.from ?? ""} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">To</label>
              <input type="date" name="to" defaultValue={range.to ?? ""} className={inputCls} />
            </div>
            <button type="submit" className={SECONDARY_ACTION_CLASS}>
              Apply
            </button>
          </form>
        </Card>
      )}

      <p className="mb-4 text-sm text-gray-500">
        Showing <span className="font-medium text-gray-700">{describeRange(range)}</span>. Rent is
        counted by paid date; expenses by incurred/completed date.
      </p>

      {/* S528: with no activity in the range, an all-zeros table tells the
          operator nothing — say so and point at the next action instead. */}
      {statement.totals.rentCount === 0 &&
        statement.totals.revenueCents === 0 &&
        statement.totals.operatingExpensesCents === 0 &&
        statement.totals.interestCents === 0 &&
        statement.totals.principalCents === 0 && (
          <div className="mb-5">
            <EmptyState
              icon={<Icons.chart className="h-5 w-5" />}
              title="Nothing to report for this period"
              description="No rent was collected and no expenses were logged in this range. Pick another period above, or log rent and expenses first — the statement fills in from what you record."
              cta={{ href: "/dashboard/expenses", label: "Log expenses" }}
            />
          </div>
        )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Revenue"
          value={formatMoneyCents(statement.totals.revenueCents)}
          hint={`${statement.totals.rentCount} payment${statement.totals.rentCount === 1 ? "" : "s"}`}
          icon={<Icons.card className="h-4 w-4" />}
        />
        <StatCard
          label="NOI"
          value={formatMoneyCents(statement.totals.noiCents)}
          hint="Revenue less operating expenses"
          icon={<Icons.chart className="h-4 w-4" />}
        />
        <StatCard
          label="Net income"
          value={formatMoneyCents(statement.totals.netIncomeCents)}
          hint="NOI less mortgage interest"
          icon={<Icons.check className="h-4 w-4" />}
        />
        <StatCard
          label="Net margin"
          value={netMarginLabel(statement.totals.netIncomeCents, statement.totals.revenueCents)}
          hint="Net income divided by revenue"
          icon={<Icons.bolt className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6">
        <Card padded={false} className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="sticky left-0 bg-white px-4 py-3 font-medium">Line item</th>
                {statement.rows.map((row) => (
                  <th key={rowKey(row)} className="px-4 py-3 text-right font-medium">
                    {row.address}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-medium">Portfolio Total</th>
              </tr>
            </thead>
            <tbody>
              <LineRow
                label="Rental revenue"
                rows={statement.rows}
                total={statement.totals}
                value={(row) => row.revenueCents}
              />
              {statement.operatingCategories.map((category) => {
                const cells = categoryCells.get(category.category) ?? new Map<string, number>();
                return (
                  <LineRow
                    key={category.category}
                    label={costCategoryLabel(category.category)}
                    rows={statement.rows}
                    total={statement.totals}
                    value={(row) => cells.get(rowKey(row)) ?? 0}
                    totalValue={category.totalCents}
                    indented
                  />
                );
              })}
              {statement.operatingCategories.length === 0 && (
                <LineRow
                  label="Operating expenses"
                  rows={statement.rows}
                  total={statement.totals}
                  value={() => 0}
                  indented
                />
              )}
              <LineRow
                label="Net operating income"
                rows={statement.rows}
                total={statement.totals}
                value={(row) => row.noiCents}
                strong
              />
              <LineRow
                label="Mortgage interest"
                rows={statement.rows}
                total={statement.totals}
                value={(row) => row.interestCents}
              />
              <LineRow
                label="Net income"
                rows={statement.rows}
                total={statement.totals}
                value={(row) => row.netIncomeCents}
                strong
              />
              <LineRow
                label="Mortgage principal"
                rows={statement.rows}
                total={statement.totals}
                value={(row) => row.principalCents}
                muted
              />
              <LineRow
                label="Net cash after debt service"
                rows={statement.rows}
                total={statement.totals}
                value={(row) => row.netCashCents}
                muted
              />
            </tbody>
          </table>
        </Card>
        <p className="mt-2 text-xs text-gray-500">
          Mortgage principal is a capital repayment, not an expense — only interest reduces net
          income. If your mortgage payments include interest, split them with a category rule so
          your net income and T776 are accurate.
          {statement.hasUnassigned
            ? " Unassigned includes rent or costs not tied to a unit; building-wide costs are bucketed there in this version."
            : ""}
        </p>
      </div>
    </div>
  );
}
