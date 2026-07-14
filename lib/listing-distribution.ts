// ============================================================================
// Pure helpers for listing distribution / source tracking.
// No DOM / env / IO — fully unit-testable (see scripts/test-listing-distribution.ts).
// Drives the operator "Where this is posted" UI; the portal -> human-source
// mapping here MUST stay in sync with the CASE in submit_public_lead (migration
// 0014), which is what actually stamps leads.source at insert time.
// ============================================================================

export const PORTAL_KEYS = [
  "kijiji",
  "facebook",
  "rentals_ca",
  "rentfaster",
  "zumper",
  "viewit",
  "realtor_ca",
  "other",
] as const;
export type PortalKey = (typeof PORTAL_KEYS)[number];

// Display labels for the operator UI (portal picker, post header).
const PORTAL_LABELS: Record<PortalKey, string> = {
  kijiji: "Kijiji",
  facebook: "Facebook Marketplace",
  rentals_ca: "Rentals.ca",
  rentfaster: "RentFaster.ca",
  zumper: "Zumper + PadMapper",
  viewit: "Viewit.ca",
  realtor_ca: "Realtor.ca",
  other: "Other",
};

// Ordered list for rendering the portal <select>.
export const PORTALS: ReadonlyArray<{ key: PortalKey; label: string }> =
  PORTAL_KEYS.map((key) => ({ key, label: PORTAL_LABELS[key] }));

export function isPortalKey(value: unknown): value is PortalKey {
  return (
    typeof value === "string" &&
    (PORTAL_KEYS as readonly string[]).includes(value)
  );
}

/** Normalize a raw form value to a valid portal key, defaulting to "other". */
export function normalizePortal(raw: unknown): PortalKey {
  if (typeof raw === "string") {
    const v = raw.trim();
    if (isPortalKey(v)) return v;
  }
  return "other";
}

/** Operator-facing display label for a portal key. */
export function portalLabel(key: unknown): string {
  return isPortalKey(key) ? PORTAL_LABELS[key] : "Other";
}

// --- post status -----------------------------------------------------------
export const LISTING_POST_STATUSES = [
  "draft",
  "live",
  "expired",
  "removed",
] as const;
export type ListingPostStatus = (typeof LISTING_POST_STATUSES)[number];

const STATUS_LABELS: Record<ListingPostStatus, string> = {
  draft: "Draft",
  live: "Live",
  expired: "Expired",
  removed: "Removed",
};

export function isListingPostStatus(value: unknown): value is ListingPostStatus {
  return (
    typeof value === "string" &&
    (LISTING_POST_STATUSES as readonly string[]).includes(value)
  );
}

/** Normalize a raw form value to a valid status, defaulting to "live". */
export function normalizeListingStatus(raw: unknown): ListingPostStatus {
  if (typeof raw === "string") {
    const v = raw.trim();
    if (isListingPostStatus(v)) return v;
  }
  return "live";
}

export function listingPostStatusLabel(value: unknown): string {
  return isListingPostStatus(value) ? STATUS_LABELS[value] : "Live";
}

// --- field normalizers (mirror the server action) --------------------------

/** Trim a URL; return null when blank. Prefixes a scheme on a bare domain so
 *  the operator's "Open" link works even if they paste "kijiji.ca/...". */
export function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  // Looks like a domain (has a dot, no spaces) — assume https.
  if (/^[^\s]+\.[^\s]+$/.test(v)) return `https://${v}`;
  return v;
}

/** Trim free text; return null when blank. */
export function normalizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v || null;
}

/** Normalize an HTML date input ("YYYY-MM-DD") to a value or null. */
export function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// --- tracked link ----------------------------------------------------------

/**
 * Build the per-post tracked inquiry link. Appends `p=<postId>` to the public
 * listing URL so a lead that arrives through it is attributed to this post.
 * Preserves any existing query string.
 */
export function buildTrackedLink(publicUrl: string, postId: string): string {
  if (!postId) return publicUrl;
  const sep = publicUrl.includes("?") ? "&" : "?";
  return `${publicUrl}${sep}p=${encodeURIComponent(postId)}`;
}

/**
 * Pick the per-(property, portal) tracker row to RESERVE for a browser co-pilot
 * channel, so the tracked `?p=` inquiry link is FINAL before the operator posts
 * (distribution hardening #2). Prefers an existing `live` tracker (its link is
 * already circulating), else the newest non-`removed` row, else null = the caller
 * should create a fresh draft. Pure; `removed` rows are ignored. "Newest" = max
 * created_at (ISO timestamps compare lexically).
 */
export function reservableTrackerId(
  posts: ReadonlyArray<{
    id: string;
    portal: string;
    status: string;
    created_at: string;
  }>,
  portal: PortalKey,
): string | null {
  const candidates = posts.filter(
    (p) => p.portal === portal && p.status !== "removed",
  );
  if (candidates.length === 0) return null;
  const live = candidates.find((p) => p.status === "live");
  if (live) return live.id;
  let newest = candidates[0];
  for (const p of candidates) {
    if (p.created_at > newest.created_at) newest = p;
  }
  return newest.id;
}

/**
 * The human source label a lead gets when it arrives through this post — must
 * match the CASE in submit_public_lead. Used for previews + keeping the two
 * layers honest in tests.
 */
export function sourceLabelForPost(post: {
  portal: unknown;
  label?: unknown;
}): string {
  const key = isPortalKey(post.portal) ? post.portal : "other";
  if (key === "other") return normalizeText(post.label) ?? "Other portal";
  return PORTAL_LABELS[key];
}

// --- validation ------------------------------------------------------------

/**
 * Validate a listing post before it is saved. The product bug this guards:
 * a post could be saved marked "Live" with no ad URL, so the tracked-source
 * story and the operator's "where is this live right now" view both lied.
 *
 * Rules (intentionally light — this is an operator's own tracker, not a public
 * form): a post that is Live MUST carry an ad URL, and any URL provided must be
 * a plausible http(s) web address. Draft/Expired/Removed posts may have no URL
 * (you're noting a plan or an old post). Returns the first problem found, keyed
 * to the field so the UI can point at it; `ok` means safe to persist.
 *
 * Operates on the SAME normalized shapes the action persists (run the raw form
 * values through normalizePortal/normalizeListingStatus/normalizeUrl first), so
 * the check and the write never disagree.
 */
export type ListingPostInput = {
  portal: PortalKey;
  status: ListingPostStatus;
  url: string | null;
};

export type ListingPostValidation =
  | { ok: true }
  | { ok: false; field: "url"; code: ListingPostError };

export type ListingPostError =
  | "live_needs_url"
  | "url_not_web"
  | "rentfaster_url_required"
  | "realtor_url_required";

/** True when a string is a plausible absolute http(s) URL. */
export function isWebUrl(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    const u = new URL(v);
    // Need a host with a dot (rules out "https://localhost" typos) and no spaces.
    return u.hostname.includes(".") && !/\s/.test(v);
  } catch {
    return false;
  }
}

/** True for a public Realtor.ca listing URL, not the homepage or another site. */
export function isRealtorCaListingUrl(value: string | null | undefined): boolean {
  if (!isWebUrl(value)) return false;
  try {
    const u = new URL(String(value).trim());
    const host = u.hostname.toLowerCase();
    const isRealtorHost = host === "realtor.ca" || host === "www.realtor.ca";
    return isRealtorHost && /^\/real-estate\/\d+/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** True for a public RentFaster listing URL, not a search/manage/pricing page. */
export function isRentFasterListingUrl(value: string | null | undefined): boolean {
  if (!isWebUrl(value)) return false;
  try {
    const u = new URL(String(value).trim());
    const host = u.hostname.toLowerCase();
    if (host !== "rentfaster.ca" && host !== "www.rentfaster.ca") return false;
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (!path || path === "/" || path === "/prices" || path === "/list-property") {
      return false;
    }
    if (/\/(?:dashboard|login|register|my-listings)(?:\/|$)/.test(path)) {
      return false;
    }
    // Search pages end at /rentals; listing detail pages continue past it and
    // include an id/address segment. This is deliberately shape-based, not
    // network verification.
    return /\/rentals\/.+\d/.test(path);
  } catch {
    return false;
  }
}

export function validateListingPost(
  input: ListingPostInput,
): ListingPostValidation {
  const url = input.url;
  // A live ad with no link can't be tracked or reopened — block it.
  if (input.status === "live" && !url) {
    return { ok: false, field: "url", code: "live_needs_url" };
  }
  // Any URL that IS provided must look like a real web address.
  if (url && !isWebUrl(url)) {
    return { ok: false, field: "url", code: "url_not_web" };
  }
  if (
    input.status === "live" &&
    input.portal === "rentfaster" &&
    !isRentFasterListingUrl(url)
  ) {
    return { ok: false, field: "url", code: "rentfaster_url_required" };
  }
  if (
    input.status === "live" &&
    input.portal === "realtor_ca" &&
    !isRealtorCaListingUrl(url)
  ) {
    return { ok: false, field: "url", code: "realtor_url_required" };
  }
  return { ok: true };
}

/** Operator-facing copy for a validation error code. */
export function listingPostErrorMessage(code: unknown): string {
  switch (code) {
    case "live_needs_url":
      return "Add the ad's web link before marking this post Live, or set it to Draft for now.";
    case "url_not_web":
      return "That doesn't look like a web link. Use the full address, like https://www.kijiji.ca/...";
    case "rentfaster_url_required":
      return "Use the live RentFaster.ca listing link, not the search, pricing, or dashboard page, before marking RentFaster Live.";
    case "realtor_url_required":
      return "Use the live Realtor.ca listing link, like https://www.realtor.ca/real-estate/123456/..., before marking Realtor.ca Live.";
    default:
      return "Please check the post details and try again.";
  }
}

// --- counts ----------------------------------------------------------------

/** Tally how many of the given leads came through each post id. */
export function countLeadsByPost(
  leads: ReadonlyArray<{ listing_post_id: string | null }>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of leads) {
    if (!l.listing_post_id) continue;
    m.set(l.listing_post_id, (m.get(l.listing_post_id) ?? 0) + 1);
  }
  return m;
}
