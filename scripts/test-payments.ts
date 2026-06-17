// Unit tests for the pure rent-payment domain model. Run: npx tsx scripts/test-payments.ts
import {
  PAYMENT_METHODS,
  paymentMethodLabel,
  isPaymentMethod,
  parseAmountToCents,
  parseDateOrNull,
  normalizePeriodMonth,
  validatePaymentInput,
  paymentErrorMessage,
  formatMoneyCents,
  formatPeriodMonth,
  reconcilePayments,
  type PaymentRow,
} from "../lib/payments";

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

// --- Methods ----------------------------------------------------------------
ok("methods are e_transfer/cheque/cash/other", PAYMENT_METHODS.join(",") === "e_transfer,cheque,cash,other");
ok("isPaymentMethod accepts known", PAYMENT_METHODS.every((m) => isPaymentMethod(m)));
ok("isPaymentMethod rejects unknown", !isPaymentMethod("paypal"));
ok("label e_transfer", paymentMethodLabel("e_transfer") === "E-transfer");
ok("label cash", paymentMethodLabel("cash") === "Cash");
ok("label unknown passthrough", paymentMethodLabel("zzz") === "zzz");

// --- parseAmountToCents -----------------------------------------------------
ok("amount plain", parseAmountToCents("1250") === 125000);
ok("amount decimals", parseAmountToCents("1250.50") === 125050);
ok("amount with $ and comma", parseAmountToCents("$1,250") === 125000);
ok("amount blank -> null", parseAmountToCents("") === null);
ok("amount zero -> null (must be > 0)", parseAmountToCents("0") === null);
ok("amount negative -> null", parseAmountToCents("-5") === null);
ok("amount junk -> null", parseAmountToCents("abc") === null);
ok("amount rounds to nearest cent", parseAmountToCents("10.999") === 1100);

// --- parseDateOrNull --------------------------------------------------------
ok("date valid", parseDateOrNull("2026-06-16") === "2026-06-16");
ok("date blank -> null", parseDateOrNull("") === null);
ok("date malformed -> null", parseDateOrNull("06/16/2026") === null);

// --- normalizePeriodMonth ---------------------------------------------------
ok("period from full date", normalizePeriodMonth("2026-06-16") === "2026-06-01");
ok("period from month input", normalizePeriodMonth("2026-06") === "2026-06-01");
ok("period already first", normalizePeriodMonth("2026-06-01") === "2026-06-01");
ok("period blank -> null", normalizePeriodMonth("") === null);
ok("period bad month -> null", normalizePeriodMonth("2026-13") === null);
ok("period month 00 -> null", normalizePeriodMonth("2026-00") === null);

// --- validatePaymentInput ---------------------------------------------------
ok(
  "valid input passes with cleaned values",
  (() => {
    const v = validatePaymentInput({ amountCents: 125000, method: "e_transfer", paidOn: "2026-06-16" });
    return v.ok && v.value.amountCents === 125000 && v.value.method === "e_transfer" && v.value.paidOn === "2026-06-16";
  })(),
);
ok("null amount -> amount code", matchCode(validatePaymentInput({ amountCents: null, method: "cash", paidOn: "2026-06-16" }), "amount"));
ok("zero amount -> amount code", matchCode(validatePaymentInput({ amountCents: 0, method: "cash", paidOn: "2026-06-16" }), "amount"));
ok("bad method -> method code", matchCode(validatePaymentInput({ amountCents: 100, method: "paypal", paidOn: "2026-06-16" }), "method"));
ok("missing date -> date code", matchCode(validatePaymentInput({ amountCents: 100, method: "cash", paidOn: null }), "date"));

// --- paymentErrorMessage ----------------------------------------------------
ok("error message known", paymentErrorMessage("amount") === "Enter a payment amount greater than zero.");
ok("error message unknown -> generic", paymentErrorMessage("weird")!.length > 0);
ok("error message undefined -> null", paymentErrorMessage(undefined) === null);

// --- formatMoneyCents -------------------------------------------------------
ok("money two decimals", formatMoneyCents(125000) === "$1,250.00");
ok("money with cents", formatMoneyCents(125050) === "$1,250.50");
ok("money zero", formatMoneyCents(0) === "$0.00");
ok("money null -> dash", formatMoneyCents(null) === "—");

// --- formatPeriodMonth ------------------------------------------------------
ok("period label", formatPeriodMonth("2026-06-01") === "June 2026");
ok("period label from full date", formatPeriodMonth("2026-12-15") === "December 2026");
ok("period null -> Unassigned", formatPeriodMonth(null) === "Unassigned");
ok("period bad -> Unassigned", formatPeriodMonth("nope") === "Unassigned");

// --- reconcilePayments ------------------------------------------------------
const rent = 125000; // $1,250

// Empty
ok(
  "reconcile empty -> zero total, no buckets",
  (() => {
    const r = reconcilePayments([], rent);
    return r.totalCollectedCents === 0 && r.buckets.length === 0;
  })(),
);

// Exact paid
ok(
  "reconcile exact -> paid, balance 0",
  (() => {
    const rows: PaymentRow[] = [{ amount_cents: 125000, period_month: "2026-06-01" }];
    const r = reconcilePayments(rows, rent);
    const b = r.buckets[0];
    return r.totalCollectedCents === 125000 && b.status === "paid" && b.balanceCents === 0 && b.expectedCents === 125000 && b.count === 1;
  })(),
);

// Short
ok(
  "reconcile short -> short, negative balance",
  (() => {
    const rows: PaymentRow[] = [{ amount_cents: 100000, period_month: "2026-06-01" }];
    const r = reconcilePayments(rows, rent);
    const b = r.buckets[0];
    return b.status === "short" && b.balanceCents === -25000;
  })(),
);

// Over (two payments same period summing above rent)
ok(
  "reconcile over -> over, positive balance, count 2",
  (() => {
    const rows: PaymentRow[] = [
      { amount_cents: 100000, period_month: "2026-06-01" },
      { amount_cents: 50000, period_month: "2026-06-01" },
    ];
    const r = reconcilePayments(rows, rent);
    const b = r.buckets[0];
    return b.status === "over" && b.collectedCents === 150000 && b.balanceCents === 25000 && b.count === 2;
  })(),
);

// Unassigned bucket
ok(
  "reconcile unassigned -> no expected, status unassigned, sorted last",
  (() => {
    const rows: PaymentRow[] = [
      { amount_cents: 50000, period_month: null },
      { amount_cents: 125000, period_month: "2026-06-01" },
    ];
    const r = reconcilePayments(rows, rent);
    const last = r.buckets[r.buckets.length - 1];
    return last.period === null && last.status === "unassigned" && last.expectedCents === null && last.balanceCents === null && last.count === 1;
  })(),
);

// Sorting: most-recent assigned period first, unassigned last
ok(
  "reconcile sorts most-recent period first",
  (() => {
    const rows: PaymentRow[] = [
      { amount_cents: 1, period_month: "2026-05-01" },
      { amount_cents: 1, period_month: "2026-07-01" },
      { amount_cents: 1, period_month: null },
      { amount_cents: 1, period_month: "2026-06-01" },
    ];
    const r = reconcilePayments(rows, rent);
    return (
      r.buckets[0].period === "2026-07-01" &&
      r.buckets[1].period === "2026-06-01" &&
      r.buckets[2].period === "2026-05-01" &&
      r.buckets[3].period === null
    );
  })(),
);

// No rent set -> assigned period shows paid (just what was collected), no balance
ok(
  "reconcile with null rent -> expected null, status paid",
  (() => {
    const rows: PaymentRow[] = [{ amount_cents: 80000, period_month: "2026-06-01" }];
    const r = reconcilePayments(rows, null);
    const b = r.buckets[0];
    return b.expectedCents === null && b.balanceCents === null && b.status === "paid";
  })(),
);

// total across all buckets
ok(
  "reconcile total sums every payment",
  (() => {
    const rows: PaymentRow[] = [
      { amount_cents: 100, period_month: "2026-06-01" },
      { amount_cents: 200, period_month: null },
      { amount_cents: 300, period_month: "2026-05-01" },
    ];
    return reconcilePayments(rows, rent).totalCollectedCents === 600;
  })(),
);

function matchCode(v: { ok: boolean; code?: string }, code: string): boolean {
  return v.ok === false && v.code === code;
}

console.log(`\npayments: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
