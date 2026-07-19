// Unit tests for the pure Premium reconciliation spine. Run:
// npx tsx scripts/test-reconciliation.ts
import { filterNewTransactions, type NormalizedTxn } from "../lib/bank-feed";
import { hasEntitlement } from "../lib/billing";
import {
  buildReconciliationSummary,
  deriveReconciliationState,
  expenseMatchCandidateForTransaction,
  isReimportNoop,
  rentMatchCandidatesForTransaction,
  type BankTransactionForReconciliation,
} from "../lib/reconciliation";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function txn(
  id: string,
  overrides: Partial<BankTransactionForReconciliation> = {},
): BankTransactionForReconciliation {
  return {
    id,
    accountExternalId: "acc-1",
    accountName: "Operating",
    postedOn: "2026-07-01",
    amountCents: 10000,
    direction: "debit",
    merchant: "Test",
    description: null,
    currency: "CAD",
    triageStatus: "pending",
    expenseId: null,
    ...overrides,
  };
}

// --- Premium accounting gate -------------------------------------------------
ok("premium has accounting entitlement", hasEntitlement("premium", "accounting") === true);
ok("growth keeps accounting locked", hasEntitlement("growth", "accounting") === false);
ok("free keeps accounting locked", hasEntitlement("free", "accounting") === false);

// --- state derivation --------------------------------------------------------
{
  const state = deriveReconciliationState(txn("t1", { expenseId: "exp-1" }));
  ok("debit with expense_id is reconciled expense", state.kind === "expense" && state.reconciled);
}
{
  const state = deriveReconciliationState(
    txn("t2", { direction: "credit" }),
    {
      rentPaymentsByTransactionId: new Map([
        ["t2", [{ id: "rent-1", bankTransactionId: "t2", tenancyId: "ten-1", amountCents: 10000, label: "Unit 1" }]],
      ]),
    },
  );
  ok("credit with rent payment link is reconciled rent", state.kind === "rent" && state.rentPaymentIds[0] === "rent-1");
}
{
  const state = deriveReconciliationState(txn("t3", { triageStatus: "excluded" }));
  ok("excluded status is reconciled with no P&L link", state.kind === "excluded" && state.reconciled);
}
{
  const state = deriveReconciliationState(txn("t4", { triageStatus: "assigned", expenseId: null }));
  ok("assigned without an actual ledger link is still unreconciled", state.kind === "unreconciled");
}

// --- book balance + unreconciled aggregation --------------------------------
{
  const summary = buildReconciliationSummary(
    [
      txn("a", { postedOn: "2026-07-01", amountCents: 200000, direction: "credit" }),
      txn("b", { postedOn: "2026-07-02", amountCents: 35000, direction: "debit", expenseId: "exp-1" }),
      txn("c", { postedOn: "2026-07-03", amountCents: 12000, direction: "debit" }),
      txn("d", {
        postedOn: "2026-07-04",
        amountCents: 5000,
        direction: "credit",
        accountExternalId: "acc-2",
        accountName: "Savings",
        triageStatus: "ignored",
      }),
    ],
    {
      expenses: [{ id: "exp-1", bankTransactionId: "b", category: "utilities" }],
      rentPayments: [{ id: "rent-1", bankTransactionId: "a", tenancyId: "ten-1", amountCents: 200000, label: "Unit 1" }],
    },
  );
  ok("summary has two accounts", summary.accounts.length === 2);
  ok("total book balance is credits minus debits", summary.totalBalanceCents === 200000 - 35000 - 12000 + 5000);
  ok("unreconciled count totals only unmatched rows", summary.unreconciledCount === 1);
  ok("unreconciled dollars sum absolute transaction amounts", summary.unreconciledCents === 12000);
  const operating = summary.accounts.find((a) => a.key === "external:acc-1")!;
  ok("account balance tracks running bank balance", operating.balanceCents === 200000 - 35000 - 12000);
  ok("newest transaction still carries chronological running balance", operating.transactions[0].id === "c" && operating.transactions[0].runningBalanceCents === operating.balanceCents);
}

// --- debit/credit match candidacy -------------------------------------------
{
  const debit = expenseMatchCandidateForTransaction(txn("debit"), {
    category: "utilities",
    propertyId: "prop-1",
  });
  ok("debit can become an expense candidate from a rule", debit?.category === "utilities" && debit.propertyId === "prop-1");
  ok("debit expense candidate falls back to other", expenseMatchCandidateForTransaction(txn("fallback"))?.category === "other");
  ok("credits are never expense candidates", expenseMatchCandidateForTransaction(txn("credit", { direction: "credit" })) === null);

  const candidates = rentMatchCandidatesForTransaction(
    txn("rent", { direction: "credit", amountCents: 250000 }),
    [
      { tenancyId: "a", rentCents: 250000, label: "1A" },
      { tenancyId: "b", rentCents: 251000, label: "1B" },
      { tenancyId: "c", rentCents: 310000, label: "1C" },
      { tenancyId: "d", rentCents: null, label: "1D" },
    ],
  );
  ok("rent candidates include exact and near matches only", candidates.length === 2);
  ok("rent candidates sort exact first", candidates[0].tenancyId === "a" && candidates[0].confidence === "exact");
  ok("debits are never rent candidates", rentMatchCandidatesForTransaction(txn("debit"), [{ tenancyId: "a", rentCents: 10000 }]).length === 0);
}

// --- re-import idempotency ---------------------------------------------------
function normalized(id: string): NormalizedTxn {
  return {
    externalId: id,
    accountExternalId: "acc-1",
    accountName: "Operating",
    postedOn: "2026-07-01",
    amountCents: 10000,
    direction: "debit",
    merchant: "Hydro",
    description: null,
    rawCategory: null,
    currency: "CAD",
    merchantEntityId: null,
    streamId: null,
  };
}
{
  const pulled = [normalized("one"), normalized("two")];
  const existing = new Set(["one", "two"]);
  ok("pure reconciliation idempotency helper sees a no-op import", isReimportNoop(pulled, existing));
  ok("bank-feed dedupe returns no fresh rows on re-import", filterNewTransactions(pulled, existing).length === 0);
  ok("new external id makes import non-noop", !isReimportNoop([...pulled, normalized("three")], existing));
}

console.log(`\nreconciliation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
