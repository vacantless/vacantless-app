// ============================================================================
// question-sheet-save - the PURE half of `saveQuestionSheet` (SPEC-S688 Slice 2
// sections 4.2 and 4.4, S692). Turns the submitted sheet form into
//
//   - a `properties` patch (only the questions the sheet showed, only the ones
//     the landlord answered; a blank control is "skip", never "clear"),
//   - an `organizations` patch (contact fields + for_rent_by, decision 5),
//   - the keys written (so the rebuilt sheet counts them as held, deviation 2
//     in question-sheet.ts),
//   - the list of org-scope fields skipped because the caller cannot manage
//     settings (decision 6: no error, no partial failure),
//   - field errors for values that were given but unusable,
//
// and, on the rebuilt sheet reporting `answersComplete`, the STAMP: the
// completion timestamp, the union of channels, and the MIRROR of effective
// (building/org-inherited) values onto `properties.*` (spec 4.4 rule 1) so the
// worker, which reads raw columns, sees what the sheet saw.
//
// Nothing here touches the database. The server action in
// app/dashboard/properties/actions.ts loads, calls, writes, revalidates.
// ============================================================================

import {
  BEDS_MAX,
  POSTAL_CODE_RE,
  SQFT_MAX,
  SQFT_MIN,
  WHEELCHAIR_AMENITY_KEY,
  buildQuestionSheet,
  normalizePostalCode,
  type PropertyForSheet,
  type QuestionKey,
  type QuestionSheet,
  type QuestionSheetInput,
} from "./question-sheet";
import { MIN_DESCRIPTION_CHARS } from "./listing-feed";
import {
  derivePetFriendly,
  formatParking,
  isDogSize,
  isForRentBy,
  isLaundry,
  isLeaseTerm,
  isParkingType,
  isSmoking,
  isUnitType,
  type UnitFeatures,
} from "./property-features";

/** One submitted value per form field; multi-valued fields carry every value. */
export type SheetFormValues = Record<string, string | string[]>;

/** The `properties` columns the sheet can write. */
export type PropertySheetPatch = Partial<{
  rent_cents: number;
  beds: number;
  baths: number;
  sqft: number;
  available_date: string;
  unit_type: string;
  postal_code: string;
  description: string;
  furnished: boolean;
  air_conditioning: boolean;
  lease_term: string;
  smoking: string;
  laundry: string;
  pets_cats: boolean;
  pets_dogs: boolean;
  pets_dog_size: string | null;
  pets_notes: string | null;
  pet_friendly: boolean;
  parking_type: string;
  parking_count: number | null;
  parking: string | null;
  heat_included: boolean;
  hydro_included: boolean;
  water_included: boolean;
  internet_included: boolean;
  cable_included: boolean;
  amenities: string[] | null;
  for_rent_by: string;
  question_sheet_completed_at: string;
  question_sheet_channels: string[];
}>;

export type OrgSheetPatch = Partial<{
  public_contact_phone: string;
  public_contact_email: string;
  for_rent_by: string;
}>;

export type SheetFieldError = { key: QuestionKey; message: string };

export type ApplyQuestionSheetResult = {
  propertyPatch: PropertySheetPatch;
  orgPatch: OrgSheetPatch;
  /** Questions written by this submit (property or org scope). */
  answeredKeys: QuestionKey[];
  /** Org-scope questions the caller submitted but cannot write (decision 6). */
  skippedOrgFields: QuestionKey[];
  errors: SheetFieldError[];
  /** True when the rebuilt sheet reports answersComplete and the stamp was added to propertyPatch. */
  stamped: boolean;
  /** Effective values copied onto the property by the stamp (spec 4.4 rule 1). */
  mirroredFields: string[];
  /** The sheet as it will read after this write (answered keys held). */
  rebuilt: QuestionSheet;
};

// --- Form parsing helpers ---------------------------------------------------

function one(values: SheetFormValues, name: string): string | null {
  const v = values[name];
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

/** "true" | "false" -> boolean; anything else (incl. blank) -> null = not answered. */
export function parseTriState(raw: string | null): boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/** Dollars (with optional $ , and cents) -> integer cents; null when blank or not a positive number. */
export function parseMoneyToCents(raw: string | null): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Math.round(Number(cleaned) * 100);
  return n > 0 ? n : null;
}

function parseInteger(raw: string | null, min: number, max: number): number | null {
  if (raw == null || !/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

function parseHalfSteps(raw: string | null): number | null {
  if (raw == null || !/^\d+(\.5|\.0)?$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 0 && n <= 20 ? n : null;
}

function parseIsoDate(raw: string | null): string | null {
  if (raw == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
    ? raw
    : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Turn a FormData into the plain shape the pure layer reads. Kept here so the
 * action and the tests share one reading of "multi" fields (getAll).
 */
export function sheetFormValuesFromFormData(formData: FormData): SheetFormValues {
  const out: SheetFormValues = {};
  const keys = new Set<string>();
  formData.forEach((_value, key) => keys.add(key));
  for (const key of keys) {
    const all = formData
      .getAll(key)
      .filter((v): v is string => typeof v === "string");
    out[key] = all.length === 1 ? all[0] : all;
  }
  return out;
}

// --- The mirror (spec 4.4 rule 1) -------------------------------------------

const MIRROR_FIELDS = [
  "lease_term",
  "smoking",
  "pets_cats",
  "pets_dogs",
  "pets_dog_size",
  "heat_included",
  "hydro_included",
  "water_included",
  "internet_included",
  "cable_included",
] as const;
type MirrorField = (typeof MIRROR_FIELDS)[number];

/**
 * Every effective value whose property column is null (and which this submit
 * did not just write) is copied onto the property. Returns the fields copied.
 */
export function mirrorEffectiveValues(
  property: PropertyForSheet,
  effective: UnitFeatures,
  patch: PropertySheetPatch,
): string[] {
  const copied: string[] = [];
  for (const field of MIRROR_FIELDS) {
    if (field in patch) continue;
    const raw = (property as Record<string, unknown>)[field];
    if (raw != null) continue;
    const eff = (effective as Record<string, unknown>)[field];
    if (eff == null) continue;
    if (field === "lease_term" && !isLeaseTerm(eff)) continue;
    if (field === "smoking" && !isSmoking(eff)) continue;
    if (field === "pets_dog_size" && !isDogSize(eff)) continue;
    if (
      (field === "pets_cats" ||
        field === "pets_dogs" ||
        field === "heat_included" ||
        field === "hydro_included" ||
        field === "water_included" ||
        field === "internet_included" ||
        field === "cable_included") &&
      typeof eff !== "boolean"
    ) {
      continue;
    }
    (patch as Record<MirrorField, unknown>)[field] = eff;
    copied.push(field);
  }
  if (
    ("pets_cats" in patch || "pets_dogs" in patch) &&
    !("pet_friendly" in patch)
  ) {
    patch.pet_friendly = derivePetFriendly({
      pets_cats: patch.pets_cats ?? property.pets_cats,
      pets_dogs: patch.pets_dogs ?? property.pets_dogs,
    });
  }
  return copied;
}

// --- The apply --------------------------------------------------------------

export type ApplyQuestionSheetInput = {
  /** The sheet as rendered (built from the same record this form was filled against). */
  sheet: QuestionSheet;
  /** Everything buildQuestionSheet needs, to rebuild after the write. */
  sheetInput: QuestionSheetInput;
  values: SheetFormValues;
  /** Injected so tests are deterministic; the action passes new Date(). */
  now: Date;
  /** properties.for_rent_by as stored, so the org value is mirrored on every save (decision 5). */
  propertyForRentBy?: string | null;
};

export function applyQuestionSheetAnswers(input: ApplyQuestionSheetInput): ApplyQuestionSheetResult {
  const { sheet, values } = input;
  const property = input.sheetInput.property;
  const canEditOrg = input.sheetInput.callerCanEditOrg;
  const propertyPatch: PropertySheetPatch = {};
  const orgPatch: OrgSheetPatch = {};
  const answeredKeys: QuestionKey[] = [];
  const skippedOrgFields: QuestionKey[] = [];
  const errors: SheetFieldError[] = [];

  const answered = (key: QuestionKey) => {
    if (!answeredKeys.includes(key)) answeredKeys.push(key);
  };
  const fail = (key: QuestionKey, message: string) => errors.push({ key, message });

  for (const q of sheet.questions) {
    const key = q.key;
    if (q.scope === "organization" && !canEditOrg) {
      // Read-only on screen; anything submitted for it is ignored, reported.
      const touched =
        key === "for_rent_by"
          ? one(values, "for_rent_by") != null
          : key === "contact_phone"
            ? one(values, "contact_phone") != null
            : key === "contact_email"
              ? one(values, "contact_email") != null
              : false;
      if (touched) skippedOrgFields.push(key);
      continue;
    }
    switch (key) {
      case "rent": {
        const raw = one(values, "rent");
        if (raw == null) break;
        const cents = parseMoneyToCents(raw);
        if (cents == null) fail(key, "Enter the monthly rent in dollars, for example 1,250.");
        else {
          propertyPatch.rent_cents = cents;
          answered(key);
        }
        break;
      }
      case "beds": {
        const raw = one(values, "beds");
        if (raw == null) break;
        const n = parseInteger(raw, 0, BEDS_MAX);
        if (n == null) fail(key, `Bedrooms must be a whole number from 0 to ${BEDS_MAX}.`);
        else {
          propertyPatch.beds = n;
          answered(key);
        }
        break;
      }
      case "baths": {
        const raw = one(values, "baths");
        if (raw == null) break;
        const n = parseHalfSteps(raw);
        if (n == null) fail(key, "Bathrooms must be a number in half steps, for example 1.5.");
        else {
          propertyPatch.baths = n;
          answered(key);
        }
        break;
      }
      case "sqft": {
        const raw = one(values, "sqft");
        if (raw == null) break;
        const n = parseInteger(raw.replace(/[,\s]/g, ""), SQFT_MIN, SQFT_MAX);
        if (n == null) fail(key, `Square footage must be a whole number from ${SQFT_MIN} to ${SQFT_MAX}.`);
        else {
          propertyPatch.sqft = n;
          answered(key);
        }
        break;
      }
      case "available_date": {
        const raw = one(values, "available_date");
        if (raw == null) break;
        const d = parseIsoDate(raw);
        if (d == null) fail(key, "Pick a date.");
        else {
          propertyPatch.available_date = d;
          answered(key);
        }
        break;
      }
      case "unit_type": {
        const raw = one(values, "unit_type");
        if (raw == null) break;
        if (!isUnitType(raw)) fail(key, "Pick a property type from the list.");
        else {
          propertyPatch.unit_type = raw;
          answered(key);
        }
        break;
      }
      case "postal_code": {
        const raw = one(values, "postal_code");
        if (raw == null) break;
        const normalized = normalizePostalCode(raw);
        if (normalized == null || !POSTAL_CODE_RE.test(normalized)) {
          fail(key, "Enter a Canadian postal code, for example M6G 2V7.");
        } else {
          propertyPatch.postal_code = normalized;
          answered(key);
        }
        break;
      }
      case "description": {
        const raw = one(values, "description");
        if (raw == null) break;
        if (raw.length < MIN_DESCRIPTION_CHARS) {
          fail(key, `Write at least ${MIN_DESCRIPTION_CHARS} characters so the sites accept the ad.`);
        } else {
          propertyPatch.description = raw;
          answered(key);
        }
        break;
      }
      case "photos":
        // Not a form field: photos are added on the property page.
        break;
      case "furnished": {
        const v = parseTriState(one(values, "furnished"));
        if (v == null) break;
        propertyPatch.furnished = v;
        answered(key);
        break;
      }
      case "air_conditioning": {
        const v = parseTriState(one(values, "air_conditioning"));
        if (v == null) break;
        propertyPatch.air_conditioning = v;
        answered(key);
        break;
      }
      case "accessibility": {
        const v = parseTriState(one(values, "accessibility"));
        if (v == null) break;
        const current = Array.isArray(property.amenities) ? [...property.amenities] : [];
        const without = current.filter((a) => a !== WHEELCHAIR_AMENITY_KEY);
        const next = v ? [...without, WHEELCHAIR_AMENITY_KEY] : without;
        propertyPatch.amenities = next.length > 0 ? next : null;
        answered(key);
        break;
      }
      case "lease_term": {
        const raw = one(values, "lease_term");
        if (raw == null) break;
        if (!isLeaseTerm(raw)) fail(key, "Pick a lease term from the list.");
        else {
          propertyPatch.lease_term = raw;
          answered(key);
        }
        break;
      }
      case "smoking": {
        const raw = one(values, "smoking");
        if (raw == null) break;
        if (!isSmoking(raw)) fail(key, "Pick a smoking rule from the list.");
        else {
          propertyPatch.smoking = raw;
          answered(key);
        }
        break;
      }
      case "laundry": {
        const raw = one(values, "laundry");
        if (raw == null) break;
        if (!isLaundry(raw)) fail(key, "Pick a laundry option from the list.");
        else {
          propertyPatch.laundry = raw;
          answered(key);
        }
        break;
      }
      case "pets": {
        const cats = parseTriState(one(values, "pets_cats"));
        const dogs = parseTriState(one(values, "pets_dogs"));
        if (cats == null && dogs == null) break;
        if (cats == null || dogs == null) {
          fail(key, "Answer both: cats and dogs.");
          break;
        }
        propertyPatch.pets_cats = cats;
        propertyPatch.pets_dogs = dogs;
        propertyPatch.pet_friendly = derivePetFriendly({ pets_cats: cats, pets_dogs: dogs });
        const size = one(values, "pets_dog_size");
        if (dogs && size != null) {
          if (!isDogSize(size)) {
            fail(key, "Pick a dog size from the list.");
            break;
          }
          propertyPatch.pets_dog_size = size;
        } else if (!dogs) {
          propertyPatch.pets_dog_size = null;
        }
        // Blank notes are a skip, like every other blank control (reviewer P3).
        const notes = one(values, "pets_notes");
        if (notes != null) propertyPatch.pets_notes = notes;
        answered(key);
        break;
      }
      case "parking": {
        const type = one(values, "parking_type");
        if (type == null) break;
        if (!isParkingType(type)) {
          fail(key, "Pick a parking type from the list.");
          break;
        }
        if (type === "none") {
          propertyPatch.parking_type = "none";
          propertyPatch.parking_count = null;
        } else {
          const count = parseInteger(one(values, "parking_count"), 1, 20);
          if (count == null) {
            fail(key, "How many spaces? Enter a whole number from 1 to 20.");
            break;
          }
          propertyPatch.parking_type = type;
          propertyPatch.parking_count = count;
        }
        propertyPatch.parking = formatParking(
          propertyPatch.parking_type,
          propertyPatch.parking_count,
          null,
        );
        answered(key);
        break;
      }
      case "utilities": {
        // Five tri-states (reviewer P1, S692): a checkbox group cannot say
        // "untouched", so every utility is its own Yes / No / blank select.
        // Heat, hydro and water are the answer (all three or none); internet
        // and cable are optional extras written only when given.
        const heat = parseTriState(one(values, "utilities_heat"));
        const hydro = parseTriState(one(values, "utilities_hydro"));
        const water = parseTriState(one(values, "utilities_water"));
        const internet = parseTriState(one(values, "utilities_internet"));
        const cable = parseTriState(one(values, "utilities_cable"));
        if (internet != null) propertyPatch.internet_included = internet;
        if (cable != null) propertyPatch.cable_included = cable;
        if (heat == null && hydro == null && water == null) break;
        if (heat == null || hydro == null || water == null) {
          fail(key, "Answer all three: heat, hydro and water.");
          break;
        }
        propertyPatch.heat_included = heat;
        propertyPatch.hydro_included = hydro;
        propertyPatch.water_included = water;
        answered(key);
        break;
      }
      case "for_rent_by": {
        const raw = one(values, "for_rent_by");
        if (raw == null) break;
        if (!isForRentBy(raw)) fail(key, "Pick who is renting it out.");
        else {
          orgPatch.for_rent_by = raw;
          // Decision 5: the worker keeps reading the property column.
          propertyPatch.for_rent_by = raw;
          answered(key);
        }
        break;
      }
      case "contact_phone": {
        const raw = one(values, "contact_phone");
        if (raw == null) break;
        if (raw.replace(/\D/g, "").length < 10) fail(key, "Enter a phone number renters can call.");
        else {
          orgPatch.public_contact_phone = raw;
          answered(key);
        }
        break;
      }
      case "contact_email": {
        const raw = one(values, "contact_email");
        if (raw == null) break;
        if (!EMAIL_RE.test(raw)) fail(key, "Enter an email address.");
        else {
          orgPatch.public_contact_email = raw.toLowerCase();
          answered(key);
        }
        break;
      }
    }
  }

  // Decision 5: on EVERY save the property column follows the org value
  // (the worker keeps reading properties.for_rent_by).
  const orgAfter = { ...input.sheetInput.org, ...orgPatch };
  if (
    !("for_rent_by" in propertyPatch) &&
    isForRentBy(orgAfter.for_rent_by) &&
    orgAfter.for_rent_by !== (input.propertyForRentBy ?? null)
  ) {
    propertyPatch.for_rent_by = orgAfter.for_rent_by;
  }
  const propertyAfter: PropertyForSheet = { ...property, ...(propertyPatch as Partial<PropertyForSheet>) };

  const rebuilt = buildQuestionSheet({
    ...input.sheetInput,
    property: propertyAfter,
    org: orgAfter,
    answeredKeys,
  });

  let stamped = false;
  let mirroredFields: string[] = [];
  if (errors.length === 0 && rebuilt.answersComplete) {
    const existing = Array.isArray(property.question_sheet_channels)
      ? property.question_sheet_channels.map(String)
      : [];
    const union = [...existing];
    for (const channel of sheet.channels) if (!union.includes(channel)) union.push(channel);
    propertyPatch.question_sheet_completed_at = input.now.toISOString();
    propertyPatch.question_sheet_channels = union;
    mirroredFields = mirrorEffectiveValues(property, input.sheetInput.effectiveFeatures, propertyPatch);
    stamped = true;
  }

  return {
    propertyPatch,
    orgPatch,
    answeredKeys,
    skippedOrgFields,
    errors,
    stamped,
    mirroredFields,
    rebuilt: stamped
      ? buildQuestionSheet({
          ...input.sheetInput,
          property: { ...propertyAfter, ...(propertyPatch as Partial<PropertyForSheet>) },
          org: orgAfter,
          answeredKeys,
        })
      : rebuilt,
  };
}
