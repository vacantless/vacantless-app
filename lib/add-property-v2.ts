import type { ChannelReadinessInput } from "./channel-readiness";
import type { ListingDraft } from "./listing-extract";
import type { DraftFacts } from "./listing-description";
import type { ParsedListing } from "./mls-import";
import { mapUnitTypeFromRaw, normalizeAmenities } from "./property-features";

export type AddPropertyV2Draft = {
  address: string;
  rent: string;
  beds: string;
  baths: string;
  unit_type: string;
  structure_type: string;
  available_date: string;
  address_display_mode: string;
  sqft: string;
  floor: string;
  furnished: boolean;
  lease_term: string;
  amenities: string[];
  parking: string;
  parking_type: string;
  parking_count: string;
  heating_type: string;
  laundry: string;
  air_conditioning: boolean;
  ac_type: string;
  balcony: boolean;
  heat_included: string;
  hydro_included: string;
  water_included: string;
  internet_included: string;
  cable_included: string;
  pets_cats: string;
  pets_dogs: string;
  pets_dog_size: string;
  pets_notes: string;
  smoking: string;
  security_deposit: string;
  income_requirement: string;
  virtual_tour_url: string;
  video_url: string;
  description: string;
};

export type AddPropertyV2ReadinessContext = {
  photoCount?: number;
  availabilityWindowCount?: number;
  replyToEmail?: string | null;
  contactPhone?: string | null;
  status?: string;
};

export const EMPTY_ADD_PROPERTY_V2_DRAFT: AddPropertyV2Draft = {
  address: "",
  rent: "",
  beds: "",
  baths: "",
  unit_type: "",
  structure_type: "",
  available_date: "",
  address_display_mode: "full",
  sqft: "",
  floor: "",
  furnished: false,
  lease_term: "",
  amenities: [],
  parking: "",
  parking_type: "",
  parking_count: "",
  heating_type: "",
  laundry: "",
  air_conditioning: false,
  ac_type: "",
  balcony: false,
  heat_included: "",
  hydro_included: "",
  water_included: "",
  internet_included: "",
  cable_included: "",
  pets_cats: "",
  pets_dogs: "",
  pets_dog_size: "",
  pets_notes: "",
  smoking: "",
  security_deposit: "",
  income_requirement: "",
  virtual_tour_url: "",
  video_url: "",
  description: "",
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function moneyInputFromCents(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) {
    return "";
  }
  return Number.isInteger(cents / 100)
    ? String(cents / 100)
    : (cents / 100).toFixed(2);
}

function numberInput(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function centsFromMoneyInput(value: string): number | null {
  const raw = cleanText(value).replace(/[$,]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function intFromInput(value: string): number | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function floatFromInput(value: string): number | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function boolSelect(value: string): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function parsedBoolSelect(
  parsedValue: boolean,
  aiValue: boolean | null | undefined,
): string {
  if (parsedValue) return "true";
  if (aiValue === true) return "true";
  if (aiValue === false) return "false";
  return "";
}

function checkboxValue(parsedValue: boolean, aiValue: boolean | null | undefined): boolean {
  return parsedValue || aiValue === true;
}

function addField(fields: string[], label: string, condition: boolean) {
  if (condition && !fields.includes(label)) fields.push(label);
}

export function addPropertyV2DraftFromListing(
  parsed: ParsedListing,
  aiDraft?: ListingDraft | null,
): { draft: AddPropertyV2Draft; filledFields: string[] } {
  const mappedUnitType = mapUnitTypeFromRaw(
    parsed.propertyType ?? aiDraft?.propertyType ?? null,
  );
  const draft: AddPropertyV2Draft = {
    ...EMPTY_ADD_PROPERTY_V2_DRAFT,
    address: parsed.address ?? "",
    rent: moneyInputFromCents(parsed.rentCents),
    beds: numberInput(parsed.beds),
    baths: numberInput(parsed.baths),
    unit_type: mappedUnitType ?? "",
    available_date: parsed.availableDate ?? "",
    sqft: numberInput(parsed.sqft),
    parking: parsed.parking ?? "",
    description: parsed.description ?? "",
    virtual_tour_url: parsed.virtualTourUrl ?? "",
    laundry: parsed.laundry ?? aiDraft?.laundry ?? "",
    furnished: checkboxValue(parsed.furnished, aiDraft?.furnished),
    air_conditioning: checkboxValue(parsed.airConditioning, aiDraft?.airConditioning),
    balcony: checkboxValue(parsed.balcony, aiDraft?.balcony),
    heat_included: parsedBoolSelect(
      parsed.heatIncluded,
      aiDraft?.heatIncluded,
    ),
    hydro_included: parsedBoolSelect(
      parsed.hydroIncluded,
      aiDraft?.hydroIncluded,
    ),
    water_included: parsedBoolSelect(
      parsed.waterIncluded,
      aiDraft?.waterIncluded,
    ),
    internet_included:
      aiDraft?.internetIncluded == null ? "" : String(aiDraft.internetIncluded),
    cable_included: aiDraft?.cableIncluded == null ? "" : String(aiDraft.cableIncluded),
    amenities: normalizeAmenities(aiDraft?.amenities ?? []),
    parking_type: aiDraft?.parkingType ?? "",
    parking_count: numberInput(aiDraft?.parkingCount),
    heating_type: aiDraft?.heatingType ?? "",
    security_deposit: moneyInputFromCents(aiDraft?.securityDepositCents),
    video_url: aiDraft?.videoUrl ?? "",
  };

  const filledFields = [...parsed.foundFields];
  addField(filledFields, "Property type", draft.unit_type !== "");
  addField(filledFields, "Internet included", draft.internet_included !== "");
  addField(filledFields, "Cable included", draft.cable_included !== "");
  addField(filledFields, "Amenities", draft.amenities.length > 0);
  addField(filledFields, "Parking type", draft.parking_type !== "");
  addField(filledFields, "Parking count", draft.parking_count !== "");
  addField(filledFields, "Heating type", draft.heating_type !== "");
  addField(filledFields, "Security deposit", draft.security_deposit !== "");
  addField(filledFields, "Video URL", draft.video_url !== "");

  return { draft, filledFields };
}

export function buildAddPropertyV2ReadinessInput(
  draft: AddPropertyV2Draft,
  context: AddPropertyV2ReadinessContext = {},
): ChannelReadinessInput {
  return {
    id: "new-property",
    status: context.status ?? "available",
    address: cleanText(draft.address) || null,
    rentCents: centsFromMoneyInput(draft.rent),
    beds: intFromInput(draft.beds),
    baths: floatFromInput(draft.baths),
    description: cleanText(draft.description) || null,
    photoCount: Math.max(0, context.photoCount ?? 0),
    availabilityWindowCount: Math.max(0, context.availabilityWindowCount ?? 0),
    replyToEmail: context.replyToEmail ?? null,
    contactPhone: context.contactPhone ?? null,
    unit_type: cleanText(draft.unit_type) || null,
    structure_type: cleanText(draft.structure_type) || null,
    available_date: cleanText(draft.available_date) || null,
    sqft: intFromInput(draft.sqft),
    floor: cleanText(draft.floor) || null,
    parking: cleanText(draft.parking) || null,
    laundry: cleanText(draft.laundry) || null,
    air_conditioning: draft.air_conditioning,
    balcony: draft.balcony,
    furnished: draft.furnished,
    pets_cats: boolSelect(draft.pets_cats),
    pets_dogs: boolSelect(draft.pets_dogs),
    pets_dog_size: cleanText(draft.pets_dog_size) || null,
    pets_notes: cleanText(draft.pets_notes) || null,
    heat_included: boolSelect(draft.heat_included),
    hydro_included: boolSelect(draft.hydro_included),
    water_included: boolSelect(draft.water_included),
    internet_included: boolSelect(draft.internet_included),
    cable_included: boolSelect(draft.cable_included),
    amenities: normalizeAmenities(draft.amenities),
    parking_type: cleanText(draft.parking_type) || null,
    parking_count: intFromInput(draft.parking_count),
    heating_type: cleanText(draft.heating_type) || null,
    security_deposit_cents: centsFromMoneyInput(draft.security_deposit),
    income_requirement: cleanText(draft.income_requirement) || null,
    video_url: cleanText(draft.video_url) || null,
    ac_type: cleanText(draft.ac_type) || null,
    smoking: cleanText(draft.smoking) || null,
    lease_term: cleanText(draft.lease_term) || null,
  };
}

export function draftFactsFromAddPropertyV2(draft: AddPropertyV2Draft): DraftFacts {
  const petsCats = boolSelect(draft.pets_cats);
  const petsDogs = boolSelect(draft.pets_dogs);
  return {
    beds: intFromInput(draft.beds),
    baths: floatFromInput(draft.baths),
    unit_type: cleanText(draft.unit_type) || null,
    rent_cents: centsFromMoneyInput(draft.rent),
    parking: cleanText(draft.parking) || null,
    available_date: cleanText(draft.available_date) || null,
    sqft: intFromInput(draft.sqft),
    floor: cleanText(draft.floor) || null,
    laundry: cleanText(draft.laundry) || null,
    air_conditioning: draft.air_conditioning,
    balcony: draft.balcony,
    furnished: draft.furnished,
    pet_friendly: petsCats === true || petsDogs === true,
    pets_cats: petsCats,
    pets_dogs: petsDogs,
    pets_dog_size: cleanText(draft.pets_dog_size) || null,
    pets_notes: cleanText(draft.pets_notes) || null,
    heat_included: boolSelect(draft.heat_included),
    hydro_included: boolSelect(draft.hydro_included),
    water_included: boolSelect(draft.water_included),
  };
}
