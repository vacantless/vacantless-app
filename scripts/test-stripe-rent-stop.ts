// Unit tests for the S796 stop-rent decisions and the payment summary.
// The impure Stripe calls live in lib/stripe-rent-stop.ts.
// Run: npx tsx scripts/test-stripe-rent-stop.ts
import {
  planRentStop,
  canCreateRentSubscription,
  summarizeRentPayments,
  subscriptionStatusLabel,
  decideScheduledRentStop,
  upcomingChargeDates,
  connectAccountController,
  connectAccountBillsPlatform,
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

// decideScheduledRentStop: last payment Dec 1, then stop.
{
  const base = { stopAfterIso: "2026-12-01", nextChargeIso: "2026-12-01", lastPaymentIso: "2026-11-04", lastPaymentState: "paid" as const };
  ok("no date -> never stops", !decideScheduledRentStop({ ...base, stopAfterIso: null, todayIso: "2027-01-01" }).stop);
  ok("before the date -> wait", decideScheduledRentStop({ ...base, todayIso: "2026-11-20" }).reason === "before_date");
  ok("on the date, not issued yet -> wait", !decideScheduledRentStop({ ...base, todayIso: "2026-12-01" }).stop);
  ok(
    "issued but still processing -> wait",
    decideScheduledRentStop({ stopAfterIso: "2026-12-01", todayIso: "2026-12-03", nextChargeIso: "2027-01-01", lastPaymentIso: "2026-12-01", lastPaymentState: "processing" }).reason === "waiting",
  );
  ok(
    "issued and paid -> stop",
    decideScheduledRentStop({ stopAfterIso: "2026-12-01", todayIso: "2026-12-05", nextChargeIso: "2027-01-01", lastPaymentIso: "2026-12-04", lastPaymentState: "paid" }).reason === "paid",
  );
  ok(
    "an older paid payment does not count as the last one",
    !decideScheduledRentStop({ stopAfterIso: "2026-12-01", todayIso: "2026-12-02", nextChargeIso: "2027-01-01", lastPaymentIso: "2026-11-04", lastPaymentState: "paid" }).stop,
  );
  ok(
    "grace: 14 days later stops even if never paid",
    decideScheduledRentStop({ stopAfterIso: "2026-12-01", todayIso: "2026-12-15", nextChargeIso: "2027-01-01", lastPaymentIso: "2026-12-01", lastPaymentState: "failed" }).reason === "grace",
  );
  ok(
    "grace also covers Stripe being unreadable",
    decideScheduledRentStop({ stopAfterIso: "2026-12-01", todayIso: "2026-12-20", nextChargeIso: null, lastPaymentIso: null, lastPaymentState: null }).stop,
  );
  ok(
    "unreadable before grace -> wait",
    !decideScheduledRentStop({ stopAfterIso: "2026-12-01", todayIso: "2026-12-10", nextChargeIso: null, lastPaymentIso: null, lastPaymentState: null }).stop,
  );
  ok(
    "grace is before the next monthly debit (Feb, shortest month)",
    decideScheduledRentStop({ stopAfterIso: "2027-02-01", todayIso: "2027-02-15", nextChargeIso: "2027-03-01", lastPaymentIso: null, lastPaymentState: null }).stop,
  );
}

// upcomingChargeDates
{
  const d = upcomingChargeDates("2026-11-18", 18, 4);
  ok("monthly from the next date", JSON.stringify(d) === JSON.stringify(["2026-11-18", "2026-12-18", "2027-01-18", "2027-02-18"]));
  const e = upcomingChargeDates("2027-01-31", 31, 4);
  ok("anchor 31 uses the month's last day, then returns to 31", JSON.stringify(e) === JSON.stringify(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]));
  const f = upcomingChargeDates("2027-02-28", 31, 2);
  ok("next on a short month still returns to the anchor day", f[1] === "2027-03-31");
  ok("no anchor falls back to the next date's day", upcomingChargeDates("2026-12-01", null, 2)[1] === "2027-01-01");
  ok("default is 12 dates", upcomingChargeDates("2026-12-01", 1).length === 12);
  ok("no next date -> empty", upcomingChargeDates(null, 1).length === 0);
  const s2 = summarizeRentPayments({ status: "active", current_period_end: NOV18, billing_cycle_anchor: NOV18 }, []);
  ok("summary carries the anchor day", s2.anchorDay === 18);
}

// S796d: landlord accounts must not bill Connect fees to the platform.
{
  const c = connectAccountController();
  ok("landlord pays Stripe directly", c.fees.payer === "account");
  ok("Stripe carries payment losses", c.losses.payments === "stripe");
  ok("full dashboard (Stripe refuses express when the landlord pays fees)", c.stripe_dashboard.type === "full");
  ok("Stripe collects requirements", c.requirement_collection === "stripe");
  ok("new setup does not bill the platform", !connectAccountBillsPlatform(c.fees.payer));
  ok("old express accounts do", connectAccountBillsPlatform("application_express"));
  ok("unknown payer is not flagged", !connectAccountBillsPlatform(null));
}
{
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const src = readFileSync("app/dashboard/settings/stripe-connect-actions.ts", "utf8");
  ok("account creation uses the controller settings", /controller: connectAccountController\(\)/.test(src));
  ok("account creation no longer passes type express", !/type: "express"/.test(src));
}

console.log(`\nstripe-rent-stop: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
