import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { hasEntitlement } from "@/lib/billing";
import {
  BrandBanner,
  Card,
  EmptyState,
  StatCard,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { formatMoneyCents } from "@/lib/payments";
import {
  SPEND_WINDOWS,
  expensesForSpendWindow,
  parseSpendWindow,
  recurringSpend,
  spendByCategory,
  spendTrend,
  spendWindowLabel,
  type SpendExpenseRow,
  type SpendWindow,
} from "@/lib/spend-analysis";
import type { CategorizationRule } from "@/lib/categorization-rules";

export const dynamic = "force-dynamic";

type OrgForSpend = {
  id: string;
  name: string | null;
  plan: string | null;
};

type ExpenseQueryRow = {
  id: string;
  property_id: string | null;
  building_key: string | null;
  category: string;
  amount_cents: number;
  incurred_on: string;
  merchant: string | null;
  note: string | null;
  source: string | null;
  bank_transaction_id: string | null;
  bank_transaction:
    | {
        stream_id: string | null;
        merchant: string | null;
        description: string | null;
        account_name: string | null;
      }
    | {
        stream_id: string | null;
        merchant: string | null;
        description: string | null;
        account_name: string | null;
      }[]
    | null;
};

type RuleQueryRow = {
  id: string;
  scope_kind: string;
  stream_id: string | null;
  merchant_norm: string | null;
  account_external_id: string | null;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  day_min: number | null;
  day_max: number | null;
  category: string;
  property_id: string | null;
  building_key: string | null;
  last_applied_at: string | null;
  created_at: string | null;
};

type SpendLoaderResult =
  | {
      ok: true;
      expenses: SpendExpenseRow[];
      category: ReturnType<typeof spendByCategory>;
      trend: ReturnType<typeof spendTrend>;
      recurring: ReturnType<typeof recurringSpend>;
    }
  | { ok: false; reason: "locked" };

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function expenseRow(row: ExpenseQueryRow): SpendExpenseRow {
  const txn = one(row.bank_transaction);
  return {
    id: row.id,
    property_id: row.property_id,
    building_key: row.building_key,
    category: row.category,
    amount_cents: row.amount_cents,
    incurred_on: row.incurred_on,
    merchant: row.merchant ?? txn?.merchant ?? txn?.description ?? null,
    note: row.note,
    source: row.source,
    bank_transaction_id: row.bank_transaction_id,
    stream_id: txn?.stream_id ?? null,
    account_name: txn?.account_name ?? null,
  };
}

function ruleRow(row: RuleQueryRow): CategorizationRule {
  return {
    id: row.id,
    scopeKind: row.scope_kind === "stream" ? "stream" : "merchant",
    merchantEntityId: null,
    streamId: row.stream_id,
    merchantNorm: row.merchant_norm,
    accountExternalId: row.account_external_id,
    amountMinCents: row.amount_min_cents,
    amountMaxCents: row.amount_max_cents,
    dayMin: row.day_min,
    dayMax: row.day_max,
    category: row.category,
    propertyId: row.property_id,
    buildingKey: row.building_key,
    lastAppliedAt: row.last_applied_at,
    createdAt: row.created_at,
  };
}

async function loadSpendAnalysis(
  org: OrgForSpend,
  window: SpendWindow,
): Promise<SpendLoaderResult> {
  if (!hasEntitlement(org.plan, "accounting")) {
    return { ok: false, reason: "locked" };
  }

  const supabase = createClient();
  const [{ data: expenseRows }, { data: ruleRows }] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, property_id, building_key, category, amount_cents, incurred_on, merchant, note, source, bank_transaction_id, bank_transaction:bank_transactions(stream_id, merchant, description, account_name)",
      )
      .eq("organization_id", org.id)
      .order("incurred_on", { ascending: false }),
    supabase
      .from("categorization_rules")
      .select(
        "id, scope_kind, stream_id, merchant_norm, account_external_id, amount_min_cents, amount_max_cents, day_min, day_max, category, property_id, building_key, last_applied_at, created_at",
      )
      .eq("organization_id", org.id)
      .eq("scope_kind", "stream")
      .not("stream_id", "is", null)
      .order("last_applied_at", { ascending: false, nullsFirst: false }),
  ]);

  const expenses = ((expenseRows ?? []) as unknown as ExpenseQueryRow[]).map(expenseRow);
  const rules = ((ruleRows ?? []) as unknown as RuleQueryRow[]).map(ruleRow);
  const expensesInWindow = expensesForSpendWindow(expenses, window);
  const category = spendByCategory(expenses, window);
  const trend = spendTrend(expenses, window);
  const recurring = recurringSpend(expensesInWindow, rules);

  return { ok: true, expenses, category, trend, recurring };
}

function spendHref(window: SpendWindow): string {
  return `/dashboard/money/spend?window=${window}`;
}

function pctWidth(pct: number): string {
  if (pct <= 0) return "0%";
  return `${Math.max(4, Math.min(100, pct))}%`;
}

function fmtDay(iso: string | null): string {
  if (!iso) return "No ledger row yet";
  return new Date(`${iso}T00:00:00`).toLocaleDateString();
}

function LockedSpend() {
  return (
    <div className="mx-auto max-w-3xl">
      <BrandBanner
        eyebrow="Money"
        title="Spend analysis"
        subtitle="A category, trend, and recurring-charge view over the expense ledger you already keep."
        icon={<Icons.chart className="h-6 w-6" />}
      />
      <EmptyState
        icon={<Icons.chart className="h-5 w-5" />}
        title="Spend analysis is a Premium feature"
        description="Premium adds accounting insights across your expense ledger: category share, monthly trend, and recurring charges from bank-stream rules."
        cta={{ href: "/dashboard/billing", label: "See plans" }}
      />
    </div>
  );
}

export default async function SpendAnalysisPage({
  searchParams,
}: {
  searchParams: { window?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const accounting = hasEntitlement(org.plan, "accounting");
  if (!accounting) return <LockedSpend />;

  const window = parseSpendWindow(searchParams.window);
  const loaded = await loadSpendAnalysis(org, window);
  if (!loaded.ok) return <LockedSpend />;

  const category = loaded.category;
  const trend = loaded.trend;
  const recurring = loaded.recurring;
  const topCategory = category.rows[0] ?? null;
  const maxTrend = Math.max(1, ...trend.rows.map((row) => row.totalCents));
  const recurringLastTotal = recurring.reduce(
    (sum, row) => sum + (row.lastAmountCents ?? 0),
    0,
  );

  return (
    <div>
      <BrandBanner
        eyebrow={`Money - ${org.name}`}
        title="Spend analysis"
        subtitle="See where property costs are going, whether spend is rising, and which recurring streams deserve a closer look."
        icon={<Icons.chart className="h-6 w-6" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/money/income-statement" className={SECONDARY_ACTION_CLASS}>
              Income statement
            </Link>
            <Link href="/dashboard/expenses" className={SECONDARY_ACTION_CLASS}>
              Expense ledger
            </Link>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {SPEND_WINDOWS.map((option) => {
          const active = option === window;
          return (
            <Link
              key={option}
              href={spendHref(option)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                active
                  ? "bg-brand text-white ring-transparent"
                  : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
              }`}
              style={active ? { background: "var(--brand-color)" } : undefined}
            >
              {spendWindowLabel(option)}
            </Link>
          );
        })}
      </div>

      <p className="mb-4 text-sm text-gray-500">
        Showing <span className="font-medium text-gray-700">{category.range.label}</span>{" "}
        from {category.range.from} to {category.range.to}. Expenses are counted by incurred date.
      </p>

      {category.totalCents === 0 && (
        <div className="mb-5">
          <EmptyState
            icon={<Icons.chart className="h-5 w-5" />}
            title="No spend in this window"
            description="No expense rows were found for this period. Pick another window or log expenses first."
            cta={{ href: "/dashboard/expenses", label: "Open expenses" }}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total spend"
          value={formatMoneyCents(category.totalCents)}
          hint={`${category.count} expense row${category.count === 1 ? "" : "s"}`}
          icon={<Icons.card className="h-4 w-4" />}
        />
        <StatCard
          label="Largest category"
          value={topCategory ? topCategory.label : "None"}
          hint={topCategory ? `${topCategory.sharePct}% of spend` : "No rows in range"}
          icon={<Icons.list className="h-4 w-4" />}
        />
        <StatCard
          label="Recurring streams"
          value={String(recurring.length)}
          hint={`${formatMoneyCents(recurringLastTotal)} in latest charges`}
          icon={<Icons.clock className="h-4 w-4" />}
        />
        <StatCard
          label="Monthly high"
          value={formatMoneyCents(maxTrend === 1 ? 0 : maxTrend)}
          hint="Highest month in selected window"
          icon={<Icons.chart className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Spend by category</h2>
              <p className="mt-1 text-sm text-gray-500">Each line reconciles to the same ledger rows used by the income statement.</p>
            </div>
            <span className="text-sm font-semibold text-gray-900">
              {formatMoneyCents(category.totalCents)}
            </span>
          </div>

          {category.rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
              No category spend in this window.
            </p>
          ) : (
            <div className="space-y-3">
              {category.rows.map((row) => (
                <div key={row.category}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-gray-800">{row.label}</span>
                    <span className="text-right tabular-nums text-gray-600">
                      {formatMoneyCents(row.totalCents)} - {row.sharePct}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{
                        width: pctWidth(row.sharePct),
                        background: "var(--brand-gradient, var(--brand-color))",
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    {row.count} row{row.count === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900">Monthly trend</h2>
            <p className="mt-1 text-sm text-gray-500">A simple month-by-month total from the selected window.</p>
          </div>
          <div className="space-y-3">
            {trend.rows.map((row) => {
              const pct = row.totalCents === 0 ? 0 : (row.totalCents / maxTrend) * 100;
              return (
                <div key={row.month}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-gray-700">{row.label}</span>
                    <span className="tabular-nums text-gray-600">
                      {formatMoneyCents(row.totalCents)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-gray-700"
                      style={{ width: pctWidth(pct) }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="mt-6" padded={false}>
        <div className="border-b border-gray-100 px-4 py-4">
          <h2 className="text-base font-semibold text-gray-900">Recurring spend</h2>
          <p className="mt-1 text-sm text-gray-500">
            Plaid recurring streams and saved stream rules, grouped without changing the ledger.
          </p>
        </div>
        {recurring.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">
            No recurring stream IDs or saved stream rules found yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Merchant</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Cadence</th>
                  <th className="px-4 py-3 text-right font-medium">Last amount</th>
                  <th className="px-4 py-3 font-medium">Last seen</th>
                  <th className="px-4 py-3 text-right font-medium">Rows</th>
                </tr>
              </thead>
              <tbody>
                {recurring.map((row) => (
                  <tr key={row.streamId} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{row.merchant}</div>
                      <div className="text-xs text-gray-400">{row.streamId}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.label}</td>
                    <td className="px-4 py-3 text-gray-600">{row.cadenceLabel}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                      {row.lastAmountCents == null
                        ? "-"
                        : formatMoneyCents(row.lastAmountCents)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {fmtDay(row.lastDate)}
                      {row.source === "rule" && (
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                          Rule
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                      {row.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
