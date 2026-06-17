// Unit tests for the pure Stripe Connect rent-rail helpers (lib/stripe-connect.ts).
// The impure pieces (accounts.create / accountLinks.create / accounts.retrieve)
// live in stripe-connect-actions.ts and are covered by the live sandbox flow.
// Run: npx tsx scripts/test-stripe-connect.ts
import {
  ACSS_CAPABILITY,
  ACH_CAPABILITY,
  CONNECT_CAPABILITY_STATUSES,
  normalizeCapabilityStatus,
  capabilityStatusLabel,
  rentCapabilityRequest,
  SUPPORTED_CONNECT_COUNTRIES,
  isSupportedConnectCountry,
  normalizeConnectCountry,
  connectCountryLabel,
  rentMethodForCountry,
  deriveOnboardingState,
  summarizeStripeAccount,
  canCollectRent,
  onboardingStateLabel,
  type RawConnectAccount,
  MANDATE_STATUSES,
  normalizeMandateStatus,
  mandateStatusLabel,
  mandateReady,
  validateStripeTenant,
  buildCustomerCreateParams,
  buildSetupSessionParams,
  parseSetupSession,
  isoToUnixSeconds,
  unixToIsoDate,
  validateRentSubscriptionPrereqs,
  buildSubscriptionParams,
  parseSubscription,
  subscriptionStatusLabel,
  subscriptionIsLive,
} from "../lib/stripe-connect";

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

// --- Capability status normalization ---------------------------------------
ok("statuses are active/inactive/pending/unrequested", CONNECT_CAPABILITY_STATUSES.join(",") === "active,inactive,pending,unrequested");
ok("normalize active", normalizeCapabilityStatus("active") === "active");
ok("normalize pending", normalizeCapabilityStatus("pending") === "pending");
ok("normalize unknown -> unrequested", normalizeCapabilityStatus("weird") === "unrequested");
ok("normalize undefined -> unrequested", normalizeCapabilityStatus(undefined) === "unrequested");
ok("normalize null -> unrequested", normalizeCapabilityStatus(null) === "unrequested");
ok("label active", capabilityStatusLabel("active") === "Enabled");
ok("label pending", capabilityStatusLabel("pending") === "Pending review");
ok("label inactive", capabilityStatusLabel("inactive") === "Not enabled");
ok("label unrequested", capabilityStatusLabel("nope") === "Not requested");

// --- Capability request body ------------------------------------------------
// A connected account has ONE country; we request only that country's bank-debit
// capability (the cross-country one makes accounts.create fail).
ok("CA requests only ACSS", (() => {
  const req = rentCapabilityRequest("CA");
  return req[ACSS_CAPABILITY]?.requested === true && req[ACH_CAPABILITY] === undefined;
})());
ok("US requests only ACH", (() => {
  const req = rentCapabilityRequest("US");
  return req[ACH_CAPABILITY]?.requested === true && req[ACSS_CAPABILITY] === undefined;
})());
ok("default/unknown country -> CA (ACSS only)", (() => {
  const req = rentCapabilityRequest();
  const req2 = rentCapabilityRequest("ZZ");
  return req[ACSS_CAPABILITY]?.requested === true && req[ACH_CAPABILITY] === undefined
    && req2[ACSS_CAPABILITY]?.requested === true && req2[ACH_CAPABILITY] === undefined;
})());
ok("lowercase us normalizes to ACH", rentCapabilityRequest("us")[ACH_CAPABILITY]?.requested === true);
ok("capability keys are the Stripe names", ACSS_CAPABILITY === "acss_debit_payments" && ACH_CAPABILITY === "us_bank_account_ach_payments");

// --- Countries --------------------------------------------------------------
ok("supported = CA, US", SUPPORTED_CONNECT_COUNTRIES.join(",") === "CA,US");
ok("isSupported CA", isSupportedConnectCountry("CA"));
ok("isSupported lower-case ca", isSupportedConnectCountry("ca"));
ok("isSupported rejects GB", !isSupportedConnectCountry("GB"));
ok("normalize us -> US", normalizeConnectCountry("us") === "US");
ok("normalize unknown -> CA", normalizeConnectCountry("ZZ") === "CA");
ok("normalize null -> CA", normalizeConnectCountry(null) === "CA");
ok("label CA", connectCountryLabel("CA") === "Canada");
ok("label US", connectCountryLabel("US") === "United States");

// --- Method/currency per country -------------------------------------------
ok("CA -> acss_debit + cad", (() => {
  const m = rentMethodForCountry("CA");
  return m.method === "acss_debit" && m.currency === "cad";
})());
ok("US -> us_bank_account + usd", (() => {
  const m = rentMethodForCountry("US");
  return m.method === "us_bank_account" && m.currency === "usd";
})());
ok("unknown country falls back to CA/cad", rentMethodForCountry("ZZ").currency === "cad");

// --- deriveOnboardingState --------------------------------------------------
ok("not_started: nothing submitted, no charges", deriveOnboardingState({ detailsSubmitted: false, chargesEnabled: false, acssStatus: "unrequested", achStatus: "unrequested" }) === "not_started");
ok("incomplete: details submitted, capability pending, no charges", deriveOnboardingState({ detailsSubmitted: true, chargesEnabled: false, acssStatus: "pending", achStatus: "unrequested" }) === "incomplete");
ok("incomplete: charges on but no active capability", deriveOnboardingState({ detailsSubmitted: true, chargesEnabled: true, acssStatus: "pending", achStatus: "inactive" }) === "incomplete");
ok("ready: charges on + acss active", deriveOnboardingState({ detailsSubmitted: true, chargesEnabled: true, acssStatus: "active", achStatus: "unrequested" }) === "ready");
ok("ready: charges on + ach active", deriveOnboardingState({ detailsSubmitted: true, chargesEnabled: true, acssStatus: "inactive", achStatus: "active" }) === "ready");
ok("not ready if a capability is active but charges off", deriveOnboardingState({ detailsSubmitted: true, chargesEnabled: false, acssStatus: "active", achStatus: "active" }) === "incomplete");

// --- summarizeStripeAccount -------------------------------------------------
ok("summarize null -> safe empty not_started", (() => {
  const s = summarizeStripeAccount(null);
  return s.connectedAccountId === null && s.chargesEnabled === false && s.acssStatus === "unrequested" && s.onboardingState === "not_started";
})());

ok("summarize a ready CA account", (() => {
  const acct: RawConnectAccount = {
    id: "acct_123",
    country: "CA",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { acss_debit_payments: "active", us_bank_account_ach_payments: "inactive" },
  };
  const s = summarizeStripeAccount(acct);
  return (
    s.connectedAccountId === "acct_123" &&
    s.country === "CA" &&
    s.chargesEnabled === true &&
    s.payoutsEnabled === true &&
    s.detailsSubmitted === true &&
    s.acssStatus === "active" &&
    s.achStatus === "inactive" &&
    s.onboardingState === "ready"
  );
})());

ok("summarize an account mid-onboarding", (() => {
  const acct: RawConnectAccount = {
    id: "acct_mid",
    country: "US",
    charges_enabled: false,
    details_submitted: true,
    capabilities: { us_bank_account_ach_payments: "pending" },
  };
  const s = summarizeStripeAccount(acct);
  return s.onboardingState === "incomplete" && s.achStatus === "pending" && s.acssStatus === "unrequested";
})());

// --- canCollectRent ---------------------------------------------------------
ok("can collect when charges + acss active", canCollectRent({ chargesEnabled: true, acssStatus: "active", achStatus: "unrequested" }));
ok("can collect when charges + ach active", canCollectRent({ chargesEnabled: true, acssStatus: "inactive", achStatus: "active" }));
ok("cannot collect when charges off", !canCollectRent({ chargesEnabled: false, acssStatus: "active", achStatus: "active" }));
ok("cannot collect when no capability active", !canCollectRent({ chargesEnabled: true, acssStatus: "pending", achStatus: "inactive" }));

// --- onboardingStateLabel ---------------------------------------------------
ok("label ready", onboardingStateLabel("ready") === "Ready");
ok("label incomplete", onboardingStateLabel("incomplete") === "Finish setup");
ok("label not_started", onboardingStateLabel("not_started") === "Not started");
ok("label unknown -> Not started", onboardingStateLabel("garbage") === "Not started");

// ===========================================================================
// Increment 2 — tenant mandate + customer helpers
// ===========================================================================

// --- mandate status ---------------------------------------------------------
ok("mandate statuses = none/pending/active/failed", MANDATE_STATUSES.join(",") === "none,pending,active,failed");
ok("normalize mandate active", normalizeMandateStatus("active") === "active");
ok("normalize mandate unknown -> none", normalizeMandateStatus("weird") === "none");
ok("normalize mandate null -> none", normalizeMandateStatus(null) === "none");
ok("mandate label pending", mandateStatusLabel("pending") === "Awaiting tenant authorization");
ok("mandate label active", mandateStatusLabel("active") === "Authorized");
ok("mandate label none", mandateStatusLabel("none") === "Not set up");
ok("mandateReady only when active", mandateReady("active") && !mandateReady("pending") && !mandateReady("none"));

// --- validateStripeTenant ---------------------------------------------------
ok("tenant valid with name+email", (() => {
  const r = validateStripeTenant({ name: "Sam Renter", email: "sam@example.com", phone: "+15195551234" });
  return r.ok && r.value.name === "Sam Renter" && r.value.email === "sam@example.com";
})());
ok("tenant invalid without name", !validateStripeTenant({ name: "  ", email: "sam@example.com", phone: null }).ok);
ok("tenant invalid without email (mandate emails)", !validateStripeTenant({ name: "Sam", email: "", phone: null }).ok);
ok("tenant trims + nulls blank phone", (() => {
  const r = validateStripeTenant({ name: " Sam ", email: " sam@example.com ", phone: "   " });
  return r.ok && r.value.name === "Sam" && r.value.email === "sam@example.com" && r.value.phone === null;
})());

// --- buildCustomerCreateParams ----------------------------------------------
ok("customer params carry name/email/metadata, no bank fields", (() => {
  const p = buildCustomerCreateParams({ name: "Sam", email: "sam@example.com", phone: "+1519" }, "ten_123") as Record<string, unknown>;
  const meta = p.metadata as Record<string, unknown>;
  return p.name === "Sam" && p.email === "sam@example.com" && p.phone === "+1519" && meta.tenancy_id === "ten_123" && !("bank_account" in p) && !("account_number" in p);
})());
ok("customer params omit phone when absent", (() => {
  const p = buildCustomerCreateParams({ name: "Sam", email: "sam@example.com", phone: null }, "ten_1") as Record<string, unknown>;
  return !("phone" in p);
})());

// --- buildSetupSessionParams ------------------------------------------------
ok("CA setup session = acss_debit + cad + mandate_options", (() => {
  const p = buildSetupSessionParams({ country: "CA", customerId: "cus_1", successUrl: "https://x/ok", cancelUrl: "https://x/no" }) as Record<string, unknown>;
  const pmt = p.payment_method_types as string[];
  const pmo = p.payment_method_options as { acss_debit?: { mandate_options?: { payment_schedule?: string; transaction_type?: string } } };
  return (
    p.mode === "setup" &&
    p.customer === "cus_1" &&
    p.currency === "cad" &&
    pmt[0] === "acss_debit" &&
    pmo.acss_debit?.mandate_options?.payment_schedule === "interval" &&
    pmo.acss_debit?.mandate_options?.transaction_type === "personal"
  );
})());
ok("US setup session = us_bank_account + usd, no acss mandate_options", (() => {
  const p = buildSetupSessionParams({ country: "US", customerId: "cus_2", successUrl: "https://x/ok", cancelUrl: "https://x/no" }) as Record<string, unknown>;
  const pmt = p.payment_method_types as string[];
  return p.currency === "usd" && pmt[0] === "us_bank_account" && !("payment_method_options" in p);
})());
ok("unknown country falls back to CA acss", (() => {
  const p = buildSetupSessionParams({ country: "ZZ", customerId: "cus_3", successUrl: "u", cancelUrl: "v" }) as Record<string, unknown>;
  return (p.payment_method_types as string[])[0] === "acss_debit";
})());

// --- parseSetupSession ------------------------------------------------------
ok("setup complete + pm -> active", (() => {
  const r = parseSetupSession({ status: "complete", setup_intent: { status: "succeeded", payment_method: "pm_123" } });
  return r.ok && r.mandateStatus === "active" && r.paymentMethodId === "pm_123";
})());
ok("setup complete + expanded pm object -> active", (() => {
  const r = parseSetupSession({ status: "complete", setup_intent: { payment_method: { id: "pm_obj" } } });
  return r.ok && r.mandateStatus === "active" && r.paymentMethodId === "pm_obj";
})());
ok("setup open -> pending", (() => {
  const r = parseSetupSession({ status: "open", setup_intent: null });
  return r.ok && r.mandateStatus === "pending" && r.paymentMethodId === null;
})());
ok("setup expired -> failed", (() => {
  const r = parseSetupSession({ status: "expired", setup_intent: null });
  return r.ok && r.mandateStatus === "failed";
})());
ok("setup null -> pending (safe)", (() => {
  const r = parseSetupSession(null);
  return r.ok && r.mandateStatus === "pending";
})());

// ===========================================================================
// Increment 3 — monthly rent subscription helpers
// ===========================================================================

// --- date conversion --------------------------------------------------------
ok("isoToUnixSeconds round-trips a date", (() => {
  const u = isoToUnixSeconds("2026-07-01");
  return u !== null && unixToIsoDate(u) === "2026-07-01";
})());
ok("isoToUnixSeconds rejects junk", isoToUnixSeconds("nope") === null);
ok("isoToUnixSeconds rejects impossible date", isoToUnixSeconds("2026-02-31") === null);
ok("unixToIsoDate null on 0/empty", unixToIsoDate(0) === null && unixToIsoDate(null) === null);

// --- validateRentSubscriptionPrereqs ----------------------------------------
ok("prereqs ok when mandate active + pm + rent", (() => {
  const r = validateRentSubscriptionPrereqs({ mandateStatus: "active", paymentMethodId: "pm_1", amountCents: 125000 });
  return r.ok && r.amountCents === 125000 && r.paymentMethodId === "pm_1";
})());
ok("prereqs fail no_mandate when not active", (() => {
  const r = validateRentSubscriptionPrereqs({ mandateStatus: "pending", paymentMethodId: "pm_1", amountCents: 125000 });
  return !r.ok && r.code === "no_mandate";
})());
ok("prereqs fail no_pm when missing pm", (() => {
  const r = validateRentSubscriptionPrereqs({ mandateStatus: "active", paymentMethodId: null, amountCents: 125000 });
  return !r.ok && r.code === "no_pm";
})());
ok("prereqs fail no_rent when amount <= 0", (() => {
  const r = validateRentSubscriptionPrereqs({ mandateStatus: "active", paymentMethodId: "pm_1", amountCents: 0 });
  return !r.ok && r.code === "no_rent";
})());

// --- buildSubscriptionParams ------------------------------------------------
ok("CA subscription = cad inline monthly price + acss + pm + anchor", (() => {
  const p = buildSubscriptionParams({ customerId: "cus_1", paymentMethodId: "pm_1", country: "CA", amountCents: 125000, anchorUnix: 1900000000 }) as Record<string, unknown>;
  const items = p.items as Array<{ price_data?: { currency?: string; unit_amount?: number; recurring?: { interval?: string } } }>;
  const ps = p.payment_settings as { payment_method_types?: string[]; payment_method_options?: { acss_debit?: { mandate_options?: { transaction_type?: string } } } };
  return (
    p.customer === "cus_1" &&
    p.default_payment_method === "pm_1" &&
    p.collection_method === "charge_automatically" &&
    p.proration_behavior === "none" &&
    p.billing_cycle_anchor === 1900000000 &&
    items[0].price_data?.currency === "cad" &&
    items[0].price_data?.unit_amount === 125000 &&
    items[0].price_data?.recurring?.interval === "month" &&
    ps.payment_method_types?.[0] === "acss_debit" &&
    ps.payment_method_options?.acss_debit?.mandate_options?.transaction_type === "personal"
  );
})());
ok("US subscription = usd + us_bank_account, no acss options", (() => {
  const p = buildSubscriptionParams({ customerId: "cus_2", paymentMethodId: "pm_2", country: "US", amountCents: 90000 }) as Record<string, unknown>;
  const items = p.items as Array<{ price_data?: { currency?: string } }>;
  const ps = p.payment_settings as { payment_method_types?: string[]; payment_method_options?: unknown };
  return items[0].price_data?.currency === "usd" && ps.payment_method_types?.[0] === "us_bank_account" && ps.payment_method_options === undefined && !("billing_cycle_anchor" in p);
})());

// --- parseSubscription ------------------------------------------------------
ok("parse subscription ok", (() => {
  const r = parseSubscription({ id: "sub_1", status: "active", current_period_end: isoToUnixSeconds("2026-08-01")! });
  return r.ok && r.subscriptionId === "sub_1" && r.status === "active" && r.currentPeriodEnd === "2026-08-01";
})());
ok("parse subscription fails without id", (() => {
  const r = parseSubscription({ status: "active" });
  return !r.ok;
})());
ok("parse subscription defaults status to incomplete", (() => {
  const r = parseSubscription({ id: "sub_2" });
  return r.ok && r.status === "incomplete";
})());

// --- subscription status labels / live --------------------------------------
ok("label active", subscriptionStatusLabel("active") === "Active");
ok("label past_due", subscriptionStatusLabel("past_due") === "Payment overdue");
ok("label unknown -> Unknown", subscriptionStatusLabel("zzz") === "Unknown");
ok("live for active/past_due/incomplete", subscriptionIsLive("active") && subscriptionIsLive("past_due") && subscriptionIsLive("incomplete"));
ok("not live for canceled", !subscriptionIsLive("canceled"));

console.log(`\nstripe-connect: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
