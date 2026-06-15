// Pure billing config + view-model helpers (M4 Stripe billing).
//
// NO Stripe SDK, env, or DB access here — everything is a pure function so it
// unit-tests cleanly via `npx tsx scripts/test-billing.ts`. The impure pieces
// (the Stripe client, env-driven price-id lookup) live in lib/stripe.ts.

export type PlanKey = "trial" | "core" | "plus";
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
    blurb: "The full lead-to-lease loop for a single operator.",
    features: [
      "Public branded intake pages",
      "Instant auto-reply emails",
      "Lead CRM + pipeline",
      "Self-serve booking + availability",
      "Showing reminders",
      "Owner reporting dashboard",
    ],
  },
  plus: {
    key: "plus",
    name: "Plus",
    priceCents: 37500,
    listPriceCents: 75000,
    priceEnv: "STRIPE_PRICE_PLUS",
    blurb: "Everything in Core plus the retention differentiators.",
    features: [
      "Everything in Core",
      "Automated post-showing feedback",
      "Price-drop blasts to past leads",
      "Nurture drip (inquiry → lease)",
      "Per-property + channel reporting",
    ],
  },
};

export const PAID_PLAN_KEYS: PaidPlanKey[] = ["core", "plus"];

export function isPaidPlan(plan: string | null | undefined): plan is PaidPlanKey {
  return plan === "core" || plan === "plus";
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
  planLabel: string; // "Trial" | "Core" | "Plus"
  isPaid: boolean; // org is on a paid tier (core/plus)
  hasSubscription: boolean; // a Stripe subscription is on file
  status: string | null;
  statusLabel: string;
  needsAttention: boolean; // past_due / unpaid / incomplete
  periodEnd: Date | null;
  periodEndLabel: string | null; // formatted in the org timezone
};

export type BillingInput = {
  plan: string | null | undefined;
  subscription_status: string | null | undefined;
  stripe_subscription_id: string | null | undefined;
  current_period_end: string | Date | null | undefined;
  timezone?: string;
};

function planLabelOf(plan: PlanKey): string {
  if (plan === "core") return "Core";
  if (plan === "plus") return "Plus";
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
  const planKey: PlanKey = isPaidPlan(input.plan) ? input.plan : "trial";
  const status = input.subscription_status ?? null;
  const periodEnd =
    input.current_period_end != null
      ? input.current_period_end instanceof Date
        ? input.current_period_end
        : new Date(input.current_period_end)
      : null;
  const validPeriodEnd = periodEnd && !isNaN(periodEnd.getTime()) ? periodEnd : null;

  return {
    planKey,
    planLabel: planLabelOf(planKey),
    isPaid: isPaidPlan(planKey),
    hasSubscription: !!input.stripe_subscription_id,
    status,
    statusLabel: statusLabel(status),
    needsAttention: needsBillingAttention(status),
    periodEnd: validPeriodEnd,
    periodEndLabel: formatPeriodEnd(input.current_period_end, input.timezone),
  };
}
