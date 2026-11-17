// ============================================================================
// sister-unit-fill (S807). A unit Narayan adds from his crew link lands as a
// private draft with only its address and building photos. "Fill from a unit
// in this building" copies the facts a sister unit already has into the
// draft's EMPTY fields only (nothing typed is overwritten). Unit-specific
// facts (floor, balcony, available date, photos, status) are never copied.
// PURE: the action in app/dashboard/properties/actions.ts reads and writes.
// Tests: scripts/test-sister-unit-fill.ts.
// ============================================================================
import { splitAddressUnit } from "./address-unit";

export const SISTER_FILL_FIELDS = [
  "rent_cents",
  "beds",
  "baths",
  "sqft",
  "unit_type",
  "structure_type",
  "for_rent_by",
  "description",
  "laundry",
  "air_conditioning",
  "ac_type",
  "heating_type",
  "heat_included",
  "hydro_included",
  "water_included",
  "internet_included",
  "cable_included",
  "parking",
  "parking_type",
  "parking_count",
  "furnished",
  "pet_friendly",
  "pets_cats",
  "pets_dogs",
  "pets_dog_size",
  "pets_notes",
  "smoking",
  "lease_term",
  "on_site_management",
  "security_deposit_cents",
  "income_requirement",
  "amenities",
  "showing_instructions",
  "showing_arrival_phone",
  "emergency_info",
  "emergency_phone",
  // S808 (0303): building facts. Exposure, view and renovation year are this
  // unit's own, never copied.
  "nearby",
  "parking_fee_cents",
  "appliances",
  "flooring",
  "max_occupants",
] as const;

export type SisterFillField = (typeof SISTER_FILL_FIELDS)[number];
export type UnitFacts = Partial<Record<SisterFillField, unknown>>;

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** The fields to write on the target: source values where the target is empty. */
export function sisterFillPatch(target: UnitFacts, source: UnitFacts): UnitFacts {
  const out: UnitFacts = {};
  for (const f of SISTER_FILL_FIELDS) {
    if (isEmpty(target[f]) && !isEmpty(source[f])) out[f] = source[f];
  }
  return out;
}

/** True when two addresses are units of the same building (same street part). */
export function sameBuilding(a: string | null | undefined, b: string | null | undefined): boolean {
  const sa = splitAddressUnit(a).street?.toLowerCase().replace(/\s+/g, " ").trim();
  const sb = splitAddressUnit(b).street?.toLowerCase().replace(/\s+/g, " ").trim();
  return !!sa && sa === sb;
}

/** Whether the draft still lacks the facts an ad needs, so the offer is worth showing. */
export function needsSisterFill(target: UnitFacts): boolean {
  return isEmpty(target.rent_cents) || isEmpty(target.beds) || isEmpty(target.description) || isEmpty(target.sqft);
}
