// ============================================================================
// Pure helpers for the listing SYNDICATION FEED.
// No DOM / env / IO — fully unit-testable (see scripts/test-listing-feed.ts).
//
// Turns the org's active listings into a well-formed, standards-aligned XML
// feed that a rental aggregator (Rentsync / Zumper / PadMapper) can ingest.
// One feed per org; one <listing> per ACTIVE property; the route at
// app/api/feed/[org] serves it from the get_org_listing_feed RPC.
//
// Grounded in the Rentsync "Zumper & PadMapper" ad requirements (2026-06):
//   - Required per listing: price, >=1 photo, description, property type.
//   - Required per feed/account: a contact phone number.
//   - Description: <= 3,500 chars, basic HTML only, NO links.
//   - Photos: up to 50, cover first.
//   - Countries: Canada & U.S. (we default CA — Ontario small landlords).
// The feed deliberately emits STRUCTURED truth (utilities-included booleans,
// furnished flag) rather than the ad-copy disclosure lines the public page
// uses — an aggregator maps fields, it does not read a disclaimer sentence.
// ============================================================================

import {
  buildAmenityChips,
  buildUtilitiesIncluded,
  derivePetFriendly,
  isAvailableNow,
  isDogSize,
  type UnitFeatures,
} from "./property-features";

// Only ACTIVE (advertised + vacant) units syndicate. draft/paused/leased/
// off_market never appear in the feed. Mirrors the WHERE in get_org_listing_feed.
export const FEED_LISTABLE_STATUS = "available" as const;

// All Agile/Vacantless units are residential apartment units today. A future
// per-property "property_type" column can override this; for now it is the
// sane default the aggregators expect for the Required "Property Type" field.
export const DEFAULT_PROPERTY_TYPE = "apartment" as const;

// Aggregator limits (Rentsync/Zumper requirements).
export const MAX_DESCRIPTION_CHARS = 3500;
export const MAX_PHOTOS = 50;

// Default country for the address block. Ontario small-landlord ICP.
export const DEFAULT_COUNTRY = "CA" as const;

// ---------------------------------------------------------------------------
// Input shapes — exactly what get_org_listing_feed returns (snake_case from
// jsonb). Kept loose (nullable) so a half-filled listing still maps cleanly;
// the readiness check below is what decides whether it is FIT to syndicate.
// ---------------------------------------------------------------------------

export type FeedListingInput = UnitFeatures & {
  id: string;
  address: string | null;
  rent_cents: number | null;
  beds: number | null;
  baths: number | string | null;
  description: string | null;
  photos: string[] | null;
};

export type FeedOrgInput = {
  name: string | null;
  slug: string | null;
  contact_phone: string | null;
  contact_email: string | null;
};

// ---------------------------------------------------------------------------
// XML escaping — the security + correctness floor. Operator-supplied free text
// (address, description, parking) and photo URLs all flow into XML; an
// unescaped "&", "<", or quote produces a malformed feed the aggregator rejects
// (or, worse, a field-injection). Text and attribute contexts differ.
// ---------------------------------------------------------------------------

export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Strip control characters XML 1.0 forbids (anything below 0x20 except tab,
// LF, CR). A stray byte in pasted copy otherwise breaks the whole document.
function stripXmlControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

// ---------------------------------------------------------------------------
// Field mappers
// ---------------------------------------------------------------------------

/** rent_cents -> a "1250.00" dollar string, or null when absent/invalid. */
export function rentDollars(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return null;
  return (Math.round(cents) / 100).toFixed(2);
}

/** baths (numeric(3,1) -> number or string from jsonb) -> "1.5" / null. */
export function formatBaths(
  baths: number | string | null | undefined,
): string | null {
  if (baths == null) return null;
  const n = typeof baths === "string" ? Number(baths) : baths;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(1);
}

/** beds -> integer string, or null. (0 beds = bachelor/studio, still valid.) */
export function formatBeds(beds: number | null | undefined): string | null {
  if (beds == null || !Number.isFinite(beds) || beds < 0) return null;
  return String(Math.round(beds));
}

/** sqft -> integer string, or null. */
export function formatSqftValue(sqft: number | null | undefined): string | null {
  if (sqft == null || !Number.isFinite(sqft) || sqft <= 0) return null;
  return String(Math.round(sqft));
}

/**
 * Sanitize a description for the feed:
 *   1. strip any links (aggregators reject them — also matches our own
 *      "FB breaks links" finding; the canonical link rides in <url>),
 *   2. collapse runs of whitespace,
 *   3. clamp to MAX_DESCRIPTION_CHARS on a word boundary,
 *   4. strip XML-illegal control chars.
 * Returns null when nothing usable remains.
 */
export function clampDescription(
  raw: string | null | undefined,
  max = MAX_DESCRIPTION_CHARS,
): string | null {
  if (typeof raw !== "string") return null;
  let v = stripLinks(raw);
  v = stripXmlControlChars(v).replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  if (!v) return null;
  if (v.length <= max) return v;
  const cut = v.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Remove http(s):// URLs and bare www. hosts from free text. */
export function stripLinks(value: string): string {
  return value
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/\bwww\.[^\s]+/gi, "")
    .replace(/[ \t]{2,}/g, " ");
}

// ---------------------------------------------------------------------------
// Feed readiness — keeps the feed HONEST. A listing only syndicates when it
// carries every aggregator-required field; anything missing is reported so the
// operator sees WHY a unit isn't going out, instead of a silently short feed.
// ---------------------------------------------------------------------------

export type FeedMissingField = "price" | "photo" | "description" | "address";

export type ListingReadiness = {
  id: string;
  ready: boolean;
  missing: FeedMissingField[];
};

export function listingFeedReadiness(
  listing: FeedListingInput,
): ListingReadiness {
  const missing: FeedMissingField[] = [];
  if (rentDollars(listing.rent_cents) == null) missing.push("price");
  if (!Array.isArray(listing.photos) || listing.photos.length === 0)
    missing.push("photo");
  if (clampDescription(listing.description) == null) missing.push("description");
  if (!listing.address || !listing.address.trim()) missing.push("address");
  return { id: listing.id, ready: missing.length === 0, missing };
}

export type FeedSummary = {
  total: number;
  readyCount: number;
  skippedCount: number;
  ready: FeedListingInput[];
  skipped: Array<{ id: string; address: string | null; missing: FeedMissingField[] }>;
  /** Org-level: the feed needs a contact phone (an aggregator requirement). */
  orgPhoneMissing: boolean;
};

export function summarizeFeed(
  org: FeedOrgInput,
  listings: ReadonlyArray<FeedListingInput>,
): FeedSummary {
  const ready: FeedListingInput[] = [];
  const skipped: FeedSummary["skipped"] = [];
  for (const l of listings) {
    const r = listingFeedReadiness(l);
    if (r.ready) ready.push(l);
    else skipped.push({ id: l.id, address: l.address, missing: r.missing });
  }
  return {
    total: listings.length,
    readyCount: ready.length,
    skippedCount: skipped.length,
    ready,
    skipped,
    orgPhoneMissing: !org.contact_phone || !org.contact_phone.trim(),
  };
}

// ---------------------------------------------------------------------------
// XML builders
// ---------------------------------------------------------------------------

function tag(name: string, value: string | null | undefined): string {
  if (value == null || value === "") return "";
  return `<${name}>${escapeXmlText(stripXmlControlChars(value))}</${name}>`;
}

function listEl(
  wrapper: string,
  item: string,
  values: ReadonlyArray<string>,
): string {
  if (values.length === 0) return "";
  const inner = values
    .map((v) => `      ${tag(item, v)}`)
    .filter(Boolean)
    .join("\n");
  if (!inner) return "";
  return `    <${wrapper}>\n${inner}\n    </${wrapper}>`;
}

export type BuildFeedOptions = {
  org: FeedOrgInput;
  listings: ReadonlyArray<FeedListingInput>;
  /** Public site base, e.g. "https://vacantless-app.vercel.app" (no trailing /). */
  baseUrl: string;
  /** ISO timestamp for the feed header; injectable for deterministic tests. */
  generatedAt: string;
  propertyType?: string;
  country?: string;
};

/** Build the <listing> element for one (already-ready) listing. */
export function buildListingItemXml(
  listing: FeedListingInput,
  opts: { baseUrl: string; propertyType: string; country: string },
): string {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/r/${encodeURIComponent(listing.id)}`;
  const address = (listing.address ?? "").trim();
  const photos = (listing.photos ?? []).slice(0, MAX_PHOTOS);

  const features: UnitFeatures = listing;
  const amenities = buildAmenityChips(features);
  const utilities = buildUtilitiesIncluded(features);

  const parts: string[] = [];
  parts.push(`    ${tag("external_id", listing.id)}`);
  parts.push(`    ${tag("url", url)}`);
  parts.push(`    ${tag("title", address)}`);
  parts.push(`    ${tag("property_type", opts.propertyType)}`);
  parts.push(`    <status>active</status>`);
  parts.push(
    `    <address>\n      ${tag("full", address)}\n      ${tag("country", opts.country)}\n    </address>`,
  );
  const rent = rentDollars(listing.rent_cents);
  if (rent)
    parts.push(`    <rent currency="CAD" period="monthly">${rent}</rent>`);
  const beds = formatBeds(listing.beds);
  if (beds) parts.push(`    ${tag("bedrooms", beds)}`);
  const baths = formatBaths(listing.baths);
  if (baths) parts.push(`    ${tag("bathrooms", baths)}`);
  const sqft = formatSqftValue(listing.sqft);
  if (sqft) parts.push(`    ${tag("square_feet", sqft)}`);
  if (listing.available_date)
    parts.push(`    ${tag("available_date", listing.available_date)}`);
  parts.push(
    `    <available_now>${isAvailableNow(listing.available_date) ? "true" : "false"}</available_now>`,
  );
  parts.push(`    <furnished>${listing.furnished ? "true" : "false"}</furnished>`);
  // Pet policy: the derived master + the structured detail (aggregators map the
  // booleans; an unknown element is ignored by ingesters that don't read it).
  const petsAllowed = derivePetFriendly(listing);
  parts.push(`    <pets_allowed>${petsAllowed ? "true" : "false"}</pets_allowed>`);
  parts.push(`    <cats_allowed>${listing.pets_cats ? "true" : "false"}</cats_allowed>`);
  parts.push(`    <dogs_allowed>${listing.pets_dogs ? "true" : "false"}</dogs_allowed>`);
  if (listing.pets_dogs && isDogSize(listing.pets_dog_size) && listing.pets_dog_size !== "any")
    parts.push(`    ${tag("dog_size_limit", listing.pets_dog_size)}`);
  if (listing.parking && String(listing.parking).trim())
    parts.push(`    ${tag("parking", String(listing.parking).trim())}`);

  const util = listEl("utilities_included", "utility", utilities);
  if (util) parts.push(util);
  const amen = listEl("amenities", "amenity", amenities);
  if (amen) parts.push(amen);

  const desc = clampDescription(listing.description);
  if (desc) parts.push(`    ${tag("description", desc)}`);

  const photoEls = photos
    .filter((u) => typeof u === "string" && u.trim())
    .map(
      (u, i) =>
        `      <photo order="${i + 1}">${escapeXmlText(stripXmlControlChars(u.trim()))}</photo>`,
    );
  if (photoEls.length)
    parts.push(`    <photos>\n${photoEls.join("\n")}\n    </photos>`);

  return `  <listing>\n${parts.filter(Boolean).join("\n")}\n  </listing>`;
}

/**
 * Build the full feed document. Only READY listings (per summarizeFeed) are
 * emitted; an org-level <contact> block carries the required phone + email.
 * Returns a complete XML string with the declaration.
 */
export function buildListingFeedXml(opts: BuildFeedOptions): string {
  const propertyType = opts.propertyType ?? DEFAULT_PROPERTY_TYPE;
  const country = opts.country ?? DEFAULT_COUNTRY;
  const summary = summarizeFeed(opts.org, opts.listings);

  const items = summary.ready
    .map((l) => buildListingItemXml(l, { baseUrl: opts.baseUrl, propertyType, country }))
    .join("\n");

  const provider = opts.org.name ?? "";
  const providerId = opts.org.slug ?? "";

  const contactInner: string[] = [];
  if (provider) contactInner.push(`    ${tag("name", provider)}`);
  if (opts.org.contact_phone && opts.org.contact_phone.trim())
    contactInner.push(`    ${tag("phone", opts.org.contact_phone.trim())}`);
  if (opts.org.contact_email && opts.org.contact_email.trim())
    contactInner.push(`    ${tag("email", opts.org.contact_email.trim())}`);
  const contactBlock = contactInner.length
    ? `  <contact>\n${contactInner.filter(Boolean).join("\n")}\n  </contact>\n`
    : "";

  const header =
    `<rental_listings source="Vacantless"` +
    ` provider="${escapeXmlAttr(provider)}"` +
    ` provider_id="${escapeXmlAttr(providerId)}"` +
    ` generated_at="${escapeXmlAttr(opts.generatedAt)}"` +
    ` count="${summary.readyCount}">`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `${header}\n` +
    contactBlock +
    (items ? `${items}\n` : "") +
    `</rental_listings>\n`
  );
}
