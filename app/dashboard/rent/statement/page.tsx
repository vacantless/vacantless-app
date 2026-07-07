import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  BrandBanner,
  Card,
  StatCard,
  SectionHeading,
  EmptyState,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { workOrderCategoryLabel } from "@/lib/work-orders";
import {
  expenseToCostRow,
  isExpenseCategory,
  expenseCategoryLabel,
  type ExpenseRow,
} from "@/lib/expenses";
import {
  STATEMENT_PRESETS,
  statementPresetLabel,
  rangeForPreset,
  parseRangeBound,
  describeRange,
  buildOwnerStatement,
  buildMonthlyStatement,
  isStandaloneUnit,
  formatMoneyCents,
  type RentRow,
  type PropertyRef,
  type DateRange,
} from "@/lib/statements";
import type { WorkOrderCostRow } from "@/lib/work-orders";

/** Label a cost row's category, covering BOTH expense + work-order taxonomies. */
function costCategoryLabel(category: string): string {
  return isExpenseCategory(category)
    ? expenseCategoryLabel(category)
    : workOrderCategoryLabel(category);
}

export const dynamic = "force-dynamic";

// ============================================================================
// Owner financial statement — work-order module Slice 5 (S307), the FINAL slice
// of the self-managed-owner wedge. Joins the two ledgers the owner already
// keeps — rent received (rent_payments) and maintenance spent (work_orders) —
// into the year-end package an accountant wants: RENT IN minus MAINTENANCE OUT,
// per property, for a chosen period. We only REPORT what was logged; no money
// moves here.
//
// Server component, query-param window (preset + optional custom from/to). The
// downloadable CSV lives at ./statement/export and reuses the same pure model.
// Cash basis: rent counted by paid_on, maintenance by completed_on (costed,
// completed jobs only).
// ============================================================================

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

function exportHref(preset: string, range: DateRange): string {
  const p = new URLSearchParams();
  p.set("preset", preset);
  if (range.from) p.set("from", range.from);
  if (range.to) p.set("to", range.to);
  return `/dashboard/rent/statement/export?${p.toString()}`;
}

export default async function StatementPage({
  searchParams,
}: {
  searchParams: { preset?: string; from?: string; to?: string };
}) {
  const supabase = createClient();

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

  // RLS scopes every query to the caller's org.
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

  // Resolve each payment's property via its tenancy (rent_payments always link
  // to a tenancy, and every tenancy has a property).
  const rentRows: RentRow[] = ((rentData ?? []) as unknown as RentQueryRow[]).map((r) => ({
    amount_cents: r.amount_cents,
    paid_on: r.paid_on,
    property_id: r.tenancy?.property_id ?? null,
  }));

  // A work order's property is its own property_id, or its tenancy's property
  // when only a tenancy is attached. A building-scoped cost carries building_key
  // (property_id null, tenancy cleared at write) so it rolls up at the building
  // tier instead of onto a unit.
  const woRows: WorkOrderCostRow[] = ((woData ?? []) as unknown as WoQueryRow[]).map((w) => ({
    property_id: w.property_id ?? w.tenancy?.property_id ?? null,
    building_key: w.building_key,
    category: w.category,
    status: w.status,
    cost_cents: w.cost_cents,
    completed_on: w.completed_on,
  }));

  // Bank-fed / manual expenses (mortgage, property tax, utilities, insurance...)
  // map to the SAME WorkOrderCostRow shape (expenseToCostRow) so they roll up
  // through the statement alongside maintenance — the "spent" side now spans the
  // FULL expense set, not just work orders. Scope (unit XOR building) carries
  // straight through the 0057/0058 discipline both ledgers share.
  const expenseRows: WorkOrderCostRow[] = ((expData ?? []) as unknown as ExpenseRow[]).map(
    (e) => expenseToCostRow(e),
  );
  const costRows: WorkOrderCostRow[] = [...woRows, ...expenseRows];

  const statement = buildOwnerStatement(rentRows, costRows, properties, range);
  const monthly = buildMonthlyStatement(rentRows, costRows, properties, range);

  const showCustom = preset === "custom";
  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

  return (
    <div>
      <BrandBanner
        eyebrow="Money"
        title="Owner statement"
        subtitle="Rent collected minus expenses, per property, for any period. The year-end picture for you and your accountant — built from what you already logged. Vacantless reports; it never moves your money."
        icon={<Icons.chart className="h-6 w-6" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/rent/rent-roll" className={SECONDARY_ACTION_CLASS}>
              Rent roll & cap rate
            </Link>
            <a href={exportHref(preset, range)} className={SECONDARY_ACTION_CLASS}>
              Download CSV
            </a>
          </div>
        }
      />

      {/* Period selector */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {STATEMENT_PRESETS.map((p) => {
          const active = preset === p;
          return (
            <Link
              key={p}
              href={p === "custom" ? "/dashboard/rent/statement?preset=custom" : `/dashboard/rent/statement?preset=${p}`}
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
            <button
              type="submit"
              className={SECONDARY_ACTION_CLASS}
            >
              Apply
            </button>
          </form>
        </Card>
      )}

      <p className="mb-4 text-sm text-gray-500">
        Showing <span className="font-medium text-gray-700">{describeRange(range)}</span>. Rent is
        counted by the date you received it; expenses by the date they were incurred (maintenance by
        the date the job was completed).
      </p>

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Rent collected"
          value={formatMoneyCents(statement.totals.rentInCents)}
          hint={`${statement.totals.rentCount} payment${statement.totals.rentCount === 1 ? "" : "s"}`}
          icon={<Icons.card className="h-4 w-4" />}
        />
        <StatCard
          label="Expenses"
          value={formatMoneyCents(statement.totals.maintenanceOutCents)}
          hint={`${statement.totals.workOrderCount} entr${statement.totals.workOrderCount === 1 ? "y" : "ies"}`}
          icon={<Icons.bolt className="h-4 w-4" />}
        />
        <StatCard
          label="Net"
          value={formatMoneyCents(statement.totals.netCents)}
          hint="Rent in − expenses out"
          icon={<Icons.chart className="h-4 w-4" />}
        />
      </div>

      {/* By building — units nested under their building, with the shared line */}
      <div className="mt-6">
        <SectionHeading>By building</SectionHeading>
        {statement.buildings.length === 0 ? (
          <EmptyState
            icon={<Icons.chart className="h-5 w-5" />}
            title="Nothing in this period"
            description="No rent payments, expenses, or completed maintenance fall in this window. Record payments inside a tenancy, log expenses, and complete work orders, then they'll roll up here."
          />
        ) : (
          <Card padded={false} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Property / building</th>
                  <th className="px-4 py-3 text-right font-medium">Rent collected</th>
                  <th className="px-4 py-3 text-right font-medium">Expenses</th>
                  <th className="px-4 py-3 text-right font-medium">Net</th>
                </tr>
              </thead>
              {statement.buildings.map((b) => {
                // A standalone unit (one unit, no siblings, no shared cost) is
                // shown as a SINGLE row using its own full address — not a bold
                // building-header row plus a redundant nested unit row for the
                // same figures (the KI631 "double-row", S433). Real multi-unit
                // buildings keep the header + nested rows.
                if (isStandaloneUnit(b)) {
                  const r = b.unitRows[0];
                  return (
                    <tbody key={b.buildingKey} className="border-b border-gray-100 last:border-0">
                      <tr>
                        <td className="px-4 py-2.5 text-gray-900">{r.address}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatMoneyCents(r.rentInCents)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{formatMoneyCents(r.maintenanceOutCents)}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${r.netCents < 0 ? "text-red-600" : "text-gray-900"}`}>
                          {formatMoneyCents(r.netCents)}
                        </td>
                      </tr>
                    </tbody>
                  );
                }
                return (
                <tbody key={b.buildingKey ?? "overhead"} className="border-b border-gray-100 last:border-0">
                  {b.buildingKey != null ? (
                    <tr className="bg-gray-50/70">
                      <td className="px-4 py-2.5 font-semibold text-gray-900">{b.label}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">{formatMoneyCents(b.rentInCents)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">{formatMoneyCents(b.maintenanceOutCents)}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${b.netCents < 0 ? "text-red-600" : "text-gray-900"}`}>
                        {formatMoneyCents(b.netCents)}
                      </td>
                    </tr>
                  ) : (
                    <tr className="bg-gray-50/70">
                      <td className="px-4 py-2.5 font-medium text-gray-600" colSpan={4}>{b.label}</td>
                    </tr>
                  )}
                  {b.unitRows.map((r) => (
                    <tr key={r.propertyId ?? "unassigned"}>
                      <td className="px-4 py-2 pl-8 text-gray-700">{r.address}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">{formatMoneyCents(r.rentInCents)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">{formatMoneyCents(r.maintenanceOutCents)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${r.netCents < 0 ? "text-red-600" : "text-gray-700"}`}>
                        {formatMoneyCents(r.netCents)}
                      </td>
                    </tr>
                  ))}
                  {b.sharedMaintenanceCents > 0 && (
                    <tr>
                      <td className="px-4 py-2 pl-8 italic text-gray-500">Building-wide (shared)</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-400">—</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">{formatMoneyCents(b.sharedMaintenanceCents)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-600">{formatMoneyCents(-b.sharedMaintenanceCents)}</td>
                    </tr>
                  )}
                </tbody>
                );
              })}
              <tfoot>
                <tr className="bg-gray-50 font-semibold text-gray-900">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoneyCents(statement.totals.rentInCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoneyCents(statement.totals.maintenanceOutCents)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${statement.totals.netCents < 0 ? "text-red-600" : ""}`}>
                    {formatMoneyCents(statement.totals.netCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Card>
        )}
        <p className="mt-2 text-xs text-gray-500">
          Shared building costs (gardening, snow, roof) are shown at the building level and are not
          split across units.
          {statement.hasUnassigned
            ? " “Unassigned / overhead” covers rent or costs not tied to a unit or building."
            : ""}
        </p>
      </div>

      {/* Expenses by category */}
      {statement.categories.length > 0 && (
        <div className="mt-6">
          <SectionHeading>Expenses by category</SectionHeading>
          <Card padded={false} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 text-right font-medium">Items</th>
                </tr>
              </thead>
              <tbody>
                {statement.categories.map((c) => (
                  <tr key={c.category} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 text-gray-900">{costCategoryLabel(c.category)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatMoneyCents(c.totalCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* Month-by-month detail */}
      {monthly.length > 0 && (
        <div className="mt-6">
          <SectionHeading>Month by month</SectionHeading>
          <Card padded={false} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Month</th>
                  <th className="px-4 py-3 font-medium">Property</th>
                  <th className="px-4 py-3 text-right font-medium">Rent</th>
                  <th className="px-4 py-3 text-right font-medium">Expenses</th>
                  <th className="px-4 py-3 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m, i) => (
                  <tr key={`${m.period}-${m.propertyId ?? "u"}-${i}`} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 text-gray-700">{m.monthLabel}</td>
                    <td className="px-4 py-3 text-gray-900">{m.address}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatMoneyCents(m.rentInCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatMoneyCents(m.maintenanceOutCents)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${m.netCents < 0 ? "text-red-600" : "text-gray-900"}`}>
                      {formatMoneyCents(m.netCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
