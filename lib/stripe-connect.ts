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
// Stripe requires every connected account to request a CORE capability
// (card_payments or transfers), and card_payments cannot be requested WITHOUT
// transfers ("Accounts do not currently support card_payments without
// transfers"). So we request BOTH — the standard pair every Standard account
// gets — in addition to the country's bank-debit rail used for rent.
export const CARD_CAPABILITY = "card_payments" as const;
export const TRANSFERS_CAPABILITY = "transfers" as const;

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
 * The capabilities to request when creating a connected account. A connected
 * account has exactly ONE country, and a bank-debit capability is only valid in
 * its own country: acss_debit_payments is Canada-only, us_bank_account_ach_payments
 * is US-only. Requesting the cross-country capability makes accounts.create fail
 * ("not available for accounts in CA/US"), so we request only the capability that
 * matches the account's country. "One rail covers CA + US" means the INTEGRATION
 * supports both — each connected account still only does its own country's method.
 * Unknown country defaults to CA (the primary market).
 */
export function rentCapabilityRequest(country?: unknown): Record<string, { requested: true }> {
  const bankDebit =
    normalizeConnectCountry(country) === "US" ? ACH_CAPABILITY : ACSS_CAPABILITY;
  return {
    // Core capabilities Stripe requires on every Standard account. card_payments
    // can't be requested without transfers, so request both (the standard pair).
    [CARD_CAPABILITY]: { requested: true },
    [TRANSFERS_CAPABILITY]: { requested: true },
    // The country-appropriate bank-debit rail for rent.
    [bankDebit]: { requested: true },
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
        // S816h: Stripe refuses payment_schedule and interval_description
        // alongside default_for (400 on checkout/sessions, 2026-11-18); the
        // subscription itself sets the monthly schedule.
        mandate_options: {
          transaction_type: "personal",
          // S816h: without this the mandate is not used for the subscription's
          // invoices: the $5 test's first debit (2026-11-18) stayed incomplete
          // with no mandate and Stripe ended the subscription. Stripe's guide
          // (billing/subscriptions/acss-debit, "saving payment method details
          // for future use") asks for default_for invoice + subscription.
          default_for: ["invoice", "subscription"],
        },
      },
    };
  }
  return base;
}

/**
 * S835b (REVIEW-S835 finding 4): the bank link already made for this tenant,
 * if it can still be used. Making a new link each time left the tenant
 * finishing on an old one that nothing was watching. Pure.
 */
export function reusableSetupLink(
  session: { status?: string | null; url?: string | null; expires_at?: number | null } | null | undefined,
  nowUnix: number,
): { url: string; expiresAtUnix: number | null } | null {
  if (!session || session.status !== "open") return null;
  const url = typeof session.url === "string" ? session.url.trim() : "";
  if (!/^https:\/\//.test(url)) return null;
  const exp = typeof session.expires_at === "number" && session.expires_at > 0 ? session.expires_at : null;
  // Under ten minutes left is not worth sending to a tenant.
  if (exp != null && exp - nowUnix < 600) return null;
  return { url, expiresAtUnix: exp };
}

/** S835b (finding 6): does Stripe bill a different amount than the rent on file? Pure. */
export function billedDiffersFromRent(billedCents: number | null | undefined, rentCents: number | null | undefined): boolean {
  if (typeof billedCents !== "number" || billedCents <= 0) return false;
  if (typeof rentCents !== "number" || rentCents <= 0) return false;
  return Math.round(billedCents) !== Math.round(rentCents);
}

/**
 * S835b (finding 3): may the edit form set this tenancy to Ended? Not while
 * rent is still collecting: only End tenancy stops the debit. Pure.
 */
export function editMayEndTenancy(input: {
  currentStatus: unknown;
  nextStatus: unknown;
  subscriptionId: unknown;
  subscriptionStatus: unknown;
  rotessaScheduleId: unknown;
}): boolean {
  if (input.nextStatus !== "ended" || input.currentStatus === "ended") return true;
  const stripeLive =
    typeof input.subscriptionId === "string" && input.subscriptionId.trim() !== "" && subscriptionIsLive(input.subscriptionStatus);
  const rotessaLive = typeof input.rotessaScheduleId === "string" && input.rotessaScheduleId.trim() !== "";
  return !stripeLive && !rotessaLive;
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

// ===========================================================================
// Increment 3 — monthly rent subscription off the saved payment method.
// Checkout SUBSCRIPTION mode doesn't support ACSS, so we create the
// subscription through the Billing/Subscriptions API directly on the connected
// account (Stripe-Account header), using the increment-2 payment method as the
// default and an inline monthly price. Params builder + validation + parsing
// are PURE here; the action does the single impure subscriptions.create.
// ===========================================================================

/** "YYYY-MM-DD" -> Unix seconds at 12:00 UTC (a safe future anchor). null if bad. */
export function isoToUnixSeconds(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(ms / 1000);
}

export type RentSubscriptionPrereqs =
  | { ok: true; amountCents: number; paymentMethodId: string }
  | { ok: false; code: "no_mandate" | "no_pm" | "no_rent" };

/** Gate subscription creation: mandate active + a saved pm + a positive rent. Pure. */
export function validateRentSubscriptionPrereqs(input: {
  mandateStatus: unknown;
  paymentMethodId: string | null | undefined;
  amountCents: number | null | undefined;
}): RentSubscriptionPrereqs {
  if (!mandateReady(input.mandateStatus)) return { ok: false, code: "no_mandate" };
  const pm = (input.paymentMethodId ?? "").trim();
  if (!pm) return { ok: false, code: "no_pm" };
  const amount = input.amountCents ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, code: "no_rent" };
  return { ok: true, amountCents: Math.round(amount), paymentMethodId: pm };
}

/**
 * Build the subscriptions.create params for monthly rent on the connected
 * account. Inline monthly price (no Product/Price to manage), the saved bank pm
 * as default, charge_automatically, and the country's bank-debit method in
 * payment_settings (ACSS carries its personal mandate option). An optional
 * future billing_cycle_anchor sets the first charge date with no proration. Pure.
 */
export function buildSubscriptionParams(args: {
  customerId: string;
  paymentMethodId: string;
  productId: string;
  country: unknown;
  amountCents: number;
  anchorUnix?: number | null;
  /** S835a: stamped on the subscription so it can be traced back at Stripe. */
  tenancyId?: string | null;
}): Record<string, unknown> {
  const { method, currency } = rentMethodForCountry(args.country);
  const paymentSettings: Record<string, unknown> = {
    payment_method_types: [method],
    save_default_payment_method: "on_subscription",
  };
  if (method === "acss_debit") {
    paymentSettings.payment_method_options = {
      acss_debit: { mandate_options: { transaction_type: "personal" } },
    };
  }
  const params: Record<string, unknown> = {
    customer: args.customerId,
    default_payment_method: args.paymentMethodId,
    collection_method: "charge_automatically",
    proration_behavior: "none",
    items: [
      {
        // Subscription items' price_data requires an existing `product` id —
        // inline `product_data` is NOT supported here (only on Checkout line
        // items). So the action creates/ensures a Product first and passes it in.
        price_data: {
          currency,
          product: args.productId,
          unit_amount: Math.round(args.amountCents),
          recurring: { interval: "month" },
        },
      },
    ],
    payment_settings: paymentSettings,
    metadata: { source: RENT_SUBSCRIPTION_SOURCE, ...(args.tenancyId ? { tenancy_id: args.tenancyId } : {}) },
  };
  if (args.anchorUnix && args.anchorUnix > 0) {
    params.billing_cycle_anchor = args.anchorUnix;
  }
  return params;
}

// S835a (REVIEW-S835 finding 2): one tenancy must never get two rent
// subscriptions. Two guards, both pure here:
//   * the idempotency key makes Stripe answer a repeated create (a retry, a
//     second tab, a save that failed after Stripe said yes) with the SAME
//     subscription instead of making another. The previous subscription id is
//     part of the key, so a real restart after a stop gets a fresh key.
//   * before creating, the action lists the customer's subscriptions and
//     adopts a live Vacantless one instead of creating a second.
export const RENT_SUBSCRIPTION_SOURCE = "vacantless_rent";

export function rentSubscriptionIdempotencyKey(input: {
  tenancyId: string;
  amountCents: number;
  firstChargeIso: string;
  previousSubscriptionId?: string | null;
}): string {
  const prev = (input.previousSubscriptionId ?? "").trim() || "first";
  return `vl-rent-${input.tenancyId}-${Math.round(input.amountCents)}-${input.firstChargeIso.trim()}-${prev}`;
}

/** The customer's live rent subscription made by Vacantless, if any. Pure. */
export function findLiveRentSubscription(
  subs: Array<{ id?: string | null; status?: string | null; metadata?: Record<string, string> | null }> | null | undefined,
): { id: string; status: string } | null {
  for (const s of subs ?? []) {
    if (!s || typeof s.id !== "string" || !s.id) continue;
    if (!subscriptionIsLive(s.status)) continue;
    if (s.metadata?.source !== RENT_SUBSCRIPTION_SOURCE) continue;
    return { id: s.id, status: String(s.status) };
  }
  return null;
}

/** S835a (finding 1): tenancies whose rent is still running on Stripe. Pure. */
export function countLiveStripeRent(
  rows: Array<{ stripe_subscription_id?: string | null; stripe_subscription_status?: string | null }> | null | undefined,
): number {
  return (rows ?? []).filter((r) => !!r?.stripe_subscription_id && subscriptionIsLive(r.stripe_subscription_status)).length;
}

export type ParsedSubscription =
  | { ok: true; subscriptionId: string; status: string; currentPeriodEnd: string | null }
  | { ok: false; message: string };

/** Unix seconds -> "YYYY-MM-DD" (UTC). null for falsy/invalid. Pure. */
export function unixToIsoDate(secs: number | null | undefined): string | null {
  if (!secs || !Number.isFinite(secs) || secs <= 0) return null;
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

/** Classify a subscriptions.create / retrieve response. Pure. */
export function parseSubscription(sub: {
  id?: string | null;
  status?: string | null;
  current_period_end?: number | null;
} | null | undefined): ParsedSubscription {
  const s = sub ?? {};
  const id = typeof s.id === "string" && s.id.trim() ? s.id.trim() : null;
  if (!id) return { ok: false, message: "Stripe returned no subscription id." };
  const status = typeof s.status === "string" ? s.status : "incomplete";
  return { ok: true, subscriptionId: id, status, currentPeriodEnd: unixToIsoDate(s.current_period_end) };
}

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Active (scheduled)",
  past_due: "Payment overdue",
  unpaid: "Unpaid",
  incomplete: "Awaiting first payment",
  incomplete_expired: "Setup expired",
  canceled: "Stopped",
  paused: "Paused",
};

export function subscriptionStatusLabel(status: unknown): string {
  return (typeof status === "string" && SUBSCRIPTION_STATUS_LABELS[status]) || "Unknown";
}

/** Is the subscription still on the hook to collect (not canceled/expired)? Pure. */
export function subscriptionIsLive(status: unknown): boolean {
  return typeof status === "string" && ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(status);
}

// ===========================================================================
// S796: stop monthly rent + payment summary. Pure decisions only; the impure
// Stripe calls live in lib/stripe-rent-stop.ts.
// ===========================================================================

/** What stopping rent has to do for this tenancy. Pure. */
export type RentStopPlan = "none" | "cancel_subscription" | "cancel_schedule_then_subscription";
export function planRentStop(input: {
  subscriptionId: unknown;
  subscriptionStatus: unknown;
  scheduleId: unknown;
}): RentStopPlan {
  const hasSub = typeof input.subscriptionId === "string" && input.subscriptionId.trim() !== "";
  if (!hasSub) return "none";
  if (!subscriptionIsLive(input.subscriptionStatus)) return "none";
  const hasSchedule = typeof input.scheduleId === "string" && input.scheduleId.trim() !== "";
  return hasSchedule ? "cancel_schedule_then_subscription" : "cancel_subscription";
}

/** May a new rent subscription be created on this tenancy? Pure. A stopped
 *  (canceled / expired) subscription no longer blocks a restart. */
export function canCreateRentSubscription(input: {
  subscriptionId: unknown;
  subscriptionStatus: unknown;
}): boolean {
  const hasSub = typeof input.subscriptionId === "string" && input.subscriptionId.trim() !== "";
  if (!hasSub) return true;
  return !subscriptionIsLive(input.subscriptionStatus);
}

export type RentPaymentState = "paid" | "processing" | "failed";
export type RentPaymentSummary = {
  nextChargeIso: string | null;
  lastPaymentIso: string | null;
  lastPaymentCents: number | null;
  lastPaymentState: RentPaymentState | null;
  /** Day of the month the subscription bills on (1 to 31), when known. */
  anchorDay: number | null;
  /** S835b: what Stripe bills each month right now, in cents, when known. */
  billedCents: number | null;
};

type SummarySub = {
  status?: string | null;
  billing_cycle_anchor?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean | null;
  items?: { data?: Array<{ current_period_end?: number | null; quantity?: number | null; price?: { unit_amount?: number | null } | null }> | null } | null;
};
type SummaryInvoice = {
  status?: string | null;
  amount_due?: number | null;
  amount_paid?: number | null;
  created?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
};

/**
 * Next debit date + the most recent real (non-zero) rent debit, from a
 * subscription and its invoices. Pure.
 *   * next = the current period end (item-level on newer API versions, top
 *     level on older ones), only while the subscription is live and not set to
 *     end at the period end.
 *   * last = the newest invoice with money due. The $0 invoice Stripe cuts for
 *     the stub period before the first charge date is skipped. Bank debits sit
 *     "open" for a few business days, so open = processing, unless the
 *     subscription is past_due / unpaid, which means the debit bounced.
 */
export function summarizeRentPayments(
  sub: SummarySub | null | undefined,
  invoices: SummaryInvoice[] | null | undefined,
): RentPaymentSummary {
  const out: RentPaymentSummary = {
    nextChargeIso: null,
    lastPaymentIso: null,
    lastPaymentCents: null,
    lastPaymentState: null,
    anchorDay: null,
    billedCents: null,
  };
  const status = typeof sub?.status === "string" ? sub.status : null;
  const unit = sub?.items?.data?.[0]?.price?.unit_amount;
  if (typeof unit === "number" && unit > 0) {
    const qty = sub?.items?.data?.[0]?.quantity;
    out.billedCents = unit * (typeof qty === "number" && qty > 0 ? qty : 1);
  }
  if (typeof sub?.billing_cycle_anchor === "number" && sub.billing_cycle_anchor > 0) {
    out.anchorDay = new Date(sub.billing_cycle_anchor * 1000).getUTCDate();
  }
  if (sub && subscriptionIsLive(status) && sub.cancel_at_period_end !== true) {
    const item = sub.items?.data?.[0]?.current_period_end;
    const end = typeof item === "number" ? item : typeof sub.current_period_end === "number" ? sub.current_period_end : null;
    out.nextChargeIso = unixToIsoDate(end);
  }
  const real = (invoices ?? [])
    .filter((i) => i && typeof i.amount_due === "number" && i.amount_due > 0 && i.status !== "void" && i.status !== "draft")
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const last = real[0];
  if (last) {
    if (last.status === "paid") {
      out.lastPaymentState = "paid";
      out.lastPaymentIso = unixToIsoDate(last.status_transitions?.paid_at ?? last.created);
      out.lastPaymentCents = typeof last.amount_paid === "number" && last.amount_paid > 0 ? last.amount_paid : last.amount_due ?? null;
    } else {
      // S816h: an unpaid invoice on an ended subscription was never collected
      // (the $5 test read "processing at the bank" after Stripe ended it).
      const bounced =
        last.status === "uncollectible" ||
        status === "past_due" ||
        status === "unpaid" ||
        status === "canceled" ||
        status === "incomplete_expired";
      out.lastPaymentState = bounced ? "failed" : "processing";
      out.lastPaymentIso = unixToIsoDate(last.created);
      out.lastPaymentCents = last.amount_due ?? null;
    }
  }
  return out;
}

/**
 * S796d: how a landlord's connected account is set up, so Vacantless pays
 * Stripe nothing. Pure.
 *   * fees.payer "account": the landlord pays Stripe's payment fee directly.
 *     Stripe charges no Connect fees (the per-account and per-payout fees) to
 *     the landlord or to the platform. type "express" set this to
 *     "application_express", which bills those Connect fees to the platform.
 *   * losses.payments "stripe": Stripe, not the platform, carries a negative
 *     balance the landlord can't repay.
 *   * stripe_dashboard "full": Stripe rejects "express" with these settings
 *     ("your platform must collect fees and be liable for negative balances"
 *     - checked live 2026-11-15), so the landlord gets the full Stripe
 *     dashboard and signs in to Stripe themselves. That is the price of the
 *     platform paying nothing.
 * Never pass `type` with these: the controller settings replace it.
 * Stripe: docs.stripe.com/connect/migrate-to-controller-properties
 */
export function connectAccountController(): {
  fees: { payer: "account" };
  losses: { payments: "stripe" };
  requirement_collection: "stripe";
  stripe_dashboard: { type: "full" };
} {
  return {
    fees: { payer: "account" },
    losses: { payments: "stripe" },
    requirement_collection: "stripe",
    stripe_dashboard: { type: "full" },
  };
}

/** Does this connected account bill Connect fees to the platform? Pure.
 *  True for accounts made the old way (type "express"). */
export function connectAccountBillsPlatform(feesPayer: unknown): boolean {
  return typeof feesPayer === "string" && feesPayer.startsWith("application");
}

/**
 * S796c: the upcoming monthly payment dates, starting with the next one, so a
 * landlord can pick the LAST payment ahead of time. Pure. Stripe bills on the
 * anchor day each month and uses the month's last day when the month is
 * shorter (anchor 31 bills Feb 28, then Mar 31).
 */
export function upcomingChargeDates(
  nextChargeIso: string | null | undefined,
  anchorDay: number | null | undefined,
  count = 12,
): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((nextChargeIso ?? "").trim());
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const firstDay = Number(m[3]);
  const day = anchorDay && anchorDay >= firstDay && anchorDay <= 31 ? anchorDay : firstDay;
  const out: string[] = [m[0]];
  for (let i = 1; i < Math.max(1, Math.min(count, 36)); i++) {
    const monthIndex = mo + i;
    const yy = y + Math.floor(monthIndex / 12);
    const mm = ((monthIndex % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    const dd = Math.min(day, lastDay);
    out.push(`${yy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
  }
  return out;
}

/** Days after the last-payment date at which a scheduled stop fires even if
 *  the payment still has not shown as paid. Shorter than any month, so the
 *  next monthly debit can never run. */
export const RENT_STOP_GRACE_DAYS = 14;

function addDaysIso(iso: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days, 12);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * S796b: is it time to carry out a scheduled "stop after the last payment"?
 * Pure. The landlord's rule: let the final payment go through, then stop.
 *   * before the last-payment date: wait.
 *   * the final payment was issued (the next charge date has moved past the
 *     stop date) and it shows paid: stop.
 *   * otherwise wait, but never past the grace window, so a slow or failed
 *     final payment can not let another monthly debit run.
 */
export function decideScheduledRentStop(input: {
  stopAfterIso: string | null | undefined;
  todayIso: string;
  nextChargeIso: string | null | undefined;
  lastPaymentIso: string | null | undefined;
  lastPaymentState: RentPaymentState | null | undefined;
}): { stop: boolean; reason: "none" | "before_date" | "paid" | "grace" | "waiting" } {
  const stopAfter = (input.stopAfterIso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stopAfter)) return { stop: false, reason: "none" };
  const grace = addDaysIso(stopAfter, RENT_STOP_GRACE_DAYS);
  if (grace && input.todayIso >= grace) return { stop: true, reason: "grace" };
  if (input.todayIso < stopAfter) return { stop: false, reason: "before_date" };
  const issued = !!input.nextChargeIso && input.nextChargeIso > stopAfter;
  if (
    issued &&
    input.lastPaymentState === "paid" &&
    !!input.lastPaymentIso &&
    input.lastPaymentIso >= stopAfter
  ) {
    return { stop: true, reason: "paid" };
  }
  return { stop: false, reason: "waiting" };
}

// ===========================================================================
// Increment 4 — webhook reconciliation. The rent rail runs on the LANDLORD's
// CONNECTED account, so its Stripe events arrive with `event.account` set
// (the acct_... id) — distinct from the PLATFORM billing events (org plans) on
// the platform account, which have no `event.account`. The webhook route
// branches on `event.account` BEFORE the platform-billing switch and routes
// these to tenancy reconciliation (match by stripe_subscription_id -> write
// stripe_subscription_status + synced_at via the service-role admin client).
//
// This module owns the PURE decisions (which events count, what status to
// write, whether a late event may overwrite a terminal one) so they unit-test
// without the SDK; the route does the impure Supabase write + id extraction.
//
// Dispute mapping (charge.dispute.*) is intentionally OUT of scope here: it
// needs charge -> invoice -> subscription resolution and has no schema field
// yet; deferred to a dedicated field / v2.
// ===========================================================================

/** Connected-account events we reconcile onto a tenancy's rent subscription. */
export const RENT_RECONCILE_EVENTS = [
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;
export type RentReconcileEvent = (typeof RENT_RECONCILE_EVENTS)[number];

/** Is this connected-account event one we act on? Pure. */
export function isRentReconcileEvent(eventType: unknown): eventType is RentReconcileEvent {
  return typeof eventType === "string" && (RENT_RECONCILE_EVENTS as readonly string[]).includes(eventType);
}

/**
 * Map a connected-account event to the rent-subscription status to persist on
 * the tenancy. Pure.
 *   * customer.subscription.deleted -> "canceled" (terminal)
 *   * customer.subscription.updated -> the subscription's own status (so a
 *     genuine active/past_due/unpaid/incomplete transition is mirrored exactly)
 *   * invoice.paid          -> "active"     (a debit cleared)
 *   * invoice.payment_failed -> "past_due"  (a debit bounced)
 * Returns null when the event shouldn't change the stored status (an unknown
 * event, or a subscription.updated with no usable status string).
 */
export function rentStatusFromEvent(eventType: unknown, subStatus?: unknown): string | null {
  switch (eventType) {
    case "customer.subscription.deleted":
      return "canceled";
    case "customer.subscription.updated": {
      const s = typeof subStatus === "string" ? subStatus.trim() : "";
      return s || null;
    }
    case "invoice.paid":
      return "active";
    case "invoice.payment_failed":
      return "past_due";
    default:
      return null;
  }
}

/**
 * Guard against a late, out-of-order INVOICE event resurrecting a terminal
 * subscription. Once a tenancy's rent subscription is "canceled", only a
 * subscription lifecycle event (updated/deleted) may change its status — a
 * straggling invoice.paid/payment_failed for the dead sub is ignored (a real
 * re-subscribe writes a NEW subscription id, so it never collides). Pure.
 */
export function shouldApplyRentStatus(currentStatus: unknown, eventType: unknown): boolean {
  if (currentStatus === "canceled") {
    return eventType === "customer.subscription.updated" || eventType === "customer.subscription.deleted";
  }
  return true;
}

// ===========================================================================
// Increment 5 — rent invoices CSV export. Lists the rent invoices Stripe
// generated on the landlord's connected account (the rent-income slice) and
// renders them as a CSV download — the Stripe-rail sibling of the Rotessa
// transaction_report export, with the same RFC-4180 escaping and a parallel row
// shape. All parsing/formatting is PURE; the route does the impure
// invoices.list({...}, { stripeAccount }).
// ===========================================================================

export type StripeInvoiceRow = {
  id: string | null;
  number: string | null;
  subscriptionId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  amountPaid: string | null;   // dollars, e.g. "1250.00"
  amountDue: string | null;    // dollars
  currency: string | null;     // e.g. "CAD"
  status: string | null;       // paid | open | void | uncollectible | draft
  created: string | null;      // YYYY-MM-DD (UTC)
  paidAt: string | null;       // YYYY-MM-DD (UTC), null until paid
};

/** Minor units (cents) -> a "1250.00" dollar string. null for non-finite. Pure. */
export function centsToAmountString(cents: unknown): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  return (cents / 100).toFixed(2);
}

/** Structural shape of the Stripe.Invoice bits we read (keeps tests SDK-free). */
export type RawStripeInvoice = {
  id?: string | null;
  number?: string | null;
  subscription?: string | { id?: string | null } | null;
  parent?: { subscription_details?: { subscription?: string | { id?: string | null } | null } | null } | null;
  customer_name?: string | null;
  customer_email?: string | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  currency?: string | null;
  status?: string | null;
  created?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
};

/** Pull the subscription id off an invoice across Stripe API-version shapes. Pure. */
export function subscriptionIdOfInvoice(invoice: RawStripeInvoice | null | undefined): string | null {
  const i = invoice ?? {};
  const idOf = (v: unknown): string | null =>
    typeof v === "string" && v.trim()
      ? v.trim()
      : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" && (v as { id: string }).id.trim()
        ? (v as { id: string }).id.trim()
        : null;
  // Older API: invoice.subscription. Newer (2025+): invoice.parent.subscription_details.subscription.
  return idOf(i.subscription) ?? idOf(i.parent?.subscription_details?.subscription);
}

/** Normalize one raw Stripe invoice into our CSV row. Pure. */
export function normalizeStripeInvoice(raw: RawStripeInvoice | null | undefined): StripeInvoiceRow {
  const i = raw ?? {};
  return {
    id: typeof i.id === "string" ? i.id : null,
    number: typeof i.number === "string" ? i.number : null,
    subscriptionId: subscriptionIdOfInvoice(i),
    customerName: typeof i.customer_name === "string" ? i.customer_name : null,
    customerEmail: typeof i.customer_email === "string" ? i.customer_email : null,
    amountPaid: centsToAmountString(i.amount_paid),
    amountDue: centsToAmountString(i.amount_due),
    currency: typeof i.currency === "string" ? i.currency.toUpperCase() : null,
    status: typeof i.status === "string" ? i.status : null,
    created: unixToIsoDate(i.created),
    paidAt: unixToIsoDate(i.status_transitions?.paid_at),
  };
}

const STRIPE_INVOICE_CSV_HEADERS = [
  "Invoice ID",
  "Number",
  "Subscription ID",
  "Tenant",
  "Email",
  "Amount paid",
  "Amount due",
  "Currency",
  "Status",
  "Created",
  "Paid date",
];

/** RFC-4180 escape one CSV field. Pure. (Mirrors rotessa.csvCell.) */
export function stripeCsvCell(value: string | null): string {
  const s = value ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render normalized Stripe invoice rows as a CSV string (with header). Pure. */
export function stripeInvoicesToCsv(rows: StripeInvoiceRow[]): string {
  const lines = [STRIPE_INVOICE_CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.number,
        r.subscriptionId,
        r.customerName,
        r.customerEmail,
        r.amountPaid,
        r.amountDue,
        r.currency,
        r.status,
        r.created,
        r.paidAt,
      ].map(stripeCsvCell).join(","),
    );
  }
  return lines.join("\r\n");
}

// ============================================================================
// Rent-rate-change preconditions (autopilot Slice C, S460 / spec S420). Pure:
// decides whether a recorded increase may be pushed to the Stripe subscription,
// and never lets an increase bill EARLY (effective date is the N1-served+90
// legal floor). The impure orchestration (retrieve sub, create/replace the
// Subscription Schedule) lives in stripe-rent-actions.ts and is covered by the
// live sandbox flow. Codes map 1:1 to the ?striperent= page states.
// ============================================================================
export type StripeRentUpdateCheck =
  | { ok: true; newAmountCents: number; effectiveUnix: number }
  | {
      ok: false;
      code: "nosub" | "subinactive" | "noamount" | "noop" | "baddate";
    };

export type StripeRentUpdateInput = {
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  newAmountCents: number | null;
  /** The amount already pushed to Stripe (tenancies.stripe_rent_amount_synced_cents). */
  syncedAmountCents: number | null;
  /** The intended first-bill date of the new rent (the N1 effective date). */
  effectiveIso: string | null;
  /** The legal floor: never earlier than the recorded increase effective date. */
  recordedEffectiveIso: string | null;
  todayIso: string;
};

export function validateStripeRentUpdate(input: StripeRentUpdateInput): StripeRentUpdateCheck {
  if (!input.subscriptionId) return { ok: false, code: "nosub" };

  const status = (input.subscriptionStatus ?? "").toLowerCase();
  if (status !== "active" && status !== "trialing") {
    return { ok: false, code: "subinactive" };
  }

  const amt = input.newAmountCents;
  if (amt == null || !Number.isFinite(amt) || amt <= 0) {
    return { ok: false, code: "noamount" };
  }
  const rounded = Math.round(amt);

  // Re-running with the amount already on Stripe is a no-op, not a change.
  if (input.syncedAmountCents != null && input.syncedAmountCents === rounded) {
    return { ok: false, code: "noop" };
  }

  const effUnix = isoToUnixSeconds(input.effectiveIso);
  const todayUnix = isoToUnixSeconds(input.todayIso);
  if (effUnix == null || todayUnix == null) return { ok: false, code: "baddate" };
  // Never bill the increase early: the effective date can't be in the past...
  if (effUnix < todayUnix) return { ok: false, code: "baddate" };
  // ...and can't precede the recorded increase's legal effective date.
  const floorUnix = isoToUnixSeconds(input.recordedEffectiveIso);
  if (floorUnix != null && effUnix < floorUnix) {
    return { ok: false, code: "baddate" };
  }

  return { ok: true, newAmountCents: rounded, effectiveUnix: effUnix };
}

export function shouldPromptRentRailSync(input: StripeRentUpdateInput): boolean {
  return validateStripeRentUpdate(input).ok;
}

// ============================================================================
// selectActiveSchedulePhase (autopilot Slice C, S462 / KI733). Pure.
// Picks the CURRENTLY ACTIVE phase of a Stripe subscription schedule — never
// phases[0]. schedule.phases retains ELAPSED phases, so after an annual phase
// transition the first entry is a completed phase. Stripe only lets you update
// "current and future phases" and requires phases[0] to be the active phase, so
// reusing index 0 makes the 2nd annual rent-rate change fail. Matches on
// current_phase.start_date; falls back to the last (open-ended tail) phase.
// ============================================================================
export type SchedulePhaseItemLike = { price?: string | { id?: string | null } | null };
export type SchedulePhaseLike = { start_date: number; items: SchedulePhaseItemLike[] };
export type ScheduleLike = {
  current_phase?: { start_date?: number | null } | null;
  phases?: SchedulePhaseLike[] | null;
};
export type ActiveSchedulePhase =
  | { ok: true; startDate: number; priceId: string | null }
  | { ok: false; code: "nophase" };

export function selectActiveSchedulePhase(sched: ScheduleLike): ActiveSchedulePhase {
  const phases = Array.isArray(sched.phases) ? sched.phases : [];
  if (phases.length === 0) return { ok: false, code: "nophase" };
  const activeStart = sched.current_phase?.start_date ?? null;
  const active =
    (activeStart != null
      ? phases.find((p) => p.start_date === activeStart)
      : undefined) ?? phases[phases.length - 1];
  const price = active.items?.[0]?.price;
  const priceId = typeof price === "string" ? price : (price?.id ?? null);
  return { ok: true, startDate: active.start_date, priceId };
}


/**
 * S837 (REVIEW-S835 finding 11): a saved schedule can still be updated only
 * while it runs. Stripe releases it after the open-ended phase's one cycle
 * (status "released"), and "completed" or "canceled" are final too. Pure.
 */
export function scheduleStillRunning(status: string | null | undefined): boolean {
  return status === "active" || status === "not_started";
}

/**
 * S816h: a Canadian bank (ACSS) mandate can pay a rent subscription only when
 * it was authorized "for" subscriptions (default_for). US bank debit and any
 * non-ACSS mandate pass. No mandate object: true (nothing to check). Pure.
 */
export function mandateCoversSubscriptions(
  mandate: { payment_method_details?: { type?: string; acss_debit?: { default_for?: string[] } } } | null | undefined,
): boolean {
  const d = mandate?.payment_method_details;
  if (!d) return true;
  if (d.type && d.type !== "acss_debit") return true;
  const list = d.acss_debit?.default_for ?? [];
  return list.includes("subscription");
}
