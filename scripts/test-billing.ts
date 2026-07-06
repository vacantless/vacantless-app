// Unit tests for the pure billing helpers. Run: npx tsx scripts/test-billing.ts
import {
  formatPlanPrice,
  isPaidPlan,
  isAnyPaidPlan,
  planForPriceId,
  isSubscriptionActive,
  needsBillingAttention,
  statusLabel,
  formatPeriodEnd,
  buildBillingView,
  subscriptionPeriodEndSeconds,
  shouldApplyStatus,
  pilotStatus,
  formatAmount,
  isPilotPlan,
  PILOT,
  PILOT_DURATION_DAYS,
  PILOT_DEPOSIT_CENTS,
  normalizeDepositStatus,
  depositStatusLabel,
  DEPOSIT_STATUSES,
  PLAN_ENTITLEMENTS,
  PLAN_FEATURES,
  planEntitlements,
  hasEntitlement,
  canUseSms,
  canUseRenterSms,
  canCollectRentByPlan,
  canUseIncidentIntake,
  canUseIncidentDispatch,
  canUseCaptureEmailIn,
  canUseCaptureTextIn,
  canUseRepairSms,
  canUseListingMarketing,
  canUseLeaseOcr,
  leaseOcrMonthlyCap,
  LEASE_OCR_CAP_GROWTH,
  LEASE_OCR_CAP_PREMIUM,
  TIERS,
  TIER_KEYS,
  isTierPurchasable,
  listingCapForPlan,
  BASE_PHOTO_CAP,
  PREMIUM_PHOTO_CAP,
  photoCapForPlan,
  storageUpsellNote,
} from "../lib/billing";
import { MAX_PHOTOS_PER_PROPERTY } from "../lib/photos";

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

// --- Plan catalog (S299: live paid plans = growth/premium via TIERS) --------
ok("growth price env name", TIERS.growth.priceEnv === "STRIPE_PRICE_GROWTH");
ok("premium price env name", TIERS.premium.priceEnv === "STRIPE_PRICE_PREMIUM");
ok("growth carries a price env (config-shape purchasable)", isTierPurchasable(TIERS.growth));
ok("premium carries a price env (config-shape purchasable)", isTierPurchasable(TIERS.premium));
ok("formatPlanPrice growth", formatPlanPrice(9900) === "$99/month");
ok("formatPlanPrice premium", formatPlanPrice(24900) === "$249/month");
ok("formatPlanPrice thousands separator", formatPlanPrice(120000) === "$1,200/month");

// --- isPaidPlan (narrow: the LIVE purchasable paid plans only) --------------
ok("growth is paid", isPaidPlan("growth"));
ok("premium is paid", isPaidPlan("premium"));
ok("core is NOT a live paid plan (retired legacy)", !isPaidPlan("core"));
ok("plus is NOT a live paid plan (retired legacy)", !isPaidPlan("plus"));
ok("trial is not paid", !isPaidPlan("trial"));
ok("null is not paid", !isPaidPlan(null));
ok("garbage is not paid", !isPaidPlan("enterprise"));

// --- isAnyPaidPlan (broad: live + retired legacy) ---------------------------
ok("isAnyPaidPlan growth", isAnyPaidPlan("growth"));
ok("isAnyPaidPlan premium", isAnyPaidPlan("premium"));
ok("isAnyPaidPlan core (legacy)", isAnyPaidPlan("core"));
ok("isAnyPaidPlan plus (legacy)", isAnyPaidPlan("plus"));
ok("isAnyPaidPlan trial false", !isAnyPaidPlan("trial"));
ok("isAnyPaidPlan free false", !isAnyPaidPlan("free"));
ok("isAnyPaidPlan pilot false", !isAnyPaidPlan("pilot"));
ok("isAnyPaidPlan null false", !isAnyPaidPlan(null));

// --- planForPriceId --------------------------------------------------------
const MAP = { price_growth: "growth" as const, price_premium: "premium" as const };
ok("price→growth", planForPriceId("price_growth", MAP) === "growth");
ok("price→premium", planForPriceId("price_premium", MAP) === "premium");
ok("unknown price→null", planForPriceId("price_unknown", MAP) === null);
ok("null price→null", planForPriceId(null, MAP) === null);
ok("empty map→null", planForPriceId("price_growth", {}) === null);

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

const activeGrowth = buildBillingView({
  plan: "growth",
  subscription_status: "active",
  stripe_subscription_id: "sub_123",
  current_period_end: "2026-07-15T12:00:00Z",
  timezone: "America/Toronto",
});
ok("active growth: planKey", activeGrowth.planKey === "growth");
ok("active growth: label", activeGrowth.planLabel === "Growth");
ok("active growth: isPaid", activeGrowth.isPaid);
ok("active growth: hasSubscription", activeGrowth.hasSubscription);
ok("active growth: no attention", !activeGrowth.needsAttention);
ok("active growth: period end label", activeGrowth.periodEndLabel === "July 15, 2026");
ok("active growth: statusLabel", activeGrowth.statusLabel === "Active");

const activePremium = buildBillingView({
  plan: "premium",
  subscription_status: "active",
  stripe_subscription_id: "sub_321",
  current_period_end: "2026-07-15T12:00:00Z",
  timezone: "America/Toronto",
});
ok("active premium: planKey + label + paid", activePremium.planKey === "premium" && activePremium.planLabel === "Premium" && activePremium.isPaid);

// Legacy core still RECOGNIZED as paid (no live org is on it, but a pre-migration
// org must not silently drop to trial).
const activeCore = buildBillingView({
  plan: "core",
  subscription_status: "active",
  stripe_subscription_id: "sub_legacy",
  current_period_end: "2026-07-15T12:00:00Z",
  timezone: "America/Toronto",
});
ok("legacy core: still planKey core + label Core + paid", activeCore.planKey === "core" && activeCore.planLabel === "Core" && activeCore.isPaid);

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

// --- Pilot tier ------------------------------------------------------------
ok("isPilotPlan true for 'pilot'", isPilotPlan("pilot"));
ok("isPilotPlan false for core/plus/trial/null",
  !isPilotPlan("core") && !isPilotPlan("plus") && !isPilotPlan("trial") && !isPilotPlan(null));
ok("pilot is not a paid plan", !isPaidPlan("pilot"));

ok("formatAmount has no /month suffix", formatAmount(20000) === "$200");
ok("PILOT deposit + duration constants", PILOT_DEPOSIT_CENTS === 20000 && PILOT_DURATION_DAYS === 30);
ok("PILOT config exposes deposit + duration", PILOT.depositCents === 20000 && PILOT.durationDays === 30);

// pilotStatus: never started
{
  const s = pilotStatus(null);
  ok("pilot not started => inactive", !s.started && !s.active && !s.expired && s.daysRemaining === 0);
}
// pilotStatus: day 0 (just started) => ~30 days left, active
{
  const now = new Date("2026-06-15T12:00:00.000Z");
  const s = pilotStatus("2026-06-15T12:00:00.000Z", now);
  ok("pilot just started is active", s.started && s.active && !s.expired);
  ok("pilot day 0 has 30 days left", s.daysRemaining === 30);
  ok("pilot endsAt = +30 days", s.endsAt?.toISOString() === "2026-07-15T12:00:00.000Z");
}
// pilotStatus: mid-window => days remaining counts down (ceil)
{
  const start = "2026-06-01T00:00:00.000Z";
  const now = new Date("2026-06-21T00:00:00.000Z"); // 20 days in -> 10 left
  const s = pilotStatus(start, now);
  ok("pilot mid-window active", s.active && !s.expired);
  ok("pilot mid-window 10 days left", s.daysRemaining === 10);
}
// pilotStatus: just past 30 days => expired, 0 left
{
  const start = "2026-06-01T00:00:00.000Z";
  const now = new Date("2026-07-01T00:00:01.000Z"); // 1s past 30d
  const s = pilotStatus(start, now);
  ok("pilot expired after 30 days", s.started && s.expired && !s.active);
  ok("pilot expired has 0 days left", s.daysRemaining === 0);
}
// pilotStatus: invalid date => not started
ok("pilot invalid date => not started", pilotStatus("not-a-date").started === false);

// buildBillingView: active pilot
{
  const now = new Date("2026-06-20T00:00:00.000Z");
  const v = buildBillingView({
    plan: "pilot",
    subscription_status: null,
    stripe_subscription_id: null,
    current_period_end: null,
    pilot_started_at: "2026-06-15T00:00:00.000Z", // 5 days in -> 25 left
    timezone: "America/Toronto",
    now,
  });
  ok("view pilot planKey + label", v.planKey === "pilot" && v.planLabel === "Pilot");
  ok("view pilot is not paid", v.isPaid === false && v.isPilot === true);
  ok("view pilot active + 25 days left", v.pilotActive && !v.pilotExpired && v.pilotDaysRemaining === 25);
  ok("view pilot ends label present", typeof v.pilotEndsAtLabel === "string");
}
// buildBillingView: expired pilot
{
  const now = new Date("2026-08-01T00:00:00.000Z");
  const v = buildBillingView({
    plan: "pilot",
    subscription_status: null,
    stripe_subscription_id: null,
    current_period_end: null,
    pilot_started_at: "2026-06-15T00:00:00.000Z",
    now,
  });
  ok("view expired pilot flagged", v.isPilot && v.pilotExpired && !v.pilotActive && v.pilotDaysRemaining === 0);
}
// buildBillingView: a paid plan ignores pilot fields
{
  const v = buildBillingView({
    plan: "core",
    subscription_status: "active",
    stripe_subscription_id: "sub_x",
    current_period_end: null,
    pilot_started_at: "2026-06-15T00:00:00.000Z",
  });
  ok("paid plan not treated as pilot", v.isPaid && !v.isPilot && !v.pilotActive);
}

// --- Pilot deposit ---------------------------------------------------------
{
  ok("deposit statuses are none/paid/refunded", DEPOSIT_STATUSES.join(",") === "none,paid,refunded");
  ok("normalize paid", normalizeDepositStatus("paid") === "paid");
  ok("normalize refunded", normalizeDepositStatus("refunded") === "refunded");
  ok("normalize none default for null", normalizeDepositStatus(null) === "none");
  ok("normalize none default for junk", normalizeDepositStatus("whatever") === "none");
  ok("label paid", depositStatusLabel("paid") === "Deposit paid");
  ok("label refunded", depositStatusLabel("refunded") === "Deposit refunded");
  ok("label none", depositStatusLabel("none") === "Deposit not paid");
}
// buildBillingView: active pilot, deposit unpaid -> CTA shown
{
  const now = new Date("2026-06-20T00:00:00.000Z");
  const v = buildBillingView({
    plan: "pilot",
    subscription_status: null,
    stripe_subscription_id: null,
    current_period_end: null,
    pilot_started_at: "2026-06-15T00:00:00.000Z",
    pilot_deposit_status: "none",
    now,
  });
  ok("active pilot unpaid: CTA shown", v.showDepositCta === true);
  ok("active pilot unpaid: not paid", v.depositPaid === false && v.depositRefunded === false);
  ok("active pilot unpaid: default $200 label", v.depositAmountLabel === "$200");
  ok("active pilot unpaid: status label", v.depositStatusLabel === "Deposit not paid");
  ok("active pilot unpaid: no paid date", v.depositPaidAtLabel === null);
}
// buildBillingView: active pilot, deposit paid -> CTA hidden, paid reflected
{
  const now = new Date("2026-06-20T00:00:00.000Z");
  const v = buildBillingView({
    plan: "pilot",
    subscription_status: null,
    stripe_subscription_id: null,
    current_period_end: null,
    pilot_started_at: "2026-06-15T00:00:00.000Z",
    pilot_deposit_status: "paid",
    pilot_deposit_amount_cents: 20000,
    pilot_deposit_paid_at: "2026-06-16T12:00:00.000Z",
    now,
  });
  ok("paid pilot: CTA hidden", v.showDepositCta === false);
  ok("paid pilot: depositPaid true", v.depositPaid === true);
  ok("paid pilot: amount label from collected", v.depositAmountLabel === "$200");
  ok("paid pilot: paid date present", typeof v.depositPaidAtLabel === "string");
}
// buildBillingView: refunded deposit
{
  const v = buildBillingView({
    plan: "pilot",
    subscription_status: null,
    stripe_subscription_id: null,
    current_period_end: null,
    pilot_started_at: "2026-06-15T00:00:00.000Z",
    pilot_deposit_status: "refunded",
    now: new Date("2026-06-20T00:00:00.000Z"),
  });
  ok("refunded pilot: refunded flag", v.depositRefunded === true && v.depositPaid === false);
  ok("refunded pilot: CTA hidden", v.showDepositCta === false);
}
// buildBillingView: expired pilot, unpaid -> no CTA (window over)
{
  const v = buildBillingView({
    plan: "pilot",
    subscription_status: null,
    stripe_subscription_id: null,
    current_period_end: null,
    pilot_started_at: "2026-05-01T00:00:00.000Z",
    pilot_deposit_status: "none",
    now: new Date("2026-06-20T00:00:00.000Z"),
  });
  ok("expired pilot unpaid: no CTA", v.showDepositCta === false);
}
// buildBillingView: trial (no pilot) never shows the deposit CTA
{
  const v = buildBillingView({
    plan: "trial",
    subscription_status: null,
    stripe_subscription_id: null,
    current_period_end: null,
    pilot_deposit_status: "none",
  });
  ok("trial: no deposit CTA", v.showDepositCta === false);
  ok("trial: deposit status none", v.depositStatus === "none");
}

// --- Plan entitlements (S220 feature × tier matrix) ------------------------
// The `sms` gate is LIVE-enforced (sendTenantMessage); its values across the
// legacy plan ladder must NOT change from the S214 mapping (Plus + Pilot only).
ok("canUseSms: trial false", canUseSms("trial") === false);
ok("canUseSms: core false (base paid tier, email only)", canUseSms("core") === false);
ok("canUseSms: plus true (upper paid tier)", canUseSms("plus") === true);
ok("canUseSms: pilot true (full product access)", canUseSms("pilot") === true);
// Unknown / missing plan defaults to the trial entitlements (no paid capability).
ok("canUseSms: unknown plan false", canUseSms("enterprise") === false);
ok("canUseSms: null false", canUseSms(null) === false);
ok("canUseSms: undefined false", canUseSms(undefined) === false);
// planEntitlements normalizes unknown -> trial (same object identity).
ok("planEntitlements unknown -> trial", planEntitlements("nope") === PLAN_ENTITLEMENTS.trial);
ok("planEntitlements plus has sms", planEntitlements("plus").sms === true);
// hasEntitlement is the generic form the typed helpers delegate to.
ok("hasEntitlement(plus, sms) true", hasEntitlement("plus", "sms") === true);
ok("hasEntitlement(core, sms) false", hasEntitlement("core", "sms") === false);
ok(
  "canUseSms mirrors hasEntitlement",
  ["trial", "pilot", "core", "plus", "starter", "growth", "premium", "x", null].every(
    (p) => canUseSms(p) === hasEntitlement(p, "sms"),
  ),
);
// Every entitlement record now carries the full feature set (not just sms).
ok(
  "entitlements map: every plan has all PLAN_FEATURES keys",
  (Object.keys(PLAN_ENTITLEMENTS) as Array<keyof typeof PLAN_ENTITLEMENTS>).every(
    (k) =>
      JSON.stringify(Object.keys(PLAN_ENTITLEMENTS[k]).sort()) ===
      JSON.stringify([...PLAN_FEATURES].sort()),
  ),
);
ok("PLAN_FEATURES has 13 features", PLAN_FEATURES.length === 13);

// --- Renter-facing SMS gate (S296: paid tiers Growth+; Free + trial = false) --
// DEFINED now; not yet wired at the renter call sites (see NEXT-SESSION).
ok("canUseRenterSms: trial false", canUseRenterSms("trial") === false);
ok("canUseRenterSms: free false (email-only funnel)", canUseRenterSms("free") === false);
ok("canUseRenterSms: growth true", canUseRenterSms("growth") === true);
ok("canUseRenterSms: premium true", canUseRenterSms("premium") === true);
ok("canUseRenterSms: pilot true", canUseRenterSms("pilot") === true);
ok("canUseRenterSms: core true (legacy leasing tier)", canUseRenterSms("core") === true);
ok("canUseRenterSms: null false", canUseRenterSms(null) === false);

// --- Rent-collection gate (Growth & up) ------------------------------------
ok("canCollectRentByPlan: free false", canCollectRentByPlan("free") === false);
ok("canCollectRentByPlan: growth true", canCollectRentByPlan("growth") === true);
ok("canCollectRentByPlan: premium true", canCollectRentByPlan("premium") === true);
ok("canCollectRentByPlan: trial false", canCollectRentByPlan("trial") === false);

// --- accounting (Premium only) ---------------------------------------------
ok("accounting: premium only", hasEntitlement("premium", "accounting") === true);
ok("accounting: growth false", hasEntitlement("growth", "accounting") === false);

// --- bank_feed (Growth & up; Free/trial false) -----------------------------
ok("bank_feed: growth true", hasEntitlement("growth", "bank_feed") === true);
ok("bank_feed: premium true", hasEntitlement("premium", "bank_feed") === true);
ok("bank_feed: free false", hasEntitlement("free", "bank_feed") === false);
ok("bank_feed: trial false", hasEntitlement("trial", "bank_feed") === false);

// --- Capture ingress gates (S368: email-in = Growth+, text-in = Premium) ----
ok("capture_email_in: free false (funnel)", canUseCaptureEmailIn("free") === false);
ok("capture_email_in: growth true (mid tier)", canUseCaptureEmailIn("growth") === true);
ok("capture_email_in: premium true", canUseCaptureEmailIn("premium") === true);
ok("capture_email_in: trial false", canUseCaptureEmailIn("trial") === false);
ok("capture_email_in: null false", canUseCaptureEmailIn(null) === false);
ok("capture_text_in: free false", canUseCaptureTextIn("free") === false);
ok("capture_text_in: growth false (gated above email)", canUseCaptureTextIn("growth") === false);
ok("capture_text_in: premium true (upper tier)", canUseCaptureTextIn("premium") === true);
ok("capture_text_in: pilot true (full access)", canUseCaptureTextIn("pilot") === true);
ok(
  "text-in is strictly above email-in (no plan has text without email)",
  (["free", "trial", "core", "plus", "growth", "premium", "pilot"] as const).every(
    (p) => !canUseCaptureTextIn(p) || canUseCaptureEmailIn(p),
  ),
);

// --- Repair-appointment-reminder SMS gate (S387: Premium+, mirrors text-in) --
// The email/in-app reminder legs are ungated; only the SMS leg needs this.
ok("repair_sms: free false", canUseRepairSms("free") === false);
ok("repair_sms: growth false (gated to Premium)", canUseRepairSms("growth") === false);
ok("repair_sms: premium true (upper tier)", canUseRepairSms("premium") === true);
ok("repair_sms: pilot true (full access)", canUseRepairSms("pilot") === true);
ok("repair_sms: trial false", canUseRepairSms("trial") === false);
ok("repair_sms: null false", canUseRepairSms(null) === false);

ok("listing_marketing: free false", canUseListingMarketing("free") === false);
ok("listing_marketing: growth true (paid convenience)", canUseListingMarketing("growth") === true);
ok("listing_marketing: premium true", canUseListingMarketing("premium") === true);
ok("listing_marketing: pilot true (full access)", canUseListingMarketing("pilot") === true);
ok("listing_marketing: core false (legacy non-marketing)", canUseListingMarketing("core") === false);
ok("listing_marketing: trial false", canUseListingMarketing("trial") === false);
ok("listing_marketing: null false", canUseListingMarketing(null) === false);

// --- lease_ocr (Growth & up; S425 paid time-saver, monthly-capped) ----------
ok("lease_ocr: free false", canUseLeaseOcr("free") === false);
ok("lease_ocr: growth true", canUseLeaseOcr("growth") === true);
ok("lease_ocr: premium true", canUseLeaseOcr("premium") === true);
ok("lease_ocr: pilot true (full access)", canUseLeaseOcr("pilot") === true);
ok("lease_ocr: core false", canUseLeaseOcr("core") === false);
ok("lease_ocr: trial false", canUseLeaseOcr("trial") === false);
ok("lease_ocr: null false", canUseLeaseOcr(null) === false);
ok("lease_ocr cap: free 0", leaseOcrMonthlyCap("free") === 0);
ok("lease_ocr cap: growth = growth cap", leaseOcrMonthlyCap("growth") === LEASE_OCR_CAP_GROWTH);
ok("lease_ocr cap: premium = premium cap", leaseOcrMonthlyCap("premium") === LEASE_OCR_CAP_PREMIUM);
ok("lease_ocr cap: pilot = premium cap", leaseOcrMonthlyCap("pilot") === LEASE_OCR_CAP_PREMIUM);
ok("lease_ocr cap: premium > growth", LEASE_OCR_CAP_PREMIUM > LEASE_OCR_CAP_GROWTH);

// --- incident_intake (Growth & up; Option B Slices 1-4) --------------------
ok("incident_intake: growth true", hasEntitlement("growth", "incident_intake") === true);
ok("incident_intake: premium true", hasEntitlement("premium", "incident_intake") === true);
ok("incident_intake: pilot true", hasEntitlement("pilot", "incident_intake") === true);
ok("incident_intake: free false", hasEntitlement("free", "incident_intake") === false);
ok("incident_intake: trial false", hasEntitlement("trial", "incident_intake") === false);
ok("canUseIncidentIntake: growth true", canUseIncidentIntake("growth") === true);
ok("canUseIncidentIntake: free false", canUseIncidentIntake("free") === false);

// --- incident_dispatch (Premium only; the guardrail amendment, Slices 5-7) --
ok("incident_dispatch: premium true", hasEntitlement("premium", "incident_dispatch") === true);
ok("incident_dispatch: pilot true", hasEntitlement("pilot", "incident_dispatch") === true);
ok("incident_dispatch: growth false (intake yes, dispatch no)", hasEntitlement("growth", "incident_dispatch") === false);
ok("incident_dispatch: free false", hasEntitlement("free", "incident_dispatch") === false);
ok("canUseIncidentDispatch: premium true", canUseIncidentDispatch("premium") === true);
ok("canUseIncidentDispatch: growth false", canUseIncidentDispatch("growth") === false);

// --- Live tier ladder shape (Free $0 < Growth $99 < Premium $249) -----------
ok("TIER_KEYS order", JSON.stringify(TIER_KEYS) === '["free","growth","premium"]');
ok("Free $0", TIERS.free.priceCents === 0);
ok("Growth $99", TIERS.growth.priceCents === 9900);
ok("Premium $249", TIERS.premium.priceCents === 24900);
ok(
  "tier prices strictly ascending",
  TIERS.free.priceCents < TIERS.growth.priceCents &&
    TIERS.growth.priceCents < TIERS.premium.priceCents,
);
ok("Growth is the highlighted tier", TIERS.growth.highlight === true);
// S299: the paid tiers now carry their price-id env names, so they are
// config-shape purchasable; Free ($0) is never purchasable. (The live runtime
// gate is isBillingConfigured in lib/stripe.ts, which checks the env VALUES.)
ok("Growth is config-shape purchasable", isTierPurchasable(TIERS.growth) === true);
ok("Premium is config-shape purchasable", isTierPurchasable(TIERS.premium) === true);
ok("Free is $0 and never purchasable", isTierPurchasable(TIERS.free) === false);

// --- Listing allowance (Free funnel cap; config-only until wired) -----------
ok("listing cap: free = 1", TIERS.free.maxActiveListings === 1);
ok("listing cap: growth unlimited", TIERS.growth.maxActiveListings === null);
ok("listing cap: premium unlimited", TIERS.premium.maxActiveListings === null);
ok("listingCapForPlan free -> 1", listingCapForPlan("free") === 1);
ok("listingCapForPlan trial -> free cap (1)", listingCapForPlan("trial") === 1);
ok("listingCapForPlan unknown -> free cap (1)", listingCapForPlan("zzz") === 1);
ok("listingCapForPlan null -> free cap (1)", listingCapForPlan(null) === 1);
ok("listingCapForPlan growth -> unlimited", listingCapForPlan("growth") === null);
ok("listingCapForPlan premium -> unlimited", listingCapForPlan("premium") === null);
ok("listingCapForPlan pilot -> unlimited", listingCapForPlan("pilot") === null);
ok("listingCapForPlan core -> unlimited (legacy paid)", listingCapForPlan("core") === null);
ok("listingCapForPlan plus -> unlimited (legacy paid)", listingCapForPlan("plus") === null);

// --- Photo storage allowance (per-tier) ------------------------------------
// The base cap MUST equal the photos-module constant the uploader validates
// against, or the display and enforcement would disagree.
ok(
  "BASE_PHOTO_CAP matches MAX_PHOTOS_PER_PROPERTY",
  BASE_PHOTO_CAP === MAX_PHOTOS_PER_PROPERTY,
);
ok("Premium cap is higher than base", PREMIUM_PHOTO_CAP > BASE_PHOTO_CAP);

// Every CURRENT plan resolves to the base cap -> wiring this changes no live
// behavior (no live org is on premium). Only premium gets more.
ok("photoCapForPlan trial -> base", photoCapForPlan("trial") === BASE_PHOTO_CAP);
ok("photoCapForPlan core -> base", photoCapForPlan("core") === BASE_PHOTO_CAP);
ok("photoCapForPlan plus -> base", photoCapForPlan("plus") === BASE_PHOTO_CAP);
ok("photoCapForPlan pilot -> base", photoCapForPlan("pilot") === BASE_PHOTO_CAP);
ok("photoCapForPlan free -> base", photoCapForPlan("free") === BASE_PHOTO_CAP);
ok("photoCapForPlan growth -> base", photoCapForPlan("growth") === BASE_PHOTO_CAP);
ok("photoCapForPlan null -> base", photoCapForPlan(null) === BASE_PHOTO_CAP);
ok("photoCapForPlan unknown -> base", photoCapForPlan("zzz") === BASE_PHOTO_CAP);
ok("photoCapForPlan premium -> premium cap", photoCapForPlan("premium") === PREMIUM_PHOTO_CAP);

// --- storageUpsellNote ------------------------------------------------------
{
  // Well under the base cap on a non-premium plan: no nudge.
  const low = storageUpsellNote("free", 3);
  ok("storageUpsell: low count cap = base", low.cap === BASE_PHOTO_CAP);
  ok("storageUpsell: low count remaining", low.remaining === BASE_PHOTO_CAP - 3);
  ok("storageUpsell: low count not at cap", low.atCap === false);
  ok("storageUpsell: low count hidden", low.showUpsell === false);

  // Within 4 of the base cap on a non-premium plan: nudge shows.
  const near = storageUpsellNote("core", BASE_PHOTO_CAP - 2);
  ok("storageUpsell: near cap remaining 2", near.remaining === 2);
  ok("storageUpsell: near cap not at cap", near.atCap === false);
  ok("storageUpsell: near cap shows", near.showUpsell === true);

  // At the base cap on a non-premium plan: nudge shows + atCap.
  const at = storageUpsellNote("plus", BASE_PHOTO_CAP);
  ok("storageUpsell: at cap remaining 0", at.remaining === 0);
  ok("storageUpsell: at cap true", at.atCap === true);
  ok("storageUpsell: at cap shows", at.showUpsell === true);

  // Premium has no higher tier above it -> never nudged, even at its cap.
  const premiumAt = storageUpsellNote("premium", PREMIUM_PHOTO_CAP);
  ok("storageUpsell: premium at cap is atCap", premiumAt.atCap === true);
  ok("storageUpsell: premium never nudged", premiumAt.showUpsell === false);

  // Negative/garbage count floors to 0 used.
  const neg = storageUpsellNote("free", -5);
  ok("storageUpsell: negative count -> used 0", neg.used === 0);
  ok("storageUpsell: negative count remaining = cap", neg.remaining === BASE_PHOTO_CAP);
}

console.log(`\nbilling: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
