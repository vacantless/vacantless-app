// Stripe Connect rent-collection helpers (platform pivot step 2, ALT provider; S215).
//
// MODEL: STANDARD connected account + DIRECT charges. The LANDLORD is the
// merchant of record; funds settle to their Stripe account; the platform never
// holds funds and is not liable for negative balances. We store only the
// connected account id (acct_...) + a cached status snapshot — no secret key,
// no bank numbers. All Stripe SDK calls live in the server action
// (stripe-connect-actions.ts), the same way billing/actions.ts calls stripe.*
// directly; THIS module is PURE so it unit-tests without env or network
// (scripts/test-stripe-connect.ts).
//
// Capabilities we request on every connected account:
//   * acss_debit_payments         — Canada pre-authorized debit (PAD), CAD
//   * us_bank_account_ach_payments — US ACH Direct Debit, USD
// Currency is driven off the connected account's country (CAD for CA, USD for US).

// --- Capabilities -----------------------------------------------------------

export const ACSS_CAPABILITY = "acss_debit_payments" as const;
export const ACH_CAPABILITY = "us_bank_account_ach_payments" as const;

export const CONNECT_CAPABILITY_STATUSES = ["active", "inactive", "pending", "unrequested"] as const;
export type ConnectCapabilityStatus = (typeof CONNECT_CAPABILITY_STATUSES)[number];

/** A capability Stripe hasn't surfaced (undefined/null/unknown) reads 'unrequested'. */
export function normalizeCapabilityStatus(value: unknown): ConnectCapabilityStatus {
  return typeof value === "string" && (CONNECT_CAPABILITY_STATUSES as readonly string[]).includes(value)
    ? (value as ConnectCapabilityStatus)
    : "unrequested";
}

const CAPABILITY_STATUS_LABELS: Record<ConnectCapabilityStatus, string> = {
  active: "Enabled",
  pending: "Pending review",
  inactive: "Not enabled",
  unrequested: "Not requested",
};

export function capabilityStatusLabel(value: unknown): string {
  return CAPABILITY_STATUS_LABELS[normalizeCapabilityStatus(value)];
}

/**
 * The capabilities object to request when creating a connected account. Both
 * rent rails are requested up front; the connected account agrees to them
 * during Stripe-hosted onboarding.
 */
export function rentCapabilityRequest(): Record<string, { requested: true }> {
  return {
    [ACSS_CAPABILITY]: { requested: true },
    [ACH_CAPABILITY]: { requested: true },
  };
}

// --- Supported countries -----------------------------------------------------

export const SUPPORTED_CONNECT_COUNTRIES = ["CA", "US"] as const;
export type ConnectCountry = (typeof SUPPORTED_CONNECT_COUNTRIES)[number];

export function isSupportedConnectCountry(value: unknown): value is ConnectCountry {
  return typeof value === "string" && (SUPPORTED_CONNECT_COUNTRIES as readonly string[]).includes(value.toUpperCase());
}

/** Coerce a country to a supported one. Unknown -> CA (the primary market). */
export function normalizeConnectCountry(value: unknown): ConnectCountry {
  return isSupportedConnectCountry(value) ? (String(value).toUpperCase() as ConnectCountry) : "CA";
}

const COUNTRY_LABELS: Record<ConnectCountry, string> = {
  CA: "Canada",
  US: "United States",
};

export function connectCountryLabel(value: unknown): string {
  return COUNTRY_LABELS[normalizeConnectCountry(value)];
}

/** The bank-debit method + presentment currency a connected account collects. */
export function rentMethodForCountry(value: unknown): { method: "acss_debit" | "us_bank_account"; currency: "cad" | "usd"; label: string } {
  return normalizeConnectCountry(value) === "US"
    ? { method: "us_bank_account", currency: "usd", label: "US ACH debit" }
    : { method: "acss_debit", currency: "cad", label: "Canada pre-authorized debit" };
}

// --- Account status summary --------------------------------------------------

export const ONBOARDING_STATES = ["not_started", "incomplete", "ready"] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

// Structural shape of the bits of a Stripe.Account we read. Typed locally so
// this module stays free of the Stripe SDK import (keeps tests hermetic).
export type RawConnectAccount = {
  id?: string | null;
  country?: string | null;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  capabilities?: {
    acss_debit_payments?: string | null;
    us_bank_account_ach_payments?: string | null;
  } | null;
};

export type ConnectAccountSummary = {
  connectedAccountId: string | null;
  country: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  acssStatus: ConnectCapabilityStatus;
  achStatus: ConnectCapabilityStatus;
  onboardingState: OnboardingState;
};

/**
 * Derive the onboarding lifecycle from the account snapshot. Pure.
 *   * not_started — Stripe form never entered (no details submitted, no charges)
 *   * ready       — can actually collect: charges enabled AND at least one rent
 *                   capability active
 *   * incomplete  — everything in between (details submitted but a capability is
 *                   still pending, or charges not yet enabled)
 */
export function deriveOnboardingState(input: {
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  acssStatus: ConnectCapabilityStatus;
  achStatus: ConnectCapabilityStatus;
}): OnboardingState {
  const anyRentCapabilityActive = input.acssStatus === "active" || input.achStatus === "active";
  if (input.chargesEnabled && anyRentCapabilityActive) return "ready";
  if (!input.detailsSubmitted && !input.chargesEnabled) return "not_started";
  return "incomplete";
}

/** Map a (structural) Stripe account object to our cached summary. Pure. */
export function summarizeStripeAccount(account: RawConnectAccount | null | undefined): ConnectAccountSummary {
  const a = account ?? {};
  const acssStatus = normalizeCapabilityStatus(a.capabilities?.acss_debit_payments);
  const achStatus = normalizeCapabilityStatus(a.capabilities?.us_bank_account_ach_payments);
  const chargesEnabled = a.charges_enabled === true;
  const detailsSubmitted = a.details_submitted === true;
  return {
    connectedAccountId: typeof a.id === "string" ? a.id : null,
    country: typeof a.country === "string" ? a.country : null,
    chargesEnabled,
    payoutsEnabled: a.payouts_enabled === true,
    detailsSubmitted,
    acssStatus,
    achStatus,
    onboardingState: deriveOnboardingState({ detailsSubmitted, chargesEnabled, acssStatus, achStatus }),
  };
}

/** Can this connection actually collect rent right now? Pure. */
export function canCollectRent(summary: Pick<ConnectAccountSummary, "chargesEnabled" | "acssStatus" | "achStatus">): boolean {
  return summary.chargesEnabled && (summary.acssStatus === "active" || summary.achStatus === "active");
}

const ONBOARDING_STATE_LABELS: Record<OnboardingState, string> = {
  not_started: "Not started",
  incomplete: "Finish setup",
  ready: "Ready",
};

export function onboardingStateLabel(value: unknown): string {
  const s = typeof value === "string" && (ONBOARDING_STATES as readonly string[]).includes(value)
    ? (value as OnboardingState)
    : "not_started";
  return ONBOARDING_STATE_LABELS[s];
}

// ===========================================================================
// Increment 2 — collect a tenant PAD/ACH mandate + customer on the connected
// account. The mandate is collected through a hosted Checkout SETUP session
// (mode=setup; ACSS/ACH are supported there — only Checkout SUBSCRIPTION mode
// is not, which is why increment 3 drives the subscription off the saved
// payment method instead). All Stripe SDK calls live in the action; the params
// builder, validation, and response parsing are PURE here and unit-tested.
// ===========================================================================

export const MANDATE_STATUSES = ["none", "pending", "active", "failed"] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

export function normalizeMandateStatus(value: unknown): MandateStatus {
  return typeof value === "string" && (MANDATE_STATUSES as readonly string[]).includes(value)
    ? (value as MandateStatus)
    : "none";
}

const MANDATE_STATUS_LABELS: Record<MandateStatus, string> = {
  none: "Not set up",
  pending: "Awaiting tenant authorization",
  active: "Authorized",
  failed: "Authorization failed",
};

export function mandateStatusLabel(value: unknown): string {
  return MANDATE_STATUS_LABELS[normalizeMandateStatus(value)];
}

/** Rent can be scheduled (increment 3) only once the mandate is active. Pure. */
export function mandateReady(value: unknown): boolean {
  return normalizeMandateStatus(value) === "active";
}

export type StripeTenantInput = {
  name: string;
  email: string | null;
  phone: string | null;
};

export type StripeTenantValidation =
  | { ok: true; value: StripeTenantInput }
  | { ok: false; error: string };

/**
 * Validate the primary tenant before creating a Stripe customer + mandate. A
 * NAME is required; an EMAIL is required too because ACSS/ACH send the mandate
 * confirmation + debit notifications by email (a network rule). Pure.
 */
export function validateStripeTenant(raw: {
  name: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
}): StripeTenantValidation {
  const name = (raw.name ?? "").trim();
  if (!name) return { ok: false, error: "The primary tenant needs a name before setting up Stripe rent collection." };
  const email = (raw.email ?? "").trim() || null;
  if (!email) return { ok: false, error: "The primary tenant needs an email — bank debit mandates and notices are sent there." };
  const phone = (raw.phone ?? "").trim() || null;
  return { ok: true, value: { name, email, phone } };
}

/** Customer.create params for the connected account (no bank data). Pure. */
export function buildCustomerCreateParams(input: StripeTenantInput, tenancyId: string): Record<string, unknown> {
  const params: Record<string, unknown> = {
    name: input.name,
    email: input.email ?? undefined,
    metadata: { tenancy_id: tenancyId },
  };
  if (input.phone) params.phone = input.phone;
  return params;
}

/**
 * Build the Checkout SETUP-session params that collect a reusable bank mandate
 * for the tenancy's country. For CA we add the required ACSS mandate_options
 * (interval schedule, personal). The session attaches the saved payment method
 * to `customerId` on completion. Pure — the action passes this straight to
 * stripe.checkout.sessions.create({...}, { stripeAccount }).
 */
export function buildSetupSessionParams(args: {
  country: unknown;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
}): Record<string, unknown> {
  const { method, currency } = rentMethodForCountry(args.country);
  const base: Record<string, unknown> = {
    mode: "setup",
    customer: args.customerId,
    // setup mode with dynamic payment methods requires a currency
    currency,
    payment_method_types: [method],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
  };
  if (method === "acss_debit") {
    base.payment_method_options = {
      acss_debit: {
        currency: "cad",
        mandate_options: {
          payment_schedule: "interval",
          interval_description: "Monthly rent",
          transaction_type: "personal",
        },
      },
    };
  }
  return base;
}

export type SetupSessionParse =
  | { ok: true; paymentMethodId: string | null; mandateStatus: MandateStatus }
  | { ok: false; message: string };

/**
 * Classify a retrieved Checkout setup Session (with its SetupIntent expanded).
 * status "complete" + a payment_method => active; "open" => still pending;
 * "expired" => failed. Pure so it's unit-testable without the SDK.
 */
export function parseSetupSession(session: {
  status?: string | null;
  setup_intent?: { status?: string | null; payment_method?: string | { id?: string } | null } | null;
} | null | undefined): SetupSessionParse {
  const s = session ?? {};
  const si = s.setup_intent ?? null;
  const pmRaw = si?.payment_method ?? null;
  const paymentMethodId = typeof pmRaw === "string" ? pmRaw : (pmRaw && typeof pmRaw === "object" && typeof pmRaw.id === "string" ? pmRaw.id : null);

  if (s.status === "complete" && paymentMethodId) {
    return { ok: true, paymentMethodId, mandateStatus: "active" };
  }
  if (s.status === "expired") {
    return { ok: true, paymentMethodId: null, mandateStatus: "failed" };
  }
  // open / processing / complete-without-pm-yet -> still pending
  return { ok: true, paymentMethodId, mandateStatus: "pending" };
}
