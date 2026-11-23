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
  rentSubscriptionIdempotencyKey,
  findLiveRentSubscription,
  countLiveStripeRent,
  buildSubscriptionParams,
  reusableSetupLink,
  billedDiffersFromRent,
  editMayEndTenancy,
} from "../lib/stripe-connect";
import { rentFailedEmail } from "../lib/rent-failed";
import { buildTodayLane } from "../lib/dashboard-today";
import { CATALOG_MESSAGES } from "../lib/message-catalog";

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

// S835a (REVIEW-S835 findings 1 and 2).
{
  const T = "11111111-2222-3333-4444-555555555555";
  const a = rentSubscriptionIdempotencyKey({ tenancyId: T, amountCents: 150000, firstChargeIso: "2026-12-01" });
  const again = rentSubscriptionIdempotencyKey({ tenancyId: T, amountCents: 150000, firstChargeIso: "2026-12-01", previousSubscriptionId: null });
  ok("a repeated create has the same key", a === again);
  ok("the key is under Stripe's 255 characters", a.length < 255);
  ok("another amount is another key", a !== rentSubscriptionIdempotencyKey({ tenancyId: T, amountCents: 155000, firstChargeIso: "2026-12-01" }));
  ok("another date is another key", a !== rentSubscriptionIdempotencyKey({ tenancyId: T, amountCents: 150000, firstChargeIso: "2026-12-02" }));
  ok(
    "a restart after a stop gets a fresh key",
    a !== rentSubscriptionIdempotencyKey({ tenancyId: T, amountCents: 150000, firstChargeIso: "2026-12-01", previousSubscriptionId: "sub_old" }),
  );

  const V = { source: "vacantless_rent" };
  ok("no subscriptions -> nothing to adopt", findLiveRentSubscription([]) === null && findLiveRentSubscription(null) === null);
  ok("a stopped one is not adopted", findLiveRentSubscription([{ id: "sub_1", status: "canceled", metadata: V }]) === null);
  ok("a live Vacantless one is adopted", findLiveRentSubscription([{ id: "sub_1", status: "canceled", metadata: V }, { id: "sub_2", status: "active", metadata: V }])?.id === "sub_2");
  ok("past_due still counts as live", findLiveRentSubscription([{ id: "sub_3", status: "past_due", metadata: V }])?.status === "past_due");
  ok("a subscription the landlord made by hand is left alone", findLiveRentSubscription([{ id: "sub_4", status: "active", metadata: {} }]) === null);

  ok("no rows -> no live rent", countLiveStripeRent(null) === 0 && countLiveStripeRent([]) === 0);
  ok(
    "only live subscriptions count",
    countLiveStripeRent([
      { stripe_subscription_id: "sub_1", stripe_subscription_status: "active" },
      { stripe_subscription_id: "sub_2", stripe_subscription_status: "canceled" },
      { stripe_subscription_id: "sub_3", stripe_subscription_status: "past_due" },
      { stripe_subscription_id: null, stripe_subscription_status: "active" },
    ]) === 2,
  );

  const params = buildSubscriptionParams({ customerId: "cus_1", paymentMethodId: "pm_1", productId: "prod_1", country: "CA", amountCents: 150000, tenancyId: T });
  const meta = params.metadata as Record<string, string>;
  ok("the subscription carries its tenancy id", meta.tenancy_id === T && meta.source === "vacantless_rent");

  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const rent = readFileSync("app/dashboard/tenancies/stripe-rent-actions.ts", "utf8");
  ok("create passes an idempotency key", /idempotencyKey: rentSubscriptionIdempotencyKey\(/.test(rent));
  ok("create looks for a live subscription first", rent.indexOf("findLiveRentSubscription(") > 0 && rent.indexOf("findLiveRentSubscription(") < rent.indexOf("stripe!.subscriptions.create("));
  ok("a failed save is reported, not swallowed", /saveErr[\s\S]{0,400}subsavefail/.test(rent));
  const sc = readFileSync("app/dashboard/settings/stripe-connect-actions.ts", "utf8");
  ok("Stripe disconnect checks for live rent before deleting", sc.indexOf("countLiveStripeRent(") > 0 && sc.indexOf("countLiveStripeRent(") < sc.indexOf('from("stripe_connect_accounts").delete()'));
  const ro = readFileSync("app/dashboard/settings/rotessa-actions.ts", "utf8");
  ok("Rotessa disconnect checks for a live schedule before deleting", ro.indexOf('not("rotessa_schedule_id", "is", null)') > 0 && ro.indexOf('not("rotessa_schedule_id", "is", null)') < ro.indexOf('from("rotessa_accounts").delete()'));
  const page = readFileSync("app/dashboard/settings/page.tsx", "utf8");
  ok("Settings says why a disconnect was refused", /stripeconnect === "liverent"/.test(page) && /rotessa === "liverent"/.test(page));
}

// S835b (REVIEW-S835 findings 3 to 6).
{
  const NOW = 1_800_000_000;
  const open = { status: "open", url: "https://checkout.stripe.com/c/pay/cs_live_x", expires_at: NOW + 3600 };
  ok("an open link is reused", reusableSetupLink(open, NOW)?.url === open.url);
  ok("a finished link is not reused", reusableSetupLink({ ...open, status: "complete" }, NOW) === null);
  ok("an expired link is not reused", reusableSetupLink({ ...open, status: "expired" }, NOW) === null);
  ok("a link with minutes left is not reused", reusableSetupLink({ ...open, expires_at: NOW + 120 }, NOW) === null);
  ok("a link with no address is not reused", reusableSetupLink({ status: "open", url: null }, NOW) === null);
  ok("no session -> nothing to reuse", reusableSetupLink(null, NOW) === null);

  ok("same amount does not differ", !billedDiffersFromRent(150000, 150000));
  ok("another amount differs", billedDiffersFromRent(150000, 155000));
  ok("unknown billed amount never warns", !billedDiffersFromRent(null, 155000) && !billedDiffersFromRent(150000, null));
  const sum = summarizeRentPayments({ status: "active", items: { data: [{ current_period_end: NOW, price: { unit_amount: 150000 } }] } }, []);
  ok("the summary carries what Stripe bills", sum.billedCents === 150000);
  ok("no price -> billed unknown", summarizeRentPayments({ status: "active" }, []).billedCents === null);

  const live = { subscriptionId: "sub_1", subscriptionStatus: "active", rotessaScheduleId: null };
  ok("the edit form cannot end a tenancy with live Stripe rent", !editMayEndTenancy({ currentStatus: "active", nextStatus: "ended", ...live }));
  ok("nor one with a Rotessa schedule", !editMayEndTenancy({ currentStatus: "active", nextStatus: "ended", subscriptionId: null, subscriptionStatus: null, rotessaScheduleId: "123" }));
  ok("stopped rent can be ended", editMayEndTenancy({ currentStatus: "active", nextStatus: "ended", subscriptionId: "sub_1", subscriptionStatus: "canceled", rotessaScheduleId: null }));
  ok("an already ended tenancy can be saved", editMayEndTenancy({ currentStatus: "ended", nextStatus: "ended", ...live }));
  ok("other status changes are untouched", editMayEndTenancy({ currentStatus: "upcoming", nextStatus: "active", ...live }));

  const mail = rentFailedEmail({ tenantName: "Sam Lee", address: "12 Main St, Unit 3", amountLabel: "$1,500" });
  ok("the failed-rent email names the rental", mail.subject === "Rent payment did not go through: 12 Main St, Unit 3");
  ok("and the tenant and the amount", mail.body.includes("Sam Lee's rent payment of $1,500 for 12 Main St, Unit 3 did not go through."));
  ok("no em dash in the email", !/\u2014/.test(mail.subject + mail.body));
  const bare = rentFailedEmail({ tenantName: null, address: null, amountLabel: null });
  ok("it reads with nothing known", bare.subject === "A rent payment did not go through" && bare.body.startsWith("Your tenant's rent payment did not go through."));

  const base = { inquiriesNeedingReply: 0, viewingsToday: 0, messagesAwaitingApproval: 0, rentIncreasesOverdue: 0, urgentWorkOrders: 0 };
  ok("Today is quiet with no failed rent", buildTodayLane(base).length === 0);
  const lane = buildTodayLane({ ...base, rentPaymentsFailed: 2 });
  ok("Today shows failed rent", lane.length === 1 && lane[0].key === "rent-failed" && lane[0].label === "2 rent payments did not go through" && lane[0].tone === "urgent");
  ok("one reads in the singular", buildTodayLane({ ...base, rentPaymentsFailed: 1 })[0].label === "1 rent payment did not go through");

  ok("the failed-rent email is on Every message we send", CATALOG_MESSAGES.some((m) => m.id === "you-rent-failed" && (m.code.notify ?? []).includes("lib/rent-failed-notify.ts")));

  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const acts = readFileSync("app/dashboard/tenancies/actions.ts", "utf8");
  ok("updateTenancy checks before saving Ended", /editMayEndTenancy\([\s\S]{0,500}striperent=useend/.test(acts));
  const rent = readFileSync("app/dashboard/tenancies/stripe-rent-actions.ts", "utf8");
  ok("the bank link is reused before a new one is made", rent.indexOf("reusableSetupLink(prior") > 0 && rent.indexOf("reusableSetupLink(prior") < rent.indexOf("stripe!.checkout.sessions.create("));
  ok("the landlord is no longer sent into the tenant's Stripe page", !/redirect\(session\.url\)/.test(rent));
  const hook = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
  ok("the webhook falls back to the Stripe customer", /eq\("stripe_customer_id", customerId\)/.test(hook));
  ok("an older link counts only when finished", /viaCustomer && parsed\.mandateStatus !== "active"/.test(hook));
  ok("a failed payment notifies the owners", /invoice\.payment_failed"\) \{[\s\S]{0,1500}notifyRentPaymentFailed\(/.test(hook));
  const card = readFileSync("components/tenancy-stripe-rent-section.tsx", "utf8");
  ok("the card shows the bank link with a Copy button", /CopyLinkButton path=\{view\.bankLinkUrl\}/.test(card));
  ok("the card shows what Stripe bills", /view\.billedLabel \?\? view\.rentLabel/.test(card) && /view\.billedDiffers &&/.test(card));
}

console.log(`\nstripe-rent-stop: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
