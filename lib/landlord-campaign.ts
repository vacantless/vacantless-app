// ============================================================================
// Landlord feature-reveal campaign — pure scheduling + copy (Tier 1 C).
//
// A near-exact port of the renter nurture engine (lib/nurture.ts) retargeted
// from a LEAD to an ORG. It reveals one capability at a time to a FREE-plan
// org that has a tenancy, and routes them to the right activation/upgrade
// surface. The cron sweep
// (app/api/cron/landlord-campaign) sends only the NEXT due reveal and bumps
// organizations.landlord_campaign_step_sent, so a re-run never double-sends.
//
// Copy lives here as code constants, exactly like nurture's STEP_COPY and every
// email template in lib/email.ts (server-composed email copy is code, not the
// next-intl UI strings in messages/*.json). Keeping it here also keeps this
// ticket off messages/*.json entirely.
//
// Pure — no DOM / env / IO / Date.now (see scripts/test-landlord-campaign.ts).
// ============================================================================

export const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Cumulative cadence in DAYS since the campaign started (org.created_at), one
// threshold per reveal. Reveal N is eligible once STEP_THRESHOLD_DAYS[N] days
// have elapsed. Gentle: right away, then weekly.
export const STEP_THRESHOLD_DAYS = [0, 7, 14, 21, 28] as const;

// Minimum spacing between two sends to the same org (pacing a catch-up sweep).
export const MIN_GAP_HOURS = 24;

// Don't run the campaign for an org whose start is older than this — the play
// targets freshly landed landlords, not the whole historical free base.
export const CAMPAIGN_MAX_AGE_DAYS = 120;

// The reveal sequence, in order. rent_increase_confirm is a FREE nudge (correct
// your base rent so the guideline math is right); rent_collection is a free
// activation reveal; tax_export/listing_marketing are Growth capabilities;
// upgrade_ask is the closer.
export const REVEAL_KEYS = [
  "rent_increase_confirm",
  "rent_collection",
  "tax_export",
  "listing_marketing",
  "upgrade_ask",
] as const;

export type RevealKey = (typeof REVEAL_KEYS)[number];
export const CAMPAIGN_STEPS = REVEAL_KEYS.length;

/**
 * Normalize a landlord campaign email: trim, lowercase, require a bare "@".
 * Returns null for a blank / obviously-invalid address. Pure.
 */
export function normalizeCampaignEmail(
  email: string | null | undefined,
): string | null {
  const t = (email ?? "").trim().toLowerCase();
  return t && t.includes("@") ? t : null;
}

/**
 * Resolve who the landlord feature-reveal campaign emails: the org's explicit
 * landlord_campaign_email ONLY. The campaign is landlord-facing, and a
 * proxy-onboarded org's member is the AGENT (not the landlord), so there is no
 * safe member fallback — an org with no landlord email is skipped by the cron.
 * Pure.
 */
export function resolveLandlordCampaignRecipient(
  landlordEmail: string | null | undefined,
): string | null {
  return normalizeCampaignEmail(landlordEmail);
}

export type LandlordRevealInput = {
  /** Campaign start (org.created_at) in ms. Null => not eligible. */
  campaignStartMs: number | null;
  nowMs: number;
  /** organizations.plan. The campaign only runs while it is "free". */
  plan: string | null;
  /** The org has at least one tenancy (a real landlord, not an empty shell). */
  hasTenancy: boolean;
  /** LANDLORD_CAMPAIGN_ENABLED (and any per-org enable) resolved by the caller. */
  enabled: boolean;
  /** organizations.landlord_campaign_opted_out. */
  optedOut: boolean;
  /** organizations.landlord_campaign_step_sent (the watermark). */
  stepSent: number;
  /** organizations.landlord_campaign_last_sent_at in ms, or null. */
  lastSentAtMs: number | null;
  // Skip-owned signals: if a reveal targets a capability the org already has,
  // it is treated as satisfied and the index advances past it.
  hasRentCollection: boolean;
  hasTaxExport: boolean;
  hasListingMarketing: boolean;
};

function isRevealOwned(key: RevealKey, input: LandlordRevealInput): boolean {
  switch (key) {
    case "rent_collection":
      return input.hasRentCollection;
    case "tax_export":
      return input.hasTaxExport;
    case "listing_marketing":
      return input.hasListingMarketing;
    default:
      // rent_increase_confirm (free nudge) and upgrade_ask are never "owned".
      return false;
  }
}

/**
 * Which reveal is due for this org right now, and the index the cron should
 * persist as landlord_campaign_step_sent (index + 1). Returns null for "nothing
 * to send".
 *
 * Returns a reveal only when ALL hold:
 *   - the campaign is enabled and the org has not opted out
 *   - the org is still on the free plan (a conversion stops the sequence)
 *   - the org has a tenancy
 *   - the campaign start is known and within the freshness cap
 *   - at least MIN_GAP_HOURS have passed since the last send
 *   - after advancing past any reveal whose capability the org already owns,
 *     the resolved reveal's cadence threshold has elapsed
 *
 * The returned index accounts for skip-owned, so persisting index + 1 advances
 * the watermark past the features that were skipped.
 */
export function nextRevealDue(
  input: LandlordRevealInput,
): { key: RevealKey; index: number } | null {
  if (!input.enabled || input.optedOut) return null;
  if (input.plan !== "free") return null; // converted or never-free -> stop
  if (!input.hasTenancy) return null;
  if (input.campaignStartMs == null) return null;

  const age = input.nowMs - input.campaignStartMs;
  if (age < 0) return null; // start in the future
  if (age > CAMPAIGN_MAX_AGE_DAYS * DAY_MS) return null; // too old

  if (
    input.lastSentAtMs != null &&
    input.nowMs - input.lastSentAtMs < MIN_GAP_HOURS * HOUR_MS
  ) {
    return null; // sent something too recently
  }

  // Start at the watermark, then advance past any reveal the org already owns.
  let idx =
    Number.isInteger(input.stepSent) && input.stepSent > 0 ? input.stepSent : 0;
  while (idx < REVEAL_KEYS.length && isRevealOwned(REVEAL_KEYS[idx], input)) {
    idx++;
  }
  if (idx >= REVEAL_KEYS.length) return null; // nothing left

  if (age < STEP_THRESHOLD_DAYS[idx] * DAY_MS) return null; // too soon

  return { key: REVEAL_KEYS[idx], index: idx };
}

export type RevealCopy = {
  subject: string;
  /** Plain-text body (may contain blank lines); no em dashes by house style. */
  body: string;
  ctaLabel: string;
  /** Relative path; the cron prefixes NEXT_PUBLIC_APP_URL for the email link. */
  ctaPath: string;
};

export type RevealContext = {
  orgName?: string | null;
  propertyAddress?: string | null;
};

export type RentConfirmCampaignTenancy = {
  id: string;
  address: string | null;
  rentCents: number | null;
  confirmToken: string;
};

export type RentConfirmCampaignUnit = {
  address: string;
  rentCents: number | null;
  confirmUrl: string;
};

export function buildRentConfirmUnits(input: {
  tenancies: RentConfirmCampaignTenancy[];
  confirmedTenancyIds: Set<string>;
  urlFor: (token: string) => string;
}): RentConfirmCampaignUnit[] {
  return input.tenancies
    .filter((tenancy) => !input.confirmedTenancyIds.has(tenancy.id))
    .map((tenancy) => ({
      address: tenancy.address?.trim() || "your unit",
      rentCents: tenancy.rentCents,
      confirmUrl: input.urlFor(tenancy.confirmToken),
    }));
}

const BILLING = "/dashboard/billing";

/**
 * Copy for one reveal. Pure. Upgrade reveals point at the real billing
 * surface; free activation nudges point at the relevant product surface.
 */
export function revealCopy(key: RevealKey, ctx: RevealContext = {}): RevealCopy {
  const unit = (ctx.propertyAddress ?? "").trim() || "your unit";
  switch (key) {
    case "rent_increase_confirm":
      return {
        subject: "Make sure you are charging the right rent",
        body:
          `Ontario sets a rent increase guideline every year. Confirm the current rent for ${unit} and Vacantless shows you exactly how much you can raise it, with the N1 notice ready to serve.\n\n` +
          "This one is free on your current plan.",
        ctaLabel: "Confirm your rent",
        ctaPath: "/dashboard/rent",
      };
    case "rent_collection":
      return {
        subject: "Collect rent automatically, straight from the tenant's bank",
        body:
          "Stop chasing e-transfers. Vacantless can pull rent from your tenant's bank on the day it is due and deposit it into your account, for a flat fee of about $5 per pull with no cut taken.\n\n" +
          "It is included free on your plan. Set it up in a few minutes.",
        ctaLabel: "Set up rent collection",
        ctaPath: "/dashboard/money",
      };
    case "tax_export":
      return {
        subject: "Your year-end tax package, built for you",
        body:
          "At tax time, Vacantless hands you a complete package: income and expenses, the T776 summary, and clean exports for your accountant, QuickBooks, or Xero.\n\n" +
          "Move to Growth to unlock it.",
        ctaLabel: "See the tax export",
        ctaPath: BILLING,
      };
    case "listing_marketing":
      return {
        subject: "Fill a vacancy from one place",
        body:
          `When ${unit} comes empty, market it everywhere renters look and track which channels bring leads back, all from one screen.\n\n` +
          "Move to Growth to unlock listing marketing.",
        ctaLabel: "Explore listing marketing",
        ctaPath: BILLING,
      };
    case "upgrade_ask":
      return {
        subject: "Ready to get more out of Vacantless?",
        body:
          "You have the essentials on the free plan, including automatic rent collection. Growth adds your year-end tax package, listing marketing, renter screening, and unlimited live listings for $99 a month.\n\n" +
          "Take a look whenever you are ready.",
        ctaLabel: "Move to Growth",
        ctaPath: BILLING,
      };
  }
}
