import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { planEntitlements } from "@/lib/billing";
import {
  BrandBanner,
  Card,
  StatCard,
  SectionHeading,
  EmptyState,
  StatusChip,
  SECONDARY_ACTION_CLASS,
  type ChipTone,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { isOperatingCategory, expenseToCostRow, type ExpenseRow } from "@/lib/expenses";
import { parseMoneyToCents } from "@/lib/tenancy";
import {
  STATEMENT_PRESETS,
  statementPresetLabel,
  rangeForPreset,
  parseRangeBound,
  describeRange,
  buildOwnerStatement,
  formatMoneyCents,
  type PropertyRef,
  type DateRange,
} from "@/lib/statements";
import type { WorkOrderCostRow } from "@/lib/work-orders";
import {
  buildRentRoll,
  computeCapRate,
  rangeDays,
  rentRollStatusLabel,
  type RentRollPropertyRef,
  type RentRollTenancyInput,
  type RentRollUnitStatus,
} from "@/lib/rent-roll";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

// ============================================================================
// Investor rent roll + cap rate (S313) — the PREMIUM accounting-depth report a
// landlord hands a buyer or lender. Three layers, all from data already logged:
//   * a rent roll (every unit, tenant, lease, rent, status — grouped by building)
//   * NOI = annualized in-place rent − operating expenses (financing EXCLUDED)
//   * cap rate = NOI / an operator-entered value (+ gross rent multiplier)
// Gated on the `accounting` entitlement (Premium); Free/Growth see a locked
// upsell. Pure-read; no money moves. Operating expenses come from the same owner-
// statement rollup, fed operating-only cost rows. CSV at ./export; the page is
// print-ready (dashboard chrome is hidden on print) so "PDF" = print-to-PDF in v1.
// ============================================================================

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

const STATUS_TONE: Record<RentRollUnitStatus, ChipTone> = {
  occupied: "success",
  upcoming: "info",
  vacant: "neutral",
};

function valueHref(preset: string, range: DateRange, valueDollars: string): string {
  const p = new URLSearchParams();
  p.set("preset", preset);
  if (range.from) p.set("from", range.from);
  if (range.to) p.set("to", range.to);
  if (valueDollars) p.set("value", valueDollars);
  return `/dashboard/rent/rent-roll?${p.toString()}`;
}

function exportHref(preset: string, range: DateRange, valueDollars: string): string {
  const p = new URLSearchParams();
  p.set("preset", preset);
  if (range.from) p.set("from", range.from);
  if (range.to) p.set("to", range.to);
  if (valueDollars) p.set("value", valueDollars);
  return `/dashboard/rent/rent-roll/export?${p.toString()}`;
}

export default async function RentRollPage({
  searchParams,
}: {
  searchParams: { preset?: string; from?: string; to?: string; value?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  // Premium-gated: the investor report is the accounting-depth differentiator.
  if (!planEntitlements(org.plan).accounting) {
    return (
      <div className="mx-auto max-w-3xl">
        <BrandBanner
          eyebrow="Money"
          title="Rent roll & cap rate"
          subtitle="The investor-grade report you hand a buyer or lender: a per-building rent roll, net operating income, and cap rate — built from what you already track."
          icon={<Icons.chart className="h-6 w-6" />}
        />
        <EmptyState
          icon={<Icons.chart className="h-5 w-5" />}
          title="The rent roll is a Premium feature"
          description="Premium adds the investor package: a per-building rent roll with occupancy, net operating income (financing excluded), cap rate and gross rent multiplier — exportable as CSV and print-ready PDF for a buyer, lender or your accountant."
          cta={{ href: "/dashboard/billing", label: "See plans" }}
        />
      </div>
    );
  }

  const presetRaw = searchParams.preset ?? "this_year";
  const preset = (STATEMENT_PRESETS as readonly string[]).includes(presetRaw) ? presetRaw : "this_year";
  const customRange: DateRange = {
    from: parseRangeBound(searchParams.from),
    to: parseRangeBound(searchParams.to),
  };
  const todayIso = new Date().toISOString().slice(0, 10);
  const range = rangeForPreset(preset, todayIso, customRange);

  const valueDollars = (searchParams.value ?? "").trim();
  const propertyValueCents = parseMoneyToCents(valueDollars);

  const supabase = createClient();
  // RLS scopes every query to the caller's org.
  const [{ data: tenData }, { data: propData }, { data: woData }, { data: expData }] =
    await Promise.all([
      supabase
        .from("tenancies")
        .select("status, rent_cents, start_date, end_date, property_id, tenants(name, is_primary)"),
      supabase.from("properties").select("id, address, building_key, rent_cents").order("address", { ascending: true }),
      supabase
        .from("work_orders")
        .select("property_id, building_key, category, status, cost_cents, completed_on, tenancy:tenancies(property_id)"),
      supabase.from("expenses").select("property_id, building_key, category, amount_cents, incurred_on"),
    ]);

  // --- Rent roll (snapshot) -------------------------------------------------
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

  // --- Operating expenses over the window (financing EXCLUDED) --------------
  // Reuse the owner-statement rollup, but feed it OPERATING-only cost rows so
  // statement.totals/buildings carry operating expenses for NOI. Rent isn't
  // needed here (income comes from the rent-roll snapshot), so pass [].
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

  const windowDays = rangeDays(range.from, range.to);
  const cap = computeCapRate({
    annualOperatingIncomeCents: roll.inPlaceAnnualRentCents,
    operatingExpensesCents,
    windowDays,
    propertyValueCents,
  });

  const showCustom = preset === "custom";
  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

  return (
    <div>
      <BrandBanner
        eyebrow={`Money · ${org.name}`}
        title="Rent roll & cap rate"
        subtitle="A per-building rent roll, net operating income, and cap rate — the package a buyer or lender asks for. NOI excludes financing (mortgage and interest); Vacantless reports, it never moves your money."
        icon={<Icons.chart className="h-6 w-6" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <PrintButton />
            <a href={exportHref(preset, range, valueDollars)} className={SECONDARY_ACTION_CLASS}>
              Download CSV
            </a>
          </div>
        }
      />

      {/* Controls: value + expense period (hidden on print) */}
      <div className="print:hidden">
        <Card className="mb-5 bg-gray-50">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="preset" value={preset} />
            {range.from && <input type="hidden" name="from" value={range.from} />}
            {range.to && <input type="hidden" name="to" value={range.to} />}
            <div>
              <label className="block text-xs font-medium text-gray-600">Property value (for cap rate)</label>
              <input
                type="text"
                inputMode="decimal"
                name="value"
                defaultValue={valueDollars}
                placeholder="e.g. 850,000"
                className={`${inputCls} w-44`}
              />
            </div>
            <button type="submit" className={SECONDARY_ACTION_CLASS}>
              Update
            </button>
            <p className="text-xs text-gray-500">
              Cap rate = NOI ÷ value. Enter the price you want to test; one value covers the whole rent roll (per-building valuation is coming).
            </p>
          </form>
        </Card>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-gray-500">Expenses period:</span>
          {STATEMENT_PRESETS.map((p) => {
            const active = preset === p;
            const href =
              p === "custom"
                ? valueHref("custom", { from: null, to: null }, valueDollars)
                : valueHref(p, rangeForPreset(p, todayIso), valueDollars);
            return (
              <Link
                key={p}
                href={href}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                  active ? "bg-brand text-white ring-transparent" : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
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
              {valueDollars && <input type="hidden" name="value" value={valueDollars} />}
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
      </div>

      <p className="mb-4 text-sm text-gray-500">
        Rent roll is a live snapshot of today&apos;s leases (annualized at ×12). Operating expenses cover{" "}
        <span className="font-medium text-gray-700">{describeRange(range)}</span>
        {cap.annualized ? " (annualized to 12 months for the cap rate)." : "."}
      </p>

      {/* Headline KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Occupancy"
          value={`${roll.occupancyPct}%`}
          hint={`${roll.occupiedUnits} of ${roll.totalUnits} units occupied`}
          icon={<Icons.key className="h-4 w-4" />}
        />
        <StatCard
          label="Annualized rent"
          value={formatMoneyCents(roll.inPlaceAnnualRentCents)}
          hint={`${formatMoneyCents(roll.inPlaceMonthlyRentCents)}/mo in-place`}
          icon={<Icons.card className="h-4 w-4" />}
        />
        <StatCard
          label="Net operating income"
          value={formatMoneyCents(cap.noiCents)}
          hint={`less ${formatMoneyCents(cap.annualOperatingExpensesCents)} operating expenses`}
          icon={<Icons.chart className="h-4 w-4" />}
        />
        <StatCard
          label="Cap rate"
          value={cap.capRatePct == null ? "—" : `${cap.capRatePct}%`}
          hint={cap.capRatePct == null ? "Enter a property value" : `on ${formatMoneyCents(propertyValueCents ?? 0)}`}
          icon={<Icons.bolt className="h-4 w-4" />}
        />
      </div>

      {/* Rent roll table */}
      <div className="mt-6">
        <SectionHeading>Rent roll</SectionHeading>
        {roll.totalUnits === 0 ? (
          <EmptyState
            icon={<Icons.key className="h-5 w-5" />}
            title="No units yet"
            description="Add rentals and record tenancies, and your rent roll fills in here — one row per unit with the tenant, lease dates, rent and occupancy."
          />
        ) : (
          <Card padded={false} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Building / unit</th>
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium">Lease</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Monthly rent</th>
                </tr>
              </thead>
              {roll.buildings.map((b) => {
                const multi = b.buildingKey != null && b.units.length > 1;
                return (
                  <tbody key={b.buildingKey ?? b.units[0]?.propertyId ?? b.label} className="border-b border-gray-100 last:border-0">
                    {multi && (
                      <tr className="bg-gray-50/70">
                        <td className="px-4 py-2.5 font-semibold text-gray-900" colSpan={3}>
                          {b.label}
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-500">
                          {b.occupiedCount}/{b.unitCount} occupied
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                          {formatMoneyCents(b.inPlaceMonthlyRentCents)}
                        </td>
                      </tr>
                    )}
                    {b.units.map((u) => (
                      <tr key={u.propertyId}>
                        <td className={`px-4 py-2 text-gray-700 ${multi ? "pl-8" : ""}`}>{u.address}</td>
                        <td className="px-4 py-2 text-gray-700">{u.tenantLabel ?? <span className="text-gray-400">Vacant</span>}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {u.status === "vacant"
                            ? "—"
                            : `${u.leaseStart ?? "?"} ${u.leaseEnd ? `to ${u.leaseEnd}` : "· month-to-month"}`}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <StatusChip tone={STATUS_TONE[u.status]}>{rentRollStatusLabel(u.status)}</StatusChip>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                          {u.monthlyRentCents == null ? "—" : formatMoneyCents(u.monthlyRentCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
              <tfoot>
                <tr className="bg-gray-50 font-semibold text-gray-900">
                  <td className="px-4 py-3" colSpan={3}>
                    Total in-place rent
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500">
                    {roll.occupiedUnits}/{roll.totalUnits} occupied
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoneyCents(roll.inPlaceMonthlyRentCents)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
        )}
        <p className="mt-2 text-xs text-gray-500">
          In-place rent counts occupied units only; vacant units show their asking rent and upcoming leases don&apos;t count
          toward income yet.
        </p>
      </div>

      {/* Valuation breakdown */}
      <div className="mt-6">
        <SectionHeading>Valuation</SectionHeading>
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              <ValRow label="Annualized in-place rent" value={formatMoneyCents(roll.inPlaceAnnualRentCents)} />
              <ValRow
                label={`Operating expenses (${describeRange(range)})`}
                value={`− ${formatMoneyCents(operatingExpensesCents)}`}
              />
              {cap.annualized && (
                <ValRow
                  label="Operating expenses, annualized"
                  value={`− ${formatMoneyCents(cap.annualOperatingExpensesCents)}`}
                  muted
                />
              )}
              <ValRow label="Net operating income (NOI)" value={formatMoneyCents(cap.noiCents)} strong />
              <ValRow
                label="Property value"
                value={propertyValueCents == null ? "Enter a value above" : formatMoneyCents(propertyValueCents)}
              />
              <ValRow
                label="Cap rate"
                value={cap.capRatePct == null ? "—" : `${cap.capRatePct}%`}
                strong
              />
              <ValRow
                label="Gross rent multiplier"
                value={cap.grossRentMultiplier == null ? "—" : `${cap.grossRentMultiplier}×`}
              />
            </tbody>
          </table>
        </Card>
        <p className="mt-2 text-xs text-gray-500">
          NOI excludes financing (mortgage and interest) — a property is valued on what it earns from operations. Cap rate =
          NOI ÷ property value. Gross rent multiplier = value ÷ annual rent.
        </p>
      </div>
    </div>
  );
}

function ValRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className={`px-4 py-3 ${strong ? "font-semibold text-gray-900" : muted ? "text-gray-400" : "text-gray-700"}`}>
        {label}
      </td>
      <td
        className={`px-4 py-3 text-right tabular-nums ${
          strong ? "font-semibold text-gray-900" : muted ? "text-gray-400" : "text-gray-700"
        }`}
      >
        {value}
      </td>
    </tr>
  );
}
