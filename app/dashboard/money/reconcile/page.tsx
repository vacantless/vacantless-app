import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { hasEntitlement } from "@/lib/billing";
import { txnDetailLine } from "@/lib/bank-feed";
import { bestRuleForTxn, ruleAutoFiles, resolveRuleAssignment, type CategorizationRule, type MatchableTxn } from "@/lib/categorization-rules";
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "@/lib/expenses";
import { formatMoneyCents } from "@/lib/payments";
import {
  buildReconciliationSummary,
  rentMatchCandidatesForTransaction,
  type BankTransactionForReconciliation,
  type RentPaymentReconciliationLink,
  type ReconciledTransaction,
} from "@/lib/reconciliation";
import { splitAddressUnit } from "@/lib/listing-fill-sheet";
import {
  Card,
  EmptyState,
  PageHeader,
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
  StatCard,
  StatusChip,
  type ChipTone,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { FeatureLockedNotice } from "@/components/feature-locked-notice";
import { SubmitButton } from "@/components/submit-button";
import { mapRuleRow, type RuleRow } from "../../expenses/triage-core";
import {
  excludeTransaction,
  reconcileCreditAsRent,
  reconcileDebitAsExpense,
} from "./actions";

export const dynamic = "force-dynamic";

type BankTxnRow = {
  id: string;
  account_external_id: string | null;
  account_name: string | null;
  posted_on: string;
  amount_cents: number;
  direction: "debit" | "credit";
  merchant: string | null;
  description: string | null;
  currency: string | null;
  triage_status: string;
  expense_id: string | null;
  merchant_entity_id: string | null;
  stream_id: string | null;
};

type ExpenseLinkRow = {
  id: string;
  bank_transaction_id: string | null;
  category: string | null;
};

type RentPaymentRow = {
  id: string;
  bank_transaction_id: string | null;
  tenancy_id: string | null;
  amount_cents: number;
  period_month: string | null;
};

type TenancyRow = {
  id: string;
  rent_cents: number | null;
  property_id: string | null;
  status: string;
  properties: { address: string } | { address: string }[] | null;
};

type PropertyRef = { id: string; address: string; building_key: string | null };

type SearchParams = {
  reconciled?: string;
  error?: string;
  locked?: string;
};

function fmtDate(d: string | null): string {
  if (!d) return "Unposted";
  const [y, m, day] = String(d).slice(0, 10).split("-").map((n) => parseInt(n, 10));
  if (!y) return String(d);
  return new Date(y, m - 1, day).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSignedCents(cents: number): string {
  if (cents === 0) return formatMoneyCents(0);
  return `${cents > 0 ? "+" : "-"}${formatMoneyCents(Math.abs(cents))}`;
}

function stateTone(txn: ReconciledTransaction): ChipTone {
  if (!txn.state.reconciled) return txn.direction === "credit" ? "warn" : "danger";
  if (txn.state.kind === "excluded") return "neutral";
  if (txn.state.kind === "rent") return "success";
  return "brand";
}

function transactionLabel(txn: ReconciledTransaction): string {
  return txn.merchant ?? txn.description ?? (txn.direction === "credit" ? "Deposit" : "Transaction");
}

function accountHint(count: number, cents: number): string {
  if (count === 0) return "All transactions accounted for";
  return `${count} transaction${count === 1 ? "" : "s"} - ${formatMoneyCents(cents)} waiting for a decision`;
}

function tenancyLabel(row: TenancyRow): string {
  const prop = Array.isArray(row.properties) ? row.properties[0] : row.properties;
  const address = prop?.address ?? "Unit";
  return splitAddressUnit(address).unit ?? address;
}

function toTransaction(row: BankTxnRow): BankTransactionForReconciliation {
  return {
    id: row.id,
    accountExternalId: row.account_external_id,
    accountName: row.account_name,
    postedOn: row.posted_on,
    amountCents: row.amount_cents,
    direction: row.direction,
    merchant: row.merchant,
    description: row.description,
    currency: row.currency,
    triageStatus: row.triage_status,
    expenseId: row.expense_id,
  };
}

function suggestionFor(
  rules: CategorizationRule[],
  row: BankTxnRow,
): { category: string; propertyId: string | null; buildingKey: string | null; label: string } | null {
  const matchTxn: MatchableTxn = {
    merchantEntityId: row.merchant_entity_id,
    streamId: row.stream_id,
    merchant: row.merchant,
    accountExternalId: row.account_external_id,
    amountCents: row.amount_cents,
    postedOn: row.posted_on,
  };
  const rule = bestRuleForTxn(rules, matchTxn);
  if (!rule) return null;
  const assignment = resolveRuleAssignment(rule);
  return {
    ...assignment,
    label: ruleAutoFiles(rule) ? "Saved rule" : "Saved category",
  };
}

function banner(searchParams: SearchParams) {
  if (searchParams.reconciled === "expense") {
    return { tone: "success" as const, text: "Expense reconciled." };
  }
  if (searchParams.reconciled === "rent") {
    return { tone: "success" as const, text: "Rent deposit reconciled." };
  }
  if (searchParams.reconciled === "excluded") {
    return { tone: "neutral" as const, text: "Transaction excluded." };
  }
  if (searchParams.error === "forbidden") {
    return { tone: "danger" as const, text: "You don't have permission to reconcile this account." };
  }
  if (searchParams.error === "already") {
    return { tone: "warn" as const, text: "That transaction was already reconciled." };
  }
  if (searchParams.error === "no_rent_match") {
    return { tone: "warn" as const, text: "No close rent match was found for that deposit." };
  }
  if (searchParams.error) {
    return { tone: "danger" as const, text: "That transaction could not be reconciled." };
  }
  return null;
}

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const accounting = hasEntitlement(org.plan, "accounting");
  if (!accounting) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          eyebrow="Money"
          title="Reconcile"
          subtitle="Account for bank activity against your rent and expense ledgers."
          icon={<Icons.card />}
        />
        <FeatureLockedNotice
          title="Reconciliation is a Premium accounting feature"
          description="Upgrade to clear unmatched bank transactions, match rent deposits, and see the accounting queue across every connected account."
          unlockTier="premium"
        />
      </div>
    );
  }

  const supabase = createClient();
  const [
    { data: txnData },
    { data: expenseData },
    { data: rentData },
    { data: tenancyData },
    { data: ruleData },
    { data: propData },
  ] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select(
        "id, account_external_id, account_name, posted_on, amount_cents, direction, merchant, description, currency, triage_status, expense_id, merchant_entity_id, stream_id",
      )
      .eq("organization_id", org.id)
      .order("posted_on", { ascending: true }),
    supabase
      .from("expenses")
      .select("id, bank_transaction_id, category")
      .eq("organization_id", org.id),
    supabase
      .from("rent_payments")
      .select("id, bank_transaction_id, tenancy_id, amount_cents, period_month")
      .eq("organization_id", org.id),
    supabase
      .from("tenancies")
      .select("id, rent_cents, property_id, status, properties(address)")
      .eq("organization_id", org.id)
      .eq("status", "active"),
    supabase
      .from("categorization_rules")
      .select(
        "id, scope_kind, merchant_entity_id, stream_id, merchant_norm, account_external_id, amount_min_cents, amount_max_cents, day_min, day_max, category, property_id, building_key, times_applied, last_applied_at, created_at",
      )
      .eq("organization_id", org.id),
    supabase.from("properties").select("id, address, building_key"),
  ]);

  const rows = (txnData ?? []) as BankTxnRow[];
  const properties = (propData ?? []) as PropertyRef[];
  const buildingLabels = new Map<string, string>();
  for (const property of properties) {
    if (!property.building_key) continue;
    if (!buildingLabels.has(property.building_key)) {
      buildingLabels.set(property.building_key, splitAddressUnit(property.address).street ?? property.address);
    }
  }
  const buildingOptions = [...buildingLabels.entries()].map(([key, label]) => ({ key, label }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const transactions = rows.map(toTransaction);
  const tenancies = ((tenancyData ?? []) as unknown as TenancyRow[]).map((row) => ({
    tenancyId: row.id,
    rentCents: row.rent_cents,
    label: tenancyLabel(row),
    propertyId: row.property_id,
  }));
  const tenancyLabels = new Map(tenancies.map((t) => [t.tenancyId, t.label]));
  const rentPayments: RentPaymentReconciliationLink[] = ((rentData ?? []) as RentPaymentRow[]).map((row) => ({
    id: row.id,
    bankTransactionId: row.bank_transaction_id,
    tenancyId: row.tenancy_id,
    amountCents: row.amount_cents,
    periodMonth: row.period_month,
    label: row.tenancy_id ? tenancyLabels.get(row.tenancy_id) ?? null : null,
  }));
  const expenses = ((expenseData ?? []) as ExpenseLinkRow[]).map((row) => ({
    id: row.id,
    bankTransactionId: row.bank_transaction_id,
    category: row.category,
  }));
  const rules = ((ruleData ?? []) as RuleRow[]).map(mapRuleRow);
  const summary = buildReconciliationSummary(transactions, { expenses, rentPayments });
  const notice = banner(searchParams);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        eyebrow="Money"
        title="Reconcile"
        subtitle="Clear unmatched bank activity against the rent and expense rows your owner statement already uses."
        icon={<Icons.card />}
        action={
          <>
            <Link href="/dashboard/expenses" className={SECONDARY_ACTION_CLASS}>
              Expenses
            </Link>
            <Link href="/dashboard/rent/statement" className={SECONDARY_ACTION_CLASS}>
              Owner statement
            </Link>
          </>
        }
      />

      {notice && (
        <div className="mb-4">
          <StatusChip tone={notice.tone}>{notice.text}</StatusChip>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Book balance"
          value={formatSignedCents(summary.totalBalanceCents)}
          hint={`${summary.accounts.length} account${summary.accounts.length === 1 ? "" : "s"}`}
          icon={<Icons.chart />}
        />
        <StatCard
          label="Waiting on you"
          value={summary.unreconciledCount}
          hint={`${formatMoneyCents(summary.unreconciledCents)} to match, log, or exclude`}
          icon={<Icons.list />}
        />
        <StatCard
          label="Matched rows"
          value={transactions.length - summary.unreconciledCount}
          hint="Expense, rent, or excluded"
          icon={<Icons.check />}
        />
      </div>

      <div className="mt-8 space-y-5">
        {summary.accounts.length === 0 ? (
          <EmptyState
            icon={<Icons.card />}
            title="No bank transactions yet"
            description="Connect or import a bank account from Expenses, then reconcile the staged transactions here."
            cta={{ href: "/dashboard/expenses", label: "Go to Expenses" }}
          />
        ) : (
          summary.accounts.map((account) => (
            <Card key={account.key} padded={false}>
              <div className="border-b border-gray-100 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">{account.label}</h2>
                    <p className="mt-1 text-sm text-gray-600">{accountHint(account.unreconciledCount, account.unreconciledCents)}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Running balance</p>
                    <p className="text-lg font-semibold text-gray-900">{formatSignedCents(account.balanceCents)}</p>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-gray-100">
                {account.transactions.map((txn) => {
                  const raw = byId.get(txn.id);
                  const suggestion = raw && txn.direction === "debit" ? suggestionFor(rules, raw) : null;
                  const rentCandidates =
                    txn.direction === "credit"
                      ? rentMatchCandidatesForTransaction(txn, tenancies).slice(0, 3)
                      : [];
                  return (
                    <div key={txn.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)_auto] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-gray-900">{transactionLabel(txn)}</p>
                          <StatusChip tone={stateTone(txn)}>{txn.state.label}</StatusChip>
                        </div>
                        {txnDetailLine(txn.merchant, txn.description) && (
                          <p className="mt-1 text-sm text-gray-700">{txnDetailLine(txn.merchant, txn.description)}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                          {fmtDate(txn.postedOn)}
                          {txn.currency && txn.currency !== "CAD" ? ` - ${txn.currency}` : ""}
                          {suggestion && !txn.state.reconciled ? ` - ${suggestion.label}` : ""}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Amount</p>
                          <p className={txn.direction === "credit" ? "font-semibold text-emerald-700" : "font-semibold text-gray-900"}>
                            {formatSignedCents(txn.signedAmountCents)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Balance</p>
                          <p className="font-semibold text-gray-900">{formatSignedCents(txn.runningBalanceCents)}</p>
                        </div>
                      </div>

                      {!txn.state.reconciled ? (
                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                          {txn.direction === "debit" && (
                            <form action={reconcileDebitAsExpense} className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:w-[34rem] xl:grid-cols-3">
                              <input type="hidden" name="transaction_id" value={txn.id} />
                              <label className="text-sm">
                                <span className="mb-1 block text-gray-600">Category</span>
                                <select name="category" defaultValue={suggestion?.category ?? "other"} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                                  {EXPENSE_CATEGORIES.map((category) => (
                                    <option key={category} value={category}>{expenseCategoryLabel(category)}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-sm">
                                <span className="mb-1 block text-gray-600">Unit</span>
                                <select name="property_id" defaultValue={suggestion?.propertyId ?? ""} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                                  <option value="">-</option>
                                  {properties.map((property) => (
                                    <option key={property.id} value={property.id}>{property.address}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-sm">
                                <span className="mb-1 block text-gray-600">Building</span>
                                <select name="building_key" defaultValue={suggestion?.buildingKey ?? ""} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                                  <option value="">-</option>
                                  {buildingOptions.map((building) => (
                                    <option key={building.key} value={building.key}>{building.label}</option>
                                  ))}
                                </select>
                              </label>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2 xl:col-span-3">
                                <SubmitButton className={`${PRIMARY_ACTION_CLASS} bg-brand`} pendingLabel="Logging...">
                                  Log expense
                                </SubmitButton>
                                <label className="flex items-center gap-2 text-sm text-gray-600">
                                  <input type="checkbox" name="remember" value="1" className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand" />
                                  Remember - always categorize {transactionLabel(txn)} this way
                                </label>
                              </div>
                            </form>
                          )}
                          {txn.direction === "credit" &&
                            rentCandidates.map((candidate) => (
                              <form key={candidate.tenancyId} action={reconcileCreditAsRent}>
                                <input type="hidden" name="transaction_id" value={txn.id} />
                                <input type="hidden" name="tenancy_id" value={candidate.tenancyId} />
                                <SubmitButton className={`${PRIMARY_ACTION_CLASS} bg-brand`} pendingLabel="Matching...">
                                  Match {candidate.label}
                                </SubmitButton>
                              </form>
                            ))}
                          <form action={excludeTransaction}>
                            <input type="hidden" name="transaction_id" value={txn.id} />
                            <SubmitButton className={SECONDARY_ACTION_CLASS} pendingLabel="Excluding...">
                              Exclude
                            </SubmitButton>
                          </form>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 lg:text-right">
                          {txn.state.kind === "rent" || txn.state.kind === "expense"
                            ? "Statement-ready"
                            : "No statement effect"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
