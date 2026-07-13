// ============================================================================
// Pure distribution VERIFICATION model (S480). No DOM / env / IO — unit-tested
// (test-distribution-verification.ts). The server actions gather facts (is the
// public page live? is the listing in the org feed? is an external URL
// reachable?) and call these interpreters to produce a durable
// distribution_verifications result, then persist it.
//
// HONESTY (brief): a feed render is "verified_submitted", NEVER "verified_live";
// a channel is only "live" with real external/public proof; a login/payment gate
// yields needs_login / needs_payment (not a failure); an unverifiable portal
// yields proof_unavailable (not a false live).
// ============================================================================

export const VERIFICATION_TYPES = [
  "public_page",
  "feed_render",
  "partner_submission",
  "external_url",
  "screenshot",
  "manual_concierge",
  "broker_confirmation",
] as const;
export type VerificationType = (typeof VERIFICATION_TYPES)[number];

export const VERIFICATION_RESULTS = [
  "verified_live",
  "verified_submitted",
  "stale",
  "not_found",
  "blocked",
  "needs_login",
  "needs_payment",
  "proof_unavailable",
  "failed",
] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

export function isVerificationResult(v: unknown): v is VerificationResult {
  return (
    typeof v === "string" &&
    (VERIFICATION_RESULTS as readonly string[]).includes(v)
  );
}

const RESULT_LABELS: Record<VerificationResult, string> = {
  verified_live: "Verified live",
  verified_submitted: "Submitted",
  stale: "Stale — refresh",
  not_found: "Not found",
  blocked: "Blocked",
  needs_login: "Needs login",
  needs_payment: "Needs payment",
  proof_unavailable: "Proof unavailable",
  failed: "Check failed",
};
export function verificationResultLabel(v: unknown): string {
  return isVerificationResult(v) ? RESULT_LABELS[v] : "Unverified";
}

export type VerificationTone = "positive" | "warning" | "danger" | "neutral";
const RESULT_TONES: Record<VerificationResult, VerificationTone> = {
  verified_live: "positive",
  verified_submitted: "positive",
  stale: "warning",
  not_found: "danger",
  blocked: "danger",
  needs_login: "warning",
  needs_payment: "warning",
  proof_unavailable: "neutral",
  failed: "danger",
};
export function verificationResultTone(v: unknown): VerificationTone {
  return isVerificationResult(v) ? RESULT_TONES[v] : "neutral";
}

/** A channel may be marked externally LIVE only with real live proof. */
export function canMarkLive(result: VerificationResult): boolean {
  return result === "verified_live";
}

/** Feed acceptance / submission is NOT live. Guards the honest wording split. */
export function isSubmittedNotLive(result: VerificationResult): boolean {
  return result === "verified_submitted";
}

export type VerificationOutcome = {
  result: VerificationResult;
  matchedFields: Record<string, boolean>;
  failureReason: string | null;
};

// --- public page verification ----------------------------------------------

export type PublicPageFacts = {
  isPublic: boolean; // property status is a public/bookable state
  bookable: boolean; // booking is enabled (renters can inquire/book)
  hasAddress: boolean;
  hasRent: boolean;
  hasPhoto: boolean;
};

/**
 * Interpret the Vacantless public page (/r/[propertyId]) facts. verified_live
 * requires it to be public + bookable + carry the core rent/address signals.
 */
export function interpretPublicPageProof(f: PublicPageFacts): VerificationOutcome {
  const matchedFields = {
    isPublic: f.isPublic,
    bookable: f.bookable,
    hasAddress: f.hasAddress,
    hasRent: f.hasRent,
    hasPhoto: f.hasPhoto,
  };
  if (!f.isPublic) {
    return { result: "not_found", matchedFields, failureReason: "The rental is not public (off-market or leased)." };
  }
  if (f.isPublic && f.bookable && f.hasAddress && f.hasRent) {
    return { result: "verified_live", matchedFields, failureReason: null };
  }
  const missing: string[] = [];
  if (!f.bookable) missing.push("booking not enabled");
  if (!f.hasAddress) missing.push("address");
  if (!f.hasRent) missing.push("rent");
  return {
    result: "failed",
    matchedFields,
    failureReason: `Public page is missing: ${missing.join(", ")}.`,
  };
}

// --- org feed verification --------------------------------------------------

export type OrgFeedFacts = {
  feedReachable: boolean;
  listingIncluded: boolean;
  hasRequiredFields: boolean; // stable id + public url + price + availability
};

/**
 * Interpret org-feed inclusion (/api/feed/[org]). A present, well-formed feed
 * item is "verified_submitted" — the listing is IN the feed, which is not the
 * same as externally live on a partner site.
 */
export function interpretOrgFeedProof(f: OrgFeedFacts): VerificationOutcome {
  const matchedFields = {
    feedReachable: f.feedReachable,
    listingIncluded: f.listingIncluded,
    hasRequiredFields: f.hasRequiredFields,
  };
  if (!f.feedReachable) {
    return { result: "failed", matchedFields, failureReason: "The org feed could not be rendered." };
  }
  if (!f.listingIncluded) {
    return { result: "not_found", matchedFields, failureReason: "This listing is not present in the org feed yet." };
  }
  if (!f.hasRequiredFields) {
    return {
      result: "failed",
      matchedFields,
      failureReason: "Feed item is missing required fields (stable id / public URL / price / availability).",
    };
  }
  return { result: "verified_submitted", matchedFields, failureReason: null };
}

// --- external URL verification ----------------------------------------------

export type ExternalUrlFacts = {
  reachable: boolean;
  loginGated: boolean;
  matchedListing: boolean; // address/rent/title matched where feasible
};

export function interpretExternalUrlProof(f: ExternalUrlFacts): VerificationOutcome {
  const matchedFields = { reachable: f.reachable, matchedListing: f.matchedListing };
  if (f.loginGated) {
    return { result: "needs_login", matchedFields, failureReason: "The listing URL is behind a login." };
  }
  if (!f.reachable) {
    return { result: "not_found", matchedFields, failureReason: "The listing URL was not reachable." };
  }
  if (f.matchedListing) {
    return { result: "verified_live", matchedFields, failureReason: null };
  }
  return {
    result: "proof_unavailable",
    matchedFields,
    failureReason: "Reachable, but the page could not be confirmed as this listing.",
  };
}

// --- stale / next-check scheduling ------------------------------------------

// Default stale windows (days) before a live channel should be re-verified.
export const STALE_DAYS: Partial<Record<string, number>> = {
  facebook: 14,
  kijiji: 14,
  viewit: 30, // paid placement — longer term
  rentals_ca: 7,
  zumper: 7,
  org_feed: 7,
  network_feed: 7,
  vacantless: 14,
  realtor_ca: 30,
  other: 14,
};
export const DEFAULT_STALE_DAYS = 14;

function addDaysISO(nowISO: string, days: number): string {
  const t = Date.parse(nowISO);
  if (Number.isNaN(t)) throw new Error(`verification: bad now "${nowISO}"`);
  return new Date(t + days * 86_400_000).toISOString();
}

/**
 * When to next re-verify a channel, given the last result. Live/submitted get a
 * channel-specific stale window; transient gated states get a short recheck;
 * terminal-negative states don't auto-schedule (operator acts). Pure — `nowISO`
 * is passed in. Returns an ISO timestamp or null (no auto recheck).
 */
export function scheduleNextVerification(
  channel: string,
  result: VerificationResult,
  nowISO: string,
): string | null {
  if (result === "verified_live" || result === "verified_submitted") {
    const days = STALE_DAYS[channel] ?? DEFAULT_STALE_DAYS;
    return addDaysISO(nowISO, days);
  }
  if (result === "needs_login" || result === "needs_payment") {
    return addDaysISO(nowISO, 1); // nudge the human action soon
  }
  if (result === "stale") {
    return addDaysISO(nowISO, 1);
  }
  // not_found / blocked / proof_unavailable / failed: operator decides, no auto.
  return null;
}

/** Has a live/submitted verification aged past its stale window? Pure. */
export function isVerificationStale(
  channel: string,
  checkedAtISO: string,
  nowISO: string,
): boolean {
  const checked = Date.parse(checkedAtISO);
  const now = Date.parse(nowISO);
  if (Number.isNaN(checked) || Number.isNaN(now)) return false;
  const days = STALE_DAYS[channel] ?? DEFAULT_STALE_DAYS;
  return now - checked >= days * 86_400_000;
}
