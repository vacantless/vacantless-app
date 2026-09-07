// ============================================================================
// Post Everywhere Slice 2: the one question sheet (SPEC-S688 Slice 2, 4.1).
//
// Pure. Given a property record, its organization's contact facts, the photo
// count, the channels the landlord picked in Screen 1 and the effective
// (profile-resolved) features, produce the list of questions whose answer the
// record does NOT hold, in the order Screen 2 shows them:
//   1. required      hardBlock ∪ required of any selected channel
//   2. answer_once   askedDefaults of any selected channel (the worker would
//                    otherwise post a silent default)
//   3. recommended   recommended of any selected channel
// A question the record already answers is not shown at all.
//
// One "does the record hold it" rule per key lives here and nowhere else;
// questionSheetFieldFacts() derives the packet-card facts from the same rules
// so the property page and the sheet can never disagree.
//
// Deviations from the spec text, both needed to make the first save possible:
//   - `answersComplete` (every required + answer_once question held) is split
//     from `complete` (answersComplete AND every selected portal channel is
//     already in property.question_sheet_channels). The save action stamps
//     question_sheet_completed_at on answersComplete; the page shows "nothing
//     left" on complete. As written, the spec's single flag could never turn
//     true before the channels were recorded, which only happens after it did.
//   - `accessibility` has no column of its own (spec 4.3: amenities holds
//     wheelchair_accessible, absent = no once the sheet is completed). A "no"
//     before completion is therefore invisible to the record, so the save
//     action passes the keys it just wrote as `answeredKeys`; those count as
//     held for that rebuild only. A present amenity is held even before
//     completion (a positive answer is self-evident). And "completed" only
//     counts when every SELECTED channel that asks accessibility is already in
//     question_sheet_channels: a sheet completed for Zumper alone never asked
//     it, so adding Kijiji later re-opens it (the spec's "extra questions" rule).
//   - `neededBy` lists every selected channel that names the field at ANY
//     level (required, askedDefaults or recommended); the tier is still the
//     strongest level among them.
//   - `requiredFieldsRemaining` counts distinct requirement-table fields (beds
//     and baths are one field; sheet-only keys excluded) so it equals the
//     packet card's missingRequired length; `requiredRemaining` counts
//     questions, which is what the Next button shows.
// ============================================================================

import {
  PORTAL_REQUIREMENTS,
  requiredQuestionFieldsFor,
  type PortalRequirementChannelKey,
  type PortalRequirementFieldKey,
  type PortalRequirements,
} from "./portal-requirements";
import type { PublishChannelKey } from "./distribution-publish";
import type { ListingPacketFieldFacts } from "./listing-packet-readiness";
import {
  MIN_DESCRIPTION_CHARS,
  MIN_PHOTOS_BY_CHANNEL,
  minPhotosForChannels,
} from "./listing-feed";
import {
  DOG_SIZE_OPTIONS,
  FOR_RENT_BY_OPTIONS,
  LAUNDRY_OPTIONS,
  LEASE_TERM_OPTIONS,
  PARKING_TYPE_LABELS,
  PARKING_TYPE_OPTIONS,
  SMOKING_OPTIONS,
  UNIT_TYPE_OPTIONS,
  dogSizeLabel,
  forRentByLabel,
  isForRentBy,
  isLaundry,
  isLeaseTerm,
  isParkingType,
  isSmoking,
  isUnitType,
  laundryLabel,
  leaseTermLabel,
  smokingLabel,
  unitTypeLabel,
  type ParkingType,
  type UnitFeatures,
} from "./property-features";

// --- Types (spec 4.1) --------------------------------------------------------

export const QUESTION_KEYS = [
  "rent",
  "beds",
  "baths",
  "sqft",
  "available_date",
  "unit_type",
  "postal_code",
  "description",
  "photos",
  "furnished",
  "lease_term",
  "pets",
  "air_conditioning",
  "smoking",
  "parking",
  "utilities",
  "laundry",
  "for_rent_by",
  "accessibility",
  "contact_phone",
  "contact_email",
] as const;
export type QuestionKey = (typeof QUESTION_KEYS)[number];

export function isQuestionKey(value: unknown): value is QuestionKey {
  return (
    typeof value === "string" &&
    (QUESTION_KEYS as readonly string[]).includes(value)
  );
}

export type QuestionOption = { value: string; label: string };

export type QuestionInput =
  | { kind: "money" }
  | { kind: "integer"; min: number; max: number }
  | { kind: "decimal_half" }
  | { kind: "date"; minToday: boolean }
  | { kind: "text"; maxLength: number }
  | { kind: "textarea"; minLength: number }
  | { kind: "select"; options: readonly QuestionOption[] }
  | { kind: "tri_state" }
  | { kind: "multi"; options: readonly QuestionOption[] }
  | { kind: "pets"; dogSizes: readonly QuestionOption[] }
  | { kind: "parking"; types: readonly QuestionOption[] }
  | { kind: "photos"; min: number; current: number }
  | { kind: "org_text"; field: "public_contact_phone" | "public_contact_email" };

export type QuestionTier = "required" | "answer_once" | "recommended";
export type QuestionScope = "property" | "organization";

export type SheetQuestion = {
  key: QuestionKey;
  /** The requirement-table field this question answers (beds and baths share beds_baths). */
  field: PortalRequirementFieldKey;
  label: string;
  help: string | null;
  neededBy: PortalRequirementChannelKey[];
  tier: QuestionTier;
  input: QuestionInput;
  /** Prefill when the record holds a partial answer; shape depends on `input.kind`. */
  current: unknown;
  scope: QuestionScope;
  /** Organization-scope questions render read-only when the caller cannot manage settings (decision 6). */
  readOnly: boolean;
  /** answer_once only: what the worker posts today when the record is null. */
  guessedDefault: string | null;
};

export type QuestionSheet = {
  propertyId: string;
  /** Selected channels that have a requirement row, in selection order. */
  channels: PortalRequirementChannelKey[];
  /** Selected channels ignored because they have no requirement row. */
  ignoredChannels: string[];
  questions: SheetQuestion[];
  /** Number of required QUESTIONS left (beds and baths count separately). */
  requiredRemaining: number;
  /** Distinct requirement-table FIELDS behind those questions, sheet-only keys excluded; equals the packet card's missingRequired length. */
  requiredFieldsRemaining: number;
  answerOnceRemaining: number;
  recommendedRemaining: number;
  /** Every required and answer_once question is held. The save action stamps the timestamp on this. */
  answersComplete: boolean;
  /** answersComplete AND every selected portal channel is in question_sheet_channels. */
  complete: boolean;
  /** Selected portal channels not yet in question_sheet_channels (why `complete` is false). */
  channelsNotYetCompleted: PortalRequirementChannelKey[];
  minPhotos: number;
};

export type PropertyForSheet = {
  id: string;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  available_date: string | null;
  unit_type: string | null;
  postal_code: string | null;
  description: string | null;
  furnished: boolean | null;
  air_conditioning: boolean | null;
  balcony: boolean | null;
  lease_term: string | null;
  pets_cats: boolean | null;
  pets_dogs: boolean | null;
  pets_dog_size: string | null;
  pets_notes: string | null;
  smoking: string | null;
  parking: string | null;
  parking_type: string | null;
  parking_count: number | null;
  heat_included: boolean | null;
  hydro_included: boolean | null;
  water_included: boolean | null;
  internet_included: boolean | null;
  cable_included: boolean | null;
  laundry: string | null;
  amenities: readonly string[] | null;
  question_sheet_completed_at: string | null;
  question_sheet_channels: readonly string[] | null;
};

export type OrgForSheet = {
  public_contact_phone: string | null;
  public_contact_email: string | null;
  reply_to_email: string | null;
  for_rent_by: string | null;
};

export type QuestionSheetInput = {
  property: PropertyForSheet;
  org: OrgForSheet;
  photoCount: number;
  /** One key type across Slices 1 to 3; keys without a requirement row are ignored. */
  channels: readonly (PublishChannelKey | string)[];
  /** The 0048/0050 inheritance already resolved on the page (resolveEffectiveFeatures().features). */
  effectiveFeatures: UnitFeatures;
  /** roleCan(role, "manage_settings"); organization-scope questions render read-only when false. */
  callerCanEditOrg: boolean;
  /** Keys written in this same request; held for this rebuild regardless of the record. */
  answeredKeys?: readonly QuestionKey[];
};

// --- Constants --------------------------------------------------------------

export const POSTAL_CODE_RE = /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i;
export const SQFT_MIN = 100;
export const SQFT_MAX = 20000;
export const BEDS_MAX = 20;
export const POSTAL_CODE_MAX_LENGTH = 7;
export const WHEELCHAIR_AMENITY_KEY = "wheelchair_accessible";

const QUESTION_FIELD: Record<QuestionKey, PortalRequirementFieldKey> = {
  rent: "rent",
  beds: "beds_baths",
  baths: "beds_baths",
  sqft: "square_footage",
  available_date: "availability_date",
  unit_type: "property_type",
  postal_code: "postal_code",
  description: "description",
  photos: "photos",
  furnished: "furnished",
  lease_term: "lease_term",
  pets: "pets",
  air_conditioning: "air_conditioning",
  smoking: "smoking",
  parking: "parking",
  utilities: "utilities",
  laundry: "laundry",
  for_rent_by: "for_rent_by",
  accessibility: "accessibility",
  contact_phone: "contact_phone",
  contact_email: "contact_email",
};

export function questionFieldKey(key: QuestionKey): PortalRequirementFieldKey {
  return QUESTION_FIELD[key];
}

/**
 * Questions the sheet requires for a channel beyond the requirement table.
 * postal_code: Kijiji places the ad by postal code (spec 4.1: "asked only when
 * kijiji is selected"; acceptance 1). Not in PORTAL_REQUIREMENTS yet because
 * the property page's packet facts do not carry that key until the page half
 * of Slice 2 derives them from this builder; adding it there first would show
 * "missing postal code" on every property page.
 */
export const SHEET_ONLY_REQUIRED: Readonly<
  Partial<Record<PortalRequirementChannelKey, readonly PortalRequirementFieldKey[]>>
> = {
  kijiji: ["postal_code"],
};

const ORG_SCOPE_KEYS: ReadonlySet<QuestionKey> = new Set<QuestionKey>([
  "for_rent_by",
  "contact_phone",
  "contact_email",
]);

const LABELS: Record<QuestionKey, string> = {
  rent: "Monthly rent",
  beds: "Bedrooms",
  baths: "Bathrooms",
  sqft: "Square footage",
  available_date: "Available from",
  unit_type: "Property type",
  postal_code: "Postal code",
  description: "Description",
  photos: "Photos",
  furnished: "Furnished",
  lease_term: "Lease term",
  pets: "Pets",
  air_conditioning: "Air conditioning",
  smoking: "Smoking",
  parking: "Parking",
  utilities: "Utilities included",
  laundry: "Laundry",
  for_rent_by: "Listed by",
  accessibility: "Wheelchair accessible",
  contact_phone: "Contact phone",
  contact_email: "Contact email",
};

const HELP: Partial<Record<QuestionKey, string>> = {
  sqft: "Kijiji and Zumper will not accept the ad without it.",
  postal_code: "Kijiji places the ad by postal code.",
  description: `At least ${MIN_DESCRIPTION_CHARS} characters.`,
  available_date: "Zumper and Rentals.ca need a move-in date.",
  pets: "Rentals.ca defaults this to Yes; we never guess it.",
  for_rent_by: "Owner, or a professional such as a property manager or agent. Applies to all your listings.",
  contact_phone: "Applies to all your listings.",
  contact_email: "Applies to all your listings.",
};

/** What the worker posts today when the record is null (compose.ts, SPEC-S688 Slice 2 section 3). */
export const GUESSED_DEFAULTS: Partial<Record<QuestionKey, string>> = {
  furnished: "Unfurnished",
  lease_term: "1-year lease",
  pets: "No pets",
  air_conditioning: "No",
  smoking: "Non-smoking",
  parking: "No parking",
  unit_type: "Apartment",
  for_rent_by: "Owner",
  utilities: "None included",
  laundry: "Not listed",
  available_date: "Today",
  accessibility: "No",
};

// --- Option lists (from property-features, labelled) --------------------------

function labelled(
  values: readonly string[],
  label: (value: unknown) => string | null,
): QuestionOption[] {
  return values.map((value) => ({ value, label: label(value) ?? value }));
}

export const UNIT_TYPE_QUESTION_OPTIONS: readonly QuestionOption[] = labelled(
  UNIT_TYPE_OPTIONS,
  unitTypeLabel,
);
export const LEASE_TERM_QUESTION_OPTIONS: readonly QuestionOption[] = labelled(
  LEASE_TERM_OPTIONS,
  leaseTermLabel,
);
export const SMOKING_QUESTION_OPTIONS: readonly QuestionOption[] = labelled(
  SMOKING_OPTIONS,
  smokingLabel,
);
export const LAUNDRY_QUESTION_OPTIONS: readonly QuestionOption[] = labelled(
  LAUNDRY_OPTIONS,
  laundryLabel,
);
export const FOR_RENT_BY_QUESTION_OPTIONS: readonly QuestionOption[] = labelled(
  FOR_RENT_BY_OPTIONS,
  forRentByLabel,
);
export const DOG_SIZE_QUESTION_OPTIONS: readonly QuestionOption[] = labelled(
  DOG_SIZE_OPTIONS,
  dogSizeLabel,
);
export const PARKING_TYPE_QUESTION_OPTIONS: readonly QuestionOption[] =
  PARKING_TYPE_OPTIONS.map((value) => ({
    value,
    label: PARKING_TYPE_LABELS[value],
  }));
export const UTILITY_QUESTION_OPTIONS: readonly QuestionOption[] = [
  { value: "heat", label: "Heat" },
  { value: "hydro", label: "Hydro" },
  { value: "water", label: "Water" },
  { value: "internet", label: "Internet" },
  { value: "cable", label: "Cable" },
];

// --- Small helpers ----------------------------------------------------------

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(y, month - 1, day));
  return d.getUTCFullYear() === y && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function positive(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Uppercase, one space in the middle: "m5v3l9" -> "M5V 3L9". Null when it is not a postal code. */
export function normalizePostalCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) return null;
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

export type InferredParking = {
  parking_type: ParkingType | null;
  parking_count: number | null;
};

const PARKING_WORD_COUNTS: Record<string, number> = {
  one: 1,
  single: 1,
  two: 2,
  double: 2,
  three: 3,
  four: 4,
};

/**
 * Best-effort read of the free-text `parking` field so the sheet can prefill
 * the structured pair; the landlord confirms. Mirrors the worker's
 * rentalsCaParkingType / parseParkingSpots regex families (spec 5).
 * Null when the text is blank or says nothing recognisable.
 */
export function inferParking(text: string | null | undefined): InferredParking | null {
  if (!hasText(text)) return null;
  const t = text.trim().toLowerCase();
  if (
    /\b(no|none|without|not?)\b[^.]*\bparking\b|\bparking\b[^.]*\b(not included|not available|none|unavailable)\b|^none$|^n\/a$/.test(
      t,
    )
  ) {
    return { parking_type: "none", parking_count: null };
  }
  let count: number | null = null;
  // A count is a small whole number not attached to money ("$50", "50/month",
  // "25%"). Anything above 10 is a price or a unit number, not spaces.
  const digit = /(?<![$\d.])\b(\d{1,2})\b(?![\d.]*\s*(?:\/|%|k\b|\$))/.exec(t);
  if (digit && Number(digit[1]) <= 10 && Number(digit[1]) > 0) {
    count = Number(digit[1]);
  } else {
    const word = /\b(one|single|two|double|three|four)\b/.exec(t);
    if (word) count = PARKING_WORD_COUNTS[word[1]] ?? null;
  }
  let type: ParkingType | null = null;
  if (/\bunderground\b/.test(t)) type = "underground";
  else if (/\bgarage\b/.test(t)) type = "garage";
  else if (/\b(covered|carport)\b/.test(t)) type = "covered";
  else if (/\bev\b|\belectric vehicle\b|\bcharg/.test(t)) type = "ev_charging";
  else if (/\bstreet\b/.test(t)) type = "street";
  else if (/\b(driveway|outdoor|surface|outside|lot|open)\b/.test(t)) type = "outdoor";
  if (type == null && count == null) {
    // "parking available" / "1 spot" style text with no type word: only a count
    // when there is one, otherwise nothing to prefill.
    return null;
  }
  if (type != null && count == null) count = 1;
  return { parking_type: type, parking_count: count };
}

// --- "Does the record hold it", one rule per key (spec 4.1 table) -------------

export type QuestionContext = {
  p: PropertyForSheet;
  org: OrgForSheet;
  eff: UnitFeatures;
  photoCount: number;
  minPhotos: number;
  answered: ReadonlySet<QuestionKey>;
  /** Selected channels that ask accessibility (askedDefaults); completion counts only when all are recorded. */
  accessibilityAskedBy: readonly PortalRequirementChannelKey[];
};
type Ctx = QuestionContext;

function effLeaseTerm(ctx: Ctx): unknown {
  return ctx.eff.lease_term ?? ctx.p.lease_term;
}
function effSmoking(ctx: Ctx): unknown {
  return ctx.eff.smoking ?? ctx.p.smoking;
}
function effPetsCats(ctx: Ctx): boolean | null {
  return ctx.eff.pets_cats ?? ctx.p.pets_cats ?? null;
}
function effPetsDogs(ctx: Ctx): boolean | null {
  return ctx.eff.pets_dogs ?? ctx.p.pets_dogs ?? null;
}
function effUtility(
  ctx: Ctx,
  key: "heat_included" | "hydro_included" | "water_included" | "internet_included" | "cable_included",
): boolean | null {
  return ctx.eff[key] ?? ctx.p[key] ?? null;
}
function amenitiesHave(ctx: Ctx, key: string): boolean {
  return Array.isArray(ctx.p.amenities) && ctx.p.amenities.includes(key);
}
function contactEmail(ctx: Ctx): string | null {
  return hasText(ctx.org.public_contact_email)
    ? ctx.org.public_contact_email
    : hasText(ctx.org.reply_to_email)
      ? ctx.org.reply_to_email
      : null;
}

const HELD: Record<QuestionKey, (ctx: Ctx) => boolean> = {
  rent: (c) => positive(c.p.rent_cents),
  beds: (c) => c.p.beds != null,
  baths: (c) => c.p.baths != null,
  sqft: (c) => positive(c.p.sqft),
  available_date: (c) => isIsoDate(c.p.available_date),
  unit_type: (c) => isUnitType(c.p.unit_type),
  postal_code: (c) => normalizePostalCode(c.p.postal_code) != null,
  description: (c) => typeof c.p.description === "string" && c.p.description.trim().length >= MIN_DESCRIPTION_CHARS,
  photos: (c) => c.photoCount >= c.minPhotos,
  furnished: (c) => c.p.furnished != null,
  air_conditioning: (c) => c.p.air_conditioning != null,
  lease_term: (c) => isLeaseTerm(effLeaseTerm(c)),
  pets: (c) => effPetsCats(c) != null && effPetsDogs(c) != null,
  smoking: (c) => isSmoking(effSmoking(c)),
  parking: (c) =>
    isParkingType(c.p.parking_type) &&
    (c.p.parking_type === "none" || c.p.parking_count != null),
  utilities: (c) =>
    effUtility(c, "heat_included") != null &&
    effUtility(c, "hydro_included") != null &&
    effUtility(c, "water_included") != null,
  laundry: (c) => isLaundry(c.p.laundry),
  for_rent_by: (c) => isForRentBy(c.org.for_rent_by),
  accessibility: (c) => {
    if (amenitiesHave(c, WHEELCHAIR_AMENITY_KEY)) return true;
    if (c.p.question_sheet_completed_at == null) return false;
    const recorded = new Set(c.p.question_sheet_channels ?? []);
    return c.accessibilityAskedBy.every((channel) => recorded.has(channel));
  },
  contact_phone: (c) => hasText(c.org.public_contact_phone),
  contact_email: (c) => contactEmail(c) != null,
};

export function questionHeld(key: QuestionKey, ctx: Ctx): boolean {
  if (ctx.answered.has(key)) return true;
  return HELD[key](ctx);
}

// --- Inputs and prefill -----------------------------------------------------

function inputFor(key: QuestionKey, ctx: Ctx): QuestionInput {
  switch (key) {
    case "rent":
      return { kind: "money" };
    case "beds":
      return { kind: "integer", min: 0, max: BEDS_MAX };
    case "baths":
      return { kind: "decimal_half" };
    case "sqft":
      return { kind: "integer", min: SQFT_MIN, max: SQFT_MAX };
    case "available_date":
      return { kind: "date", minToday: true };
    case "unit_type":
      return { kind: "select", options: UNIT_TYPE_QUESTION_OPTIONS };
    case "postal_code":
      return { kind: "text", maxLength: POSTAL_CODE_MAX_LENGTH };
    case "description":
      return { kind: "textarea", minLength: MIN_DESCRIPTION_CHARS };
    case "photos":
      return { kind: "photos", min: ctx.minPhotos, current: ctx.photoCount };
    case "furnished":
    case "air_conditioning":
    case "accessibility":
      return { kind: "tri_state" };
    case "lease_term":
      return { kind: "select", options: LEASE_TERM_QUESTION_OPTIONS };
    case "pets":
      return { kind: "pets", dogSizes: DOG_SIZE_QUESTION_OPTIONS };
    case "smoking":
      return { kind: "select", options: SMOKING_QUESTION_OPTIONS };
    case "parking":
      return { kind: "parking", types: PARKING_TYPE_QUESTION_OPTIONS };
    case "utilities":
      return { kind: "multi", options: UTILITY_QUESTION_OPTIONS };
    case "laundry":
      return { kind: "select", options: LAUNDRY_QUESTION_OPTIONS };
    case "for_rent_by":
      return { kind: "select", options: FOR_RENT_BY_QUESTION_OPTIONS };
    case "contact_phone":
      return { kind: "org_text", field: "public_contact_phone" };
    case "contact_email":
      return { kind: "org_text", field: "public_contact_email" };
  }
}

function currentFor(key: QuestionKey, ctx: Ctx): unknown {
  const p = ctx.p;
  switch (key) {
    case "rent":
      return positive(p.rent_cents) ? p.rent_cents : null;
    case "beds":
      return p.beds;
    case "baths":
      return p.baths;
    case "sqft":
      return positive(p.sqft) ? p.sqft : null;
    case "available_date":
      return isIsoDate(p.available_date) ? p.available_date.trim().slice(0, 10) : null;
    case "unit_type":
      return isUnitType(p.unit_type) ? p.unit_type : null;
    case "postal_code":
      return normalizePostalCode(p.postal_code);
    case "description":
      return hasText(p.description) ? p.description : null;
    case "photos":
      return ctx.photoCount;
    case "furnished":
      return p.furnished;
    case "air_conditioning":
      return p.air_conditioning;
    case "accessibility":
      return amenitiesHave(ctx, WHEELCHAIR_AMENITY_KEY)
        ? true
        : HELD.accessibility(ctx)
          ? false
          : null;
    case "lease_term": {
      const v = effLeaseTerm(ctx);
      return isLeaseTerm(v) ? v : null;
    }
    case "pets":
      return {
        cats: effPetsCats(ctx),
        dogs: effPetsDogs(ctx),
        dog_size: ctx.eff.pets_dog_size ?? p.pets_dog_size ?? null,
        notes: hasText(p.pets_notes) ? p.pets_notes : null,
      };
    case "smoking": {
      const v = effSmoking(ctx);
      return isSmoking(v) ? v : null;
    }
    case "parking": {
      if (isParkingType(p.parking_type)) {
        return {
          parking_type: p.parking_type,
          parking_count: p.parking_count,
          inferred: false,
        };
      }
      const inferred = inferParking(p.parking);
      return inferred ? { ...inferred, inferred: true } : null;
    }
    case "utilities":
      return {
        heat: effUtility(ctx, "heat_included"),
        hydro: effUtility(ctx, "hydro_included"),
        water: effUtility(ctx, "water_included"),
        internet: effUtility(ctx, "internet_included"),
        cable: effUtility(ctx, "cable_included"),
      };
    case "laundry":
      return isLaundry(p.laundry) ? p.laundry : null;
    case "for_rent_by":
      return isForRentBy(ctx.org.for_rent_by) ? ctx.org.for_rent_by : null;
    case "contact_phone":
      return hasText(ctx.org.public_contact_phone) ? ctx.org.public_contact_phone : null;
    case "contact_email":
      return contactEmail(ctx);
  }
}

function photosHelp(
  min: number,
  current: number,
  channels: readonly PortalRequirementChannelKey[],
): string {
  if (min <= 1) return "At least one photo.";
  const names = channels
    .filter((channel) => MIN_PHOTOS_BY_CHANNEL[channel] === min)
    .map((channel) => requirementRow(channel)?.label ?? channel);
  const who = names.length > 0 ? names.join(" and ") : "One of your sites";
  return `${Math.min(current, min)} of ${min} photos. ${who} needs at least ${min}.`;
}

// --- The builder -------------------------------------------------------------

const TIER_ORDER: Record<QuestionTier, number> = {
  required: 0,
  answer_once: 1,
  recommended: 2,
};

function requirementRow(channel: string): PortalRequirements | null {
  return PORTAL_REQUIREMENTS.find((row) => row.channel === channel) ?? null;
}

export function buildQuestionSheet(input: QuestionSheetInput): QuestionSheet {
  const rows: PortalRequirements[] = [];
  const channels: PortalRequirementChannelKey[] = [];
  const ignoredChannels: string[] = [];
  for (const channel of input.channels) {
    if (channels.includes(channel as PortalRequirementChannelKey)) continue;
    const row = requirementRow(channel);
    if (row) {
      rows.push(row);
      channels.push(row.channel);
    } else if (!ignoredChannels.includes(String(channel))) {
      ignoredChannels.push(String(channel));
    }
  }

  // Which selected channels list each field, per level.
  const requiredBy = new Map<PortalRequirementFieldKey, PortalRequirementChannelKey[]>();
  const askedBy = new Map<PortalRequirementFieldKey, PortalRequirementChannelKey[]>();
  const recommendedBy = new Map<PortalRequirementFieldKey, PortalRequirementChannelKey[]>();
  const push = (
    map: Map<PortalRequirementFieldKey, PortalRequirementChannelKey[]>,
    field: PortalRequirementFieldKey,
    channel: PortalRequirementChannelKey,
  ) => {
    const list = map.get(field) ?? [];
    if (!list.includes(channel)) list.push(channel);
    map.set(field, list);
  };
  for (const row of rows) {
    for (const field of requiredQuestionFieldsFor(row)) push(requiredBy, field, row.channel);
    for (const field of SHEET_ONLY_REQUIRED[row.channel] ?? []) push(requiredBy, field, row.channel);
    for (const field of row.askedDefaults) push(askedBy, field, row.channel);
    for (const field of row.recommended) push(recommendedBy, field, row.channel);
  }

  const minPhotos = minPhotosForChannels(channels);
  const ctx: Ctx = {
    p: input.property,
    org: input.org,
    eff: input.effectiveFeatures ?? {},
    photoCount: Math.max(0, Math.floor(input.photoCount || 0)),
    minPhotos,
    answered: new Set(input.answeredKeys ?? []),
    accessibilityAskedBy: askedBy.get("accessibility") ?? [],
  };

  const questions: SheetQuestion[] = [];
  for (const key of QUESTION_KEYS) {
    const field = QUESTION_FIELD[key];
    const tier: QuestionTier | null = requiredBy.has(field)
      ? "required"
      : askedBy.has(field)
        ? "answer_once"
        : recommendedBy.has(field)
          ? "recommended"
          : null;
    if (tier == null) continue;
    if (questionHeld(key, ctx)) continue;
    // Every selected channel that names the field, in selection order.
    const listedBy = new Set<PortalRequirementChannelKey>([
      ...(requiredBy.get(field) ?? []),
      ...(askedBy.get(field) ?? []),
      ...(recommendedBy.get(field) ?? []),
    ]);
    const neededBy = channels.filter((channel) => listedBy.has(channel));

    const inputSpec = inputFor(key, ctx);
    questions.push({
      key,
      field,
      label: LABELS[key],
      help:
        key === "photos"
          ? photosHelp(minPhotos, ctx.photoCount, channels)
          : (HELP[key] ?? null),
      neededBy,
      tier,
      input: inputSpec,
      current: currentFor(key, ctx),
      scope: ORG_SCOPE_KEYS.has(key) ? "organization" : "property",
      readOnly: ORG_SCOPE_KEYS.has(key) && !input.callerCanEditOrg,
      guessedDefault: tier === "answer_once" ? (GUESSED_DEFAULTS[key] ?? null) : null,
    });
  }

  questions.sort((a, b) => {
    const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tierDiff !== 0) return tierDiff;
    if (b.neededBy.length !== a.neededBy.length) return b.neededBy.length - a.neededBy.length;
    return a.label.localeCompare(b.label);
  });

  const requiredQuestions = questions.filter((q) => q.tier === "required");
  const requiredRemaining = requiredQuestions.length;
  const sheetOnly = new Set<PortalRequirementFieldKey>(
    channels.flatMap((channel) => SHEET_ONLY_REQUIRED[channel] ?? []),
  );
  const requiredFieldsRemaining = new Set(
    requiredQuestions
      .map((q) => q.field)
      .filter((field) => !sheetOnly.has(field) || rows.some((row) => requiredQuestionFieldsFor(row).includes(field))),
  ).size;
  const answerOnceRemaining = questions.filter((q) => q.tier === "answer_once").length;
  const recommendedRemaining = questions.filter((q) => q.tier === "recommended").length;
  const answersComplete = requiredRemaining === 0 && answerOnceRemaining === 0;

  const recorded = new Set(input.property.question_sheet_channels ?? []);
  const channelsNotYetCompleted = channels.filter((channel) => !recorded.has(channel));

  return {
    propertyId: input.property.id,
    channels,
    ignoredChannels,
    questions,
    requiredRemaining,
    requiredFieldsRemaining,
    answerOnceRemaining,
    recommendedRemaining,
    answersComplete,
    complete: answersComplete && channelsNotYetCompleted.length === 0,
    channelsNotYetCompleted,
    minPhotos,
  };
}

// --- Packet-card facts from the same rules (one source of truth) -------------

/**
 * The ListingPacketFieldFacts entries this sheet can answer, derived from the
 * same held-rules as the sheet. The property page spreads these over the facts
 * it computes for keys the sheet does not cover (title, address, amenities,
 * virtual_tour, post_caption, tracked_link).
 */
export function questionSheetFieldFacts(
  input: Omit<QuestionSheetInput, "callerCanEditOrg" | "answeredKeys"> & {
    callerCanEditOrg?: boolean;
  },
): ListingPacketFieldFacts {
  const rows = input.channels
    .map((channel) => requirementRow(channel))
    .filter((row): row is PortalRequirements => row != null);
  const channels = rows.map((row) => row.channel);
  const ctx: Ctx = {
    p: input.property,
    org: input.org,
    eff: input.effectiveFeatures ?? {},
    photoCount: Math.max(0, Math.floor(input.photoCount || 0)),
    minPhotos: minPhotosForChannels(channels),
    answered: new Set(),
    accessibilityAskedBy: rows
      .filter((row) => row.askedDefaults.includes("accessibility"))
      .map((row) => row.channel),
  };
  const held = (key: QuestionKey) => HELD[key](ctx);
  return {
    rent: held("rent"),
    beds_baths: held("beds") && held("baths"),
    square_footage: held("sqft"),
    availability_date: held("available_date"),
    property_type: held("unit_type"),
    postal_code: held("postal_code"),
    description: held("description"),
    photos: held("photos"),
    furnished: held("furnished"),
    lease_term: held("lease_term"),
    pets: held("pets"),
    air_conditioning: held("air_conditioning"),
    smoking: held("smoking"),
    parking: held("parking"),
    utilities: held("utilities"),
    laundry: held("laundry"),
    for_rent_by: held("for_rent_by"),
    accessibility: held("accessibility"),
    contact_phone: held("contact_phone"),
    contact_email: held("contact_email"),
  };
}
