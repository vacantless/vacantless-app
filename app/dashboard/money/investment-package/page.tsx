import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { planEntitlements } from "@/lib/billing";
import { BrandBanner, Card, StatCard, EmptyState, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { Icons } from "@/components/icons";
import {
  STATEMENT_PRESETS,
  statementPresetLabel,
  rangeForPreset,
  parseRangeBound,
  formatMoneyCents,
  type DateRange,
} from "@/lib/statements";
import { EXPIRY_HORIZON_MONTHS, type PackageUnitRow } from "@/lib/investment-package";
import { loadInvestmentPackage } from "./load";

export const dynamic = "force-dynamic";

// The investment package: the document a seller hands to the market and a
// buyer's lender reads, for one building. Everything on this page comes from
// the owner's own records; the page's job is to show the numbers AND the basis
// under them, because the reader is not the person who kept the books.

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parsePriceDollars(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}

function leaseTypeLabel(unit: PackageUnitRow): string {
  if (unit.leaseKind === "vacant") return "Vacant";
  if (unit.leaseKind === "month_to_month") return "Month to month";
  return "Fixed term";
}

export default async function InvestmentPackagePage({
  searchParams,
}: {
  searchParams: { building?: string; preset?: string; from?: string; to?: string; price?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  if (!planEntitlements(org.plan).accounting) {
    return (
      <div className="mx-auto max-w-3xl">
        <BrandBanner
          eyebrow="Money"
          title="Investment package"
          subtitle="The rent roll, operating numbers and lease schedule for one building, in the form a buyer and their lender read."
          icon={<Icons.chart className="h-6 w-6" />}
        />
        <div className="mt-6">
          <EmptyState
            title="Investment package is a Premium feature"
            description="It turns what you already record into the document you hand to the market."
            cta={{ href: "/dashboard/billing", label: "See plans" }}
          />
        </div>
      </div>
    );
  }

  const preset = searchParams.preset ?? "this_year";
  const asOf = todayIso();
  const customRange: DateRange = {
    from: parseRangeBound(searchParams.from),
    to: parseRangeBound(searchParams.to),
  };
  const range: DateRange = rangeForPreset(preset, asOf, customRange);
  const askingPriceCents = parsePriceDollars(searchParams.price);

  const { buildings, pkg } = await loadInvestmentPackage(
    org.id,
    range,
    asOf,
    searchParams.building ?? null,
    askingPriceCents,
  );

  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

  const exportHref = pkg
    ? `/dashboard/money/investment-package/export?building=${encodeURIComponent(pkg.buildingKey ?? "")}&preset=${encodeURIComponent(preset)}&from=${encodeURIComponent(searchParams.from ?? "")}&to=${encodeURIComponent(searchParams.to ?? "")}&price=${encodeURIComponent(searchParams.price ?? "")}`
    : "#";

  return (
    <div>
      <BrandBanner
        eyebrow={`Money · ${org.name}`}
        title="Investment package"
        subtitle="The rent roll, the operating numbers, the lease schedule and the basis under all three, for one building."
        icon={<Icons.chart className="h-6 w-6" />}
        action={
          pkg ? (
            <Link href={exportHref} className={SECONDARY_ACTION_CLASS} prefetch={false}>
              Download CSV
            </Link>
          ) : null
        }
      />

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Building</span>
          <select name="building" defaultValue={pkg?.buildingKey ?? ""} className={inputCls}>
            {buildings.map((b) => (
              <option key={b.buildingKey ?? "none"} value={b.buildingKey ?? ""}>
                {b.label} ({b.unitCount} unit{b.unitCount === 1 ? "" : "s"})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Period</span>
          <select name="preset" defaultValue={preset} className={inputCls}>
            {STATEMENT_PRESETS.map((p) => (
              <option key={p} value={p}>
                {statementPresetLabel(p)}
              </option>
            ))}
          </select>
        </label>
        {preset === "custom" && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">From</span>
              <input type="date" name="from" defaultValue={searchParams.from ?? ""} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">To</span>
              <input type="date" name="to" defaultValue={searchParams.to ?? ""} className={inputCls} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">Asking price</span>
          <input
            name="price"
            inputMode="decimal"
            placeholder="1,950,000"
            defaultValue={searchParams.price ?? ""}
            className={inputCls}
          />
        </label>
        <button type="submit" className={SECONDARY_ACTION_CLASS}>
          Update
        </button>
      </form>

      {!pkg ? (
        <div className="mt-6">
          <EmptyState
            title="No building to report on yet"
            description="Add a property and a lease, and the package fills in from what you record."
            cta={{ href: "/dashboard/properties", label: "Your properties" }}
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="In place rent"
              value={formatMoneyCents(pkg.headline.inPlaceAnnualRentCents)}
              hint={`${formatMoneyCents(pkg.headline.inPlaceMonthlyRentCents)} a month`}
              icon={<Icons.chart className="h-4 w-4" />}
            />
            <StatCard
              label="Net operating income"
              value={formatMoneyCents(pkg.headline.noiCents)}
              hint={`after ${formatMoneyCents(pkg.headline.annualOperatingExpensesCents)} of costs`}
              icon={<Icons.bolt className="h-4 w-4" />}
            />
            <StatCard
              label="Cap rate"
              value={pkg.headline.capRatePct == null ? "Withheld" : `${pkg.headline.capRatePct}%`}
              hint={
                pkg.headline.capRatePct == null
                  ? "not enough recorded cost to stand behind"
                  : `on ${formatMoneyCents(pkg.headline.askingPriceCents ?? 0)}`
              }
              icon={<Icons.bolt className="h-4 w-4" />}
            />
            <StatCard
              label="Occupancy"
              value={`${pkg.headline.occupancyPct}%`}
              hint={`${pkg.headline.occupiedCount} of ${pkg.headline.unitCount} units`}
              icon={<Icons.chart className="h-4 w-4" />}
            />
          </div>

          {pkg.basis.warnings.length > 0 && (
            <Card className="mt-6 border-amber-200 bg-amber-50/60">
              <h2 className="text-sm font-semibold text-gray-900">What is behind these numbers</h2>
              <ul className="mt-2 space-y-1 text-sm text-gray-700">
                {pkg.basis.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </Card>
          )}

          <div className="mt-6">
            <Card padded={false} className="overflow-x-auto">
              <table className="min-w-[820px] w-full text-sm">
                <caption className="px-4 pt-4 text-left text-sm font-semibold text-gray-900">
                  Rent roll
                </caption>
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 font-medium">Unit</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Tenant</th>
                    <th className="px-4 py-3 text-right font-medium">Monthly rent</th>
                    <th className="px-4 py-3 font-medium">Lease type</th>
                    <th className="px-4 py-3 font-medium">Lease end</th>
                    <th className="px-4 py-3 text-right font-medium">Market rent</th>
                    <th className="px-4 py-3 text-right font-medium">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {pkg.units.map((u) => (
                    <tr key={u.propertyId} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3 text-gray-900">{u.unitLabel}</td>
                      <td className="px-4 py-3 text-gray-600">{u.statusLabel}</td>
                      <td className="px-4 py-3 text-gray-600">{u.tenantLabel ?? "Vacant"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                        {u.monthlyRentCents == null ? "not set" : formatMoneyCents(u.monthlyRentCents)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{leaseTypeLabel(u)}</td>
                      <td className="px-4 py-3 text-gray-600">{u.leaseEnd ?? "no end date"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {u.marketRentCents == null ? "not set" : formatMoneyCents(u.marketRentCents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                        {u.gapCents == null ? "" : formatMoneyCents(u.gapCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="text-sm font-semibold text-gray-900">When the leases roll</h2>
              <p className="mt-1 text-sm text-gray-600">
                What a buyer can reset, and how soon.
              </p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-600">Month to month</dt>
                  <dd className="tabular-nums text-gray-900">
                    {pkg.expiry.monthToMonthUnits} unit{pkg.expiry.monthToMonthUnits === 1 ? "" : "s"},{" "}
                    {formatMoneyCents(pkg.expiry.monthToMonthMonthlyRentCents)} a month
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-600">Ending within {EXPIRY_HORIZON_MONTHS} months</dt>
                  <dd className="tabular-nums text-gray-900">
                    {pkg.expiry.expiringWithinHorizonUnits} unit
                    {pkg.expiry.expiringWithinHorizonUnits === 1 ? "" : "s"},{" "}
                    {formatMoneyCents(pkg.expiry.expiringWithinHorizonMonthlyRentCents)} a month
                  </dd>
                </div>
                {pkg.expiry.byMonth.map((b) => (
                  <div key={b.month} className="flex justify-between pl-4">
                    <dt className="text-gray-500">{b.month}</dt>
                    <dd className="tabular-nums text-gray-600">
                      {b.units} unit{b.units === 1 ? "" : "s"}, {formatMoneyCents(b.monthlyRentCents)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>

            <Card>
              <h2 className="text-sm font-semibold text-gray-900">Operating costs</h2>
              <p className="mt-1 text-sm text-gray-600">
                {pkg.basis.periodLabel}. Financing is excluded, so this is the operating picture.
              </p>
              {pkg.operatingLines.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">Nothing recorded in this period.</p>
              ) : (
                <dl className="mt-3 space-y-2 text-sm">
                  {pkg.operatingLines.map((line) => (
                    <div key={line.category} className="flex justify-between">
                      <dt className="text-gray-600">{line.label}</dt>
                      <dd className="tabular-nums text-gray-900">{formatMoneyCents(line.totalCents)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>
          </div>

          <Card className="mt-6">
            <h2 className="text-sm font-semibold text-gray-900">Rent against market</h2>
            {pkg.rentGap.unitsPriced === 0 ? (
              <p className="mt-1 text-sm text-gray-600">
                No market rent is set on any occupied unit, so there is no gap to show yet.
              </p>
            ) : (
              <p className="mt-1 text-sm text-gray-700">
                Across {pkg.rentGap.unitsPriced} unit{pkg.rentGap.unitsPriced === 1 ? "" : "s"} with a
                market rent, the leases run {formatMoneyCents(pkg.rentGap.monthlyGapCents)} a month under
                market, which is {formatMoneyCents(pkg.rentGap.annualGapCents)} a year.
              </p>
            )}
          </Card>

          <p className="mt-4 text-xs text-gray-500">
            Prepared from the owner&apos;s own records for {pkg.basis.periodLabel}, as of {pkg.asOf}. It is
            not an appraisal and it is not audited. Costs are recorded in{" "}
            {pkg.basis.expenseMonthsObserved} month
            {pkg.basis.expenseMonthsObserved === 1 ? "" : "s"} of the period across{" "}
            {pkg.basis.expenseItems} item{pkg.basis.expenseItems === 1 ? "" : "s"}.
          </p>
        </>
      )}
    </div>
  );
}
