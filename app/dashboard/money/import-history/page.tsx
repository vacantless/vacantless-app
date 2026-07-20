import Link from "next/link";
import { redirect } from "next/navigation";
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
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { hasEntitlement } from "@/lib/billing";
import { currentUserCan } from "@/lib/membership";
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "@/lib/expenses";
import { formatMoneyCents } from "@/lib/payments";
import { mapSourceCategory } from "@/lib/accounting-import";
import {
  commitCategorizationImport,
  discardCategorizationImportBatch,
  stageCategorizationImport,
  updatePlannedRow,
} from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = {
  batch?: string;
  staged?: string;
  skipped?: string;
  committed?: string;
  discarded?: string;
  updated?: string;
  noop?: string;
  import?: string;
  error?: string;
};

type BatchRow = {
  id: string;
  source: string;
  filename: string | null;
  row_count: number;
  status: string;
  created_at: string | null;
  committed_at: string | null;
};

type ImportRow = {
  id: string;
  row_no: number | null;
  txn_date: string | null;
  amount_cents: number | null;
  direction: "debit" | "credit" | null;
  description: string | null;
  source_category: string | null;
  client_tag: string | null;
  matched_transaction_id: string | null;
  planned_action: string | null;
  planned_category: string | null;
  planned_property_id: string | null;
  planned_building_key: string | null;
  status: string;
  applied_ref: string | null;
};

type PropertyRow = {
  id: string;
  address: string;
  building_key: string | null;
};

type BankTxnRow = {
  id: string;
  posted_on: string;
  amount_cents: number;
  direction: string;
  merchant: string | null;
  description: string | null;
  triage_status: string;
};

const ACTION_LABELS: Record<string, string> = {
  rule_seed: "Seed rule",
  direct_expense: "File expense",
  rent_link: "Link rent",
  exclude: "Exclude",
  needs_review: "Needs review",
};

const IMPORT_ERROR_TEXT: Record<string, string> = {
  nofile: "Choose a FreshBooks CSV first.",
  toobig: "That file is too large. Export a shorter date range and try again.",
  not_csv: "Upload a .csv export from FreshBooks.",
  unreadable: "That file could not be read.",
  no_header: "No header row was found in that CSV.",
  missing_columns: "The CSV needs date, amount, and category columns.",
  no_rows: "No transaction rows were found in that CSV.",
  save: "The import could not be staged. Migration 0166 may not be applied yet.",
};

function fmtDate(value: string | null): string {
  if (!value) return "No date";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return new Date(year, month - 1, day).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function actionTone(action: string | null): ChipTone {
  if (action === "exclude") return "neutral";
  if (action === "rent_link") return "success";
  if (action === "needs_review") return "warn";
  if (action === "rule_seed") return "brand";
  return "info";
}

function statusTone(status: string): ChipTone {
  if (status === "applied") return "success";
  if (status === "skipped") return "warn";
  return "neutral";
}

// S528: raw DB enums ("staged", "committed", "pending") tell the operator a
// database fact, not what to do — map every chip to plain English.
const BATCH_STATUS_LABELS: Record<string, string> = {
  staged: "Awaiting your review",
  committed: "Applied",
  discarded: "Discarded",
};

const ROW_STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting review",
  applied: "Applied",
  skipped: "Skipped",
};

const TRIAGE_STATUS_LABELS: Record<string, string> = {
  pending: "Free to match",
  categorized: "Already categorized",
  excluded: "Excluded",
};

function rowReason(row: ImportRow, matched: BankTxnRow | undefined): string | null {
  if (row.status !== "pending") return row.applied_ref ?? null;
  if (row.planned_action !== "needs_review") return null;
  if (!row.matched_transaction_id) return "No matched bank transaction.";
  if (matched && matched.triage_status !== "pending") return "Matched transaction is already reconciled.";
  const mapped = row.direction ? mapSourceCategory(row.source_category, row.direction) : { kind: "unknown" as const };
  if (mapped.kind === "unknown") return "Pick a category and rental before applying.";
  if (!row.planned_property_id && (mapped.kind === "expense" || mapped.kind === "rent")) {
    return "Pick which rental this belongs to.";
  }
  return "Review before applying.";
}

function banner(searchParams: SearchParams) {
  if (searchParams.staged != null) {
    const n = parseInt(searchParams.staged, 10) || 0;
    const skipped = parseInt(searchParams.skipped ?? "0", 10) || 0;
    return {
      tone: "success" as const,
      text: `Staged ${n} row${n === 1 ? "" : "s"}${skipped > 0 ? `; skipped ${skipped} summary row${skipped === 1 ? "" : "s"}` : ""}.`,
    };
  }
  if (searchParams.committed != null) {
    const n = parseInt(searchParams.committed, 10) || 0;
    const skipped = parseInt(searchParams.skipped ?? "0", 10) || 0;
    return searchParams.noop
      ? { tone: "neutral" as const, text: "That batch was already committed. No ledger rows were touched." }
      : {
          tone: "success" as const,
          text: `Applied ${n} row${n === 1 ? "" : "s"}${skipped > 0 ? `; skipped ${skipped}` : ""}.`,
        };
  }
  if (searchParams.discarded) return { tone: "neutral" as const, text: "Import batch discarded. Ledger rows were untouched." };
  if (searchParams.updated) return { tone: "success" as const, text: "Preview row updated." };
  if (searchParams.import) {
    return {
      tone: "danger" as const,
      text: IMPORT_ERROR_TEXT[searchParams.import] ?? "That import could not be staged.",
    };
  }
  if (searchParams.error === "forbidden") return { tone: "danger" as const, text: "You do not have permission to manage accounting imports." };
  if (searchParams.error === "category") return { tone: "danger" as const, text: "Pick a valid expense category." };
  if (searchParams.error === "property") return { tone: "danger" as const, text: "Pick a rental in this organization." };
  if (searchParams.error === "personal") return { tone: "danger" as const, text: "Personal or non-rental rows can only be excluded or left for review." };
  if (searchParams.error) return { tone: "danger" as const, text: "That import could not be updated." };
  return null;
}

export default async function ImportHistoryPage({
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
          title="Import history"
          subtitle="Seed categorization from prior accounting once Premium accounting is enabled."
          icon={<Icons.page />}
        />
        <FeatureLockedNotice
          title="Accounting history import is a Premium feature"
          description="Upgrade to review imported accounting history, match it to bank transactions, and seed rules for future expenses."
          unlockTier="premium"
        />
      </div>
    );
  }

  const canManage = await currentUserCan("manage_work_orders");
  if (!canManage) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          eyebrow="Money"
          title="Import history"
          subtitle="Review FreshBooks history before anything touches the ledger."
          icon={<Icons.page />}
        />
        <EmptyState
          icon={<Icons.list />}
          title="No accounting import access"
          description="Ask an owner or operator with maintenance and accounting permissions to stage this import."
        />
      </div>
    );
  }

  const supabase = createClient();
  const [{ data: batchData }, { data: propData }] = await Promise.all([
    supabase
      .from("categorization_import_batches")
      .select("id, source, filename, row_count, status, created_at, committed_at")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("properties")
      .select("id, address, building_key")
      .eq("organization_id", org.id)
      .order("address", { ascending: true }),
  ]);
  const batches = (batchData ?? []) as BatchRow[];
  const properties = (propData ?? []) as PropertyRow[];
  const selectedBatch =
    batches.find((batch) => batch.id === searchParams.batch) ??
    batches.find((batch) => batch.status === "staged") ??
    batches[0] ??
    null;

  let rows: ImportRow[] = [];
  let txns = new Map<string, BankTxnRow>();
  if (selectedBatch) {
    const { data: rowData } = await supabase
      .from("categorization_import_rows")
      .select(
        "id, row_no, txn_date, amount_cents, direction, description, source_category, client_tag, matched_transaction_id, planned_action, planned_category, planned_property_id, planned_building_key, status, applied_ref",
      )
      .eq("organization_id", org.id)
      .eq("batch_id", selectedBatch.id)
      .order("row_no", { ascending: true });
    rows = (rowData ?? []) as ImportRow[];
    const txnIds = [...new Set(rows.map((row) => row.matched_transaction_id).filter(Boolean) as string[])];
    if (txnIds.length > 0) {
      const { data: txnData } = await supabase
        .from("bank_transactions")
        .select("id, posted_on, amount_cents, direction, merchant, description, triage_status")
        .eq("organization_id", org.id)
        .in("id", txnIds);
      txns = new Map(((txnData ?? []) as BankTxnRow[]).map((txn) => [txn.id, txn]));
    }
  }

  const counts = rows.reduce(
    (acc, row) => {
      if (row.status !== "pending") return acc;
      const action = row.planned_action ?? "needs_review";
      if (action === "rule_seed") acc.rule += 1;
      else if (action === "direct_expense") acc.direct += 1;
      else if (action === "rent_link") acc.rent += 1;
      else if (action === "exclude") acc.exclude += 1;
      else acc.review += 1;
      return acc;
    },
    { rule: 0, direct: 0, rent: 0, exclude: 0, review: 0 },
  );
  const applyCount = counts.rule + counts.direct + counts.rent + counts.exclude;
  const notice = banner(searchParams);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        eyebrow="Money"
        title="Import history"
        subtitle="Match FreshBooks history to existing bank transactions, review the plan, then commit only the rows you approve."
        icon={<Icons.page />}
        action={
          <>
            <Link href="/dashboard/money/reconcile" className={SECONDARY_ACTION_CLASS}>
              Reconcile
            </Link>
            <Link href="/dashboard/expenses" className={SECONDARY_ACTION_CLASS}>
              Expenses
            </Link>
          </>
        }
      />

      {notice && (
        <div className="mb-4">
          <StatusChip tone={notice.tone}>{notice.text}</StatusChip>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
              <Icons.page />
            </span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">FreshBooks CSV</h2>
              <p className="mt-1 text-sm text-gray-600">
                Export your transactions from FreshBooks, then upload the CSV here.
              </p>
            </div>
          </div>
          <form action={stageCategorizationImport} className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600">CSV file</span>
              <input
                type="file"
                name="file"
                accept=".csv,text/csv"
                required
                className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700"
              />
            </label>
            <SubmitButton className={`${PRIMARY_ACTION_CLASS} bg-brand`} pendingLabel="Staging...">
              Stage import
            </SubmitButton>
          </form>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Will seed rules" value={counts.rule} icon={<Icons.check />} />
          <StatCard label="Will file directly" value={counts.direct} icon={<Icons.list />} />
          <StatCard label="Need review" value={counts.review} icon={<Icons.page />} />
        </div>
      </div>

      {selectedBatch ? (
        <Card className="mt-6" padded={false}>
          <div className="border-b border-gray-100 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-900">
                    {selectedBatch.filename ?? "FreshBooks import"}
                  </h2>
                  <StatusChip tone={selectedBatch.status === "staged" ? "brand" : statusTone(selectedBatch.status)}>
                    {BATCH_STATUS_LABELS[selectedBatch.status] ?? selectedBatch.status}
                  </StatusChip>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {selectedBatch.source} · {selectedBatch.row_count} row{selectedBatch.row_count === 1 ? "" : "s"} · staged {fmtDate(selectedBatch.created_at)}
                </p>
              </div>
              {selectedBatch.status === "staged" && (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={commitCategorizationImport}>
                    <input type="hidden" name="batch_id" value={selectedBatch.id} />
                    <SubmitButton
                      className={`${PRIMARY_ACTION_CLASS} bg-brand disabled:opacity-50`}
                      pendingLabel="Applying..."
                      disabled={applyCount === 0}
                    >
                      Apply {applyCount} row{applyCount === 1 ? "" : "s"}
                    </SubmitButton>
                  </form>
                  <form action={discardCategorizationImportBatch}>
                    <input type="hidden" name="batch_id" value={selectedBatch.id} />
                    <SubmitButton className={SECONDARY_ACTION_CLASS} pendingLabel="Discarding...">
                      Discard
                    </SubmitButton>
                  </form>
                </div>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-5">
              <StatCard label="Rule seeds" value={counts.rule} />
              <StatCard label="Direct expenses" value={counts.direct} />
              <StatCard label="Rent links" value={counts.rent} />
              <StatCard label="Excluded" value={counts.exclude} />
              <StatCard label="Needs review" value={counts.review} />
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<Icons.list />}
                title="No rows staged"
                description="Upload a FreshBooks CSV to create a review batch."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Source row</th>
                    <th className="px-4 py-3">FreshBooks</th>
                    <th className="px-4 py-3">Bank match</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Override</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => {
                    const matched = row.matched_transaction_id ? txns.get(row.matched_transaction_id) : undefined;
                    const reason = rowReason(row, matched);
                    const action = row.planned_action ?? "needs_review";
                    return (
                      <tr key={row.id} className="align-top">
                        <td className="px-4 py-4 text-gray-500">#{row.row_no ?? "-"}</td>
                        <td className="max-w-xs px-4 py-4">
                          <p className="font-medium text-gray-900">{row.description ?? "Transaction"}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {fmtDate(row.txn_date)} · {row.direction ?? "unknown"} · {formatMoneyCents(row.amount_cents)}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            {row.source_category ?? "No category"}
                            {row.client_tag ? ` · ${row.client_tag}` : ""}
                          </p>
                        </td>
                        <td className="max-w-xs px-4 py-4">
                          {matched ? (
                            <>
                              <p className="font-medium text-gray-900">{matched.merchant ?? matched.description ?? "Bank transaction"}</p>
                              <p className="mt-1 text-xs text-gray-500">
                                {fmtDate(matched.posted_on)} · {matched.direction} · {formatMoneyCents(matched.amount_cents)}
                              </p>
                              <StatusChip tone={matched.triage_status === "pending" ? "success" : "neutral"}>
                                {TRIAGE_STATUS_LABELS[matched.triage_status] ?? matched.triage_status}
                              </StatusChip>
                            </>
                          ) : (
                            <StatusChip tone="warn">unmatched</StatusChip>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div className="space-y-2">
                            <StatusChip tone={actionTone(action)}>
                              {ACTION_LABELS[action] ?? action}
                            </StatusChip>
                            {row.planned_category && (
                              <p className="text-xs text-gray-600">
                                {expenseCategoryLabel(row.planned_category)}
                              </p>
                            )}
                            {row.planned_property_id && (
                              <p className="text-xs text-gray-600">
                                {properties.find((p) => p.id === row.planned_property_id)?.address ?? "Selected rental"}
                              </p>
                            )}
                            {row.status !== "pending" && (
                              <StatusChip tone={statusTone(row.status)}>
                                {ROW_STATUS_LABELS[row.status] ?? row.status}
                              </StatusChip>
                            )}
                            {reason && <p className="max-w-xs text-xs leading-relaxed text-amber-700">{reason}</p>}
                          </div>
                        </td>
                        <td className="min-w-[260px] px-4 py-4">
                          {selectedBatch.status === "staged" && row.status === "pending" ? (
                            <form action={updatePlannedRow} className="space-y-2">
                              <input type="hidden" name="batch_id" value={selectedBatch.id} />
                              <input type="hidden" name="row_id" value={row.id} />
                              <input type="hidden" name="planned_building_key" value="" />
                              <select
                                name="planned_action"
                                defaultValue={action}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                              >
                                <option value="needs_review">Needs review</option>
                                <option value="rule_seed">Seed rule</option>
                                <option value="direct_expense">File expense</option>
                                <option value="rent_link">Link rent</option>
                                <option value="exclude">Exclude</option>
                              </select>
                              <select
                                name="planned_category"
                                defaultValue={row.planned_category ?? ""}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                              >
                                <option value="">No expense category</option>
                                {EXPENSE_CATEGORIES.map((category) => (
                                  <option key={category} value={category}>
                                    {expenseCategoryLabel(category)}
                                  </option>
                                ))}
                              </select>
                              <select
                                name="planned_property_id"
                                defaultValue={row.planned_property_id ?? ""}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                              >
                                <option value="">No rental selected</option>
                                {properties.map((property) => (
                                  <option key={property.id} value={property.id}>
                                    {property.address}
                                  </option>
                                ))}
                              </select>
                              <SubmitButton className={SECONDARY_ACTION_CLASS} pendingLabel="Updating...">
                                Update
                              </SubmitButton>
                            </form>
                          ) : (
                            <p className="text-sm text-gray-500">No changes available.</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={<Icons.page />}
            title="No staged imports"
            description="Upload a FreshBooks CSV to create a review batch. Nothing is filed until you confirm the preview."
          />
        </div>
      )}
    </div>
  );
}
