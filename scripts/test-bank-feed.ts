// Unit tests for the pure bank-feed seam. Run: npx tsx scripts/test-bank-feed.ts
import {
  providerForPlan,
  hasLiveBankFeed,
  normalizeAmount,
  isExpenseCandidate,
  dedupeKey,
  filterNewTransactions,
  type NormalizedTxn,
} from "../lib/bank-feed";
import { PLAN_ENTITLEMENTS } from "../lib/billing";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Provider routing off the real entitlements matrix ----------------------
// Premium (accounting) -> Flinks; Growth (bank_feed) -> Plaid; Free/trial -> none.
ok("premium -> flinks", providerForPlan(PLAN_ENTITLEMENTS.premium) === "flinks");
ok("growth -> plaid", providerForPlan(PLAN_ENTITLEMENTS.growth) === "plaid");
ok("free -> none", providerForPlan(PLAN_ENTITLEMENTS.free) === null);
ok("trial -> none", providerForPlan(PLAN_ENTITLEMENTS.trial) === null);

// accounting wins over bank_feed (a premium-shaped entitlement -> Flinks).
ok("accounting wins over bank_feed", providerForPlan({ ...PLAN_ENTITLEMENTS.growth, accounting: true }) === "flinks");
ok("bank_feed only -> plaid", providerForPlan({ ...PLAN_ENTITLEMENTS.free, bank_feed: true }) === "plaid");

ok("hasLiveBankFeed premium", hasLiveBankFeed(PLAN_ENTITLEMENTS.premium) === true);
ok("hasLiveBankFeed free", hasLiveBankFeed(PLAN_ENTITLEMENTS.free) === false);

// --- Amount normalization (sign convention decided in one place) ------------
// Plaid: positive raw = outflow (money out). outflowSign = 1.
ok("plaid positive -> debit", JSON.stringify(normalizeAmount(19880, 1)) === JSON.stringify({ amountCents: 19880, direction: "debit" }));
ok("plaid negative -> credit", JSON.stringify(normalizeAmount(-250000, 1)) === JSON.stringify({ amountCents: 250000, direction: "credit" }));
// Flinks-style: negative raw = outflow. outflowSign = -1.
ok("flinks negative -> debit", JSON.stringify(normalizeAmount(-19880, -1)) === JSON.stringify({ amountCents: 19880, direction: "debit" }));
ok("flinks positive -> credit", JSON.stringify(normalizeAmount(5000, -1)) === JSON.stringify({ amountCents: 5000, direction: "credit" }));
ok("zero -> credit (not outflow)", normalizeAmount(0, 1).direction === "credit");
ok("truncates fractional cents", normalizeAmount(199.9, 1).amountCents === 199);

// --- Expense candidacy ------------------------------------------------------
ok("debit is candidate", isExpenseCandidate({ direction: "debit" }) === true);
ok("credit not candidate", isExpenseCandidate({ direction: "credit" }) === false);

// --- Dedupe key -------------------------------------------------------------
ok("dedupe key shape", dedupeKey("conn1", "txnA") === "conn1:txnA");

// --- New-transaction filtering (idempotent re-sync) -------------------------
function txn(id: string): NormalizedTxn {
  return {
    externalId: id,
    accountExternalId: "acc1",
    accountName: "Chequing",
    postedOn: "2026-06-01",
    amountCents: 1000,
    direction: "debit",
    merchant: "Test",
    description: null,
    rawCategory: null,
    currency: "CAD",
  };
}
const pulled = [txn("a"), txn("b"), txn("c"), txn("b")]; // note dup "b" within batch
const existing = new Set(["a"]);
const fresh = filterNewTransactions(pulled, existing);
ok("filters already-staged", !fresh.some((t) => t.externalId === "a"));
ok("keeps new b + c once each", fresh.length === 2 && fresh.filter((t) => t.externalId === "b").length === 1);
ok("empty existing keeps all distinct", filterNewTransactions([txn("x"), txn("y")], new Set()).length === 2);
ok("all existing -> none", filterNewTransactions([txn("a")], new Set(["a"])).length === 0);

console.log(`\nbank-feed: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
