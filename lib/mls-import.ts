// ============================================================================
// MLS / realtor.ca paste -> structured listing fields (PURE).
// No DOM / env / IO — fully unit-testable (see scripts/test-mls-import.ts).
//
// The realtor-onboarding wedge (REAL-WORLD-INTAKE item M, S245): a realtor who
// already has a listing on MLS / realtor.ca pastes the listing text and we
// prefill a Vacantless rental so they can spin up the portal listings
// (Kijiji / FB / Zumper / Rentals.ca) without re-keying what is already on MLS.
//
// DATA-SOURCE DISCIPLINE: this parses text the OPERATOR pastes (their own
// listing). It is NOT a scrape and makes no network call — the same ToS posture
// as the syndication feed. The automated CREA/DDF or board-API pull is a
// separate, later increment gated on the data-source decision.
//
// SAFETY POSTURE: extract CONSERVATIVELY. Every false positive costs the
// operator a correction, so when a signal is ambiguous we leave the field
// unset rather than guess. The import always lands in a DRAFT the operator
// reviews before going Live, and `foundFields` tells them exactly what we
// filled so they know what to check.
//
// DELIBERATELY NOT INFERRED: pet policy. Pets are an RTA s.14 advertising/
// screening decision the operator makes explicitly (S241) — auto-guessing
// "pets allowed" from listing prose is exactly the kind of false positive that
// would mislead a renter, so the parser never touches the pet fields.
//
// FORMAT COVERAGE: handles three paste shapes:
//   1. "Label: value" agent-printout form.
//   2. The STACKED form a realtor.ca full-page copy produces, where the label
//      sits on its own line and the value lands on the next line ("Bedrooms" \n
//      "2"). The stacked lookahead is guarded (see isPlausibleStackedValue) so a
//      label whose value is blank never bleeds into the next field.
//   3. The dense TRREB agent DATA-SHEET, whose hallmark is yes/no inclusion
//      COLUMNS ("Heat Incl: Y  Hydro Incl: N  Water Incl: Y  CAC Incl: Y"),
//      "A/C: N" / "Furnished: N" flags, and "/Mth" rent. These are read by
//      scanFlag (see below): an explicit "Y" sets the feature, an explicit "N"
//      forces it false even over a looser positive, and a non-yes/no value
//      ("Heat: Forced Air", "A/C: Central Air") carries no verdict and defers to
//      the keyword scan. Critically, "Hydro Incl: N" / "Furnished: N" must NOT
//      read as included/furnished — the column is authoritative.
// ============================================================================

import { type Laundry } from "./property-features";
import { normalizeVirtualTourUrl } from "./virtual-tour";

export interface ParsedListing {
  address: string | null;
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  parking: string | null;
  description: string | null;
  /** ISO "YYYY-MM-DD" or null. */
  availableDate: string | null;
  /**
   * Virtual tour / listing video URL (REAL-WORLD-INTAKE item S). The MLS data
   * sheet / realtor.ca page carries a tour link the operator otherwise re-keys;
   * we lift it from the paste, but only when it points at an allow-listed tour
   * host (YouTube / Vimeo / iGUIDE / Matterport) — see lib/virtual-tour.
   */
  virtualTourUrl: string | null;
  airConditioning: boolean;
  balcony: boolean;
  furnished: boolean;
  laundry: Laundry | null;
  heatIncluded: boolean;
  hydroIncluded: boolean;
  waterIncluded: boolean;
  /** Human labels of the fields we actually filled, for the review banner. */
  foundFields: string[];
}

/** An empty parse result — every field unset. */
export function emptyParsedListing(): ParsedListing {
  return {
    address: null,
    rentCents: null,
    beds: null,
    baths: null,
    sqft: null,
    parking: null,
    description: null,
    availableDate: null,
    virtualTourUrl: null,
    airConditioning: false,
    balcony: false,
    furnished: false,
    laundry: null,
    heatIncluded: false,
    hydroIncluded: false,
    waterIncluded: false,
    foundFields: [],
  };
}

// --- low-level helpers ------------------------------------------------------

/** Lines, trimmed, blanks dropped. Original order preserved. */
function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Every field label we recognize, lowercased. Used as a STOP SET for the
 * stacked-value lookahead below: when a label sits on its own line, we only
 * accept the NEXT line as its value if that next line is not itself another
 * known label (so two labels in a row — a realtor.ca row whose value is blank —
 * never bleeds one field's header into another field's value).
 */
const ALL_KNOWN_LABELS = new Set(
  [
    "list price", "lease price", "listing price", "price", "rent",
    "monthly rent", "lease", "lease rate", "monthly",
    "bedrooms", "bedroom", "beds", "bed", "br", "bdrms",
    "bathrooms", "bathroom", "baths", "bath", "washrooms", "washroom", "ba",
    "square footage", "approximate square footage", "approx square footage",
    "square feet", "sq ft", "sqft", "sq. ft.", "size", "living area",
    "approx sqft", "apx sqft", "aprx sqft",
    "parking", "parking spaces", "parking type", "garage", "garage type",
    "total parking spaces",
    "available", "available date", "availability", "possession",
    "possession date", "occupancy", "date available",
    "address", "property address", "location",
    "property type", "building type", "type", "storeys", "land size",
    "lease includes", "includes", "utilities included", "included utilities",
    "rent includes", "inclusions",
  ].map((s) => s.toLowerCase()),
);

/**
 * Is `line` plausibly the VALUE of a stacked "label on its own line" row (the
 * realtor.ca full-page copy pattern)? Reject another known label, an obvious
 * header line (ends with a colon), and over-long prose.
 */
function isPlausibleStackedValue(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  if (/:\s*$/.test(t)) return false;
  if (ALL_KNOWN_LABELS.has(t.toLowerCase())) return false;
  return true;
}

/**
 * Find the value for a "Label: value" line. Accepts a list of label aliases
 * (case-insensitive), tolerates an optional trailing colon, and returns the
 * text after the first colon (or the rest of the line for label-only matches).
 * Returns the FIRST match in document order.
 *
 * When `opts.allowNextLine` is set, also handles the STACKED form that a
 * realtor.ca full-page copy produces — the label alone on one line and its
 * value on the following non-empty line ("Bedrooms" \n "2") — guarded by
 * `isPlausibleStackedValue` so it never swallows the next field's label.
 */
function labelValue(
  lines: string[],
  aliases: string[],
  opts: { allowNextLine?: boolean } = {},
): string | null {
  const alt = aliases
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const inlineRe = new RegExp(`^\\s*(?:${alt})\\s*[:\\-]\\s*(.+)$`, "i");
  const bareRe = new RegExp(`^\\s*(?:${alt})\\s*[:\\-]?\\s*$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const m = inlineRe.exec(lines[i]);
    if (m) {
      const v = m[1].trim();
      if (v) return v;
    }
    if (opts.allowNextLine && bareRe.test(lines[i])) {
      const next = lines[i + 1];
      if (next && isPlausibleStackedValue(next)) return next.trim();
    }
  }
  return null;
}

/** First whole-number in a string, or null. */
function firstInt(s: string): number | null {
  const m = /-?\d[\d,]*/.exec(s);
  if (!m) return null;
  const n = parseInt(m[0].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// --- rent -------------------------------------------------------------------

/**
 * A monthly rent in cents, or null. Recognizes a money amount that is either
 * (a) on an explicit rent/price/lease label line, or (b) adjacent to a
 * per-month marker ("/mo", "/month", "monthly", "per month").
 *
 * Guards against grabbing the wrong dollar amount: a bare "$450,000" with no
 * monthly marker and no rent label is ignored (likely a sale price / deposit),
 * and any amount >= $25,000 is rejected as implausible monthly rent.
 */
const MAX_PLAUSIBLE_RENT_CENTS = 25_000 * 100;

function parseMoneyToCents(raw: string): number | null {
  const m = /\$?\s*([\d][\d,]*(?:\.\d{1,2})?)/.exec(raw);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function extractRentCents(lines: string[], rawText: string): number | null {
  // (a) explicit label.
  const labelled = labelValue(
    lines,
    [
      "List Price",
      "Lease Price",
      "Listing Price",
      "Price",
      // The TRREB / PropTx data sheet prints the asking rent as a bare
      // "List: $2,700 For: Lease" line (no "Price"). "List" matches only when a
      // colon follows immediately, so "List Date:" / "Last Update:" never match,
      // and the MAX_PLAUSIBLE_RENT_CENTS cap below still rejects a sale "List:"
      // (a sale price is far over the monthly-rent ceiling).
      "List",
      "Rent",
      "Monthly Rent",
      "Lease",
      "Lease Rate",
      "Monthly",
    ],
    { allowNextLine: true },
  );
  if (labelled) {
    const cents = parseMoneyToCents(labelled);
    if (cents && cents <= MAX_PLAUSIBLE_RENT_CENTS) return cents;
  }

  // (b) money adjacent to a per-month marker, e.g. "$2,400/Monthly",
  // "$2,400 per month", "$2,400/mo", and the TRREB "/Mth" / "Mthly" forms.
  const perMonth =
    /\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*(?:\/|\bper\b)?\s*(?:mo|mth|mthly|month|monthly)\b/i.exec(
      rawText,
    );
  if (perMonth) {
    const cents = parseMoneyToCents(`$${perMonth[1]}`);
    if (cents && cents <= MAX_PLAUSIBLE_RENT_CENTS) return cents;
  }
  return null;
}

// --- beds / baths -----------------------------------------------------------

/**
 * Bedrooms. Handles "Bedrooms: 3", "3 Bedrooms", "3 bd", "Beds 3", and the MLS
 * "3 + 1" convention (main + additional = SUMMED to total usable bedrooms).
 */
function extractBeds(lines: string[], rawText: string): number | null {
  const labelled = labelValue(
    lines,
    ["Bedrooms", "Bedroom", "Beds", "Bed", "Br", "Bdrms"],
    { allowNextLine: true },
  );
  const source = labelled ?? rawText;

  // "3 + 1" / "3+1" -> 4.
  const plus = /(\d+)\s*\+\s*(\d+)/.exec(source);
  if (plus) {
    const total = parseInt(plus[1], 10) + parseInt(plus[2], 10);
    if (Number.isFinite(total) && total > 0 && total <= 20) return total;
  }
  if (labelled) {
    const n = firstInt(labelled);
    if (n != null && n >= 0 && n <= 20) return n;
  }
  // "3 Bedrooms" / "3 bd" anywhere in the text.
  const inline = /(\d+)\s*(?:bed(?:room)?s?\b|bd\b|br\b)/i.exec(rawText);
  if (inline) {
    const n = parseInt(inline[1], 10);
    if (Number.isFinite(n) && n >= 0 && n <= 20) return n;
  }
  return null;
}

/**
 * Bathrooms. Handles "Bathrooms: 2", "Washrooms: 2", "2 Bathrooms", "2 ba",
 * "1.5 baths". MLS "Washrooms" piece-counts are read as a plain count.
 */
function extractBaths(lines: string[], rawText: string): number | null {
  const labelled = labelValue(
    lines,
    ["Bathrooms", "Bathroom", "Baths", "Bath", "Washrooms", "Washroom", "Ba"],
    { allowNextLine: true },
  );
  if (labelled) {
    const m = /(\d+(?:\.\d)?)/.exec(labelled);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 20) return n;
    }
  }
  const inline = /(\d+(?:\.\d)?)\s*(?:bath(?:room)?s?\b|ba\b)/i.exec(rawText);
  if (inline) {
    const n = parseFloat(inline[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 20) return n;
  }
  return null;
}

// --- sqft -------------------------------------------------------------------

/**
 * Square footage. Handles "Square Footage: 1200", "Sq Ft 1200", "1200 sqft",
 * and a range "1500-2000" (take the LOWER bound, conservative). Ignores values
 * outside a plausible 100–20000 sq ft band.
 */
function extractSqft(lines: string[], rawText: string): number | null {
  const labelled = labelValue(
    lines,
    [
      "Square Footage",
      "Approximate Square Footage",
      "Approx Square Footage",
      "Approx Sqft",
      "Apx Sqft",
      "Aprx Sqft",
      "Square Feet",
      "Sq Ft",
      "SqFt",
      "Sq. Ft.",
      "Size",
      "Living Area",
    ],
    { allowNextLine: true },
  );
  const fromLabel = labelled != null ? firstInt(labelled) : null;
  if (fromLabel != null && fromLabel >= 100 && fromLabel <= 20000)
    return fromLabel;

  // "1,200 sq ft" / "1200 sqft" inline.
  const inline = /([\d][\d,]*)\s*(?:sq\.?\s*ft|sqft|square\s*feet)/i.exec(
    rawText,
  );
  if (inline) {
    const n = parseInt(inline[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n >= 100 && n <= 20000) return n;
  }
  return null;
}

// --- parking ----------------------------------------------------------------

/**
 * Parking as free text (the column is text). Prefer an explicit label; reject
 * pure "none"/"0"/"no" so we don't store a misleading "Parking: none" the
 * operator then has to clear.
 */
function extractParking(lines: string[]): string | null {
  const v = labelValue(
    lines,
    [
      "Parking",
      "Parking Spaces",
      "Parking Type",
      "Garage",
      "Garage Type",
      "Total Parking Spaces",
    ],
    { allowNextLine: true },
  );
  if (!v) return null;
  const trimmed = v.trim();
  if (/^(none|no|0|n\/a|na)\b/i.test(trimmed)) return null;
  return trimmed.slice(0, 200);
}

// --- available date ---------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Parse a possession/availability value to ISO "YYYY-MM-DD", or null. Handles
 * "2026-07-01", "07/01/2026" (MM/DD/YYYY), "July 1, 2026", "1 July 2026".
 * Conservative: anything we can't pin to a concrete y/m/d (e.g. "Immediate",
 * "TBA", "Flexible", "30/60 days") returns null.
 */
export function parseAvailableDate(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // ISO.
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  // Numeric MM/DD/YYYY or M/D/YY.
  const num = /\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/.exec(s);
  if (num) {
    const m = +num[1], d = +num[2];
    let y = +num[3];
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  // "July 1, 2026" / "Jul 1 2026".
  const mdy = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(s);
  if (mdy) {
    const mon = MONTHS[mdy[1].toLowerCase()];
    const d = +mdy[2], y = +mdy[3];
    if (mon && d >= 1 && d <= 31) return `${y}-${pad2(mon)}-${pad2(d)}`;
  }

  // "1 July 2026".
  const dmy = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/.exec(s);
  if (dmy) {
    const mon = MONTHS[dmy[2].toLowerCase()];
    const d = +dmy[1], y = +dmy[3];
    if (mon && d >= 1 && d <= 31) return `${y}-${pad2(mon)}-${pad2(d)}`;
  }

  return null;
}

function extractAvailableDate(lines: string[], rawText: string): string | null {
  const v = labelValue(
    lines,
    [
      "Available",
      "Available Date",
      "Availability",
      "Possession",
      "Possession Date",
      "Occupancy",
      "Date Available",
    ],
    { allowNextLine: true },
  );
  const fromLabel = parseAvailableDate(v);
  if (fromLabel) return fromLabel;

  // TRREB / PropTx prints possession on a SHARED line where the label is not at
  // the start: "Holdover: 30 Possession: Flexible Date: 08/01/2026 Occup: …".
  // The line-start label match above misses it, so scan for a date that sits
  // close after a possession/occupancy/availability cue. The 40-char window +
  // the cue requirement keep this from grabbing the sheet's OTHER dates
  // (Contract Date, Expiry Date, Printed On, Last Update), which carry no such
  // cue. parseAvailableDate validates the captured token, so a non-date
  // ("Flexible", "TBA") between the cue and a real date is skipped.
  const cue =
    /\b(?:possession|occupancy|date available|available)\b[^\n]{0,40}?(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i.exec(
      rawText,
    );
  if (cue) {
    const fromCue = parseAvailableDate(cue[1]);
    if (fromCue) return fromCue;
  }
  return null;
}

// --- virtual tour / video link ----------------------------------------------

// A URL-ish token: an http(s) link, a "www." link, OR a bare (scheme-less,
// www-less) link to a KNOWN tour host the data sheet sometimes prints inline
// ("Tour here: youriguide.com/abc/"). The bare branch is restricted to the
// allow-listed tour hosts so it can't grab arbitrary domains. Trailing sentence
// punctuation is trimmed before validation.
const URL_TOKEN_RE =
  /(?:https?:\/\/|www\.)[^\s)>"'\]]+|(?:[a-z0-9-]+\.)*(?:youriguide\.com|iguide\.com|youtu\.be|youtube\.com|youtube-nocookie\.com|vimeo\.com|matterport\.com)\/[^\s)>"'\]]*/gi;

function stripTrailingUrlPunct(s: string): string {
  return s.replace(/[.,;:!?)\]}>'"]+$/, "");
}

/**
 * The virtual-tour / video URL, or null. Prefers an explicit tour/multimedia
 * label value; otherwise scans the whole paste for the FIRST URL whose host is
 * an allow-listed tour host (YouTube / Vimeo / iGUIDE / Matterport). Conservative
 * by construction: a non-tour link (the listing's own realtor.ca page, a
 * brokerage site, a Google Maps link) never validates, so it is never imported.
 */
function extractVirtualTourUrl(lines: string[], rawText: string): string | null {
  const labelled = labelValue(
    lines,
    [
      "Virtual Tour",
      "Virtual Tour URL",
      "Virtual Tour Link",
      "Tour",
      "Tour URL",
      "Tour Link",
      "Video Tour",
      "Video",
      "Video Link",
      "Multimedia",
      "Multimedia URL",
      "iGuide",
      "iGUIDE",
      "3D Tour",
      "Matterport",
    ],
    { allowNextLine: true },
  );

  // Try the labelled value first, then fall back to the whole paste.
  for (const text of [labelled, rawText]) {
    if (!text) continue;
    const matches = text.match(URL_TOKEN_RE);
    if (!matches) continue;
    for (const m of matches) {
      const cleaned = stripTrailingUrlPunct(m);
      const withScheme = /^https?:\/\//i.test(cleaned)
        ? cleaned
        : `https://${cleaned}`;
      const normalized = normalizeVirtualTourUrl(withScheme);
      if (normalized) return normalized;
    }
  }
  return null;
}

// --- description ------------------------------------------------------------

/**
 * The remarks / description blob. Prefer an explicit remarks label; the value
 * may run onto following lines, so once we hit a remarks label we collect the
 * inline remainder plus subsequent lines until the next obvious "Label:" line
 * or the end. Falls back to the single longest prose line when no label exists.
 */
const REMARKS_LABELS = [
  "Public Remarks",
  "Client Remarks",
  "Realtor Remarks",
  "Remarks for Clients",
  // TRREB data-sheets abbreviate these as "Remks".
  "Client Remks",
  "Realtor Remks",
  "Public Remks",
  "Remks",
  "Remarks",
  "Description",
  "Property Description",
  "About",
];

function extractDescription(lines: string[]): string | null {
  const labelRe = new RegExp(
    `^\\s*(?:${REMARKS_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*[:\\-]\\s*(.*)$`,
    "i",
  );
  // A generic "Some Label: value" line marks the end of a remarks block.
  const genericLabelRe = /^[A-Z][A-Za-z .\/]{1,28}:\s*\S/;

  for (let i = 0; i < lines.length; i++) {
    const m = labelRe.exec(lines[i]);
    if (!m) continue;
    const parts: string[] = [];
    if (m[1].trim()) parts.push(m[1].trim());
    for (let j = i + 1; j < lines.length; j++) {
      if (genericLabelRe.test(lines[j])) break;
      parts.push(lines[j]);
    }
    const joined = parts.join(" ").replace(/\s+/g, " ").trim();
    if (joined.length >= 20) return joined;
  }

  // Fallback: the longest prose-looking line (has spaces, sentence length, not
  // a label line). Helps a bare realtor.ca paste where remarks have no header.
  let best: string | null = null;
  for (const line of lines) {
    if (genericLabelRe.test(line)) continue;
    if (line.length >= 60 && /\s/.test(line) && /[.!?]/.test(line)) {
      if (!best || line.length > best.length) best = line;
    }
  }
  return best;
}

// --- address ----------------------------------------------------------------

const STREET_SUFFIX =
  /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|cres|crescent|ct|court|pl|place|way|lane|ln|terr?(?:ace)?|cir(?:cle)?|sq(?:uare)?|hwy|highway|pkwy|parkway|trail|trl|grv|grove|gdns|gardens|close|row|walk|mews|gate|crt|pky)\b/i;

/**
 * The address. Prefer an explicit "Address:" label; otherwise the first line
 * that looks like a street address (begins with a unit/number and contains a
 * street suffix). Conservative — a line that does not look like an address
 * returns null rather than a wrong guess.
 */
function looksLikeAddress(line: string): boolean {
  if (line.length > 120) return false;
  // Must start with a digit (civic number) or a unit prefix, and carry a
  // street suffix somewhere.
  const startsRight = /^(?:unit\s+)?#?\s*\d/i.test(line);
  return startsRight && STREET_SUFFIX.test(line);
}

function extractAddress(lines: string[]): string | null {
  const labelled = labelValue(
    lines,
    ["Address", "Property Address", "Location"],
    { allowNextLine: true },
  );
  if (labelled && labelled.length <= 160) return labelled.slice(0, 160);

  for (const line of lines) {
    if (looksLikeAddress(line)) return line.slice(0, 160);
  }
  return null;
}

// --- amenity / utility keyword pass -----------------------------------------

/**
 * True when `text` contains `term` as a positive signal — i.e. NOT immediately
 * preceded/qualified by a negation ("no", "none", "not", "without"). Crude but
 * effective for "A/C: None" / "No balcony" / "Laundry: None".
 */
function hasPositive(text: string, terms: RegExp): boolean {
  const m = terms.exec(text);
  if (!m) return false;
  const idx = m.index;
  // Look at up to ~12 chars before the match for a negation.
  const before = text.slice(Math.max(0, idx - 14), idx).toLowerCase();
  if (/\b(no|not|none|without|n\/a)\b[\s:.\-]*$/.test(before)) return false;
  // "<term>: none" / "<term> - none" immediately after.
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12).toLowerCase();
  if (/^\s*[:\-]?\s*(none|no\b|n\/a)/.test(after)) return false;
  return true;
}

/**
 * TRREB agent data-sheets express many features as a yes/no COLUMN rather than
 * prose: "Heat Incl: Y", "Hydro Incl: N", "Water Incl: Y", "CAC Incl: Y",
 * "A/C: N", "Furnished: N" — often several on one line. Scan `rawText` for any
 * of the given label aliases followed (after an optional "Incl"/"Included") by a
 * yes/no token, and return true (Y/Yes/Incl), false (N/No/None/N-A), or null
 * (label absent, or its value isn't a yes/no token — e.g. "Heat: Forced Air"
 * or "A/C: Central Air", which carry no inclusion verdict and should defer to
 * the keyword/utility scans). Conservative by design: a non-yes/no value never
 * sets a flag, so a "Water: Municipal" source field can't read as included.
 */
function scanFlag(rawText: string, labelAlts: string): boolean | null {
  const re = new RegExp(
    `\\b(?:${labelAlts})\\s*(?:incl(?:uded|usive)?\\.?)?\\s*[:\\-]\\s*(yes|no|y|n|none|incl(?:uded)?|n\\/a)\\b`,
    "i",
  );
  const m = re.exec(rawText);
  if (!m) return null;
  const t = m[1].toLowerCase();
  if (t === "y" || t === "yes" || t.startsWith("incl")) return true;
  return false; // n / no / none / n/a
}

function extractLaundry(text: string): Laundry | null {
  const t = text.toLowerCase();
  if (/\b(ensuite laundry|in[- ]suite laundry|in[- ]unit laundry|laundry in[- ]?suite|laundry in[- ]?unit|washer\/dryer|washer and dryer|in-suite washer)\b/.test(t))
    return "in_suite";
  if (/\b(laundry in building|in[- ]building laundry|building laundry)\b/.test(t))
    return "in_building";
  if (/\b(shared laundry|coin laundry|common laundry|laundry room)\b/.test(t))
    return "shared";
  return null;
}

/**
 * Read a "utilities included" / "lease includes" / "tenant pays" section to set
 * the heat/hydro/water booleans. Only an INCLUDES context sets them true — a
 * "Tenant pays: hydro" line must NOT mark hydro as included.
 */
function extractUtilities(lines: string[], rawText: string): {
  heat: boolean;
  hydro: boolean;
  water: boolean;
} {
  const out = { heat: false, hydro: false, water: false };
  const includesVal = labelValue(
    lines,
    [
      "Lease Includes",
      "Includes",
      "Utilities Included",
      "Included Utilities",
      "Rent Includes",
      "Inclusions",
    ],
    { allowNextLine: true },
  );
  const scan = (s: string) => {
    const t = s.toLowerCase();
    if (/\b(heat|heating)\b/.test(t)) out.heat = true;
    if (/\b(hydro|electric(?:ity)?|electrical)\b/.test(t)) out.hydro = true;
    if (/\bwater\b/.test(t)) out.water = true;
  };
  if (includesVal) scan(includesVal);

  // Also catch inline "Heat included", "Water included" phrasing, but never a
  // "tenant pays ..." / "plus utilities" / "not included" context.
  const all = rawText.toLowerCase();
  if (/\bheat\s+(?:is\s+)?included\b/.test(all)) out.heat = true;
  if (/\b(hydro|electricity)\s+(?:is\s+)?included\b/.test(all)) out.hydro = true;
  if (/\bwater\s+(?:is\s+)?included\b/.test(all)) out.water = true;

  // TRREB Y/N inclusion COLUMNS ("Heat Incl: Y", "Hydro Incl: N", "Water Incl:
  // Y"). The explicit column is authoritative: a "Y" sets included AND an
  // explicit "N" forces it back to false even if a looser signal set it true.
  const heatFlag = scanFlag(rawText, "heat");
  const hydroFlag = scanFlag(rawText, "hydro|electric(?:ity)?|electrical");
  const waterFlag = scanFlag(rawText, "water");
  if (heatFlag !== null) out.heat = heatFlag;
  if (hydroFlag !== null) out.hydro = hydroFlag;
  if (waterFlag !== null) out.water = waterFlag;
  return out;
}

// --- main -------------------------------------------------------------------

// Exported so the AI listing-import merge (lib/listing-extract.applyAiListing,
// S428) can label the fields it backfills with the SAME human labels the
// deterministic review banner uses.
export const FIELD_LABELS: Record<keyof Omit<ParsedListing, "foundFields">, string> = {
  address: "Address",
  rentCents: "Rent",
  beds: "Beds",
  baths: "Baths",
  sqft: "Square footage",
  parking: "Parking",
  description: "Description",
  availableDate: "Available date",
  virtualTourUrl: "Virtual tour",
  airConditioning: "Air conditioning",
  balcony: "Balcony",
  furnished: "Furnished",
  laundry: "Laundry",
  heatIncluded: "Heat included",
  hydroIncluded: "Hydro included",
  waterIncluded: "Water included",
};

/**
 * Parse pasted MLS / realtor.ca listing text into structured Vacantless fields.
 * Pure + deterministic. Always returns a complete object; unfound fields stay
 * null/false. `foundFields` lists the human labels of what was filled.
 */
export function parseMlsListing(text: string): ParsedListing {
  const out = emptyParsedListing();
  if (!text || !text.trim()) return out;

  const raw = text;
  const lines = toLines(text);

  out.address = extractAddress(lines);
  out.rentCents = extractRentCents(lines, raw);
  out.beds = extractBeds(lines, raw);
  out.baths = extractBaths(lines, raw);
  out.sqft = extractSqft(lines, raw);
  out.parking = extractParking(lines);
  out.description = extractDescription(lines);
  out.availableDate = extractAvailableDate(lines, raw);
  out.virtualTourUrl = extractVirtualTourUrl(lines, raw);

  // A/C: a TRREB explicit Y/N flag ("A/C: N", "CAC Incl: Y", "Central Air: Y")
  // is authoritative; otherwise fall back to the keyword scan (so "A/C: Central
  // Air" or prose "central air conditioning" still reads true).
  const acFlag = scanFlag(raw, "a\\/c|air\\s*cond(?:itioning)?|central\\s*air|cac");
  out.airConditioning =
    acFlag !== null
      ? acFlag
      : hasPositive(
          raw,
          /\b(central air|air[- ]conditioning|air conditioner|\ba\/c\b|\bac\b)/i,
        );
  out.balcony = hasPositive(raw, /\b(balcony|balconies|terrace|juliet balcony)\b/i);
  // Furnished: a TRREB "Furnished: Y/N" flag is authoritative (fixes the false
  // positive where "Furnished: N" would otherwise read as furnished); otherwise
  // the prose keyword scan applies.
  const furnishedFlag = scanFlag(raw, "furnished");
  out.furnished =
    furnishedFlag !== null
      ? furnishedFlag
      : hasPositive(raw, /\bfully furnished\b/i) ||
        (hasPositive(raw, /\bfurnished\b/i) && !/\bunfurnished\b/i.test(raw));
  out.laundry = extractLaundry(raw);

  const util = extractUtilities(lines, raw);
  out.heatIncluded = util.heat;
  out.hydroIncluded = util.hydro;
  out.waterIncluded = util.water;

  // Build the found-fields list in a stable, display order.
  const order: (keyof Omit<ParsedListing, "foundFields">)[] = [
    "address", "rentCents", "beds", "baths", "sqft", "parking",
    "description", "availableDate", "virtualTourUrl", "airConditioning",
    "balcony", "furnished", "laundry", "heatIncluded", "hydroIncluded",
    "waterIncluded",
  ];
  for (const key of order) {
    const v = out[key];
    const present =
      typeof v === "boolean" ? v : v !== null && v !== undefined;
    if (present) out.foundFields.push(FIELD_LABELS[key]);
  }
  return out;
}
