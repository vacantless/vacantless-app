// Pure billing config + view-model helpers (M4 Stripe billing).
//
// NO Stripe SDK, env, or DB access here — everything is a pure function so it
// unit-tests cleanly via `npx tsx scripts/test-billing.ts`. The impure pieces
// (the Stripe client, env-driven price-id lookup) live in lib/stripe.ts.

// `free` is the permanent, no-card funnel tier (Package B, S296). `trial` stays
// the pre-anything default for legacy orgs; `core`/`plus` are the DEPRECATED
// leasing-era Stripe products (kept only until the Growth/Premium product
// migration lands — see the TIERS migration checklist below).
export type PlanKey = "trial" | "free" | "pilot" | "core" | "plus";
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

// DEPRECATED (S296): the legacy leasing-era Stripe products (Core $200/mo,
// Plus $375/mo CAD). These remain ONLY because lib/stripe.ts + the billing-page
// checkout + PaidPlanKey still reference them; they are no longer the offered
// ladder. The live ladder is now Free / Growth / Premium (see TIERS below).
// Do not surface Core/Plus to new customers. Removal lands with the
// Growth/Premium Stripe-product migration (TIERS migration checklist).
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
// where higher-cost capabilities are tier-gated. This is the entitlement source
// of truth: a pure plan -> capability map, enforced server-side (never UI-only).
// Every gate in the app reads through `hasEntitlement` / the typed helpers
// below, so re-pointing the matrix is the ONLY edit needed to re-tier.
//
// S220 generalized this from the S214 SMS-only boolean into a feature × tier
// MATRIX; S296 set the live Free/Growth/Premium ladder (see TIERS below; the
// $49 Starter was dropped). The matrix is keyed by BOTH the new tier keys AND the legacy
// leasing-era plan keys (trial/pilot/core/plus) so nothing breaks before the
// rename + Stripe-product migration lands — a legacy org resolves to the same
// entitlements it had under S214 (the only LIVE-enforced feature today is `sms`).
//
// FEATURES (capabilities that may be gated):
//   sms             landlord -> tenant SMS (email is ALWAYS free, never gated)
//   renter_sms      public booking/reminder SMS to renters (the leasing wedge)
//   rent_collection automated rent rails (Stripe Connect / Rotessa)
//   tax_export      year-end rent / tax CSV export
//   accounting      full accounting module (Premium)
export type PlanFeature =
  | "sms"
  | "renter_sms"
  | "rent_collection"
  | "tax_export"
  | "accounting";

export const PLAN_FEATURES: PlanFeature[] = [
  "sms",
  "renter_sms",
  "rent_collection",
  "tax_export",
  "accounting",
];

export type PlanEntitlements = Record<PlanFeature, boolean>;

// Every feature off — the safe default and the trial baseline.
function noEntitlements(): PlanEntitlements {
  return {
    sms: false,
    renter_sms: false,
    rent_collection: false,
    tax_export: false,
    accounting: false,
  };
}

// The live Free / Growth / Premium ladder (S296, Package B; numbers validated
// 2026-06-22 — see PRICING-RESEARCH-2026-06-22.md). Replaces the S220 three-
// paid-tier draft: the $49 Starter is dropped (the leasing wedge moves into the
// Free funnel, matching how Avail/TurboTenant convert), so the ladder is one
// free tier + two paid tiers. Tier keys are distinct from the legacy plan keys
// so both can coexist through the Stripe-product migration.
export type TierKey = "free" | "growth" | "premium";
export const TIER_KEYS: TierKey[] = ["free", "growth", "premium"];

// Any stored plan string we recognize: the new ladder + the legacy plans.
export type AnyPlanKey = PlanKey | TierKey;

// THE MATRIX. Legacy keys (trial/pilot/core/plus) keep their S214 `sms` value
// EXACTLY (trial/core false, plus/pilot true) so the only live-enforced gate is
// unchanged; their non-`sms` values are forward-looking config, not yet enforced
// for legacy orgs (which migrate to the new tiers anyway).
//
// Live ladder (S296, Package B):
//   Free     = lead-gen funnel. One live listing + the standalone tools; EMAIL
//              ONLY (no renter SMS) and no paid capabilities.
//   Growth   = rent collection + landlord<->tenant + renter SMS + tax export.
//   Premium  = + accounting module.
export const PLAN_ENTITLEMENTS: Record<AnyPlanKey, PlanEntitlements> = {
  // Legacy leasing-era plans (migrate to the new ladder; `sms` value frozen).
  trial: noEntitlements(),
  pilot: { sms: true, renter_sms: true, rent_collection: true, tax_export: true, accounting: true }, // founder pilot = full access
  core: { sms: false, renter_sms: true, rent_collection: false, tax_export: false, accounting: false },
  plus: { sms: true, renter_sms: true, rent_collection: false, tax_export: false, accounting: false },
  // Live ladder.
  free: noEntitlements(), // funnel tier: email only, no paid capabilities
  growth: { sms: true, renter_sms: true, rent_collection: true, tax_export: true, accounting: false },
  premium: { sms: true, renter_sms: true, rent_collection: true, tax_export: true, accounting: true },
};

const TRIAL_ENTITLEMENTS: PlanEntitlements = PLAN_ENTITLEMENTS.trial;

// Resolve the entitlements for a stored plan value, defaulting an
// unknown/missing plan to the trial (no paid capabilities). Looks the plan up
// directly in the matrix so it covers both legacy keys and new tier keys.
export function planEntitlements(plan: string | null | undefined): PlanEntitlements {
  if (plan && Object.prototype.hasOwnProperty.call(PLAN_ENTITLEMENTS, plan)) {
    return PLAN_ENTITLEMENTS[plan as AnyPlanKey];
  }
  return TRIAL_ENTITLEMENTS;
}

// Generic capability check, keyed by feature. Every server-side gate funnels
// through here.
export function hasEntitlement(
  plan: string | null | undefined,
  feature: PlanFeature,
): boolean {
  return planEntitlements(plan)[feature] === true;
}

// Whether this plan may send landlord -> tenant SMS. The gate the
// sendTenantMessage server action enforces; email needs no entitlement.
export function canUseSms(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "sms");
}

// Whether this plan may send renter-facing booking/reminder SMS (the public
// leasing flow). S296 decision: gated to PAID tiers (Growth and up); Free + trial
// = email only. DEFINED here now; the live wiring (the book_public_showing RPC
// surfacing org.plan + the reminders cron joining plan) is the next increment —
// see NEXT-SESSION. Until wired, renter SMS remains ungated at the call sites.
export function canUseRenterSms(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "renter_sms");
}

// Whether this plan may use the automated rent-collection rails (Stripe/Rotessa).
export function canCollectRentByPlan(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "rent_collection");
}

// --- Photo storage allowance (per-tier; an expansion-revenue lever) ---------
// Photos are the heaviest stored asset per rental, so the per-rental photo cap
// is a natural paid lever. BASE_PHOTO_CAP must equal MAX_PHOTOS_PER_PROPERTY in
// lib/photos (a test asserts this) — it's the allowance every CURRENT plan gets;
// only Premium raises it. Because no live org is on Premium today, wiring this
// into the uploader changes ZERO live behavior (the same config-only discipline
// as the SMS gate, S220): the cap is the entitlement source of truth, enforced
// server-side, and re-tiering is a one-line edit here.
export const BASE_PHOTO_CAP = 24;
export const PREMIUM_PHOTO_CAP = 60;

// The per-rental photo allowance for a plan. Everything below Premium gets the
// base; Premium gets more. Unknown/missing plan -> base (never less).
export function photoCapForPlan(plan: string | null | undefined): number {
  return plan === "premium" ? PREMIUM_PHOTO_CAP : BASE_PHOTO_CAP;
}

// Soft, non-blocking upsell for the Photos card. "Show, don't block" (the
// two-axis visibility rule): we never stop an operator from managing photos —
// we only point out that a higher plan has more room, and only when they're at
// or near their current cap AND a higher tier actually offers more.
export type StorageUpsell = {
  cap: number; // this plan's per-rental allowance
  used: number; // photos currently on the rental
  remaining: number; // cap - used, floored at 0
  atCap: boolean; // used >= cap
  showUpsell: boolean; // near/at cap AND a higher tier offers more room
};

export function storageUpsellNote(
  plan: string | null | undefined,
  photoCount: number,
): StorageUpsell {
  const cap = photoCapForPlan(plan);
  const used = Math.max(0, Math.floor(photoCount));
  const remaining = Math.max(0, cap - used);
  const atCap = used >= cap;
  const higherCapAvailable = cap < PREMIUM_PHOTO_CAP;
  // Surface within 4 of the cap (or at it), but only if more room exists above.
  const showUpsell = higherCapAvailable && remaining <= 4;
  return { cap, used, remaining, atCap, showUpsell };
}

// --- Live Free / Growth / Premium ladder (S296, Package B) -------------------
// Display config for the live 3-tier ladder. NUMBERS VALIDATED 2026-06-22
// against the market (PRICING-RESEARCH-2026-06-22.md): $0 Free funnel + $99
// Growth anchor + $249 Premium, all flat (no per-unit caps — the 20–100 door
// ICP balks at per-unit math; flat is the wedge). The paid tiers are NOT yet
// wired to Stripe products, so the comparison still renders behind a preview
// flag (GTM is HELD) and `priceEnv` stays null until the products exist.
//
// MIGRATION CHECKLIST (to make Growth/Premium sellable, replacing Core/Plus):
//   1. Create two CAD Stripe products: Growth $99/mo, Premium $249/mo.
//   2. Add env vars STRIPE_PRICE_GROWTH / STRIPE_PRICE_PREMIUM in Vercel; set
//      each tier's `priceEnv` (then isTierPurchasable -> true for paid tiers).
//   3. Point the billing page's purchasable cards at TIERS (Growth/Premium),
//      remove the Core/Plus "Founding plans" cards, and wire startCheckout to
//      the tier key.
//   4. Widen PaidPlanKey + lib/stripe.ts priceMap to the new tier keys and
//      update the actions.ts "pick Core or Plus" validation copy.
//   5. Default a fresh org to plan='free' at signup and enforce
//      `listingCapForPlan` in the publish path (currently config-only).
// Hard/usage costs (Twilio SMS, ad/portal spend, payment processing) always
// pass through at cost on top — these monthly prices are the platform fee only.
export type TierInfo = {
  key: TierKey;
  name: string;
  priceCents: number; // CAD / month — 0 for Free; platform fee for paid tiers
  priceEnv: string | null; // Stripe price-id env var (null until the product exists; Free is never purchasable)
  maxActiveListings: number | null; // published-listing allowance; null = unlimited
  blurb: string;
  features: string[]; // customer-facing bullets ("Everything in X, plus…")
  highlight?: boolean; // the recommended/most-popular tier
};

export const TIERS: Record<TierKey, TierInfo> = {
  free: {
    key: "free",
    name: "Free",
    priceCents: 0,
    priceEnv: null,
    maxActiveListings: 1,
    blurb: "List one rental and try the tools — no card, no time limit.",
    features: [
      "One active listing with a branded inquiry page",
      "Every inquiry organized in one list",
      "Rent-increase guideline calculator + N1 form",
      "Listing-copy generator + MLS data-sheet import",
      "Email replies and reminders (no texting)",
    ],
  },
  growth: {
    key: "growth",
    name: "Growth",
    priceCents: 9900,
    priceEnv: null,
    maxActiveListings: null,
    blurb: "Everything in Free, plus collect rent, screen renters, and manage tenants.",
    highlight: true,
    features: [
      "Unlimited active listings",
      "Online rent collection (Stripe / Rotessa)",
      "Renter pre-screening questions",
      "Tenant + renter messaging by email and text",
      "Tenancy records and payment ledger",
      "Year-end tax / rent export",
    ],
  },
  premium: {
    key: "premium",
    name: "Premium",
    priceCents: 24900,
    priceEnv: null,
    maxActiveListings: null,
    blurb: "Everything in Growth, plus full books, operations, and automation.",
    features: [
      "Everything in Growth",
      "Full accounting module",
      "Maintenance / repair dispatch",
      "Automatic post-viewing follow-up",
      "Round-robin lead assignment",
      "Priority support",
    ],
  },
};

// True once a tier has a real Stripe product behind it (safe to offer checkout).
// Free is $0 and never purchasable, so this is only ever true for paid tiers.
export function isTierPurchasable(tier: TierInfo): boolean {
  return tier.priceCents > 0 && tier.priceEnv != null;
}

// The published-listing allowance for a stored plan (the Free funnel cap; null =
// unlimited). Config is the source of truth — the publish/uploader path reads
// this — but enforcement wiring is a follow-up increment (the same config-first
// discipline as the photo cap). Unknown/missing plan -> the Free cap (never more).
export function listingCapForPlan(plan: string | null | undefined): number | null {
  if (plan === "growth" || plan === "premium") return null;
  if (isPaidPlan(plan) || isPilotPlan(plan)) return null; // legacy paid + pilot = unlimited
  return TIERS.free.maxActiveListings; // free / trial / unknown
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
  planLabel: string; // "Trial" | "Free" | "Pilot" | "Core" | "Plus"
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
  if (plan === "free") return "Free";
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
  // A paid Stripe plan wins; otherwise pilot; otherwise the free funnel tier;
  // else trial (the legacy pre-anything default).
  const planKey: PlanKey = isPaidPlan(input.plan)
    ? input.plan
    : isPilotPlan(input.plan)
      ? "pilot"
      : input.plan === "free"
        ? "free"
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
