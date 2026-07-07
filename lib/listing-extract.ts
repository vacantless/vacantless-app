// ============================================================================
// AI listing extraction - the PURE parse contract (Feature B, S428). Turns a
// NON-MLS listing source (a freeform Kijiji/Facebook blurb an operator pastes,
// or a photo of a listing) into the SAME `ParsedListing` shape that the
// deterministic `parseMlsListing` produces, so the AI path is a drop-in
// BACKFILL for the regex parser rather than a parallel one:
//
//   1. the deterministic `parseMlsListing` runs first (conservative, proven,
//      no network) and fills whatever the label/column formats expose;
//   2. `applyAiListing` then fills ONLY the fields the deterministic parse left
//      unset - the deterministic result always wins, the model never overwrites
//      a value the regex was confident about.
//
// The extraction itself is delegated to a multimodal model in
// lib/listing-extract-vision.ts (the impure, network half); THIS module is the
// deterministic contract around it - the JSON schema the model must return, the
// prompt, the normalizer that clamps every field to the same bounds the manual
// property form enforces, and the merge. No DB / env / I/O, so it unit-tests
// cleanly (scripts/test-listing-extract.ts).
//
// Mirrors lib/lease-extract.ts on purpose (same pure/impure split, tolerant JSON
// extraction, never-guess posture) - but WITHOUT a PII redaction guard: a rental
// LISTING is public marketing copy, not a tenant record, so there is no
// SIN / driver's-licence / bank identifier to strip. The one sensitive-by-policy
// field is PET POLICY, which we deliberately do NOT infer: pets are an RTA s.14
// advertising/screening decision the operator makes explicitly (S241), so the
// contract has no pet field at all - exactly matching `parseMlsListing`, which
// never touches the pet fields.
// ============================================================================

import { type ParsedListing, emptyParsedListing, FIELD_LABELS } from "./mls-import";
import { type Laundry, isLaundry } from "./property-features";
// The tolerant JSON extractor and the ASCII-key guard are generic (no lease/PII
// coupling) and already unit-tested; reuse them rather than duplicate.
import { extractJsonObject, isAsciiApiKey } from "./lease-extract";

export { extractJsonObject, isAsciiApiKey };

// ---------------------------------------------------------------------------
// Bounds (mirror the property form's own clamps so an AI draft can never carry a
// value the manual form would reject).
// ---------------------------------------------------------------------------
/** Trim ceiling for a short free-text field the model returns (parking). */
export const MAX_TEXT_LEN = 120;
/** Ceiling for the listing description. */
export const MAX_DESCRIPTION_LEN = 4000;
/** Monthly rent sanity ceiling, in cents ($100,000/mo). */
export const MAX_RENT_CENTS = 10_000_000;
/** Monthly rent sanity FLOOR, in cents ($100/mo). A monthly residential rent
 * below this is implausible; a bare integer that low was almost certainly the
 * model returning DOLLARS despite the "integer cents" contract, so it is scaled
 * up by 100 rather than persisted 100x too low. */
export const MIN_RENT_CENTS = 10_000;
/** Bedroom / bathroom count ceiling (a small residential rental). */
export const MAX_ROOMS = 20;
/** Square-footage sanity ceiling. */
export const MAX_SQFT = 100_000;
/** Calendar-year bounds for an availability date. */
export const MIN_LISTING_YEAR = 2000;
export const MAX_LISTING_YEAR = 2100;

// ---------------------------------------------------------------------------
// The result contract
// ---------------------------------------------------------------------------

/**
 * The structured listing fields read off an arbitrary source. Everything is
 * nullable - the model must null what it cannot clearly read. This is a SUBSET
 * of `ParsedListing`: it deliberately omits `virtualTourUrl` (a URL is recovered
 * more reliably by the deterministic allow-listed host scan than by a model),
 * `foundFields` (the merge recomputes it), and any PET field (operator decision,
 * never inferred). The booleans are TRI-STATE (`true` / `false` / `null`): the
 * merge only ever backfills a `true` the deterministic parse missed, so an
 * explicit `false` and an unknown `null` are treated the same (leave the base's
 * default), and the model saying "no A/C" never demotes a regex-found A/C.
 */
export interface ListingDraft {
  address: string | null;
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  parking: string | null;
  description: string | null;
  availableDate: string | null; // ISO YYYY-MM-DD
  airConditioning: boolean | null;
  balcony: boolean | null;
  furnished: boolean | null;
  laundry: Laundry | null;
  heatIncluded: boolean | null;
  hydroIncluded: boolean | null;
  waterIncluded: boolean | null;
}

/** The outcome the vision adapter returns. `empty` = parsed but nothing useful
 * was read (all fields null) - the caller keeps the deterministic result. */
export type ListingParseResult =
  | { ok: true; draft: ListingDraft }
  | { ok: false; reason: "unconfigured" | "failed" | "empty" | "locked" | "limit" };

/** An empty draft - every field unset. */
export function emptyListingDraft(): ListingDraft {
  return {
    address: null,
    rentCents: null,
    beds: null,
    baths: null,
    sqft: null,
    parking: null,
    description: null,
    availableDate: null,
    airConditioning: null,
    balcony: null,
    furnished: null,
    laundry: null,
    heatIncluded: null,
    hydroIncluded: null,
    waterIncluded: null,
  };
}

// ---------------------------------------------------------------------------
// The prompt (kept here so the contract + wording are versioned together)
// ---------------------------------------------------------------------------

export const LISTING_SYSTEM_PROMPT =
  "You read a residential RENTAL listing (a classified ad, a realtor blurb, a " +
  "property-management page, or a photo of one) that a landlord pasted or " +
  "uploaded, and extract the key facts into structured fields. Extract only what " +
  "is clearly stated. NEVER guess: if a value is absent or unclear, use null.\n\n" +
  "This is a listing, not a lease or an application - it contains no private " +
  "identifiers. Do NOT invent a pet policy: the field does not exist here because " +
  "pets are a decision the landlord makes separately.\n\n" +
  "Reply with ONE JSON object and nothing else - no prose, no markdown fences.";

/** The instruction sent alongside the listing text / image. Describes the exact
 * JSON shape so the model's output maps 1:1 onto normalizeListingDraft. */
export function buildListingExtractionPrompt(): string {
  return [
    "Return a single JSON object with exactly these keys:",
    "",
    '{"address":<the rental unit\'s address as written, or null>,',
    '"rentCents":<monthly rent in integer cents, e.g. $1,850/mo -> 185000, or null>,',
    '"beds":<number of bedrooms, integer (a studio/bachelor is 0), or null>,',
    '"baths":<number of bathrooms (halves allowed, e.g. 1.5), or null>,',
    '"sqft":<interior square footage, integer, or null>,',
    '"parking":<short text describing parking, e.g. "1 surface spot", or null>,',
    '"description":<the listing description / marketing copy, or null>,',
    '"availableDate":<the date the unit is available, YYYY-MM-DD, or null>,',
    '"airConditioning":<true if it mentions A/C, false if it says none, else null>,',
    '"balcony":<true if it mentions a balcony/terrace, false if none, else null>,',
    '"furnished":<true if furnished, false if unfurnished, else null>,',
    '"laundry":<one of "in_suite","in_building","ensuite","shared","none", or null>,',
    '"heatIncluded":<true if heat is included in rent, false if the tenant pays it, else null>,',
    '"hydroIncluded":<true if hydro/electricity is included, false if the tenant pays it, else null>,',
    '"waterIncluded":<true if water is included, false if the tenant pays it, else null>}',
    "",
    "Rules: money as INTEGER CENTS. Dates as YYYY-MM-DD. A boolean field is null " +
      "unless the listing clearly states it either way. laundry must be exactly one " +
      "of the listed words or null. Do NOT output a pet field. Output the JSON " +
      "object only.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Field coercion helpers (each null-safe; the only logic worth testing)
// ---------------------------------------------------------------------------

/** Coerce to an integer in [min,max], or null. Strips currency/thousands junk. */
function clampInt(v: unknown, min: number, max: number): number | null {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[, $]/g, "")) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < min || i > max) return null;
  return i;
}

/**
 * Coerce a model rent value to integer CENTS in [1, MAX_RENT_CENTS], or null.
 * The prompt asks for integer cents, but models frequently return a DOLLAR
 * figure instead ("$1,850", "1850", "1850.00"). Left to clampInt those would
 * persist 100x too low ("$1,850" -> 1850 cents = $18.50), so detect the dollar
 * case and scale:
 *  - an explicit "$" in the string, or a genuine fractional part (cents are
 *    whole numbers; a fraction means the value is in dollars) => scale x100;
 *  - a bare integer that, read as cents, is below MIN_RENT_CENTS ($100/mo) is
 *    implausibly low for a monthly rent => it was dollars => scale x100.
 * Otherwise the integer is taken as cents per the contract. Deliberately biased
 * toward the dollar reading because a 100x-too-low rent is the dangerous error.
 */
function clampRentCents(v: unknown): number | null {
  let dollars = false;
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string") {
    if (v.includes("$")) dollars = true;
    n = Number(v.replace(/[, $]/g, ""));
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!Number.isInteger(n)) dollars = true; // a fractional value is dollars, not cents
  let cents = Math.round(dollars ? n * 100 : n);
  // A bare integer that reads as an implausibly low monthly rent was dollars.
  if (!dollars && cents < MIN_RENT_CENTS) cents = cents * 100;
  if (cents < 1 || cents > MAX_RENT_CENTS) return null;
  return cents;
}

/** Coerce a bathroom count to the nearest 0.5 in [0,max], or null. */
function clampHalf(v: unknown, max: number): number | null {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[, $]/g, "")) : NaN;
  if (!Number.isFinite(n)) return null;
  const h = Math.round(n * 2) / 2;
  if (h < 0 || h > max) return null;
  return h;
}

/** Coerce a model value to an ISO 'YYYY-MM-DD' in range, or null. */
function cleanIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const yr = Number(y);
  const mon = Number(mo);
  const day = Number(d);
  if (yr < MIN_LISTING_YEAR || yr > MAX_LISTING_YEAR) return null;
  if (mon < 1 || mon > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** Trim, collapse whitespace, map null-ish tokens to null, clamp to maxLen. */
function cleanText(v: unknown, maxLen: number = MAX_TEXT_LEN): string | null {
  if (typeof v !== "string") return null;
  const collapsed = v.trim().replace(/\s+/g, " ");
  if (!collapsed) return null;
  if (/^(null|n\/a|na|none|unknown|unspecified|not stated|-)$/i.test(collapsed)) return null;
  const t = collapsed.slice(0, maxLen).trim();
  return t || null;
}

/** A description keeps internal newlines (marketing copy has paragraphs); only
 * trims and clamps. Null-ish tokens map to null. */
function cleanDescription(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (/^(null|n\/a|na|none|unknown|unspecified|not stated|-)$/i.test(t)) return null;
  return t.slice(0, MAX_DESCRIPTION_LEN).trim() || null;
}

/** Tri-state boolean: true / false / null (unknown). */
function cleanTriBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "yes", "included", "y"].includes(t)) return true;
    if (["false", "no", "not included", "excluded", "n"].includes(t)) return false;
  }
  return null;
}

/** A laundry value validated against the shared enum, or null. */
function cleanLaundry(v: unknown): Laundry | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return isLaundry(t) ? t : null;
}

// ---------------------------------------------------------------------------
// The normalizer - raw model JSON -> a safe, typed ListingDraft (or null)
// ---------------------------------------------------------------------------

/**
 * Coerce a parsed JSON object into a ListingDraft, clamping every field to the
 * same bounds the manual property form enforces and discarding junk. Returns
 * null only when `raw` isn't an object at all. Tolerates a handful of alias keys
 * so a model that returns snake_case still maps cleanly.
 */
export function normalizeListingDraft(raw: unknown): ListingDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  return {
    address: cleanText(o.address ?? o.unit_address, MAX_TEXT_LEN),
    rentCents: clampRentCents(o.rentCents ?? o.rent_cents ?? o.rent),
    beds: clampInt(o.beds ?? o.bedrooms, 0, MAX_ROOMS),
    baths: clampHalf(o.baths ?? o.bathrooms, MAX_ROOMS),
    sqft: clampInt(o.sqft ?? o.square_feet ?? o.size, 1, MAX_SQFT),
    parking: cleanText(o.parking),
    description: cleanDescription(o.description ?? o.summary),
    availableDate: cleanIsoDate(o.availableDate ?? o.available_date ?? o.available),
    airConditioning: cleanTriBool(o.airConditioning ?? o.air_conditioning ?? o.ac),
    balcony: cleanTriBool(o.balcony),
    furnished: cleanTriBool(o.furnished),
    laundry: cleanLaundry(o.laundry),
    heatIncluded: cleanTriBool(o.heatIncluded ?? o.heat_included ?? o.heat),
    hydroIncluded: cleanTriBool(o.hydroIncluded ?? o.hydro_included ?? o.hydro),
    waterIncluded: cleanTriBool(o.waterIncluded ?? o.water_included ?? o.water),
  };
}

/** True when the draft carries nothing useful - the caller should keep the
 * deterministic result untouched rather than merge an all-null draft. */
export function isEmptyListingDraft(d: ListingDraft): boolean {
  return (
    d.address == null &&
    d.rentCents == null &&
    d.beds == null &&
    d.baths == null &&
    d.sqft == null &&
    d.parking == null &&
    d.description == null &&
    d.availableDate == null &&
    d.laundry == null &&
    d.airConditioning !== true &&
    d.balcony !== true &&
    d.furnished !== true &&
    d.heatIncluded !== true &&
    d.hydroIncluded !== true &&
    d.waterIncluded !== true
  );
}

// ---------------------------------------------------------------------------
// The merge - deterministic base wins, the AI draft only fills gaps
// ---------------------------------------------------------------------------

/** The boolean feature fields, paired with the ParsedListing key they set. The
 * deterministic parse defaults each to `false` and records the label in
 * `foundFields` only when it found positive evidence, so "the base did NOT find
 * it" == the label is absent from `foundFields`. */
const BOOLEAN_FEATURES = [
  "airConditioning",
  "balcony",
  "furnished",
  "heatIncluded",
  "hydroIncluded",
  "waterIncluded",
] as const;

/**
 * Merge an AI `ListingDraft` into a deterministic `ParsedListing`, filling ONLY
 * the fields the deterministic parse left unset. Never overwrites a value the
 * regex found. Returns a NEW ParsedListing plus the list of human labels the AI
 * newly filled (for the review banner / logging).
 *
 * Rules:
 * - text/number/date/laundry: filled when the base value is null and the AI has one.
 * - booleans: filled to `true` only when the base did NOT already find that
 *   feature (its label is absent from base.foundFields) AND the AI is confident
 *   it is true. An AI `false`/`null` never demotes or touches the base default.
 */
export function applyAiListing(
  base: ParsedListing,
  ai: ListingDraft,
): { merged: ParsedListing; added: string[] } {
  const merged: ParsedListing = { ...base, foundFields: [...base.foundFields] };
  const found = new Set(base.foundFields);
  const added: string[] = [];

  const fillScalar = <K extends "address" | "rentCents" | "beds" | "baths" | "sqft" | "parking" | "description" | "availableDate" | "laundry">(
    key: K,
  ) => {
    if (base[key] == null && ai[key] != null) {
      merged[key] = ai[key] as ParsedListing[K];
      const label = FIELD_LABELS[key];
      if (!found.has(label)) {
        merged.foundFields.push(label);
        found.add(label);
        added.push(label);
      }
    }
  };

  fillScalar("address");
  fillScalar("rentCents");
  fillScalar("beds");
  fillScalar("baths");
  fillScalar("sqft");
  fillScalar("parking");
  fillScalar("description");
  fillScalar("availableDate");
  fillScalar("laundry");

  for (const key of BOOLEAN_FEATURES) {
    const label = FIELD_LABELS[key];
    // The base "found" the feature iff its label is present. Only fill when the
    // base didn't find it and the AI is confident it's true.
    if (!found.has(label) && ai[key] === true) {
      merged[key] = true;
      merged.foundFields.push(label);
      found.add(label);
      added.push(label);
    }
  }

  return { merged, added };
}

// Re-export so a caller can build an empty ParsedListing without importing two
// modules when it wants the AI path to stand alone.
export { emptyParsedListing };
