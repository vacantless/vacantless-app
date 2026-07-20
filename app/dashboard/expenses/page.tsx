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
import { canUseCaptureEmailIn, planEntitlements } from "@/lib/billing";
import { providerForPlan, txnDetailLine } from "@/lib/bank-feed";
import { DEFAULT_INGEST_DOMAIN, ingestAddressFromToken } from "@/lib/email-ingest";
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "@/lib/expenses";
import {
  bestRuleForTxn,
  type CategorizationRule,
  type MatchableTxn,
} from "@/lib/categorization-rules";
import { formatMoneyCents } from "@/lib/payments";
import { isRentFromBankEnabled, prefillRentSplit, rentFromBankErrorMessage } from "@/lib/rent-from-bank";
import { classifyCredit, railPaymentLinkCandidatesForTransaction } from "@/lib/rent-classify";
import { splitAddressUnit } from "@/lib/listing-fill-sheet";
import { CopyTextButton } from "@/components/copy-text-button";
import { PlaidConnectButton } from "./PlaidConnectButton";
import {
  syncConnection,
  assignTransaction,
  ignoreTransaction,
  ignoreAllPending,
  recordRentFromTransaction,
  linkRailRentPaymentToTransaction,
  applyRulesToQueue,
  confirmEtransferRent,
  confirmEtransferExpense,
  dismissEtransferCapture,
} from "./actions";
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
type ActiveTenancy = { id: string; rentCents: number | null; label: string };
type RailRentPaymentRow = {
  id: string;
  tenancy_id: string | null;
  amount_cents: number;
  period_month: string | null;
  source: string | null;
  bank_transaction_id: string | null;
};
type EtransferCaptureRow = {
  id: string;
  direction: "received" | "sent";
  counterparty_name: string;
  amount_cents: number;
  txn_date: string;
  suggested_tenancy_id: string | null;
  suggested_category: string | null;
  suggested_property_id: string | null;
  suggested_building_key: string | null;
  created_at: string;
};

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
    swept?: string;
    ignored?: string;
    ignored_bulk?: string;
    bank?: string;
    exp?: string;
    imported?: string;
    skipped?: string;
    import?: string;
    rent?: string;
    etransfer?: string;
  };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const provider = providerForPlan(planEntitlements(org.plan));
  const emailCaptureAllowed = canUseCaptureEmailIn(org.plan);

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
            description="Connect your bank and cards, and forward Interac e-Transfer notices for rent or trade payments, then sort everything by unit and building. Upgrade to turn it on."
            cta={{ href: "/dashboard/billing", label: "See plans" }}
          />
        </div>
      </div>
    );
  }

  const supabase = createClient();
  const [
    { data: connData },
    { data: txnData },
    { data: propData },
    { data: ruleData },
    { count: assignedCount },
    { count: pendingTotal },
  ] = await Promise.all([
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
      // True count of ALL pending debits (the visible list is capped at 100) so
      // the bulk-ignore control can tell the operator when more lines exist
      // beyond the ones on screen (S433b P2).
      supabase
        .from("bank_transactions")
        .select("id", { count: "exact", head: true })
        .eq("triage_status", "pending")
        .eq("direction", "debit"),
    ]);

  const connections = (connData ?? []) as ConnRow[];
  const pending = (txnData ?? []) as TxnRow[];
  const pendingBeyondView = Math.max(0, (pendingTotal ?? 0) - pending.length);
  const properties = (propData ?? []) as PropertyRef[];
  const rules = ((ruleData ?? []) as RuleRow[]).map(ruleFromRow);

  const rentFromBank = isRentFromBankEnabled();
  let activeTenancies: ActiveTenancy[] = [];
  if (rentFromBank || emailCaptureAllowed) {
    const { data: tenData } = await supabase
      .from("tenancies")
      .select("id, rent_cents, property_id, properties(address), tenants(name, is_primary)")
      .eq("status", "active");
    const propAddr = new Map(properties.map((p) => [p.id, p.address]));
    type TenRow = {
      id: string;
      rent_cents: number | null;
      property_id: string;
      properties: { address: string } | { address: string }[] | null;
      tenants: { name: string; is_primary: boolean }[] | null;
    };
    activeTenancies = ((tenData ?? []) as unknown as TenRow[]).map((t) => {
      const propJoin = Array.isArray(t.properties) ? t.properties[0] : t.properties;
      const address = propJoin?.address ?? propAddr.get(t.property_id) ?? "Unit";
      const tenants = t.tenants ?? [];
      const primary = tenants.find((x) => x.is_primary) ?? tenants[0] ?? null;
      const unit = splitAddressUnit(address).unit ?? address;
      const label = primary?.name ? `${unit} · ${primary.name}` : unit;
      return { id: t.id, rentCents: t.rent_cents, label };
    });
  }

  let etransferCaptures: EtransferCaptureRow[] = [];
  let ingestAddress: string | null = null;
  if (emailCaptureAllowed) {
    const [{ data: captureData }, { data: addr }] = await Promise.all([
      supabase
        .from("etransfer_captures")
        .select(
          "id, direction, counterparty_name, amount_cents, txn_date, suggested_tenancy_id, suggested_category, suggested_property_id, suggested_building_key, created_at",
        )
        .eq("organization_id", org.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("org_ingest_addresses")
        .select("token")
        .eq("organization_id", org.id)
        .eq("channel", "email")
        .eq("active", true)
        .maybeSingle(),
    ]);
    etransferCaptures = (captureData ?? []) as EtransferCaptureRow[];
    if (addr?.token) {
      ingestAddress = ingestAddressFromToken(
        addr.token,
        process.env.INGEST_EMAIL_DOMAIN || DEFAULT_INGEST_DOMAIN,
      );
    }
  }

  // --- "Is any of this rent?" — money-in lane (dark behind RENT_FROM_BANK) ----
  // The import stores incoming money as credits but the triage above only shows
  // debits, so a rent deposit had no path to "Rent collected". Here the owner
  // splits a credit across active tenancies into rent_payments the statement sums.
  let credits: TxnRow[] = [];
  let railRentPayments: RailRentPaymentRow[] = [];
  if (rentFromBank) {
    const [{ data: creditData }, { data: railPaymentData }] = await Promise.all([
      supabase
        .from("bank_transactions")
        .select(
          "id, posted_on, amount_cents, merchant, description, raw_category, account_name, currency, merchant_entity_id, stream_id, account_external_id",
        )
        .eq("triage_status", "pending")
        .eq("direction", "credit")
        .order("posted_on", { ascending: false })
        .limit(100),
      supabase
        .from("rent_payments")
        .select("id, tenancy_id, amount_cents, period_month, source, bank_transaction_id")
        .eq("organization_id", org.id)
        .in("source", ["stripe", "rotessa"])
        .is("bank_transaction_id", null),
    ]);
    credits = (creditData ?? []) as TxnRow[];
    railRentPayments = (railPaymentData ?? []) as RailRentPaymentRow[];
  }

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
    if (searchParams.assigned) {
      const n = parseInt(searchParams.swept ?? "0", 10) || 0;
      return {
        tone: "success" as const,
        text:
          n > 0
            ? `Expense logged — and filed ${n} more matching line${n === 1 ? "" : "s"} automatically.`
            : "Expense logged.",
      };
    }
    if (searchParams.swept != null) {
      const n = parseInt(searchParams.swept, 10) || 0;
      return {
        tone: n > 0 ? ("success" as const) : ("neutral" as const),
        text:
          n > 0
            ? `Filed ${n} matching line${n === 1 ? "" : "s"} from your saved rules.`
            : "No lines in the queue matched a saved rule.",
      };
    }
    if (searchParams.ignored) return { tone: "neutral" as const, text: "Transaction ignored." };
    if (searchParams.ignored_bulk != null) {
      const n = parseInt(searchParams.ignored_bulk, 10) || 0;
      return {
        tone: "neutral" as const,
        text: n > 0 ? `Ignored ${n} remaining line${n === 1 ? "" : "s"}.` : "No lines left to ignore.",
      };
    }
    if (searchParams.rent != null) {
      if (searchParams.rent === "linked") {
        return { tone: "success" as const, text: "Bank deposit linked to the existing rent payment." };
      }
      const n = parseInt(searchParams.rent, 10);
      if (Number.isFinite(n) && n > 0) {
        return { tone: "success" as const, text: `Rent recorded across ${n} tenanc${n === 1 ? "y" : "ies"}.` };
      }
      const msg = rentFromBankErrorMessage(searchParams.rent);
      return { tone: "danger" as const, text: msg ?? "Could not record the rent." };
    }
    if (searchParams.etransfer != null) {
      if (searchParams.etransfer === "rent") {
        return { tone: "success" as const, text: "Captured e-Transfer recorded as rent." };
      }
      if (searchParams.etransfer === "expense") {
        return { tone: "success" as const, text: "Captured e-Transfer logged as an expense." };
      }
      if (searchParams.etransfer === "dismissed") {
        return { tone: "neutral" as const, text: "Captured e-Transfer dismissed." };
      }
      if (searchParams.etransfer === "locked") {
        return { tone: "danger" as const, text: "Email-in capture is not available on this plan." };
      }
      if (searchParams.etransfer === "forbidden") {
        return { tone: "danger" as const, text: "You do not have permission to file captured e-Transfers." };
      }
      if (searchParams.etransfer === "gone") {
        return { tone: "warn" as const, text: "That captured e-Transfer was already handled." };
      }
      return { tone: "danger" as const, text: "Could not file that captured e-Transfer." };
    }
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

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Connected banks" value={connections.length} icon={<Icons.card />} />
        <StatCard label="To review" value={pending.length} icon={<Icons.list />} />
        <StatCard label="Captured e-Transfers" value={emailCaptureAllowed ? etransferCaptures.length : 0} icon={<Icons.mail />} />
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
            <PlaidConnectButton className={`${PRIMARY_ACTION_CLASS} bg-brand`} />
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

      {/* --- Money in: is any of this rent? (dark behind RENT_FROM_BANK) ------- */}
      {rentFromBank && credits.length > 0 && (
        <div className="mt-8">
          <SectionHeading>Money in — is any of this rent?</SectionHeading>
          <p className="mb-3 text-sm text-gray-600">
            Deposits from your bank. Record one as rent to count it on your owner statement — split it across the
            tenancies it covers. Vacantless never moves money; it only records what already landed.
          </p>
          {activeTenancies.length === 0 ? (
            <EmptyState
              icon={<Icons.list />}
              title="No active tenancies yet"
              description="Add an active tenancy first, then you can record a deposit as rent against it."
            />
          ) : (
            <div className="space-y-3">
              {credits.map((c) => {
                const rentTenancies = activeTenancies.map((t) => ({
                  tenancyId: t.id,
                  rentCents: t.rentCents,
                  label: t.label,
                }));
                const creditForClassify = {
                  amountCents: c.amount_cents,
                  postedOn: c.posted_on,
                  description: c.description,
                  source: [c.merchant, c.raw_category].filter(Boolean).join(" "),
                };
                const classification = classifyCredit(creditForClassify, rentTenancies);
                const railLinks = railPaymentLinkCandidatesForTransaction(
                  creditForClassify,
                  rentTenancies,
                  railRentPayments.map((payment) => ({
                    id: payment.id,
                    tenancyId: payment.tenancy_id,
                    amountCents: payment.amount_cents,
                    periodMonth: payment.period_month,
                    source: payment.source,
                    bankTransactionId: payment.bank_transaction_id,
                  })),
                );
                const prefill = new Map<string, number>();
                if (classification.suggestRent && classification.amountCandidates[0]) {
                  const best = classification.amountCandidates[0];
                  prefillRentSplit(c.amount_cents, [
                    { tenancyId: best.tenancyId, rentCents: best.rentCents },
                  ]).forEach((a) => prefill.set(a.tenancyId, a.amountCents));
                }
                const hint = (() => {
                  if (classification.classification === "rail") {
                    return railLinks.length > 0
                      ? "This looks like a Stripe or Rotessa deposit that is already in the rent ledger. Link it instead of recording rent again."
                      : "This looks like a Stripe or Rotessa deposit. No matching unlinked rent payment was found; leave the fields blank unless it is not already recorded.";
                  }
                  if (classification.classification === "possible_offcycle") {
                    return "Possible off-cycle rent payment. The amounts are blank so you can decide what to record.";
                  }
                  if (classification.classification === "likely_rent") {
                    return "Likely rent payment. Review the suggested amount before recording.";
                  }
                  return null;
                })();
                return (
                  <Card key={c.id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{c.merchant ?? c.description ?? "Deposit"}</p>
                        {txnDetailLine(c.merchant, c.description) && (
                          <p className="text-sm text-gray-700">{txnDetailLine(c.merchant, c.description)}</p>
                        )}
                        <p className="text-xs text-gray-500">
                          {fmtDate(c.posted_on)}
                          {c.account_name ? ` · ${c.account_name}` : ""}
                          {c.raw_category ? ` · ${c.raw_category}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 text-lg font-semibold text-emerald-700">
                        + {formatMoneyCents(c.amount_cents)}
                        {c.currency && c.currency !== "CAD" ? ` ${c.currency}` : ""}
                      </p>
                    </div>

                    {hint && <p className="mt-3 text-sm text-gray-600">{hint}</p>}

                    {railLinks.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        {railLinks.map((link) => (
                          <form key={link.paymentId} action={linkRailRentPaymentToTransaction}>
                            <input type="hidden" name="transaction_id" value={c.id} />
                            <input type="hidden" name="rent_payment_id" value={link.paymentId} />
                            <SubmitButton className={SECONDARY_ACTION_CLASS} pendingLabel="Linking…">
                              Link existing {link.source} rent payment for {link.label}
                            </SubmitButton>
                          </form>
                        ))}
                      </div>
                    ) : (
                      <form action={recordRentFromTransaction} className="mt-4">
                        <input type="hidden" name="transaction_id" value={c.id} />
                        <p className="mb-2 text-sm text-gray-600">Rent for each tenancy (edit or clear any that don&apos;t apply):</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {activeTenancies.map((t) => {
                            const cents = prefill.get(t.id) ?? 0;
                            return (
                              <label key={t.id} className="text-sm">
                                <span className="mb-1 block text-gray-600">{t.label}</span>
                                <div className="flex items-center gap-1">
                                  <span className="text-gray-400">$</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    name={`alloc_${t.id}`}
                                    defaultValue={cents > 0 ? (cents / 100).toFixed(2) : ""}
                                    placeholder="0.00"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                  />
                                </div>
                              </label>
                            );
                          })}
                        </div>
                        <div className="mt-4">
                          <SubmitButton className={`${PRIMARY_ACTION_CLASS} bg-brand`} pendingLabel="Recording…">
                            Record as rent
                          </SubmitButton>
                        </div>
                      </form>
                    )}

                    <form action={ignoreTransaction} className="mt-2">
                      <input type="hidden" name="transaction_id" value={c.id} />
                      <SubmitButton className="text-sm text-gray-500 underline" pendingLabel="…">
                        Not rent
                      </SubmitButton>
                    </form>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* --- Captured e-Transfers ------------------------------------------- */}
      {emailCaptureAllowed && (
        <div className="mt-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <SectionHeading>Captured e-Transfers</SectionHeading>
            {ingestAddress ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>Forward notices to</span>
                <code className="rounded bg-gray-50 px-2 py-1 text-gray-700">{ingestAddress}</code>
                <CopyTextButton value={ingestAddress} />
              </div>
            ) : (
              <Link href="/dashboard/captures" className={SECONDARY_ACTION_CLASS}>
                Set up forwarding
              </Link>
            )}
          </div>
          <p className="mb-3 mt-1 text-sm text-gray-600">
            Forward Interac notices from a verified sender. Vacantless queues a suggestion here; it never records rent or expenses until you confirm.
          </p>
          {!ingestAddress ? (
            <EmptyState
              icon={<Icons.mail />}
              title="Set up your forwarding address"
              description="Generate your private capture address and confirm the email address you forward from before e-Transfers can land here."
              cta={{ href: "/dashboard/captures", label: "Open capture setup" }}
            />
          ) : etransferCaptures.length === 0 ? (
            <EmptyState
              icon={<Icons.check />}
              title="No captured e-Transfers waiting"
              description="Received rent notices and sent trade-payment notices will appear here for you to confirm or dismiss."
            />
          ) : (
            <div className="space-y-3">
              {etransferCaptures.map((capture) => {
                const isReceived = capture.direction === "received";
                return (
                  <Card key={capture.id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-gray-900">
                            {isReceived ? "Money received" : "Payment sent"} - {capture.counterparty_name}
                          </p>
                          <StatusChip tone={isReceived ? "success" : "brand"}>
                            {isReceived ? "Rent suggestion" : "Expense suggestion"}
                          </StatusChip>
                        </div>
                        <p className="mt-1 text-sm text-gray-700">
                          {fmtDate(capture.txn_date)} - {formatMoneyCents(capture.amount_cents)}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Parsed from a forwarded Interac notice. Raw email body was discarded.
                        </p>
                      </div>
                    </div>

                    {isReceived ? (
                      activeTenancies.length === 0 ? (
                        <p className="mt-3 text-sm text-gray-600">
                          Add an active tenancy before recording this as rent.
                        </p>
                      ) : (
                        <form action={confirmEtransferRent} className="mt-4 flex flex-wrap items-end gap-3">
                          <input type="hidden" name="capture_id" value={capture.id} />
                          <label className="text-sm">
                            <span className="mb-1 block text-gray-600">Record rent for</span>
                            <select
                              name="tenancy_id"
                              required
                              defaultValue={capture.suggested_tenancy_id ?? ""}
                              className="min-w-56 rounded-lg border border-gray-300 px-3 py-2"
                            >
                              <option value="" disabled>
                                Choose tenancy...
                              </option>
                              {activeTenancies.map((tenancy) => (
                                <option key={tenancy.id} value={tenancy.id}>
                                  {tenancy.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <SubmitButton className={`${PRIMARY_ACTION_CLASS} bg-brand`} pendingLabel="Recording...">
                            Record as rent
                          </SubmitButton>
                        </form>
                      )
                    ) : (
                      <form action={confirmEtransferExpense} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
                        <input type="hidden" name="capture_id" value={capture.id} />
                        <label className="text-sm">
                          <span className="mb-1 block text-gray-600">Category</span>
                          <select
                            name="category"
                            required
                            defaultValue={capture.suggested_category ?? ""}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2"
                          >
                            <option value="" disabled>
                              Choose...
                            </option>
                            {EXPENSE_CATEGORIES.map((category) => (
                              <option key={category} value={category}>
                                {expenseCategoryLabel(category)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-sm">
                          <span className="mb-1 block text-gray-600">Unit</span>
                          <select
                            name="property_id"
                            defaultValue={capture.suggested_property_id ?? ""}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2"
                          >
                            <option value="">-</option>
                            {properties.map((property) => (
                              <option key={property.id} value={property.id}>
                                {property.address}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-sm">
                          <span className="mb-1 block text-gray-600">Building</span>
                          <select
                            name="building_key"
                            defaultValue={capture.suggested_building_key ?? ""}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2"
                          >
                            <option value="">-</option>
                            {buildingOptions.map((building) => (
                              <option key={building.key} value={building.key}>
                                {building.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="flex items-end">
                          <SubmitButton className={`${PRIMARY_ACTION_CLASS} bg-brand`} pendingLabel="Logging...">
                            Log expense
                          </SubmitButton>
                        </div>
                        {capture.suggested_category && (
                          <p className="text-xs text-gray-500 sm:col-span-4">
                            Pre-filled from a saved payee rule. Confirm or change it before logging.
                          </p>
                        )}
                      </form>
                    )}

                    <form action={dismissEtransferCapture} className="mt-2">
                      <input type="hidden" name="capture_id" value={capture.id} />
                      <SubmitButton className="text-sm text-gray-500 underline" pendingLabel="...">
                        Dismiss
                      </SubmitButton>
                    </form>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* --- Triage ----------------------------------------------------------- */}
      <div className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading>To review</SectionHeading>
          {pending.length > 0 && rules.length > 0 && (
            <form action={applyRulesToQueue}>
              <SubmitButton className={SECONDARY_ACTION_CLASS} pendingLabel="Sorting…">
                Apply saved rules
              </SubmitButton>
            </form>
          )}
        </div>
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
                    {txnDetailLine(t.merchant, t.description) && (
                      <p className="text-sm text-gray-700">{txnDetailLine(t.merchant, t.description)}</p>
                    )}
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
                    <SubmitButton className={`${PRIMARY_ACTION_CLASS} bg-brand`} pendingLabel="Saving…">
                      Log expense
                    </SubmitButton>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" name="remember" value="1" className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand" />
                      Remember this — auto-sort matching {t.merchant ? t.merchant : ""} charges, now and going forward
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
            {/* Bulk-ignore the personal remainder of a commingled import (S433).
                Placed AFTER the list so the operator files real property costs
                first; "ignore" is a soft status, so nothing is deleted. The form
                submits the VISIBLE line IDs, and the action ignores ONLY those —
                it never clears a pending line the operator couldn't see on screen
                (S433b P2). When more lines exist beyond the first 100, we say so;
                clearing this page reveals the next batch to sort. */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500">
                Imported a personal account too? Sort the property costs above, then clear the rest in one step.
                {pendingBeyondView > 0
                  ? ` Showing the ${pending.length} most recent — ${pendingBeyondView} older line${pendingBeyondView === 1 ? "" : "s"} will appear after you clear these.`
                  : ""}
              </p>
              <form action={ignoreAllPending}>
                {pending.map((t) => (
                  <input key={t.id} type="hidden" name="ids" value={t.id} />
                ))}
                <SubmitButton className="shrink-0 text-sm font-medium text-gray-600 underline" pendingLabel="Ignoring…">
                  Ignore these {pending.length}
                </SubmitButton>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
