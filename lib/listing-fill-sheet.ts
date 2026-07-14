// ============================================================================
// Per-portal "fill sheet" — the field-by-field bridge between a unit's listing
// data and each portal's posting form (S262, syndication sequence step 2, the
// CODE half of operator-assist fill). Pure data + selectors, no DOM / env / IO,
// fully unit-testable (see scripts/test-listing-fill-sheet.ts).
//
// What it is: for a given portal, an ORDERED list of the form fields the
// operator (or a future Claude-in-Chrome assist / extension) fills, each with
// the value already resolved from THIS unit, plus the guardrail that applies to
// that field. The "before you post" checklist (lib/listing-guardrails) tells you
// the traps; this tells you exactly what to put in each box, in form order, with
// the trap attached. It produces the structured payload an assist consumes — it
// is still a reference, NOT automation; nothing here submits anything.
//
// Reuses, never duplicates: buildListingCopy() owns the title + body, and
// guardrailsForPortal() owns the trap content. This module only does the
// field-to-value mapping. Keyed on the SAME PortalKey taxonomy as listing
// distribution + guardrails (KI420 — content on the existing taxonomy, not a
// parallel enum), so the fill sheet, the checklist, and the "Where this is
// posted" tracker can never list different portals.
// ============================================================================

import {
  isPortalKey,
  portalLabel,
  type PortalKey,
} from "./listing-distribution";
import {
  buildListingCopy,
  isCopyPortalKey,
  type CopyPortalKey,
  type ListingCopyInput,
} from "./listing-copy";
import { guardrailsForPortal, type Guardrail } from "./listing-guardrails";
import {
  buildUtilitiesIncluded,
  formatAvailability,
  formatSqft,
  petPolicyLabel,
  acAmenityLabel,
  leaseTermLabel,
} from "./property-features";

// Where a field's value comes from — drives both the UI affordance and the
// honesty of the sheet:
//   listing = resolved from the unit's own data (copy/paste straight in)
//   preset  = a portal constant WE recommend (plan, category, "skip Boost")
//   manual  = the operator must supply it; we can't (postal code, intersections,
//             photos) or it's a post-publish step (click Enable)
export const FILL_FIELD_SOURCES = ["listing", "preset", "manual"] as const;
export type FillFieldSource = (typeof FILL_FIELD_SOURCES)[number];

export type FillField = {
  /** Stable, portal-scoped id (used as a React key + checked state). */
  id: string;
  /** The portal's own form-field name, as the operator sees it on screen. */
  label: string;
  /**
   * The value to put in the field: the unit's data for `listing`, our
   * recommendation for `preset`, or null for a `manual` field we can't fill.
   */
  value: string | null;
  source: FillFieldSource;
  /** Short instruction shown under the field (how to enter it / what to watch). */
  hint?: string;
  /** Ties this field to a guardrailsForPortal() entry so the UI shows the why. */
  guardrailId?: string;
  /**
   * Optional wizard-step grouping label (e.g. "Step 1 · Type & location"). Set
   * only by portals whose posting form is a multi-step wizard (Rentals.ca), so
   * the UI can group the fields the way the form actually presents them — the
   * fill-sheet field order is NOT the form's step order (S264 finding #1). Left
   * undefined by single-page portals; the UI just renders those flat.
   */
  step?: string;
};

export type FillSheet = {
  portal: PortalKey;
  label: string;
  fields: FillField[];
  /**
   * The portal's full guardrail list (so the UI can resolve a field's
   * guardrailId to its detail, and surface the not-field-specific reminders).
   */
  guardrails: Guardrail[];
};

// The fill sheet needs everything the copy needs, plus the inquiry contact a
// couple of portals make you re-enter per listing (Rentals.ca's Lead Contact)
// and the optional virtual-tour URL (item S) the portals with a tour/video
// field accept.
export type FillSheetInput = ListingCopyInput & {
  leadContactEmail?: string | null;
  leadContactPhone?: string | null;
  virtualTourUrl?: string | null;
  // Standard-policy fields (0048) that were INHERITED from the org building
  // profile rather than set on the unit, so the sheet can label provenance
  // ("from your building standard policy"). `features` already carries the
  // RESOLVED effective values; this just records which ones came from the
  // profile. Names match the policy field keys (lease_term / smoking / ac_type
  // / on_site_management).
  inheritedPolicyFields?: readonly string[];
};

/** True when a policy field's effective value was inherited from the profile. */
function policyInherited(input: FillSheetInput, field: string): boolean {
  return (input.inheritedPolicyFields ?? []).includes(field);
}

const POLICY_PROVENANCE_NOTE =
  " Pulled from your building standard policy — change it if this unit differs.";

// Portals whose posting form has a virtual-tour / video LINK field (item S). We
// only surface the tour field for these, and only when the unit actually has a
// tour URL — Facebook Marketplace (photo/video upload, no link field) and
// Realtor.ca (DDF only) are deliberately excluded.
const TOUR_FIELD_PORTALS: ReadonlySet<PortalKey> = new Set([
  "kijiji",
  "rentals_ca",
  "zumper",
  "viewit",
]);

// The field-id prefix each builder uses, so the inserted tour field keys match.
const PORTAL_FIELD_PREFIX: Partial<Record<PortalKey, string>> = {
  kijiji: "kijiji",
  rentals_ca: "rentalsca",
  zumper: "zumper",
  viewit: "viewit",
};

// Portals we produce a sheet for — the guardrail/distribution taxonomy minus
// "other" (no portal form to map). Order = the operator's usual posting run.
export const FILL_SHEET_PORTALS: readonly PortalKey[] = [
  "kijiji",
  "facebook",
  "rentals_ca",
  "rentfaster",
  "zumper",
  "viewit",
  "realtor_ca",
];

// --- value formatters -------------------------------------------------------

/** "$1,850" (no "/month" — portal price fields are already monthly). null when unset. */
export function formatPriceField(
  rentCents: number | null | undefined,
): string | null {
  if (rentCents == null || !Number.isFinite(rentCents) || rentCents <= 0) {
    return null;
  }
  const dollars = Math.round(rentCents) / 100;
  const hasCents = Math.round(rentCents) % 100 !== 0;
  return `$${dollars.toLocaleString("en-CA", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`;
}

/** Bedrooms field value: "Studio" for 0, the number otherwise, null when unset. */
export function bedroomsField(beds: number | null | undefined): string | null {
  if (beds == null || !Number.isFinite(beds)) return null;
  return beds <= 0 ? "Studio" : String(beds);
}

/** Bathrooms field value (bare number), null when unset. */
export function bathroomsField(baths: number | null | undefined): string | null {
  if (baths == null || !Number.isFinite(baths)) return null;
  return String(baths);
}

/** Size field value: a bare sqft number ("850"), null when unset. */
export function sqftField(sqft: number | null | undefined): string | null {
  const formatted = formatSqft(sqft); // "850 sq ft" or null
  return formatted ? formatted.replace(/\s*sq\s*ft$/i, "") : null;
}

/**
 * Conservative bed-count-keyed square-footage fallback (S269, Noam-approved) for
 * portals that make Size a REQUIRED numeric field (Zumper), so an unknown-size
 * unit doesn't block the operator mid-wizard. The bias is LOW on purpose — an
 * under-estimate is the safe direction; over-stating size is the misrepresentation
 * risk. A den is real floor area and a selling feature (~75-150 sq ft), so a
 * 1-bed+den sits a notch above a plain 1-bed while staying conservative. Returns
 * null for missing/non-finite beds (the caller then leaves the field for the
 * operator). Pure + reusable on any portal with a required size field. Numbers
 * are tunable starting points for the Windsor stock.
 */
export function sqftEstimate(
  beds: number | null | undefined,
  hasDen = false,
): number | null {
  if (beds == null || !Number.isFinite(beds)) return null;
  const b = Math.max(0, Math.round(beds));
  if (b <= 0) return 400; // Bachelor / Studio
  if (b === 1) return hasDen ? 625 : 550; // 1 bed (+ den)
  if (b === 2) return 650; // 2 bed
  return 900; // 3+ bed
}

/** Yes/No for a boolean flag; null when the flag is unset (don't assume "No"). */
export function yesNoField(flag: boolean | null | undefined): string | null {
  if (flag == null) return null;
  return flag ? "Yes" : "No";
}

/** Move-in / available date as the human availability label ("Available now" / "Available Jul 1"). */
function availabilityField(
  availableDate: string | null | undefined,
  now?: Date,
): string {
  return formatAvailability(availableDate, now);
}

/** Trimmed free-text value, or null when blank. */
function textOrNull(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const v = s.trim();
  return v || null;
}

/**
 * Split a combined address string into the street address and a separate unit /
 * suite number (S264 finding #2: Rentals.ca has distinct Address + Unit fields,
 * but our `address` is one string). Recognizes "Unit 808", "Suite 12B",
 * "Apt 4", "Apartment 4", "Ste 9", and "#808" anywhere in the string, strips
 * that segment (and its adjoining comma) out of the street value, and tidies the
 * leftover comma/space artifacts. When no unit token is present the street is
 * returned unchanged and unit is null (a genuinely unit-less address).
 *
 * An immediately-following parenthetical alias is treated as part of the same
 * unit designation, so "Unit 1 (Main)" strips whole (S433, mirrors the SQL
 * building_key() change in migration 0112) — this is what collapses a triplex
 * entered as "…, Unit 1 (Main), …" / "…, Unit 2 (Upper), …" onto one building
 * label. A STANDALONE parenthetical with no unit token ("123 Main St (North
 * Tower)") is left intact so genuinely distinct buildings never merge.
 */
export function splitAddressUnit(address: string | null | undefined): {
  street: string | null;
  unit: string | null;
} {
  const raw = textOrNull(address);
  if (!raw) return { street: null, unit: null };
  // Match an optional leading comma/space, then a unit designator, then the
  // unit token, then an OPTIONAL adjacent "(...)" alias. `unit|suite|ste|apt|
  // apartment` need word boundaries; `#` is punctuation so it stands alone.
  const re =
    /[,\s]*(?:\b(?:unit|suite|ste|apt|apartment)\b\.?|#)\s*([A-Za-z0-9-]+)(?:\s*\([^)]*\))?/i;
  const m = re.exec(raw);
  if (!m) return { street: raw, unit: null };
  const unit = m[1];
  let street = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim();
  street = street
    .replace(/\s*,(?:\s*,)+\s*/g, ", ") // collapse doubled commas
    .replace(/^\s*,\s*/, "") // strip a leading comma
    .replace(/\s*,\s*$/, "") // strip a trailing comma
    .replace(/\s{2,}/g, " ")
    .trim();
  return { street: street || null, unit };
}

/**
 * Strip a leading list marker ("- ", "– ", "— ", "• ", "* ") from each line
 * (S264 finding #8: the Rentals.ca description editor auto-bullets any line that
 * starts with a dash, so our sign-off "- Agile Real Estate Group" became a
 * bullet). Returns null when the result is empty so a body-less unit stays null.
 */
export function stripLeadingListMarkers(
  body: string | null | undefined,
): string | null {
  const raw = textOrNull(body);
  if (!raw) return null;
  const cleaned = raw
    .split("\n")
    .map((line) => line.replace(/^(\s*)(?:[-–—•*])\s+/, "$1"))
    .join("\n");
  return textOrNull(cleaned);
}

/** Utilities-included multi-select value, e.g. "Heat, Water"; null when none set. */
function utilitiesField(input: FillSheetInput): string | null {
  const items = buildUtilitiesIncluded(input.features ?? {});
  return items.length ? items.join(", ") : null;
}

/**
 * Rentals.ca "Unit Features" amenity hint (S267/KI425 finding C): the unit-level
 * amenities we can map from THIS unit's flags, for the operator to tick in the
 * Unit Features multi-select. Only what we genuinely track — flooring/appliances
 * aren't in our schema, so the field's hint asks for those by hand (never
 * invent). null when nothing maps.
 */
function unitFeaturesHint(input: FillSheetInput): string | null {
  const f = input.features ?? {};
  const out: string[] = [];
  // A/C presence is now ac_type-aware (acAmenityLabel resolves type-beats-boolean
  // and treats ac_type "none" as no A/C). The portal option is still the plain
  // "Air Conditioning" tick; the type rides along in the field hint.
  if (acAmenityLabel(f)) out.push("Air Conditioning");
  if (f.balcony) out.push("Balcony");
  if (f.furnished) out.push("Furnished");
  if (f.laundry === "in_suite") out.push("In-Suite Laundry");
  return out.length ? out.join(", ") : null;
}

/**
 * Rentals.ca "Building Features" amenity hint (S267/KI425 finding C): the
 * building-level amenities we can map (shared/in-building laundry). null when
 * nothing maps.
 */
function buildingFeaturesHint(input: FillSheetInput): string | null {
  const f = input.features ?? {};
  const out: string[] = [];
  if (f.laundry === "in_building" || f.laundry === "shared") {
    out.push("Laundry Facilities");
  }
  if (f.on_site_management) out.push("On-Site Management");
  return out.length ? out.join(", ") : null;
}

/**
 * The Lease Term field value + provenance, shared by the portals that take a
 * lease term (Rentals.ca, Zumper). Reads the EFFECTIVE lease_term (unit override
 * or inherited org-profile default); falls back to the long-standing "1 Year"
 * preset when neither is set. Marks it inherited so the hint can say so.
 */
function leaseTermField(
  input: FillSheetInput,
): { value: string; source: FillFieldSource; note: string } {
  const label = leaseTermLabel(input.features?.lease_term);
  if (!label) {
    return { value: "1 Year", source: "preset", note: "" };
  }
  const inherited = policyInherited(input, "lease_term");
  return {
    value: label,
    source: inherited ? "preset" : "listing",
    note: inherited ? POLICY_PROVENANCE_NOTE : "",
  };
}

// --- per-portal field builders ----------------------------------------------
// Each returns the fields in the order the portal's form presents them. Title +
// body always come from buildListingCopy (never re-derived here).

function copyPortalFor(portal: PortalKey): CopyPortalKey {
  // listing-copy has no realtor_ca/other profile; fall back to the master copy.
  return isCopyPortalKey(portal) ? portal : "generic";
}

/** The virtual-tour field for a portal, or null when the unit has no tour URL. */
function virtualTourField(
  input: FillSheetInput,
  prefix: string,
): FillField | null {
  const url = textOrNull(input.virtualTourUrl);
  if (!url) return null;
  return {
    id: `${prefix}-virtual-tour`,
    label: "Virtual tour / video URL",
    value: url,
    source: "listing",
    hint: "Paste into the portal's virtual tour / video link field, if it has one — it boosts engagement and most renters expect it.",
  };
}

/**
 * Insert the virtual-tour field right after the portal's Description field (or
 * at the end if there isn't one). A no-op when the unit has no tour URL, so a
 * tour-less unit's sheet is unchanged.
 */
function withVirtualTour(
  fields: FillField[],
  input: FillSheetInput,
  prefix: string,
): FillField[] {
  const tour = virtualTourField(input, prefix);
  if (!tour) return fields;
  const idx = fields.findIndex((f) => f.id.endsWith("-description"));
  if (idx === -1) return [...fields, tour];
  // Inherit the description field's wizard step (if any) so the tour groups with
  // the description on a stepped portal (Rentals.ca) instead of orphaning.
  const placed: FillField = { ...tour, step: fields[idx].step };
  return [...fields.slice(0, idx + 1), placed, ...fields.slice(idx + 1)];
}

function kijijiFields(input: FillSheetInput, title: string, body: string): FillField[] {
  return [
    {
      id: "kijiji-category",
      label: "Category",
      value: "Real Estate › For Rent › Long Term Rentals",
      source: "preset",
      hint: "Set it by hand — the suggested \"Houses for Sale\" is wrong.",
      guardrailId: "kijiji-required-fields",
    },
    {
      id: "kijiji-title",
      label: "Ad title",
      value: title,
      source: "listing",
      hint: "Kijiji caps the title around 64 characters.",
      guardrailId: "kijiji-title-limit",
    },
    {
      id: "kijiji-price",
      label: "Price (monthly)",
      value: formatPriceField(input.rentCents),
      source: "listing",
    },
    {
      id: "kijiji-bedrooms",
      label: "Bedrooms",
      value: bedroomsField(input.beds),
      source: "listing",
    },
    {
      id: "kijiji-bathrooms",
      label: "Bathrooms",
      value: bathroomsField(input.baths),
      source: "listing",
    },
    {
      id: "kijiji-size",
      label: "Size (sq ft)",
      value: sqftField(input.features?.sqft),
      source: "listing",
      hint: "Size errors only surface on submit and block checkout.",
      guardrailId: "kijiji-required-fields",
    },
    {
      id: "kijiji-parking",
      label: "Parking Included",
      value: textOrNull(input.features?.parking),
      source: "listing",
      guardrailId: "kijiji-required-fields",
    },
    {
      id: "kijiji-furnished",
      label: "Furnished",
      value: yesNoField(input.features?.furnished),
      source: "listing",
    },
    {
      id: "kijiji-movein",
      label: "Move-In Date",
      value: availabilityField(input.features?.available_date, input.now),
      source: "listing",
    },
    {
      id: "kijiji-location",
      label: "Location / postal code",
      value: textOrNull(input.address),
      source: "manual",
      hint: "Set the postal code and confirm the map reads Windsor (not Toronto) before you pay — a paid ad's location is locked once posted.",
      guardrailId: "kijiji-location-lock",
    },
    {
      id: "kijiji-description",
      label: "Description",
      value: body,
      source: "listing",
    },
    {
      id: "kijiji-plan",
      label: "Ad package",
      value: "Lite ($29.95)",
      source: "preset",
      hint: "Re-select Lite right before paying — the submit reload reverts it to Plus.",
      guardrailId: "kijiji-lite-plus-reset",
    },
  ];
}

// Rentals.ca posting is a 4-step wizard and its step order is NOT the order our
// other portals list fields in (S264 finding #1). We tag each field with the
// step it actually lives on so the operator/assist fills them in form order.
const RENTALSCA_STEP = {
  location: "Step 1 · Type & location",
  details: "Step 2 · Property details",
  floorPlan: "Step 3 · Floor plan, features, photos & contact",
  plan: "Step 4 · Plan & add-ons (after the photo gate)",
} as const;

function rentalsCaFields(input: FillSheetInput, _title: string, body: string): FillField[] {
  const { street, unit } = splitAddressUnit(input.address);
  const parkingType = textOrNull(input.features?.parking);
  const unitFeatures = unitFeaturesHint(input);
  const buildingFeatures = buildingFeaturesHint(input);
  return [
    // --- Step 1: Property Type + Location ---
    {
      id: "rentalsca-property-type",
      label: "Property Type",
      value: "Apartment",
      source: "preset",
      step: RENTALSCA_STEP.location,
      hint: "Required. Pick the type + sub-type that match — change from Apartment for a house, condo, townhouse, etc.",
    },
    {
      id: "rentalsca-address",
      label: "Address",
      value: street,
      source: "listing",
      step: RENTALSCA_STEP.location,
      hint: "Street address only (the unit goes in the separate field below). Pick the Google autocomplete match so it geocodes correctly.",
      guardrailId: "rentalsca-address-autocomplete",
    },
    {
      id: "rentalsca-unit",
      label: "Unit",
      value: unit,
      source: "listing",
      step: RENTALSCA_STEP.location,
      hint: "The unit / suite number, split out of the address. Verify it — leave blank if the address has no unit.",
    },
    // --- Step 2: Property Details ---
    {
      id: "rentalsca-utilities",
      label: "Utilities Included",
      value: utilitiesField(input),
      source: "listing",
      step: RENTALSCA_STEP.details,
      hint: "Required structured multi-select — tick each utility included in rent (Heat / Hydro / Water).",
    },
    {
      id: "rentalsca-lease-term",
      label: "Lease Term",
      value: leaseTermField(input).value,
      source: leaseTermField(input).source,
      step: RENTALSCA_STEP.details,
      hint:
        "Required. The form defaults to 1 Year — change it if your term differs." +
        leaseTermField(input).note,
    },
    {
      id: "rentalsca-pets",
      label: "Pet Friendly?",
      value: null,
      source: "manual",
      step: RENTALSCA_STEP.details,
      hint: "The form defaults this to Yes — set it to match your actual policy. (Ontario RTA s.14 makes no-pet clauses unenforceable, so don't advertise a hard no-pets rule.)",
    },
    // Parking block (S267/KI425 finding B) — a whole Step-2 sub-section the v2
    // sheet omitted: Type + per-type Monthly Fee + Spots + Included? toggle.
    {
      id: "rentalsca-parking-type",
      label: "Parking Type",
      value: parkingType,
      source: parkingType ? "listing" : "manual",
      step: RENTALSCA_STEP.details,
      hint: "Pick the matching Parking Type (Outdoor / Driveway / Garage / Underground / Street / Indoor / Covered / Electric / Valet). Leave it as No Parking only if there genuinely is none. The same block also has a per-type Monthly Fee box and Visitor / Tandem / Parallel toggles + an Other Parking Details field — leave those off unless they apply.",
    },
    {
      id: "rentalsca-parking-included",
      label: "Parking Included?",
      value: "No",
      source: "preset",
      step: RENTALSCA_STEP.details,
      hint: "Defaults to No on purpose. Only set Yes if parking is genuinely included in the rent — advertising it as included is a commitment that's hard to walk back. Offer it as a per-unit add-on instead.",
      guardrailId: "rentalsca-parking-included",
    },
    {
      id: "rentalsca-parking-spots",
      label: "Parking Spots",
      value: null,
      source: "manual",
      step: RENTALSCA_STEP.details,
      hint: "Optional preset button group (0 / 1 / 2 / 3 / 4 / Custom), not a +/- stepper — leave it unset unless you're assigning a specific number of spots.",
    },
    // --- Step 3: Floor Plan + Photos + Description ---
    {
      id: "rentalsca-bedrooms",
      label: "Bedrooms",
      value: bedroomsField(input.beds),
      source: "listing",
      step: RENTALSCA_STEP.floorPlan,
      hint: "Under the Floor Plan row — a 0.5-step “+” stepper, not a text box (each click adds 0.5).",
    },
    {
      id: "rentalsca-bathrooms",
      label: "Bathrooms",
      value: bathroomsField(input.baths),
      source: "listing",
      step: RENTALSCA_STEP.floorPlan,
      hint: "Under the Floor Plan row — a 0.5-step “+” stepper, not a text box (each click adds 0.5).",
    },
    {
      id: "rentalsca-price",
      label: "Price (monthly)",
      value: formatPriceField(input.rentCents),
      source: "listing",
      step: RENTALSCA_STEP.floorPlan,
      hint: "Free-text Rent field under the Floor Plan row.",
    },
    {
      id: "rentalsca-size",
      label: "Size (sq ft)",
      value: sqftField(input.features?.sqft),
      source: "listing",
      step: RENTALSCA_STEP.floorPlan,
      hint: "Free-text Unit Size field under the Floor Plan row.",
    },
    {
      id: "rentalsca-photos",
      label: "Photos",
      value: null,
      source: "manual",
      step: RENTALSCA_STEP.floorPlan,
      hint: "Upload at least 2 — Rentals.ca won't let you reach the Plan & contact step (below) until you do.",
    },
    {
      id: "rentalsca-description",
      label: "Description",
      value: stripLeadingListMarkers(body),
      source: "listing",
      step: RENTALSCA_STEP.floorPlan,
      hint: "The editor auto-bullets each line — write flowing sentences, not dashed lines.",
      guardrailId: "rentalsca-description-bullets",
    },
    // Features/Amenities (S267/KI425 finding C) — Step-3 multi-selects the v2
    // sheet omitted. We pre-fill only what the unit's flags map to and ask the
    // operator to tick the rest (flooring/appliances we don't track).
    {
      id: "rentalsca-unit-features",
      label: "Unit Features",
      value: unitFeatures,
      source: unitFeatures ? "listing" : "manual",
      step: RENTALSCA_STEP.floorPlan,
      hint: "Tick these in the Unit Features multi-select, plus anything else that applies we don't track (flooring type, fridge/stove, dishwasher).",
    },
    {
      id: "rentalsca-building-features",
      label: "Building Features",
      value: buildingFeatures,
      source: buildingFeatures ? "listing" : "manual",
      step: RENTALSCA_STEP.floorPlan,
      hint: "Tick these in the Building Features multi-select, plus anything else that applies (on-site management, elevator, secured entry).",
    },
    {
      id: "rentalsca-promotion",
      label: "Promotion / Open House (optional)",
      value: null,
      source: "manual",
      step: RENTALSCA_STEP.floorPlan,
      hint: "Optional Step-3 sections — add a Rent Special / Move-In Gift or an Open House date only if you're actually running one. Otherwise skip both.",
    },
    // Lead Contact lives on STEP 3 (below Promotion / Open House), NOT Step 4
    // (S267/KI425 finding A — corrects the v2 step tag).
    {
      id: "rentalsca-contact-email",
      label: "Lead Contact — email",
      value: textOrNull(input.leadContactEmail),
      source: "listing",
      step: RENTALSCA_STEP.floorPlan,
      hint: "The per-listing Lead Contact is on this step (below Promotion / Open House) and defaults wrong — set it before you continue.",
      guardrailId: "rentalsca-lead-contact-revert",
    },
    {
      id: "rentalsca-contact-phone",
      label: "Lead Contact — phone",
      value: textOrNull(input.leadContactPhone),
      source: "listing",
      step: RENTALSCA_STEP.floorPlan,
      guardrailId: "rentalsca-lead-contact-revert",
    },
    // --- Step 4: Plan & Add-ons (after the photo gate) ---
    {
      id: "rentalsca-plan",
      label: "Plan",
      value: "Limited ($0)",
      source: "preset",
      step: RENTALSCA_STEP.plan,
      hint: "Click \"See other pricing options\" → Limited $0; the form defaults to a paid Promoted plan. If you do pick a paid plan, uncheck the +$20 Credit Report add-on (it's pre-checked).",
      guardrailId: "rentalsca-paid-default",
    },
    {
      id: "rentalsca-enable",
      label: "After posting: Enable the listing",
      value: null,
      source: "manual",
      step: RENTALSCA_STEP.plan,
      hint: "New listings save as Disabled. Open Manage Listings, click Enable, confirm the badge turns green.",
      guardrailId: "rentalsca-disabled-default",
    },
  ];
}

const RENTFASTER_STEP = {
  address: "Step 1 · Listing type & address",
  details: "Step 2 · Details, rent & terms",
  media: "Step 3 · Description, photos & contact",
  payment: "Step 4 · Review & payment",
} as const;

function rentFasterFields(input: FillSheetInput, title: string, body: string): FillField[] {
  const { street, unit } = splitAddressUnit(input.address);
  const lease = leaseTermField(input);
  const utilities = utilitiesField(input);
  const petPolicy = petPolicyLabel(input.features ?? {});
  return [
    {
      id: "rentfaster-listing-type",
      label: "Listing type",
      value: "Single Unit Listing",
      source: "preset",
      step: RENTFASTER_STEP.address,
      hint: "Use this for one suite at one address. Use Multi-Unit Listing only when one address has several unit types.",
      guardrailId: "rentfaster-single-address",
    },
    {
      id: "rentfaster-address",
      label: "Address",
      value: street,
      source: "listing",
      step: RENTFASTER_STEP.address,
      hint: "Pick the address/geocode result and confirm the listing lands in the correct city search.",
      guardrailId: "rentfaster-location-market",
    },
    {
      id: "rentfaster-unit",
      label: "Unit / suite",
      value: unit,
      source: unit ? "listing" : "manual",
      step: RENTFASTER_STEP.address,
      hint: "Enter the suite/unit only when the rental has one.",
    },
    {
      id: "rentfaster-property-type",
      label: "Property type",
      value: "Apartment",
      source: "preset",
      step: RENTFASTER_STEP.details,
      hint: "Change this to match the unit if it is a condo, house, townhouse, basement, room, or another type.",
    },
    {
      id: "rentfaster-title",
      label: "Ad title",
      value: title,
      source: "listing",
      step: RENTFASTER_STEP.details,
    },
    {
      id: "rentfaster-price",
      label: "Rent (monthly)",
      value: formatPriceField(input.rentCents),
      source: "listing",
      step: RENTFASTER_STEP.details,
    },
    {
      id: "rentfaster-bedrooms",
      label: "Bedrooms",
      value: bedroomsField(input.beds),
      source: "listing",
      step: RENTFASTER_STEP.details,
    },
    {
      id: "rentfaster-bathrooms",
      label: "Bathrooms",
      value: bathroomsField(input.baths),
      source: "listing",
      step: RENTFASTER_STEP.details,
    },
    {
      id: "rentfaster-size",
      label: "Size (sq ft)",
      value: sqftField(input.features?.sqft),
      source: "listing",
      step: RENTFASTER_STEP.details,
      hint: "Use the real size when known; leave for manual review rather than overstating it.",
    },
    {
      id: "rentfaster-available-date",
      label: "Available date",
      value: availabilityField(input.features?.available_date, input.now),
      source: "listing",
      step: RENTFASTER_STEP.details,
    },
    {
      id: "rentfaster-lease-term",
      label: "Lease term",
      value: lease.value,
      source: lease.source,
      step: RENTFASTER_STEP.details,
      hint: "Set the actual lease term." + lease.note,
    },
    {
      id: "rentfaster-utilities",
      label: "Utilities included",
      value: utilities,
      source: utilities ? "listing" : "manual",
      step: RENTFASTER_STEP.details,
      hint: "Tick only utilities included in rent. Hydro must stay disclosed when it is not included.",
    },
    {
      id: "rentfaster-pets",
      label: "Pet policy",
      value: petPolicy,
      source: petPolicy ? "listing" : "manual",
      step: RENTFASTER_STEP.details,
      hint: "Match the actual policy and avoid advertising a hard no-pets clause in Ontario.",
    },
    {
      id: "rentfaster-parking",
      label: "Parking",
      value: textOrNull(input.features?.parking),
      source: textOrNull(input.features?.parking) ? "listing" : "manual",
      step: RENTFASTER_STEP.details,
      hint: "State whether parking is included, extra, or unavailable.",
    },
    {
      id: "rentfaster-furnished",
      label: "Furnished",
      value: yesNoField(input.features?.furnished),
      source: "listing",
      step: RENTFASTER_STEP.details,
    },
    {
      id: "rentfaster-description",
      label: "Description",
      value: body,
      source: "listing",
      step: RENTFASTER_STEP.media,
      hint: "The ad includes unlimited description, so keep the useful details in.",
      guardrailId: "rentfaster-photo-depth",
    },
    {
      id: "rentfaster-photos",
      label: "Photos",
      value: null,
      source: "manual",
      step: RENTFASTER_STEP.media,
      hint: "Upload the full unit-specific photo set.",
      guardrailId: "rentfaster-photo-depth",
    },
    {
      id: "rentfaster-contact-email",
      label: "Contact email",
      value: textOrNull(input.leadContactEmail),
      source: "listing",
      step: RENTFASTER_STEP.media,
    },
    {
      id: "rentfaster-contact-phone",
      label: "Contact phone",
      value: textOrNull(input.leadContactPhone),
      source: "listing",
      step: RENTFASTER_STEP.media,
    },
    {
      id: "rentfaster-payment",
      label: "Plan / payment",
      value: "New Rental Ad - $54.50 + tax",
      source: "preset",
      step: RENTFASTER_STEP.payment,
      hint: "Confirm the checkout total and the 60-day posting window before paying.",
      guardrailId: "rentfaster-paid-sixty-day",
    },
    {
      id: "rentfaster-live-url",
      label: "After posting: live ad URL",
      value: null,
      source: "manual",
      step: RENTFASTER_STEP.payment,
      hint: "Open the public RentFaster ad and paste that live listing URL back into Vacantless. Do not use the dashboard or pricing page.",
    },
  ];
}

// Zumper posting is a 5-step wizard (S269 live walk): Address / Listing (itself
// 5 sub-steps) / Pricing / Media / Review. Its form order is NOT our flat field
// order, so — exactly like Rentals.ca — each field carries the step it lives on
// (the UI groups them by step header). The v3 flat 6-field sheet drastically
// under-modeled this (KI427); v4 mirrors the real wizard, and v5 (S271 live-post
// finding) adds the Pricing → Lease details sub-step (available date + lease
// length) that were filled by hand on the live Unit 20 post.
const ZUMPER_STEP = {
  address: "Step 1 · Address",
  listing: "Step 2 · Listing details",
  pricing: "Step 3 · Pricing",
  media: "Step 4 · Media",
  review: "Step 5 · Review & publish",
} as const;

function zumperFields(input: FillSheetInput, _title: string, body: string): FillField[] {
  const { street, unit } = splitAddressUnit(input.address);
  // Size is a REQUIRED Zumper field. Use the unit's real sqft if we have it,
  // else fall back to the conservative bed-count estimate (S269) so the operator
  // isn't blocked mid-wizard — and disclose the estimate in the description,
  // since the numeric field can't say "approximate".
  const realSqft = sqftField(input.features?.sqft);
  const estSqft = realSqft == null ? sqftEstimate(input.beds) : null;
  const sqftValue = realSqft ?? (estSqft != null ? String(estSqft) : null);
  const sqftIsEstimate = realSqft == null && estSqft != null;
  const sqftSource: FillFieldSource =
    realSqft != null ? "listing" : estSqft != null ? "preset" : "manual";
  const baseBody = textOrNull(body);
  const description = sqftIsEstimate && baseBody
    ? `${baseBody}\n\nApproximate square footage.`
    : baseBody;
  const unitFeatures = unitFeaturesHint(input);
  const buildingFeatures = buildingFeaturesHint(input);
  const petPolicy = petPolicyLabel(input.features ?? {});
  return [
    // --- Step 1: Address ---
    {
      id: "zumper-property-type",
      label: "Property Type",
      value: "Apartment",
      source: "preset",
      step: ZUMPER_STEP.address,
      hint: "Required native select — change from Apartment to match (Condo, Single Family Home, Townhouse, Room, Multifamily, Loft, Co-Op, etc.; 13 options).",
    },
    {
      id: "zumper-address",
      label: "Street Address",
      value: street,
      source: "listing",
      step: ZUMPER_STEP.address,
      hint: "Street only (the unit goes in the separate field below). Pick the Google autocomplete match — a typed-in address is rejected with a \"valid zip code\" error.",
      guardrailId: "zumper-address-autocomplete",
    },
    {
      id: "zumper-unit",
      label: "Apt / Unit #",
      value: unit,
      source: "listing",
      step: ZUMPER_STEP.address,
      hint: "The unit / suite number, split out of the address. Leave blank if the address has no unit.",
    },
    // --- Step 2: Listing details (Zumper's 5 sub-steps) ---
    {
      id: "zumper-bedrooms",
      label: "Bedrooms",
      value: bedroomsField(input.beds),
      source: "listing",
      step: ZUMPER_STEP.listing,
      hint: "Stepper — 0 renders as \"Studio\".",
    },
    {
      id: "zumper-bathrooms",
      label: "Bathrooms",
      value: bathroomsField(input.baths),
      source: "listing",
      step: ZUMPER_STEP.listing,
    },
    {
      id: "zumper-half-baths",
      label: "Half-Bathrooms",
      value: null,
      source: "manual",
      step: ZUMPER_STEP.listing,
      hint: "Optional stepper — set only if the unit has a half-bath (toilet + sink, no shower/tub).",
    },
    {
      id: "zumper-sqft",
      label: "Square footage",
      value: sqftValue,
      source: sqftSource,
      step: ZUMPER_STEP.listing,
      hint: sqftIsEstimate
        ? "Required — Zumper blocks the next sub-step without it. This is an estimate from the bed count; replace it with the actual size if you know it (we've added \"approximate square footage\" to the description so it isn't overstated)."
        : "Required — Zumper won't let you past Listing details without a size.",
      guardrailId: "zumper-sqft-required",
    },
    {
      id: "zumper-description",
      label: "Description",
      value: description,
      source: "listing",
      step: ZUMPER_STEP.listing,
      hint: "Zumper strips URL punctuation — don't rely on a booking link here; the phone number survives.",
      guardrailId: "zumper-url-strip",
    },
    {
      id: "zumper-unit-amenities",
      label: "In-unit amenities",
      value: unitFeatures,
      source: unitFeatures ? "listing" : "manual",
      step: ZUMPER_STEP.listing,
      hint: "Tick these in the In-unit amenities sub-step, plus anything else that applies we don't track (flooring, appliances, dishwasher).",
    },
    {
      id: "zumper-building-amenities",
      label: "Building amenities",
      value: buildingFeatures,
      source: buildingFeatures ? "listing" : "manual",
      step: ZUMPER_STEP.listing,
      hint: "Tick these in the Building amenities sub-step, plus anything else that applies (elevator, secured entry, on-site management).",
    },
    {
      id: "zumper-pet-policy",
      label: "Pet policy",
      value: petPolicy,
      source: petPolicy ? "listing" : "manual",
      step: ZUMPER_STEP.listing,
      hint: "Zumper has a dedicated pet-policy sub-step — set it to match your actual policy. (Ontario RTA s.14 makes no-pet clauses unenforceable, so don't advertise a hard no-pets rule.)",
    },
    // --- Step 3: Pricing (incl. the Lease details sub-step) ---
    {
      id: "zumper-price",
      label: "Price (monthly)",
      value: formatPriceField(input.rentCents),
      source: "listing",
      step: ZUMPER_STEP.pricing,
      hint: "Type your real rent over Zumper's higher suggested figure.",
      guardrailId: "zumper-rent-override",
    },
    // Lease details sub-step (S271 finding #1) — v4 omitted these and they were
    // filled by hand on the live Unit 20 post.
    {
      id: "zumper-available-date",
      label: "Available date",
      value: availabilityField(input.features?.available_date, input.now),
      source: "listing",
      step: ZUMPER_STEP.pricing,
      hint: "In the Lease details sub-step — pick the move-in date. \"Available now\" means pick today.",
    },
    {
      id: "zumper-lease-length",
      label: "Lease length",
      value: leaseTermField(input).value,
      source: leaseTermField(input).source,
      step: ZUMPER_STEP.pricing,
      hint:
        "In the Lease details sub-step — defaults shown as 1 Year; change it if your term differs (e.g. month-to-month)." +
        leaseTermField(input).note,
    },
    // --- Step 4: Media ---
    {
      id: "zumper-photos",
      label: "Photos",
      value: null,
      source: "manual",
      step: ZUMPER_STEP.media,
      hint: "Upload the unit's photos on the Media step. Like Rentals.ca, expect a photo gate before you can publish.",
    },
    // --- Step 5: Review & publish ---
    {
      id: "zumper-boost",
      label: "Boost upsell",
      value: "Continue without Boost",
      source: "preset",
      step: ZUMPER_STEP.review,
      hint: "The free tier already reaches Zumper + PadMapper.",
      guardrailId: "zumper-boost-upsell",
    },
  ];
}

function facebookFields(input: FillSheetInput, title: string, body: string): FillField[] {
  return [
    {
      id: "facebook-title",
      label: "Title",
      value: title,
      source: "listing",
    },
    {
      id: "facebook-price",
      label: "Price (monthly)",
      value: formatPriceField(input.rentCents),
      source: "listing",
    },
    {
      id: "facebook-bedrooms",
      label: "Bedrooms",
      value: bedroomsField(input.beds),
      source: "listing",
    },
    {
      id: "facebook-bathrooms",
      label: "Bathrooms",
      value: bathroomsField(input.baths),
      source: "listing",
    },
    {
      id: "facebook-description",
      label: "Description",
      value: body,
      source: "listing",
      hint: "Links break in Marketplace DMs — the copy already tells renters to message or paste the link.",
      guardrailId: "facebook-links-in-dms",
    },
    {
      id: "facebook-photos",
      label: "Photos",
      value: null,
      source: "manual",
      hint: "Use a unique photo set per ad — address + photo overlap is the top anti-fraud trigger.",
      guardrailId: "facebook-unique-photos",
    },
  ];
}

function viewitFields(input: FillSheetInput, _title: string, body: string): FillField[] {
  return [
    {
      id: "viewit-address",
      label: "Address",
      value: textOrNull(input.address),
      source: "listing",
      hint: "Pick the Google Places dropdown match or it mis-geocodes.",
      guardrailId: "viewit-geocode",
    },
    {
      id: "viewit-intersections",
      label: "Intersection 1 & Intersection 2",
      value: null,
      source: "manual",
      hint: "Both cross-streets are required fields.",
      guardrailId: "viewit-geocode",
    },
    {
      id: "viewit-price",
      label: "Price (monthly)",
      value: formatPriceField(input.rentCents),
      source: "listing",
    },
    {
      id: "viewit-bedrooms",
      label: "Bedrooms",
      value: bedroomsField(input.beds),
      source: "listing",
    },
    {
      id: "viewit-bathrooms",
      label: "Bathrooms",
      value: bathroomsField(input.baths),
      source: "listing",
    },
    {
      id: "viewit-description",
      label: "Description",
      value: body,
      source: "listing",
    },
  ];
}

function realtorCaFields(): FillField[] {
  return [
    {
      id: "realtorca-ddf",
      label: "Enter through your brokerage MLS / DDF feed",
      value: null,
      source: "manual",
      hint: "Realtor.ca has no self-serve rental post — it only accepts REALTOR listings via the DDF feed.",
      guardrailId: "realtorca-ddf-only",
    },
  ];
}

const FIELD_BUILDERS: Record<
  PortalKey,
  (input: FillSheetInput, title: string, body: string) => FillField[]
> = {
  kijiji: kijijiFields,
  facebook: facebookFields,
  rentals_ca: rentalsCaFields,
  rentfaster: rentFasterFields,
  zumper: zumperFields,
  viewit: viewitFields,
  realtor_ca: () => realtorCaFields(),
  other: () => [],
};

/**
 * Build the field-by-field fill sheet for one portal: the portal's form fields
 * in entry order, each with the value resolved from this unit (title + body via
 * buildListingCopy, never re-derived), plus the portal's guardrail list so the
 * UI can show the why behind each field. Unknown/junk keys fall back to "other"
 * (an empty field list + the universal guardrail floor) rather than throwing.
 */
export function buildFillSheet(
  input: FillSheetInput,
  portal: PortalKey = "kijiji",
): FillSheet {
  const key: PortalKey = isPortalKey(portal) ? portal : "other";
  const copy = buildListingCopy(input, copyPortalFor(key));
  let fields = (FIELD_BUILDERS[key] ?? FIELD_BUILDERS.other)(
    input,
    copy.title,
    copy.body,
  );
  // Add the virtual-tour field for portals with a tour/video link field, only
  // when the unit has a tour URL (item S).
  const prefix = PORTAL_FIELD_PREFIX[key];
  if (TOUR_FIELD_PORTALS.has(key) && prefix) {
    fields = withVirtualTour(fields, input, prefix);
  }
  return {
    portal: key,
    label: portalLabel(key),
    fields,
    guardrails: guardrailsForPortal(key),
  };
}

/** Build a fill sheet for every postable portal (operator "post everywhere" run). */
export function buildAllFillSheets(input: FillSheetInput): FillSheet[] {
  return FILL_SHEET_PORTALS.map((p) => buildFillSheet(input, p));
}

/** How many of a sheet's fields we could pre-fill from the unit's data. */
export function filledFieldCount(sheet: FillSheet): number {
  return sheet.fields.reduce(
    (n, f) => (f.source === "listing" && f.value != null ? n + 1 : n),
    0,
  );
}

/** Fields that still need the operator (manual fields, or a listing field we couldn't resolve). */
export function unresolvedFields(sheet: FillSheet): FillField[] {
  return sheet.fields.filter((f) => f.value == null);
}
