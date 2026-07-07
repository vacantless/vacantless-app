// Pure billing config + view-model helpers (M4 Stripe billing).
//
// NO Stripe SDK, env, or DB access here — everything is a pure function so it
// unit-tests cleanly via `npx tsx scripts/test-billing.ts`. The impure pieces
// (the Stripe client, env-driven price-id lookup) live in lib/stripe.ts.

// `free` is the permanent, no-card funnel tier (Package B, S296). `trial` stays
// the pre-anything default for legacy orgs. `growth`/`premium` are the LIVE
// purchasable paid plans (S299 Stripe-product migration). `core`/`plus` are the
// retired leasing-era plans — recognized for any pre-migration org (see
// isAnyPaidPlan / the entitlements matrix) but never offered for sale.
export type PlanKey =
  | "trial"
  | "free"
  | "pilot"
  | "growth"
  | "premium"
  | "core"
  | "plus";

// The purchasable paid plans. As of S299 these are the live Free/Growth/Premium
// ladder's two paid tiers — they are exactly the paid keys of TIERS, so the
// Stripe price layer (lib/stripe.ts) reads each plan's `priceEnv` straight off
// TIERS. Core/Plus are NO LONGER part of this union (they are retired legacy).
export type PaidPlanKey = "growth" | "premium";

export const PAID_PLAN_KEYS: PaidPlanKey[] = ["growth", "premium"];

// True for a LIVE purchasable paid plan (growth/premium). This narrows the type,
// so checkout/price-lookup callers can pass the result straight to TIERS[plan].
export function isPaidPlan(plan: string | null | undefined): plan is PaidPlanKey {
  return plan === "growth" || plan === "premium";
}

// True for ANY paid subscription plan — the live ones (growth/premium) PLUS the
// retired legacy plans (core/plus). Used by the billing view + the "already on a
// paid plan" guards so a pre-migration paid org still reads as paid even though
// Core/Plus are no longer sold. (No live org is on core/plus today; this is the
// defensive belt-and-suspenders for the migration.)
export function isAnyPaidPlan(plan: string | null | undefined): boolean {
  return (
    plan === "growth" || plan === "premium" || plan === "core" || plan === "plus"
  );
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
//   bank_feed       live bank/card transaction sync (Growth+; Plaid). Distinct
//                   from `accounting`: bank_feed says a live feed exists at all;
//                   provider routing (Plaid vs Flinks) keys off accounting too —
//                   see lib/bank-feed providerForPlan (accounting -> Flinks).
//   accounting      full accounting module + Premium aggregator (Flinks)
//   incident_intake tenant self-serve incident reporting + operator triage
//                   (Option B Slices 1-4). Growth+ — table-stakes for the
//                   self-managed-owner wedge (an Abbas-type expects tenants to
//                   report issues). Split from incident_dispatch deliberately
//                   (plan doc §7 / locked decision 4): intake is broad value,
//                   the trade-coordination depth is reserved for Premium.
//   incident_dispatch in-app trade dispatch / quote / two-way scheduling
//                   (Option B Slices 5-7, the guardrail amendment). Premium+ —
//                   the marketplace-coordination depth, gated above intake.
export type PlanFeature =
  | "sms"
  | "renter_sms"
  | "rent_collection"
  | "tax_export"
  | "bank_feed"
  | "accounting"
  | "incident_intake"
  | "incident_dispatch"
  // Capture Phase 3 ingress (S368): forward/text a plate or receipt to a per-org
  // address and it files a pending capture. email-in = Growth+ (cheap to run);
  // text-in = Premium (per-message MMS cost + the premium convenience).
  | "capture_email_in"
  | "capture_text_in"
  // Repair-scheduling appointment reminders (S387, Slice 4): the SMS leg of the
  // 1-day / same-day tenant appointment reminder. Premium+ (per-message SMS cost),
  // mirroring capture_text_in — the email/in-app legs need no entitlement.
  | "repair_sms"
  // Listing-marketing kit (S388, Tier A): the self-serve promotion kit for an
  // active rental listing — packaged per-channel copy + the /r landing link + a
  // QR + syndication surfacing. Growth+ (a paid convenience that monetizes the
  // listing-copy / feed plumbing). The kit surface enforces this; it never runs
  // or pays for an ad (that is the later Tier B done-for-you boost).
  | "listing_marketing"
  // Lease-OCR prefill (S425): upload a signed lease and pre-fill the tenancy from
  // it. Growth+ (a paid time-saver over manual tenancy entry). It carries a real
  // per-use model/API cost, so the gate is paired with a monthly per-org cap
  // (see LEASE_OCR_MONTHLY_CAP). The extractLease* actions enforce both.
  | "lease_ocr"
  // AI listing import (Feature B, S428): paste a non-MLS listing (a Kijiji /
  // Facebook / PM-page blurb, or a photo) and have a model backfill the property
  // fields the deterministic MLS parser can't read. Growth+ (a paid time-saver
  // over re-keying, sibling to lease_ocr). Carries a real per-use model/API cost;
  // the import action enforces the entitlement server-side.
  | "listing_ai_import";

export const PLAN_FEATURES: PlanFeature[] = [
  "sms",
  "renter_sms",
  "rent_collection",
  "tax_export",
  "bank_feed",
  "accounting",
  "incident_intake",
  "incident_dispatch",
  "capture_email_in",
  "capture_text_in",
  "repair_sms",
  "listing_marketing",
  "lease_ocr",
  "listing_ai_import",
];

export type PlanEntitlements = Record<PlanFeature, boolean>;

// Every feature off — the safe default and the trial baseline.
function noEntitlements(): PlanEntitlements {
  return {
    sms: false,
    renter_sms: false,
    rent_collection: false,
    tax_export: false,
    bank_feed: false,
    accounting: false,
    incident_intake: false,
    incident_dispatch: false,
    capture_email_in: false,
    capture_text_in: false,
    repair_sms: false,
    listing_marketing: false,
    lease_ocr: false,
    listing_ai_import: false,
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
//   Growth   = rent collection + landlord<->tenant + renter SMS + tax export +
//              live bank feed (Plaid).
//   Premium  = + accounting module + Premium aggregator (Flinks).
export const PLAN_ENTITLEMENTS: Record<AnyPlanKey, PlanEntitlements> = {
  // Legacy leasing-era plans (migrate to the new ladder; `sms` value frozen).
  trial: noEntitlements(),
  pilot: { sms: true, renter_sms: true, rent_collection: true, tax_export: true, bank_feed: true, accounting: true, incident_intake: true, incident_dispatch: true, capture_email_in: true, capture_text_in: true, repair_sms: true, listing_marketing: true, lease_ocr: true, listing_ai_import: true }, // founder pilot = full access
  core: { sms: false, renter_sms: true, rent_collection: false, tax_export: false, bank_feed: false, accounting: false, incident_intake: false, incident_dispatch: false, capture_email_in: false, capture_text_in: false, repair_sms: false, listing_marketing: false, lease_ocr: false, listing_ai_import: false },
  plus: { sms: true, renter_sms: true, rent_collection: false, tax_export: false, bank_feed: false, accounting: false, incident_intake: false, incident_dispatch: false, capture_email_in: false, capture_text_in: false, repair_sms: false, listing_marketing: false, lease_ocr: false, listing_ai_import: false },
  // Live ladder.
  free: noEntitlements(), // funnel tier: email only, no paid capabilities
  growth: { sms: true, renter_sms: true, rent_collection: true, tax_export: true, bank_feed: true, accounting: false, incident_intake: true, incident_dispatch: false, capture_email_in: true, capture_text_in: false, repair_sms: false, listing_marketing: true, lease_ocr: true, listing_ai_import: true }, // Plaid feed; tenant intake (Slices 1-4); email-in capture; listing-marketing kit; lease-OCR prefill; AI listing import
  premium: { sms: true, renter_sms: true, rent_collection: true, tax_export: true, bank_feed: true, accounting: true, incident_intake: true, incident_dispatch: true, capture_email_in: true, capture_text_in: true, repair_sms: true, listing_marketing: true, lease_ocr: true, listing_ai_import: true }, // Flinks feed; + in-app trade dispatch (Slices 5-7); email-in + text-in capture; appointment-reminder SMS; listing-marketing kit; lease-OCR prefill; AI listing import
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

// Whether this plan may use tenant incident intake + operator triage (Option B
// Slices 1-4). Growth+. The gate the /report token surfaces + the operator
// triage inbox enforce server-side.
export function canUseIncidentIntake(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "incident_intake");
}

// Whether this plan may use in-app trade dispatch / quote / scheduling (Option B
// Slices 5-7, the guardrail amendment). Premium+. Gated above intake.
export function canUseIncidentDispatch(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "incident_dispatch");
}

// Whether this plan may provision an email-in capture address (forward a plate/
// receipt photo to u-<token>@in.vacantless.com -> a pending capture). Growth+
// (S368). The gate the ingest-address provisioning action + the settings panel
// enforce; the inbound webhook itself stays org-scoped regardless.
export function canUseCaptureEmailIn(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "capture_email_in");
}

// Whether this plan may provision a text/MMS-in capture identity. Premium+
// (S368) — above email-in, since MMS carries a per-message cost. Gated at
// provisioning; the foundation is tier-agnostic.
export function canUseCaptureTextIn(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "capture_text_in");
}

// Whether this plan may send the SMS leg of a repair-appointment reminder
// (S387). Premium+ (per-message SMS cost), mirroring capture_text_in — the
// email/in-app reminder legs are ungated. The appointment-reminder cron enforces
// this server-side before texting the tenant; email always sends regardless.
export function canUseRepairSms(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "repair_sms");
}

// Whether this plan may use the listing-marketing kit (S388, Tier A): the
// self-serve promotion package for an active listing (per-channel copy + the
// /r landing link + a QR + syndication surfacing). Growth+ — a paid convenience
// over the existing listing-copy / feed plumbing. The kit surface enforces this
// server-side; an ungated plan sees the locked upsell, never the kit payload.
// NB: this gates the SELF-SERVE kit only; it never runs or pays for an ad.
export function canUseListingMarketing(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "listing_marketing");
}

// Whether this plan may use lease-OCR prefill (S425): upload a signed lease and
// pre-fill the tenancy from it. Growth+. A paid time-saver over manual entry that
// carries a real per-use model/API cost, so it is ALSO metered by a monthly
// per-org cap (leaseOcrMonthlyCap). The extractLease* actions enforce both the
// entitlement and the cap server-side; an ungated plan sees the locked upsell.
export function canUseLeaseOcr(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "lease_ocr");
}

// Whether this plan may use the AI listing import (Feature B, S428): paste a
// non-MLS listing (or a photo) and have a model backfill the property fields the
// deterministic MLS parser can't read. Growth+. A paid time-saver over re-keying
// that carries a real per-use model/API cost; the import action enforces the
// entitlement server-side, and an ungated plan simply gets the deterministic
// parse (no AI backfill), never an error.
export function canUseListingAiImport(plan: string | null | undefined): boolean {
  return hasEntitlement(plan, "listing_ai_import");
}

// Monthly per-org lease-OCR scan cap (a runaway/abuse backstop, not a meter -
// generous for real use: a landlord signs a handful of leases a year). Premium
// gets a higher ceiling than Growth. 0 for ungated plans. (Noam, S425.)
export const LEASE_OCR_CAP_GROWTH = 25;
export const LEASE_OCR_CAP_PREMIUM = 100;
export function leaseOcrMonthlyCap(plan: string | null | undefined): number {
  if (!canUseLeaseOcr(plan)) return 0;
  // Premium (and the founder pilot) get the higher ceiling; every other gated
  // plan (Growth) gets the standard one.
  return plan === "premium" || plan === "pilot" ? LEASE_OCR_CAP_PREMIUM : LEASE_OCR_CAP_GROWTH;
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
// MIGRATION (S299): the ladder is now WIRED as the live billing surface. The
// paid tiers carry their Stripe price-id env vars (STRIPE_PRICE_GROWTH /
// STRIPE_PRICE_PREMIUM); once those envs hold a real price id, isTierPurchasable
// -> true and the billing page's Subscribe buttons go live. Done in S299:
//   [x] Growth/Premium `priceEnv` set (below).
//   [x] lib/stripe.ts priceIdForPlan/priceMap read the paid TIERS.
//   [x] PaidPlanKey = growth|premium; billing page renders TIERS (Core/Plus cards removed).
//   [x] startCheckout accepts the tier key; webhook maps the price -> growth/premium.
//   [x] A fresh org defaults to plan='free' at signup (onboarding actions).
// ENFORCED (post-S402): `publishProperty` (app/dashboard/properties/actions.ts)
// checks `listingCapForPlan` before flipping a rental Live and bounces a
// Free-plan org that's already at its live-listing allowance with ?publish=plan.
// Manual step OUTSIDE the code: create the two CAD Stripe products + set the two
// price-id envs in Vercel.
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
    priceEnv: "STRIPE_PRICE_GROWTH",
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
    priceEnv: "STRIPE_PRICE_PREMIUM",
    maxActiveListings: null,
    blurb:
      "Everything in Growth, plus full books, repairs, and automatic reminders.",
    features: [
      "Everything in Growth",
      "Full accounting module",
      "Maintenance / repair dispatch",
      "Automatic post-viewing follow-up",
      "Shares new inquiries evenly across your team",
      "Priority support",
    ],
  },
};

// Config-shape check: the tier is set up to be SOLD — it has a price and a
// price-id env name. True for the paid tiers (growth/premium), false for Free
// ($0, never purchasable). NOTE: this does not read the env VALUE, so it does
// not by itself prove a Stripe product exists. The live runtime gate the
// billing page uses is isBillingConfigured() in lib/stripe.ts (it checks the
// actual price-id env values + the secret key).
export function isTierPurchasable(tier: TierInfo): boolean {
  return tier.priceCents > 0 && tier.priceEnv != null;
}

// The published-listing allowance for a stored plan (the Free funnel cap; null =
// unlimited). The publish path (publishProperty) enforces this by counting the
// org's other live listings before it makes a rental public. Unknown/missing
// plan -> the Free cap (never more).
export function listingCapForPlan(plan: string | null | undefined): number | null {
  // Any paid plan (live growth/premium or legacy core/plus) + pilot = unlimited.
  if (isAnyPaidPlan(plan) || isPilotPlan(plan)) return null;
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
    "Full access to every Growth and Premium feature",
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
  planLabel: string; // "Trial" | "Free" | "Pilot" | "Growth" | "Premium" | (legacy) "Core" | "Plus"
  isPaid: boolean; // org is on a paid tier (growth/premium, or legacy core/plus)
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
  if (plan === "growth") return "Growth";
  if (plan === "premium") return "Premium";
  if (plan === "core") return "Core"; // retired legacy plan, still labeled for any pre-migration org
  if (plan === "plus") return "Plus"; // retired legacy plan, still labeled for any pre-migration org
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
  // A paid Stripe plan wins (live growth/premium OR retired legacy core/plus);
  // otherwise pilot; otherwise the free funnel tier; else trial (the legacy
  // pre-anything default).
  const planKey: PlanKey = isAnyPaidPlan(input.plan)
    ? (input.plan as PlanKey)
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
    isPaid: isAnyPaidPlan(planKey),
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
