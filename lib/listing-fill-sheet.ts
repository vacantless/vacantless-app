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
import { formatAvailability, formatSqft } from "./property-features";

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
};

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
  return [...fields.slice(0, idx + 1), tour, ...fields.slice(idx + 1)];
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

function rentalsCaFields(input: FillSheetInput, _title: string, body: string): FillField[] {
  return [
    {
      id: "rentalsca-plan",
      label: "Plan",
      value: "Limited ($0)",
      source: "preset",
      hint: "Click \"See other pricing options\" → Limited $0; the form defaults to a paid Promoted plan.",
      guardrailId: "rentalsca-paid-default",
    },
    {
      id: "rentalsca-address",
      label: "Address",
      value: textOrNull(input.address),
      source: "listing",
      hint: "Pick the Google autocomplete match so it geocodes correctly.",
      guardrailId: "rentalsca-address-autocomplete",
    },
    {
      id: "rentalsca-price",
      label: "Price (monthly)",
      value: formatPriceField(input.rentCents),
      source: "listing",
    },
    {
      id: "rentalsca-bedrooms",
      label: "Bedrooms",
      value: bedroomsField(input.beds),
      source: "listing",
    },
    {
      id: "rentalsca-bathrooms",
      label: "Bathrooms",
      value: bathroomsField(input.baths),
      source: "listing",
    },
    {
      id: "rentalsca-description",
      label: "Description",
      value: body,
      source: "listing",
      hint: "The editor auto-bullets each line — write flowing sentences, not dashed lines.",
      guardrailId: "rentalsca-description-bullets",
    },
    {
      id: "rentalsca-contact-email",
      label: "Lead Contact — email",
      value: textOrNull(input.leadContactEmail),
      source: "listing",
      hint: "The per-listing Lead Contact defaults wrong — set it before publishing.",
      guardrailId: "rentalsca-lead-contact-revert",
    },
    {
      id: "rentalsca-contact-phone",
      label: "Lead Contact — phone",
      value: textOrNull(input.leadContactPhone),
      source: "listing",
      guardrailId: "rentalsca-lead-contact-revert",
    },
    {
      id: "rentalsca-enable",
      label: "After posting: Enable the listing",
      value: null,
      source: "manual",
      hint: "New listings save as Disabled. Open Manage Listings, click Enable, confirm the badge turns green.",
      guardrailId: "rentalsca-disabled-default",
    },
  ];
}

function zumperFields(input: FillSheetInput, _title: string, body: string): FillField[] {
  return [
    {
      id: "zumper-address",
      label: "Address",
      value: textOrNull(input.address),
      source: "listing",
    },
    {
      id: "zumper-price",
      label: "Price (monthly)",
      value: formatPriceField(input.rentCents),
      source: "listing",
      hint: "Type your real rent over Zumper's higher suggested figure.",
      guardrailId: "zumper-rent-override",
    },
    {
      id: "zumper-bedrooms",
      label: "Bedrooms",
      value: bedroomsField(input.beds),
      source: "listing",
    },
    {
      id: "zumper-bathrooms",
      label: "Bathrooms",
      value: bathroomsField(input.baths),
      source: "listing",
    },
    {
      id: "zumper-description",
      label: "Description",
      value: body,
      source: "listing",
      hint: "Zumper strips URL punctuation — don't rely on a booking link here; the phone number survives.",
      guardrailId: "zumper-url-strip",
    },
    {
      id: "zumper-boost",
      label: "Boost upsell",
      value: "Continue without Boost",
      source: "preset",
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
