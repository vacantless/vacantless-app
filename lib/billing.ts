// Pure billing config + view-model helpers (M4 Stripe billing).
//
// NO Stripe SDK, env, or DB access here — everything is a pure function so it
// unit-tests cleanly via `npx tsx scripts/test-billing.ts`. The impure pieces
// (the Stripe client, env-driven price-id lookup) live in lib/stripe.ts.

export type PlanKey = "trial" | "pilot" | "core" | "plus";
export type PaidPlanKey = "core" | "plus";

export type PlanInfo = {
  key: PaidPlanKey;
  name: string;
  priceCents: number; // CAD, per month — the current (founding) charge
  listPriceCents: number; // CAD, per month — the standard list anchor (shown struck through)
  priceEnv: string; // env var holding the Stripe price id
  blurb: string;
  features: string[];
};

// The two sellable tiers. Prices match the Stripe products created in the
// Vacantless account (Core $200/mo, Plus $375/mo CAD — a 50% new-entrant
// undercut of the original $400/$750 placeholders; raise later + grandfather
// early customers). The actual Stripe price id is read from env (test vs live
// = an env swap), keyed by priceEnv.
export const PLANS: Record<PaidPlanKey, PlanInfo> = {
  core: {
    key: "core",
    name: "Core",
    priceCents: 20000,
    listPriceCents: 40000,
    priceEnv: "STRIPE_PRICE_CORE",
    blurb: "Everything you need to fill a rental, from first inquiry to signed lease.",
    features: [
      "Rental inquiry pages with your business name",
      "Instant reply to every inquiry",
      "Your renters, organized in one list",
      "Renters book from your viewing times",
      "Automatic viewing reminders",
      "Reports by unit and ad source",
    ],
  },
  plus: {
    key: "plus",
    name: "Plus",
    priceCents: 37500,
    listPriceCents: 75000,
    priceEnv: "STRIPE_PRICE_PLUS",
    blurb: "Everything in Core, plus tools to follow up and win renters back.",
    features: [
      "Everything in Core",
      "Automatic feedback after each viewing",
      "Price-drop alerts to past renters",
      "Automatic follow-up with interested renters",
      "Reports by unit and advertising source",
    ],
  },
};

export const PAID_PLAN_KEYS: PaidPlanKey[] = ["core", "plus"];

export function isPaidPlan(plan: string | null | undefined): plan is PaidPlanKey {
  return plan === "core" || plan === "plus";
}

// --- Plan entitlements (feature tier-gating) -------------------------------
// The platform pivot (S208) turns Vacantless into a Buildium-style PM platform
// where higher-cost capabilities are tier-gated. S214 banked the first such gate:
// SMS comms is a metered upgrade (a per-message Twilio hard cost passes through),
// while EMAIL comms stays free on every tier. This is the entitlement source of
// truth: a pure plan -> capability map, enforced server-side (never UI-only).
//
// INTERIM MAPPING — the pricing ladder is being redrawn (Starter/Growth/Premium
// proposed, NOT yet locked; the live plans are still the leasing-era Core/Plus).
// So SMS is gated to the UPPER existing paid tier (Plus) + the founder-led Pilot
// (which gets full product access by design). When the new ladder is locked,
// re-point PLAN_ENTITLEMENTS — every gate reads through here, so that's the only
// edit. The default for an unknown/trial plan is NO paid capabilities.
export type PlanFeature = "sms";

export type PlanEntitlements = {
  sms: boolean; // may send landlord -> tenant SMS (email is always allowed)
};

export const PLAN_ENTITLEMENTS: Record<PlanKey, PlanEntitlements> = {
  trial: { sms: false },
  pilot: { sms: true }, // full product access during the 30-day founder pilot
  core: { sms: false }, // base paid tier: email only
  plus: { sms: true }, // upper paid tier: SMS unlocked
};

const TRIAL_ENTITLEMENTS: PlanEntitlements = PLAN_ENTITLEMENTS.trial;

// Resolve the entitlements for a stored plan value, defaulting an
// unknown/missing plan to the trial (no paid capabilities).
export function planEntitlements(plan: string | null | undefined): PlanEntitlements {
  if (plan === "pilot") return PLAN_ENTITLEMENTS.pilot;
  if (plan === "core") return PLAN_ENTITLEMENTS.core;
  if (plan === "plus") return PLAN_ENTITLEMENTS.plus;
  return TRIAL_ENTITLEMENTS;
}

// Generic capability check, keyed by feature.
export function hasEntitlement(
  plan: string | null | undefined,
  feature: PlanFeature,
): boolean {
  return planEntitlements(plan)[feature] === true;
}

// Whether this plan may send landlord -> tenant SMS. The single gate the
// sendTenantMessage server action enforces; email needs no entitlement.
export function canUseSms(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "sms");
}

// --- Pilot tier (GTM Layer 1) ----------------------------------------------
// A self-serve 30-day, founder-led pilot at $0/month with a refundable $200
// setup deposit (paid in-app via the one-time Stripe deposit Checkout, S199;
// see startDepositCheckout + the deposit columns from migration 0021).
// Recorded as plan='pilot' + organizations.pilot_started_at;
// the 30-day end is DERIVED here, never stored. A pilot gets full product access
// because no feature is gated on plan tier.
export const PILOT_DURATION_DAYS = 30;
export const PILOT_DEPOSIT_CENTS = 20000; // CAD, one-time, refundable
const DAY_MS = 86_400_000;

export const PILOT = {
  key: "pilot" as const,
  name: "Pilot",
  durationDays: PILOT_DURATION_DAYS,
  depositCents: PILOT_DEPOSIT_CENTS,
  blurb:
    "A 30-day, set-up-with-you trial of the full system, at no monthly cost.",
  features: [
    "Full access to every Core and Plus feature",
    "We set it up and onboard you",
    "$0 monthly fee for 30 days",
    "Refundable $200 setup deposit",
    "Third-party ad/portal costs billed at cost",
  ],
};

export function isPilotPlan(plan: string | null | undefined): boolean {
  return plan === "pilot";
}

// --- Pilot deposit state (Phase B: in-app Stripe deposit Checkout) ----------
// The refundable setup deposit is a one-time charge, tracked separately from the
// subscription fields. `none` = not paid yet, `paid` = collected (refundable at
// the end of the pilot), `refunded` = returned. Mirrors the DB CHECK in 0021.
export type DepositStatus = "none" | "paid" | "refunded";

export const DEPOSIT_STATUSES: DepositStatus[] = ["none", "paid", "refunded"];

// Coerce any stored/raw value to a known DepositStatus (defaults to "none").
export function normalizeDepositStatus(
  value: string | null | undefined,
): DepositStatus {
  return value === "paid" || value === "refunded" ? value : "none";
}

// Human label for the deposit state.
export function depositStatusLabel(status: DepositStatus): string {
  switch (status) {
    case "paid":
      return "Deposit paid";
    case "refunded":
      return "Deposit refunded";
    default:
      return "Deposit not paid";
  }
}

// Format a plain one-time amount, e.g. "$200" (no "/month"). Use for the deposit.
export function formatAmount(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("en-CA");
}

export type PilotStatus = {
  started: boolean; // a pilot was ever started
  active: boolean; // started and within the 30-day window
  expired: boolean; // started but the 30 days have passed
  daysRemaining: number; // whole days left (0 once expired / not started)
  startedAt: Date | null;
  endsAt: Date | null;
};

// Derive the live pilot status from the stored start timestamp. `now` is
// injectable for testing. A missing/invalid start = "never started".
export function pilotStatus(
  startedAt: string | Date | null | undefined,
  now: Date = new Date(),
): PilotStatus {
  const start =
    startedAt == null
      ? null
      : startedAt instanceof Date
        ? startedAt
        : new Date(startedAt);
  if (!start || isNaN(start.getTime())) {
    return {
      started: false,
      active: false,
      expired: false,
      daysRemaining: 0,
      startedAt: null,
      endsAt: null,
    };
  }
  const endsAt = new Date(start.getTime() + PILOT_DURATION_DAYS * DAY_MS);
  const msLeft = endsAt.getTime() - now.getTime();
  const active = msLeft > 0;
  return {
    started: true,
    active,
    expired: !active,
    daysRemaining: active ? Math.ceil(msLeft / DAY_MS) : 0,
    startedAt: start,
    endsAt,
  };
}

// Format a cents amount as a monthly price label, e.g. "$400/month".
export function formatPlanPrice(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("en-CA") + "/month";
}

// Map a Stripe price id back to its plan tier using a priceId→plan lookup
// (built from env in lib/stripe.ts). Returns null for an unknown price.
export function planForPriceId(
  priceId: string | null | undefined,
  map: Record<string, PaidPlanKey>,
): PaidPlanKey | null {
  if (!priceId) return null;
  return map[priceId] ?? null;
}

// Stripe subscription statuses that should unlock paid features. `trialing`
// counts (the customer is in a paid trial); `past_due` keeps access during the
// dunning grace window but is flagged as needing attention below.
export const ACTIVE_STATUSES = ["active", "trialing"] as const;
export const GRACE_STATUSES = ["past_due"] as const;
export const ATTENTION_STATUSES = [
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
] as const;

export function isSubscriptionActive(status: string | null | undefined): boolean {
  return !!status && (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function needsBillingAttention(status: string | null | undefined): boolean {
  return !!status && (ATTENTION_STATUSES as readonly string[]).includes(status);
}

// --- Webhook sync helpers (M4) ---------------------------------------------
// The current-period-end timestamp (unix seconds) for a Stripe subscription.
// Newer Stripe API versions (2025-* / "dahlia") expose it per subscription item;
// older versions put it at the top level. Prefer the item value, fall back to
// the top level, else null. Reading only the top level (the old shape) yields
// null on the newer payloads — the cause of the blank "period ends …" date.
// Structural shape only (lib/billing stays Stripe-free). The caller casts its
// Stripe.Subscription to this — the v17 SubscriptionItem type doesn't declare
// current_period_end even though the runtime dahlia payload carries it.
export type SubscriptionPeriodShape = {
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> | null } | null;
};
export function subscriptionPeriodEndSeconds(
  sub: SubscriptionPeriodShape,
): number | null {
  const item = sub.items?.data?.[0]?.current_period_end;
  if (typeof item === "number") return item;
  if (typeof sub.current_period_end === "number") return sub.current_period_end;
  return null;
}

// Guard against a stale, out-of-order `incomplete` event clobbering a
// subscription that has already advanced past it. `incomplete` is only ever a
// transient *initial* state — once a subscription is active / trialing /
// past_due / unpaid / canceled, Stripe never legitimately moves it back to
// `incomplete`. So an `incomplete` event that is processed after (but was
// created before) the `active` event must not overwrite the real status.
// Only guard when it's the SAME subscription; a brand-new subscription is
// allowed to write `incomplete` so a genuinely-stuck payment still surfaces.
const INCOMPLETE_STATUSES = ["incomplete", "incomplete_expired"] as const;
export function shouldApplyStatus(
  incomingStatus: string | null | undefined,
  existingStatus: string | null | undefined,
  sameSubscription: boolean,
): boolean {
  if (incomingStatus !== "incomplete") return true;
  if (!sameSubscription) return true;
  if (!existingStatus) return true;
  // Existing status is settled (non-incomplete) → skip the stale downgrade.
  return (INCOMPLETE_STATUSES as readonly string[]).includes(existingStatus);
}

// Human label for a raw Stripe status.
export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "Active";
    case "trialing":
      return "Trial";
    case "past_due":
      return "Past due";
    case "unpaid":
      return "Unpaid";
    case "canceled":
      return "Canceled";
    case "incomplete":
    case "incomplete_expired":
      return "Payment incomplete";
    case "paused":
      return "Paused";
    default:
      return status ? status : "—";
  }
}

export type BillingView = {
  planKey: PlanKey;
  planLabel: string; // "Trial" | "Pilot" | "Core" | "Plus"
  isPaid: boolean; // org is on a paid tier (core/plus)
  isPilot: boolean; // org is on the pilot plan (active OR expired-not-yet-converted)
  pilotActive: boolean; // pilot started and within the 30-day window
  pilotExpired: boolean; // pilot started but the 30 days have passed
  pilotDaysRemaining: number;
  pilotEndsAtLabel: string | null; // formatted in the org timezone
  hasSubscription: boolean; // a Stripe subscription is on file
  status: string | null;
  statusLabel: string;
  needsAttention: boolean; // past_due / unpaid / incomplete
  periodEnd: Date | null;
  periodEndLabel: string | null; // formatted in the org timezone
  // Pilot deposit
  depositStatus: DepositStatus; // none | paid | refunded
  depositPaid: boolean; // status === "paid"
  depositRefunded: boolean; // status === "refunded"
  depositStatusLabel: string;
  depositAmountLabel: string; // the collected amount, else the standard $200
  depositPaidAtLabel: string | null; // formatted in the org timezone
  showDepositCta: boolean; // active pilot + deposit not yet paid -> show "Pay deposit"
};

export type BillingInput = {
  plan: string | null | undefined;
  subscription_status: string | null | undefined;
  stripe_subscription_id: string | null | undefined;
  current_period_end: string | Date | null | undefined;
  pilot_started_at?: string | Date | null | undefined;
  pilot_deposit_status?: string | null | undefined;
  pilot_deposit_amount_cents?: number | null | undefined;
  pilot_deposit_paid_at?: string | Date | null | undefined;
  timezone?: string;
  now?: Date; // injectable for tests
};

function planLabelOf(plan: PlanKey): string {
  if (plan === "core") return "Core";
  if (plan === "plus") return "Plus";
  if (plan === "pilot") return "Pilot";
  return "Trial";
}

// Format a date as a plain day label in the given timezone, e.g.
// "June 16, 2026". Returns null for a missing/invalid date.
export function formatPeriodEnd(
  value: string | Date | null | undefined,
  timezone = "America/Toronto",
): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

// Build the view-model the Billing page + settings Account panel render from.
export function buildBillingView(input: BillingInput): BillingView {
  // A paid Stripe plan wins; otherwise the org may be on a pilot; else trial.
  const planKey: PlanKey = isPaidPlan(input.plan)
    ? input.plan
    : isPilotPlan(input.plan)
      ? "pilot"
      : "trial";
  const status = input.subscription_status ?? null;
  const periodEnd =
    input.current_period_end != null
      ? input.current_period_end instanceof Date
        ? input.current_period_end
        : new Date(input.current_period_end)
      : null;
  const validPeriodEnd = periodEnd && !isNaN(periodEnd.getTime()) ? periodEnd : null;

  const pilot = pilotStatus(input.pilot_started_at, input.now);

  const depositStatus = normalizeDepositStatus(input.pilot_deposit_status);
  const depositAmountCents =
    typeof input.pilot_deposit_amount_cents === "number" &&
    input.pilot_deposit_amount_cents > 0
      ? input.pilot_deposit_amount_cents
      : PILOT_DEPOSIT_CENTS;

  return {
    planKey,
    planLabel: planLabelOf(planKey),
    isPaid: isPaidPlan(planKey),
    isPilot: planKey === "pilot",
    pilotActive: planKey === "pilot" && pilot.active,
    pilotExpired: planKey === "pilot" && pilot.expired,
    pilotDaysRemaining: planKey === "pilot" ? pilot.daysRemaining : 0,
    pilotEndsAtLabel:
      planKey === "pilot" && pilot.endsAt
        ? formatPeriodEnd(pilot.endsAt, input.timezone)
        : null,
    hasSubscription: !!input.stripe_subscription_id,
    status,
    statusLabel: statusLabel(status),
    needsAttention: needsBillingAttention(status),
    periodEnd: validPeriodEnd,
    periodEndLabel: formatPeriodEnd(input.current_period_end, input.timezone),
    depositStatus,
    depositPaid: depositStatus === "paid",
    depositRefunded: depositStatus === "refunded",
    depositStatusLabel: depositStatusLabel(depositStatus),
    depositAmountLabel: formatAmount(depositAmountCents),
    depositPaidAtLabel: formatPeriodEnd(input.pilot_deposit_paid_at, input.timezone),
    // Only nudge an active pilot that hasn't paid yet; an expired pilot or a paid
    // one shows status instead of a CTA.
    showDepositCta: planKey === "pilot" && pilot.active && depositStatus === "none",
  };
}
