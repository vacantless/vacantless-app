import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  StatCard,
  SectionHeading,
  EmptyState,
  StatusChip,
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
  type ChipTone,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { getCurrentOrg } from "@/lib/org";
import { planEntitlements } from "@/lib/billing";
import { providerForPlan } from "@/lib/bank-feed";
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "@/lib/expenses";
import {
  bestRuleForTxn,
  type CategorizationRule,
  type MatchableTxn,
} from "@/lib/categorization-rules";
import { formatMoneyCents } from "@/lib/payments";
import { splitAddressUnit } from "@/lib/listing-fill-sheet";
import { PlaidConnectButton } from "./PlaidConnectButton";
import { syncConnection, assignTransaction, ignoreTransaction } from "./actions";
import { importTransactionsFromFile } from "./import-actions";

export const dynamic = "force-dynamic";

// ============================================================================
// Expenses — bank-feed module Slice 2b (S311). The owner connects a bank/card,
// transactions stage here, and the owner triages each debit onto a unit /
// building + category, creating an `expenses` row that rolls up through the
// owner statement. Read-only feed; we never move money. Gated on the bank_feed
// entitlement (Growth+) — Free sees a locked upsell.
// ============================================================================

type ConnRow = {
  id: string;
  provider: string;
  institution_name: string | null;
  status: string;
  last_synced_at: string | null;
  import_format: string | null;
};

type TxnRow = {
  id: string;
  posted_on: string;
  amount_cents: number;
  merchant: string | null;
  description: string | null;
  raw_category: string | null;
  account_name: string | null;
  currency: string;
  merchant_entity_id: string | null;
  stream_id: string | null;
  account_external_id: string | null;
};

type RuleRow = {
  id: string;
  scope_kind: string;
  merchant_entity_id: string | null;
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

type PropertyRef = { id: string; address: string; building_key: string | null };

/** What a matched rule pre-fills on a triage card (and whether to flag it). */
type Suggestion = {
  category: string;
  scope: "unit" | "building" | "none";
  propertyId: string;
  buildingKey: string;
};

function ruleFromRow(r: RuleRow): CategorizationRule {
  return {
    id: r.id,
    scopeKind: r.scope_kind === "stream" ? "stream" : "merchant",
    merchantEntityId: r.merchant_entity_id,
    streamId: r.stream_id,
    merchantNorm: r.merchant_norm,
    accountExternalId: r.account_external_id,
    amountMinCents: r.amount_min_cents,
    amountMaxCents: r.amount_max_cents,
    dayMin: r.day_min,
    dayMax: r.day_max,
    category: r.category,
    propertyId: r.property_id,
    buildingKey: r.building_key,
    lastAppliedAt: r.last_applied_at,
    createdAt: r.created_at,
  };
}

/** The rule-driven pre-fill for one pending transaction, or null if none match. */
function suggestionFor(rules: CategorizationRule[], t: TxnRow): Suggestion | null {
  const matchTxn: MatchableTxn = {
    merchantEntityId: t.merchant_entity_id,
    streamId: t.stream_id,
    merchant: t.merchant,
    accountExternalId: t.account_external_id,
    amountCents: t.amount_cents,
    postedOn: t.posted_on,
  };
  const rule = bestRuleForTxn(rules, matchTxn);
  if (!rule) return null;
  if (rule.propertyId) return { category: rule.category, scope: "unit", propertyId: rule.propertyId, buildingKey: "" };
  if (rule.buildingKey) return { category: rule.category, scope: "building", propertyId: "", buildingKey: rule.buildingKey };
  // Broad merchant→category rule: pre-fill only the category; leave the scope at
  // the default so the owner still picks which unit it belongs to.
  return { category: rule.category, scope: "unit", propertyId: "", buildingKey: "" };
}

function connTone(status: string): ChipTone {
  if (status === "active") return "success";
  if (status === "reauth_required") return "warn";
  if (status === "error") return "danger";
  return "neutral";
}

const IMPORT_ERROR_TEXT: Record<string, string> = {
  nofile: "Choose a file to import first.",
  toobig: "That file is too large. Export a shorter date range and try again.",
  unreadable: "That file couldn't be read. Make sure it's a plain .ofx/.qfx export.",
  unknown_format: "Unsupported file. Upload an OFX or QFX transaction export.",
  csv_unsupported: "CSV import is coming soon — for now, download an OFX/QFX export from your bank.",
  empty: "That file was empty.",
  no_transactions: "No transactions were found in that file.",
  save: "Couldn't save the import. Please try again.",
};

function importErrorText(code: string): string {
  return IMPORT_ERROR_TEXT[code] ?? "That file couldn't be imported. Please check it and try again.";
}

function fmtDate(d: string | null): string {
  if (!d) return "never";
  const [y, m, day] = String(d).slice(0, 10).split("-").map((n) => parseInt(n, 10));
  if (!y) return String(d);
  return new Date(y, m - 1, day).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: {
    synced?: string;
    assigned?: string;
    ignored?: string;
    bank?: string;
    exp?: string;
    imported?: string;
    skipped?: string;
    import?: string;
  };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const provider = providerForPlan(planEntitlements(org.plan));

  // --- Locked (Free / no live feed): upsell, no data load --------------------
  if (provider === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Expenses</h1>
        <p className="mt-1 text-gray-600">Track every property cost automatically from your bank and cards.</p>
        <div className="mt-6">
          <EmptyState
            icon={<Icons.card />}
            title="Bank sync is a Growth feature"
            description="Connect your bank and credit cards to pull every property expense — e-transfers, card payments, pre-authorized debits — and sort them by unit and building. Upgrade to turn it on."
            cta={{ href: "/dashboard/billing", label: "See plans" }}
          />
        </div>
      </div>
    );
  }

  const supabase = createClient();
  const [{ data: connData }, { data: txnData }, { data: propData }, { data: ruleData }, { count: assignedCount }] =
    await Promise.all([
      supabase
        .from("bank_connections")
        .select("id, provider, institution_name, status, last_synced_at, import_format")
        .order("created_at", { ascending: true }),
      supabase
        .from("bank_transactions")
        .select(
          "id, posted_on, amount_cents, merchant, description, raw_category, account_name, currency, merchant_entity_id, stream_id, account_external_id",
        )
        .eq("triage_status", "pending")
        .eq("direction", "debit")
        .order("posted_on", { ascending: false })
        .limit(100),
      supabase.from("properties").select("id, address, building_key"),
      supabase
        .from("categorization_rules")
        .select(
          "id, scope_kind, merchant_entity_id, stream_id, merchant_norm, account_external_id, amount_min_cents, amount_max_cents, day_min, day_max, category, property_id, building_key, last_applied_at, created_at",
        ),
      supabase
        .from("bank_transactions")
        .select("id", { count: "exact", head: true })
        .eq("triage_status", "assigned"),
    ]);

  const connections = (connData ?? []) as ConnRow[];
  const pending = (txnData ?? []) as TxnRow[];
  const properties = (propData ?? []) as PropertyRef[];
  const rules = ((ruleData ?? []) as RuleRow[]).map(ruleFromRow);

  // Building options (street label per building_key), like the maintenance form.
  const buildingLabels = new Map<string, string>();
  for (const p of properties) {
    if (!p.building_key) continue;
    if (!buildingLabels.has(p.building_key)) {
      buildingLabels.set(p.building_key, splitAddressUnit(p.address).street ?? p.address);
    }
  }
  const buildingOptions = [...buildingLabels.entries()].map(([key, label]) => ({ key, label }));

  const banner = (() => {
    if (searchParams.synced != null) {
      const n = parseInt(searchParams.synced, 10) || 0;
      return { tone: "success" as const, text: n > 0 ? `Synced ${n} new transaction${n === 1 ? "" : "s"}.` : "Up to date — no new transactions." };
    }
    if (searchParams.assigned) return { tone: "success" as const, text: "Expense logged." };
    if (searchParams.ignored) return { tone: "neutral" as const, text: "Transaction ignored." };
    if (searchParams.imported != null) {
      const n = parseInt(searchParams.imported, 10) || 0;
      const sk = parseInt(searchParams.skipped ?? "0", 10) || 0;
      if (n > 0) {
        return {
          tone: "success" as const,
          text: `Imported ${n} new transaction${n === 1 ? "" : "s"}${sk > 0 ? ` (${sk} already imported)` : ""}.`,
        };
      }
      return {
        tone: "neutral" as const,
        text: sk > 0 ? `No new transactions — all ${sk} were already imported.` : "No transactions found in that file.",
      };
    }
    if (searchParams.import) return { tone: "danger" as const, text: importErrorText(searchParams.import) };
    if (searchParams.bank === "forbidden") return { tone: "danger" as const, text: "You don't have permission to manage bank sync." };
    if (searchParams.bank === "locked") return { tone: "danger" as const, text: "Bank sync isn't available on your plan." };
    if (searchParams.bank) return { tone: "danger" as const, text: "That transaction or connection could not be found." };
    if (searchParams.exp) return { tone: "danger" as const, text: "Could not log the expense — please check the fields." };
    return null;
  })();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Expenses</h1>
          <p className="mt-1 text-gray-600">Pull property costs from your bank and sort them by unit and building.</p>
        </div>
        <Link href="/dashboard/rent/statement" className={SECONDARY_ACTION_CLASS}>
          Owner statement
        </Link>
      </div>

      {banner && (
        <div className="mt-4">
          <StatusChip tone={banner.tone}>{banner.text}</StatusChip>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Connected banks" value={connections.length} icon={<Icons.card />} />
        <StatCard label="To review" value={pending.length} icon={<Icons.list />} />
        <StatCard label="Logged from bank" value={assignedCount ?? 0} icon={<Icons.chart />} />
      </div>

      {/* --- Connections ------------------------------------------------------ */}
      <div className="mt-8">
        <SectionHeading>Connected accounts</SectionHeading>
        <Card>
          {connections.length === 0 ? (
            <p className="text-sm text-gray-600">
              No banks connected yet. Connect your bank and credit cards to start importing property expenses.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {connections.map((c) => {
                const isImported = c.provider === "csv";
                return (
                <li key={c.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-gray-900">{c.institution_name ?? "Bank"}</p>
                    <p className="text-xs text-gray-500">
                      {isImported
                        ? `Imported${c.import_format ? ` from ${c.import_format.toUpperCase()}` : ""} · last import ${fmtDate(c.last_synced_at)}`
                        : `Last synced ${fmtDate(c.last_synced_at)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {isImported ? (
                      <StatusChip tone="neutral">imported</StatusChip>
                    ) : (
                      <>
                        <StatusChip tone={connTone(c.status)}>{c.status.replace("_", " ")}</StatusChip>
                        <form action={syncConnection}>
                          <input type="hidden" name="connection_id" value={c.id} />
                          <SubmitButton className={SECONDARY_ACTION_CLASS} pendingLabel="Syncing…">
                            Sync now
                          </SubmitButton>
                        </form>
                      </>
                    )}
                  </div>
                </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4">
            <PlaidConnectButton className={PRIMARY_ACTION_CLASS} />
          </div>

          {/* Import from a file — for cards the live feed can't connect (e.g. MBNA).
              Download an OFX/QFX export from your bank and drop it here; re-importing
              an overlapping range only adds genuinely new transactions. */}
          <div className="mt-6 border-t border-gray-100 pt-4">
            <p className="text-sm font-medium text-gray-900">Import from a file</p>
            <p className="mt-1 text-xs text-gray-500">
              Bank or card not in the list above? Download an OFX/QFX transaction export from your bank and import it here.
            </p>
            <form action={importTransactionsFromFile} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="text-sm">
                <span className="mb-1 block text-gray-600">File (.ofx / .qfx)</span>
                <input
                  type="file"
                  name="file"
                  accept=".ofx,.qfx"
                  required
                  className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700"
                />
              </label>
              <label className="text-sm sm:flex-1">
                <span className="mb-1 block text-gray-600">Account label (optional)</span>
                <input
                  type="text"
                  name="account_label"
                  placeholder="e.g. MBNA Mastercard"
                  maxLength={80}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </label>
              <SubmitButton className={SECONDARY_ACTION_CLASS} pendingLabel="Importing…">
                Import file
              </SubmitButton>
            </form>
          </div>
        </Card>
      </div>

      {/* --- Triage ----------------------------------------------------------- */}
      <div className="mt-8">
        <SectionHeading>To review</SectionHeading>
        {pending.length === 0 ? (
          <EmptyState
            icon={<Icons.check />}
            title="Nothing to review"
            description="New debit transactions from your connected banks will appear here for you to sort into expenses."
          />
        ) : (
          <div className="space-y-3">
            {pending.map((t) => {
              const sug = suggestionFor(rules, t);
              return (
              <Card key={t.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{t.merchant ?? t.description ?? "Transaction"}</p>
                    <p className="text-xs text-gray-500">
                      {fmtDate(t.posted_on)}
                      {t.account_name ? ` · ${t.account_name}` : ""}
                      {t.raw_category ? ` · ${t.raw_category}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-lg font-semibold text-gray-900">
                    {formatMoneyCents(t.amount_cents)}
                    {t.currency && t.currency !== "CAD" ? ` ${t.currency}` : ""}
                  </p>
                </div>

                {sug && (
                  <p
                    className="mt-3 inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-gray-200"
                    style={{ color: "var(--brand-color)" }}
                  >
                    Pre-filled from a rule you saved — confirm or change it
                  </p>
                )}

                <form action={assignTransaction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <input type="hidden" name="transaction_id" value={t.id} />
                  <label className="text-sm">
                    <span className="mb-1 block text-gray-600">For</span>
                    <select name="scope" defaultValue={sug?.scope ?? "unit"} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                      <option value="unit">A unit</option>
                      <option value="building">Whole building</option>
                      <option value="none">Not unit-specific</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-gray-600">Unit</span>
                    <select name="property_id" defaultValue={sug?.propertyId ?? ""} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                      <option value="">—</option>
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>{p.address}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-gray-600">Building</span>
                    <select name="building_key" defaultValue={sug?.buildingKey ?? ""} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                      <option value="">—</option>
                      {buildingOptions.map((b) => (
                        <option key={b.key} value={b.key}>{b.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-gray-600">Category</span>
                    <select name="category" defaultValue={sug?.category ?? "other"} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{expenseCategoryLabel(c)}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-4">
                    <SubmitButton className={PRIMARY_ACTION_CLASS} pendingLabel="Saving…">
                      Log expense
                    </SubmitButton>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" name="remember" value="1" className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand" />
                      Remember this — auto-sort future {t.merchant ? t.merchant : "matching"} charges
                    </label>
                  </div>
                </form>

                <form action={ignoreTransaction} className="mt-2">
                  <input type="hidden" name="transaction_id" value={t.id} />
                  <SubmitButton className="text-sm text-gray-500 underline" pendingLabel="…">
                    Ignore
                  </SubmitButton>
                </form>
              </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
