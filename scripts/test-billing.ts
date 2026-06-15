// Unit tests for the pure billing helpers. Run: npx tsx scripts/test-billing.ts
import {
  PLANS,
  formatPlanPrice,
  isPaidPlan,
  planForPriceId,
  isSubscriptionActive,
  needsBillingAttention,
  statusLabel,
  formatPeriodEnd,
  buildBillingView,
  subscriptionPeriodEndSeconds,
  shouldApplyStatus,
} from "../lib/billing";

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

// --- Plan catalog ----------------------------------------------------------
ok("core priced at $200/mo (20000 cents)", PLANS.core.priceCents === 20000);
ok("plus priced at $375/mo (37500 cents)", PLANS.plus.priceCents === 37500);
ok("core list anchor $400 (40000 cents)", PLANS.core.listPriceCents === 40000);
ok("plus list anchor $750 (75000 cents)", PLANS.plus.listPriceCents === 75000);
ok("founding rate is below the list anchor (core)", PLANS.core.priceCents < PLANS.core.listPriceCents);
ok("founding rate is below the list anchor (plus)", PLANS.plus.priceCents < PLANS.plus.listPriceCents);
ok("core price env name", PLANS.core.priceEnv === "STRIPE_PRICE_CORE");
ok("plus price env name", PLANS.plus.priceEnv === "STRIPE_PRICE_PLUS");
ok("formatPlanPrice core", formatPlanPrice(20000) === "$200/month");
ok("formatPlanPrice plus", formatPlanPrice(37500) === "$375/month");
ok("formatPlanPrice thousands separator", formatPlanPrice(120000) === "$1,200/month");

// --- isPaidPlan ------------------------------------------------------------
ok("core is paid", isPaidPlan("core"));
ok("plus is paid", isPaidPlan("plus"));
ok("trial is not paid", !isPaidPlan("trial"));
ok("null is not paid", !isPaidPlan(null));
ok("garbage is not paid", !isPaidPlan("enterprise"));

// --- planForPriceId --------------------------------------------------------
const MAP = { price_core: "core" as const, price_plus: "plus" as const };
ok("price→core", planForPriceId("price_core", MAP) === "core");
ok("price→plus", planForPriceId("price_plus", MAP) === "plus");
ok("unknown price→null", planForPriceId("price_unknown", MAP) === null);
ok("null price→null", planForPriceId(null, MAP) === null);
ok("empty map→null", planForPriceId("price_core", {}) === null);

// --- status helpers --------------------------------------------------------
ok("active is active", isSubscriptionActive("active"));
ok("trialing is active", isSubscriptionActive("trialing"));
ok("past_due is NOT active", !isSubscriptionActive("past_due"));
ok("canceled is NOT active", !isSubscriptionActive("canceled"));
ok("null is NOT active", !isSubscriptionActive(null));

ok("past_due needs attention", needsBillingAttention("past_due"));
ok("unpaid needs attention", needsBillingAttention("unpaid"));
ok("incomplete needs attention", needsBillingAttention("incomplete"));
ok("active does NOT need attention", !needsBillingAttention("active"));
ok("canceled does NOT need attention (terminal)", !needsBillingAttention("canceled"));
ok("null does NOT need attention", !needsBillingAttention(null));

ok("statusLabel active", statusLabel("active") === "Active");
ok("statusLabel past_due", statusLabel("past_due") === "Past due");
ok("statusLabel incomplete", statusLabel("incomplete") === "Payment incomplete");
ok("statusLabel null → dash", statusLabel(null) === "—");

// --- formatPeriodEnd -------------------------------------------------------
ok(
  "period end formats in Toronto tz",
  formatPeriodEnd("2026-07-15T12:00:00Z", "America/Toronto") === "July 15, 2026",
);
ok("period end null → null", formatPeriodEnd(null) === null);
ok("period end invalid → null", formatPeriodEnd("not-a-date") === null);
// A UTC instant just after midnight Toronto still lands on the right calendar day.
ok(
  "period end respects tz boundary",
  formatPeriodEnd("2026-07-15T04:30:00Z", "America/Toronto") === "July 15, 2026",
);

// --- buildBillingView ------------------------------------------------------
const trial = buildBillingView({
  plan: "trial",
  subscription_status: null,
  stripe_subscription_id: null,
  current_period_end: null,
});
ok("trial: planKey", trial.planKey === "trial");
ok("trial: label", trial.planLabel === "Trial");
ok("trial: not paid", !trial.isPaid);
ok("trial: no subscription", !trial.hasSubscription);
ok("trial: no attention", !trial.needsAttention);
ok("trial: no period end label", trial.periodEndLabel === null);

const activeCore = buildBillingView({
  plan: "core",
  subscription_status: "active",
  stripe_subscription_id: "sub_123",
  current_period_end: "2026-07-15T12:00:00Z",
  timezone: "America/Toronto",
});
ok("active core: planKey", activeCore.planKey === "core");
ok("active core: label", activeCore.planLabel === "Core");
ok("active core: isPaid", activeCore.isPaid);
ok("active core: hasSubscription", activeCore.hasSubscription);
ok("active core: no attention", !activeCore.needsAttention);
ok("active core: period end label", activeCore.periodEndLabel === "July 15, 2026");
ok("active core: statusLabel", activeCore.statusLabel === "Active");

const pastDuePlus = buildBillingView({
  plan: "plus",
  subscription_status: "past_due",
  stripe_subscription_id: "sub_456",
  current_period_end: "2026-07-15T12:00:00Z",
});
ok("past_due plus: still paid tier", pastDuePlus.isPaid && pastDuePlus.planKey === "plus");
ok("past_due plus: needs attention", pastDuePlus.needsAttention);
ok("past_due plus: statusLabel", pastDuePlus.statusLabel === "Past due");

// An unknown/garbage plan falls back to trial (defensive).
const garbage = buildBillingView({
  plan: "enterprise",
  subscription_status: null,
  stripe_subscription_id: null,
  current_period_end: null,
});
ok("garbage plan → trial fallback", garbage.planKey === "trial" && !garbage.isPaid);

// Invalid period end on an otherwise-active sub → null label, no crash.
const badDate = buildBillingView({
  plan: "core",
  subscription_status: "active",
  stripe_subscription_id: "sub_789",
  current_period_end: "garbage",
});
ok("bad period end → null label", badDate.periodEndLabel === null && badDate.periodEnd === null);

// --- subscriptionPeriodEndSeconds (webhook sync) ---------------------------
// Newer API (dahlia): value lives on the item, top level absent → use item.
ok(
  "period end: reads item-level (dahlia shape)",
  subscriptionPeriodEndSeconds({ items: { data: [{ current_period_end: 1784137920 }] } }) ===
    1784137920,
);
// Older API: only top level present → fall back to it.
ok(
  "period end: falls back to top level (legacy shape)",
  subscriptionPeriodEndSeconds({ current_period_end: 1700000000 }) === 1700000000,
);
// Item value wins when both are present.
ok(
  "period end: item wins over top level",
  subscriptionPeriodEndSeconds({
    current_period_end: 1700000000,
    items: { data: [{ current_period_end: 1784137920 }] },
  }) === 1784137920,
);
ok("period end: neither present → null", subscriptionPeriodEndSeconds({}) === null);
ok(
  "period end: empty items → null",
  subscriptionPeriodEndSeconds({ items: { data: [] } }) === null,
);

// --- shouldApplyStatus (stale-incomplete guard) ----------------------------
// Non-incomplete statuses always apply.
ok("status: active always applies", shouldApplyStatus("active", "incomplete", true));
ok("status: canceled always applies", shouldApplyStatus("canceled", "active", true));
// Incomplete on a NEW subscription applies (a genuinely-stuck payment surfaces).
ok("status: incomplete on new sub applies", shouldApplyStatus("incomplete", "canceled", false));
ok("status: incomplete with no prior applies", shouldApplyStatus("incomplete", null, true));
ok(
  "status: incomplete when still incomplete applies",
  shouldApplyStatus("incomplete", "incomplete", true),
);
// The bug we fixed: a stale `incomplete` must NOT clobber an active same-sub.
ok(
  "status: stale incomplete skipped over active (same sub)",
  shouldApplyStatus("incomplete", "active", true) === false,
);
ok(
  "status: stale incomplete skipped over past_due (same sub)",
  shouldApplyStatus("incomplete", "past_due", true) === false,
);

console.log(`\nbilling: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
