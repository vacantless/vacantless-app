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
ok("request asks for both rails", (() => {
  const req = rentCapabilityRequest();
  return req[ACSS_CAPABILITY]?.requested === true && req[ACH_CAPABILITY]?.requested === true;
})());
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

console.log(`\nstripe-connect: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
