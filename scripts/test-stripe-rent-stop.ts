// Unit tests for the S796 stop-rent decisions and the payment summary.
// The impure Stripe calls live in lib/stripe-rent-stop.ts.
// Run: npx tsx scripts/test-stripe-rent-stop.ts
import {
  planRentStop,
  canCreateRentSubscription,
  summarizeRentPayments,
  subscriptionStatusLabel,
} from "../lib/stripe-connect";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error("FAIL:", name);
  }
}

// planRentStop
ok("no subscription -> none", planRentStop({ subscriptionId: null, subscriptionStatus: null, scheduleId: null }) === "none");
ok("canceled -> none", planRentStop({ subscriptionId: "sub_1", subscriptionStatus: "canceled", scheduleId: null }) === "none");
ok("active -> cancel sub", planRentStop({ subscriptionId: "sub_1", subscriptionStatus: "active", scheduleId: null }) === "cancel_subscription");
ok("past_due is still live -> cancel sub", planRentStop({ subscriptionId: "sub_1", subscriptionStatus: "past_due", scheduleId: "" }) === "cancel_subscription");
ok("active with schedule -> schedule first", planRentStop({ subscriptionId: "sub_1", subscriptionStatus: "active", scheduleId: "sub_sched_1" }) === "cancel_schedule_then_subscription");

// canCreateRentSubscription
ok("no sub -> can create", canCreateRentSubscription({ subscriptionId: null, subscriptionStatus: null }));
ok("live sub blocks create", !canCreateRentSubscription({ subscriptionId: "sub_1", subscriptionStatus: "active" }));
ok("stopped sub allows restart", canCreateRentSubscription({ subscriptionId: "sub_1", subscriptionStatus: "canceled" }));
ok("expired setup allows restart", canCreateRentSubscription({ subscriptionId: "sub_1", subscriptionStatus: "incomplete_expired" }));

ok("canceled reads Stopped", subscriptionStatusLabel("canceled") === "Stopped");

// summarizeRentPayments. 1795003200 = 2026-11-18T12:00Z, 1797595200 = 2026-12-18T12:00Z
const NOV18 = Date.UTC(2026, 10, 18, 12) / 1000;
const DEC18 = Date.UTC(2026, 11, 18, 12) / 1000;
{
  // Before the first charge: only the $0 stub invoice exists.
  const r = summarizeRentPayments(
    { status: "active", items: { data: [{ current_period_end: NOV18 }] } },
    [{ status: "paid", amount_due: 0, amount_paid: 0, created: NOV18 - 4 * 86400 }],
  );
  ok("next = period end (item level)", r.nextChargeIso === "2026-11-18");
  ok("$0 stub invoice is not a payment", r.lastPaymentIso === null && r.lastPaymentState === null);
}
{
  const r = summarizeRentPayments(
    { status: "active", current_period_end: DEC18 },
    [
      { status: "paid", amount_due: 0, amount_paid: 0, created: NOV18 - 4 * 86400 },
      { status: "open", amount_due: 500, amount_paid: 0, created: NOV18 },
    ],
  );
  ok("next falls back to top-level period end", r.nextChargeIso === "2026-12-18");
  ok("open debit = processing", r.lastPaymentState === "processing" && r.lastPaymentIso === "2026-11-18" && r.lastPaymentCents === 500);
}
{
  const r = summarizeRentPayments(
    { status: "active", current_period_end: DEC18 },
    [{ status: "paid", amount_due: 500, amount_paid: 500, created: NOV18, status_transitions: { paid_at: NOV18 + 3 * 86400 } }],
  );
  ok("paid uses the paid date", r.lastPaymentState === "paid" && r.lastPaymentIso === "2026-11-21" && r.lastPaymentCents === 500);
}
{
  const r = summarizeRentPayments(
    { status: "past_due", current_period_end: DEC18 },
    [{ status: "open", amount_due: 500, created: NOV18 }],
  );
  ok("open + past_due = failed", r.lastPaymentState === "failed");
}
{
  const r = summarizeRentPayments(
    { status: "canceled", current_period_end: DEC18 },
    [{ status: "paid", amount_due: 500, amount_paid: 500, created: NOV18 }],
  );
  ok("stopped -> no next payment", r.nextChargeIso === null);
  ok("stopped keeps last payment", r.lastPaymentState === "paid");
}
{
  const r = summarizeRentPayments({ status: "active", current_period_end: DEC18, cancel_at_period_end: true }, []);
  ok("ending at period end -> no next payment", r.nextChargeIso === null);
  const e = summarizeRentPayments(null, null);
  ok("nulls are safe", e.nextChargeIso === null && e.lastPaymentIso === null);
}
{
  const r = summarizeRentPayments(
    { status: "active", current_period_end: DEC18 },
    [
      { status: "void", amount_due: 500, created: NOV18 + 10 },
      { status: "paid", amount_due: 500, amount_paid: 500, created: NOV18 },
    ],
  );
  ok("void invoices are skipped", r.lastPaymentState === "paid");
}

console.log(`\nstripe-rent-stop: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
