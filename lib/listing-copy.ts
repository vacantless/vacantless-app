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
  "linkedin",
  "instagram",
  "facebook_feed",
  "whatsapp",
  "snapchat",
  "rentals_ca",
  "rentfaster",
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
  // CLASSIFIED (Kijiji, Facebook, the portable master) = the platform has no
  // structured listing fields, so the body must be SELF-CONTAINED: it repeats
  // beds/baths/sqft/parking and the amenity list inline. STRUCTURED (Rentals.ca,
  // Zumper, Viewit) = the platform captures those as its own fields, so repeating
  // them in the description box is redundant clutter. There the body reads as a
  // narrative (description + price + utilities + CTA) and DROPS the spec + amenity
  // lines. Utilities stay everywhere (a what's-included disclosure, not always a
  // structured field).
  classified: boolean;
};

// Default CTA shared by classified portals whose links render normally.
const DEFAULT_CTA = "Book a viewing or send an inquiry:";
// Listing platforms show the inquiry beneath their own structured fields, so the
// CTA is a short, direct nudge rather than a self-contained "send an inquiry".
const STRUCTURED_CTA = "Book a viewing or ask us a question:";
const DEFAULT_NO_URL_CTA = "Contact us to book a viewing.";
const SOCIAL_CTA = "See details and book a viewing:";

const PORTAL_PROFILES: Record<CopyPortalKey, PortalProfile> = {
  generic: { label: "Master copy", maxTitle: 120, plainText: true, linkOnOwnLine: true, cta: DEFAULT_CTA, classified: true },
  kijiji: { label: "Kijiji", maxTitle: 64, plainText: true, linkOnOwnLine: false, cta: DEFAULT_CTA, classified: true },
  facebook: {
    label: "Facebook Marketplace",
    maxTitle: 100,
    plainText: true,
    linkOnOwnLine: true,
    // Marketplace strips inline links and breaks them in Messenger, so point the
    // renter at messaging us or copying the link into a browser instead.
    cta: "Message us to book a viewing, or copy this link into your browser:",
    classified: true,
  },
  linkedin: { label: "LinkedIn", maxTitle: 120, plainText: true, linkOnOwnLine: true, cta: SOCIAL_CTA, classified: true },
  instagram: { label: "Instagram", maxTitle: 90, plainText: true, linkOnOwnLine: true, cta: "Details and viewing link:", classified: true },
  facebook_feed: { label: "Facebook feed", maxTitle: 100, plainText: true, linkOnOwnLine: true, cta: SOCIAL_CTA, classified: true },
  whatsapp: { label: "WhatsApp", maxTitle: 100, plainText: true, linkOnOwnLine: true, cta: "Reply here or book a viewing:", classified: true },
  snapchat: { label: "Snapchat", maxTitle: 80, plainText: true, linkOnOwnLine: true, cta: "Details and viewing link:", classified: true },
  rentals_ca: { label: "Rentals.ca", maxTitle: 100, plainText: true, linkOnOwnLine: false, cta: STRUCTURED_CTA, classified: false },
  rentfaster: { label: "RentFaster.ca", maxTitle: 100, plainText: true, linkOnOwnLine: false, cta: STRUCTURED_CTA, classified: false },
  zumper: { label: "Zumper + PadMapper", maxTitle: 100, plainText: true, linkOnOwnLine: false, cta: STRUCTURED_CTA, classified: false },
  viewit: { label: "Viewit.ca", maxTitle: 90, plainText: true, linkOnOwnLine: false, cta: STRUCTURED_CTA, classified: false },
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
  fallbackCta?: string | null;
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

// Curated, FACTUAL lead descriptors. A title only uses one of these when the
// word actually appears in the operator's description - we never invent a
// quality the listing didn't claim. Priority order (most evocative first); the
// headline takes up to two distinct labels. Hyphen/space variants are matched
// explicitly so "open concept" and "open-concept" both resolve.
const LEAD_DESCRIPTORS: Array<{ re: RegExp; label: string }> = [
  { re: /\bbright\b/i, label: "Bright" },
  { re: /\bsunny\b/i, label: "Sunny" },
  { re: /\bspacious\b/i, label: "Spacious" },
  { re: /\b(?:newly|recently|fully)\s+renovated\b/i, label: "Renovated" },
  { re: /\brenovated\b/i, label: "Renovated" },
  { re: /\b(?:newly|recently|fully)\s+updated\b/i, label: "Updated" },
  { re: /\bupdated\b/i, label: "Updated" },
  { re: /\bmodern\b/i, label: "Modern" },
  { re: /\bopen[-\s]?concept\b/i, label: "Open-Concept" },
  { re: /\bcorner\b/i, label: "Corner" },
  { re: /\bmain[-\s]?floor\b/i, label: "Main-Floor" },
  { re: /\bground[-\s]?floor\b/i, label: "Ground-Floor" },
  { re: /\btop[-\s]?floor\b/i, label: "Top-Floor" },
  { re: /\bpenthouse\b/i, label: "Penthouse" },
  { re: /\bfreshly\s+painted\b/i, label: "Freshly Painted" },
  { re: /\bcharming\b/i, label: "Charming" },
  { re: /\bcozy\b/i, label: "Cozy" },
  { re: /\bquiet\b/i, label: "Quiet" },
  { re: /\bclean\b/i, label: "Clean" },
  { re: /\bbeautiful\b/i, label: "Beautiful" },
  { re: /\bspotless\b/i, label: "Spotless" },
];

/**
 * Pull up to `max` factual lead adjectives FROM the operator's own description
 * (so the title can read "Bright Main-Floor 1-Bedroom..." instead of a field
 * dump). Returns [] when the description is empty or carries none - the headline
 * then falls back to structured facts. Never invents a descriptor.
 */
export function extractLeadDescriptors(
  description: string | null | undefined,
  max = 2,
): string[] {
  if (typeof description !== "string" || !description.trim()) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { re, label } of LEAD_DESCRIPTORS) {
    if (out.length >= max) break;
    if (seen.has(label)) continue;
    if (re.test(description)) {
      out.push(label);
      seen.add(label);
    }
  }
  return out;
}

/** Title-cased bedroom phrase: "Studio" / "1-Bedroom" / "3-Bedroom", or null. */
export function bedroomPhrase(beds: number | null | undefined): string | null {
  if (beds == null || !Number.isFinite(beds)) return null;
  if (beds <= 0) return "Studio";
  return `${beds}-Bedroom`;
}

/**
 * Trim a unit/suite designator off an address so a title reads as a place, not a
 * mailing line: "506 Manning Avenue unit - main" -> "506 Manning Avenue". Keeps
 * the street suffix (no invention/over-shortening). Returns "" for a blank input.
 */
export function shortenAddressForTitle(
  address: string | null | undefined,
): string {
  const a = (address ?? "").replace(/\s+/g, " ").trim();
  if (!a) return "";
  // Drop a unit/suite/apt keyword and everything after it (incl. a trailing
  // "- main" that rode along with "unit").
  let s = a.replace(/[,]?\s*(?:unit|suite|apt|apartment|ste|#)\b.*$/i, "").trim();
  // Drop a trailing "- <unit label>" segment when no keyword was present.
  s = s
    .replace(
      /\s*[-–—]\s*(?:main|basement|bsmt|upper|lower|ground|rear|front|main\s+floor|lower\s+level|upper\s+level)\b.*$/i,
      "",
    )
    .trim();
  // A dangling separator/comma after stripping reads badly; clean it up.
  return s.replace(/[\s,;:-]+$/, "").trim();
}

/**
 * Up to two TRUE structured features for a headline tail ("With Air Conditioning
 * and Parking"). Only emitted when the description carried no descriptors, so the
 * title still has a hook without over-stuffing. Facts only - nothing assumed.
 */
function featureTail(features?: UnitFeatures): string | null {
  if (!features) return null;
  const t: string[] = [];
  if (features.air_conditioning) t.push("Air Conditioning");
  const parking = features.parking != null ? String(features.parking).trim() : "";
  if (parking && !/^(?:no|none|n\/a|0)$/i.test(parking)) t.push("Parking");
  if (features.laundry === "in_suite") t.push("In-Suite Laundry");
  if (t.length === 0 && features.balcony) t.push("a Balcony");
  const top = t.slice(0, 2);
  if (top.length === 0) return null;
  return top.length === 1 ? top[0] : `${top[0]} and ${top[1]}`;
}

/**
 * Persuasive headline before truncation. Leads with factual descriptors pulled
 * from the description ("Bright Main-Floor 1-Bedroom at 506 Manning Avenue");
 * with none, falls back to "1-Bedroom Rental at <address>" plus a true-feature
 * tail ("... With Air Conditioning"). Never includes a quality the listing
 * didn't state. Hyphens only (never em dash); rent stays in the body.
 */
export function buildHeadline(input: ListingCopyInput): string {
  const descriptors = extractLeadDescriptors(input.description);
  const bedPhrase = bedroomPhrase(input.beds);
  const shortAddr = shortenAddressForTitle(input.address);

  const leadParts = [...descriptors];
  if (bedPhrase) leadParts.push(bedPhrase);
  const lead = leadParts.join(" ") || "Rental";

  // With no descriptor carrying the appeal, give a bare "1-Bedroom" the "Rental"
  // noun so it reads as an ad rather than a spec.
  const needsNoun = descriptors.length === 0 && lead !== "Rental";

  let headline: string;
  if (shortAddr) {
    headline = `${lead}${needsNoun ? " Rental" : ""} at ${shortAddr}`;
  } else {
    headline = needsNoun ? `${lead} Rental` : lead;
  }

  if (descriptors.length === 0) {
    const tail = featureTail(input.features);
    if (tail) headline += ` With ${tail}`;
  }

  return stripEmDashes(headline.replace(/\s+/g, " ").trim());
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

  // The operator's description is the PERSUASIVE SPINE: when present it LEADS the
  // copy (a renter decides on feel/light/layout before specs), and the basics
  // below become a supporting block. With no description we fall back to a plain
  // "<beds/baths> rental at <address>" opener so the copy still stands up - the
  // Builder UI nudges the operator to write one via the Description Helper.
  const desc = (input.description ?? "").trim();
  const bb = bedsBathsSummary(input.beds, input.baths);
  const addr = (input.address ?? "").trim();
  if (desc) {
    lines.push(desc);
  } else {
    const opener = bb ? `${bb} rental` : "Rental";
    lines.push(addr ? `${opener} at ${addr}.` : `${opener}.`);
  }

  // Price + availability.
  const rent = formatRent(input.rentCents);
  const avail = formatAvailability(features.available_date, now);
  const priceLine = [rent, avail].filter(Boolean).join(" - ");
  if (priceLine) lines.push(priceLine);

  // Spec line (beds/baths/sqft/floor/parking) + amenities are the platform's OWN
  // structured fields on a listing site (Rentals.ca / Zumper / Viewit), so only
  // the self-contained classifieds (Kijiji / Facebook / master) repeat them in
  // the body. On a structured platform they'd just duplicate the form fields.
  if (profile.classified) {
    const specs = buildSpecLine({
      ...features,
      beds: input.beds,
      baths: input.baths,
    });
    if (specs.length) lines.push(specs.join(" - "));

    const amenities = buildAmenityChips(features);
    if (amenities.length) lines.push(`Features: ${amenities.join(", ")}.`);
  }

  // Utilities included (derived from the unit's own flags).
  const utils = utilitiesSummary(features);
  if (utils) lines.push(`${utils} in rent.`);

  // (The description already led the copy above when present.)

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
    const fallbackCta = (input.fallbackCta ?? DEFAULT_NO_URL_CTA).trim();
    if (fallbackCta) lines.push(fallbackCta);
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
