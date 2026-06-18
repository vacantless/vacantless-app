// ============================================================================
// Pure helpers for the listing-copy builder/export.
// No DOM / env / IO — fully unit-testable (see scripts/test-listing-copy.ts).
// Generates ready-to-paste listing copy per advertising portal from a unit's
// own fields. House rules honored: hyphens not em dashes in generated text;
// utilities/furnishing reflect each unit's actual flags (never hardcoded).
// The portal keys here intentionally MIRROR lib/listing-distribution PORTALS so
// the "build copy" and "track where posted" flows speak the same vocabulary.
// ============================================================================

import {
  type UnitFeatures,
  buildSpecLine,
  buildAmenityChips,
  utilitiesSummary,
  formatAvailability,
} from "./property-features";

// Portals the builder can target. "generic" is the portal-agnostic master copy.
export const COPY_PORTAL_KEYS = [
  "generic",
  "kijiji",
  "facebook",
  "rentals_ca",
  "zumper",
  "viewit",
] as const;
export type CopyPortalKey = (typeof COPY_PORTAL_KEYS)[number];

type PortalProfile = {
  label: string;
  // Max title length the portal accepts (used to truncate the headline cleanly).
  maxTitle: number;
  // Whether the portal's free-text body renders plain text only (no markdown).
  plainText: boolean;
  // Put the inquiry link on its own line (Facebook strips/garbles inline links).
  linkOnOwnLine: boolean;
  // Portal-appropriate call-to-action that precedes the inquiry link. Facebook
  // Marketplace mangles clickable links (and breaks them outright inside DMs),
  // so its CTA tells the renter to message or paste the link rather than tap it.
  cta: string;
};

// Default CTA shared by every portal whose links render normally.
const DEFAULT_CTA = "Book a viewing or send an inquiry:";

const PORTAL_PROFILES: Record<CopyPortalKey, PortalProfile> = {
  generic: { label: "Master copy", maxTitle: 120, plainText: true, linkOnOwnLine: true, cta: DEFAULT_CTA },
  kijiji: { label: "Kijiji", maxTitle: 64, plainText: true, linkOnOwnLine: false, cta: DEFAULT_CTA },
  facebook: {
    label: "Facebook Marketplace",
    maxTitle: 100,
    plainText: true,
    linkOnOwnLine: true,
    // Marketplace strips inline links and breaks them in Messenger, so point the
    // renter at messaging us or copying the link into a browser instead.
    cta: "Message us to book a viewing, or copy this link into your browser:",
  },
  rentals_ca: { label: "Rentals.ca", maxTitle: 100, plainText: true, linkOnOwnLine: false, cta: DEFAULT_CTA },
  zumper: { label: "Zumper", maxTitle: 100, plainText: true, linkOnOwnLine: false, cta: DEFAULT_CTA },
  viewit: { label: "Viewit.ca", maxTitle: 90, plainText: true, linkOnOwnLine: false, cta: DEFAULT_CTA },
};

export const COPY_PORTALS: ReadonlyArray<{ key: CopyPortalKey; label: string }> =
  COPY_PORTAL_KEYS.map((key) => ({ key, label: PORTAL_PROFILES[key].label }));

export function isCopyPortalKey(value: unknown): value is CopyPortalKey {
  return (
    typeof value === "string" &&
    (COPY_PORTAL_KEYS as readonly string[]).includes(value)
  );
}

/** Normalize a raw form value to a valid copy-portal key, defaulting to "generic". */
export function normalizeCopyPortal(raw: unknown): CopyPortalKey {
  if (typeof raw === "string") {
    const v = raw.trim();
    if (isCopyPortalKey(v)) return v;
  }
  return "generic";
}

export function copyPortalLabel(key: unknown): string {
  return isCopyPortalKey(key) ? PORTAL_PROFILES[key].label : "Master copy";
}

// --- inputs -----------------------------------------------------------------

export type ListingCopyInput = {
  businessName?: string | null;
  address: string;
  rentCents?: number | null;
  beds?: number | null;
  baths?: number | null;
  description?: string | null;
  publicUrl?: string | null;
  features?: UnitFeatures;
  now?: Date;
};

export type ListingCopy = {
  portal: CopyPortalKey;
  title: string;
  body: string;
};

// --- formatting primitives --------------------------------------------------

/** "$1,850/month" from cents, or null when missing/invalid. */
export function formatRent(rentCents: number | null | undefined): string | null {
  if (rentCents == null || !Number.isFinite(rentCents) || rentCents <= 0) {
    return null;
  }
  const dollars = Math.round(rentCents) / 100;
  // Whole-dollar rents render without cents; odd amounts keep them.
  const hasCents = Math.round(rentCents) % 100 !== 0;
  const formatted = dollars.toLocaleString("en-CA", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
  return `$${formatted}/month`;
}

/** Beds/baths summary, e.g. "2 bed, 1 bath" — omits whichever is missing. */
export function bedsBathsSummary(
  beds: number | null | undefined,
  baths: number | null | undefined,
): string | null {
  const parts: string[] = [];
  if (beds != null && Number.isFinite(beds)) {
    parts.push(beds === 0 ? "Studio" : `${beds} bed`);
  }
  if (baths != null && Number.isFinite(baths)) {
    // Drop a trailing ".0" so 1.0 -> "1".
    const b = Number.isInteger(baths) ? String(baths) : String(baths);
    parts.push(`${b} bath`);
  }
  return parts.length ? parts.join(", ") : null;
}

/** Truncate at a word boundary to <= max chars, no trailing punctuation. */
export function truncateTitle(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > Math.floor(max * 0.6) ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/[\s,.;:-]+$/, "");
}

// --- title + body -----------------------------------------------------------

/**
 * Headline before truncation: "<beds/baths> for rent - <address>" with the
 * rent appended when there's room. Hyphen separator (never em dash).
 */
export function buildHeadline(input: ListingCopyInput): string {
  const bb = bedsBathsSummary(input.beds, input.baths);
  const lead = bb ? `${bb} for rent` : "Rental for rent";
  const addr = (input.address ?? "").trim();
  const base = addr ? `${lead} - ${addr}` : lead;
  const rent = formatRent(input.rentCents);
  return rent ? `${base} - ${rent}` : base;
}

/**
 * Build ready-to-paste copy for a given portal. Returns a title (length-capped
 * for the portal) and a plain-text body assembled from the unit's real fields.
 */
export function buildListingCopy(
  input: ListingCopyInput,
  portal: CopyPortalKey = "generic",
): ListingCopy {
  const profile = PORTAL_PROFILES[portal] ?? PORTAL_PROFILES.generic;
  const features = input.features ?? {};
  const now = input.now ?? new Date();

  const title = truncateTitle(buildHeadline(input), profile.maxTitle);

  const lines: string[] = [];

  // Opening line: business name + what it is.
  const bb = bedsBathsSummary(input.beds, input.baths);
  const opener = bb ? `${bb} rental` : "Rental";
  const addr = (input.address ?? "").trim();
  lines.push(addr ? `${opener} at ${addr}.` : `${opener}.`);

  // Price + availability.
  const rent = formatRent(input.rentCents);
  const avail = formatAvailability(features.available_date, now);
  const priceLine = [rent, avail].filter(Boolean).join(" - ");
  if (priceLine) lines.push(priceLine);

  // Spec line (beds/baths/sqft/floor/parking) — reuse the canonical helper.
  const specs = buildSpecLine({
    ...features,
    beds: input.beds,
    baths: input.baths,
  });
  if (specs.length) lines.push(specs.join(" - "));

  // Amenities.
  const amenities = buildAmenityChips(features);
  if (amenities.length) lines.push(`Features: ${amenities.join(", ")}.`);

  // Utilities included (derived from the unit's own flags).
  const utils = utilitiesSummary(features);
  if (utils) lines.push(`${utils} in rent.`);

  // Operator's own description.
  const desc = (input.description ?? "").trim();
  if (desc) lines.push(desc);

  // Call to action + inquiry link. The CTA is portal-specific (Facebook gets a
  // message/paste-the-link variant because Marketplace breaks tappable links).
  const url = (input.publicUrl ?? "").trim();
  if (url) {
    const cta = profile.cta;
    if (profile.linkOnOwnLine) {
      lines.push(cta);
      lines.push(url);
    } else {
      lines.push(`${cta} ${url}`);
    }
  } else {
    lines.push("Contact us to book a viewing.");
  }

  // Sign-off with the business name when present.
  const biz = (input.businessName ?? "").trim();
  if (biz) lines.push(`- ${biz}`);

  const body = stripEmDashes(lines.join("\n\n").trim());
  return { portal, title: stripEmDashes(title), body };
}

/** Build copy for every portal at once (operator "copy for each channel" view). */
export function buildAllListingCopy(input: ListingCopyInput): ListingCopy[] {
  return COPY_PORTAL_KEYS.map((p) => buildListingCopy(input, p));
}

/** Safety net: replace any em/en dash with a hyphen (house style). */
export function stripEmDashes(s: string): string {
  return s.replace(/[–—]/g, "-");
}
