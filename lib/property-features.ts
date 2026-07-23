// ============================================================================
// Pure helpers for unit-level property features.
// No DOM / env / IO — fully unit-testable (see scripts/test-property-features.ts).
// Drives both the operator edit form and the public /r listing page.
// ============================================================================

export const LAUNDRY_OPTIONS = [
  "in_suite",
  "in_building",
  "shared",
  "none",
] as const;
export type Laundry = (typeof LAUNDRY_OPTIONS)[number];

export function isLaundry(value: unknown): value is Laundry {
  return (
    typeof value === "string" &&
    (LAUNDRY_OPTIONS as readonly string[]).includes(value)
  );
}

/** Normalize a raw form value to a valid laundry option or null (= unspecified). */
export function normalizeLaundry(raw: unknown): Laundry | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return isLaundry(v) ? v : null;
}

const LAUNDRY_LABELS: Record<Laundry, string> = {
  in_suite: "In-suite laundry",
  in_building: "Laundry in building",
  shared: "Shared laundry",
  none: "No laundry",
};

export function laundryLabel(value: unknown): string | null {
  return isLaundry(value) ? LAUNDRY_LABELS[value] : null;
}

// --- Pets -------------------------------------------------------------------
// Structured pet policy (migration 0045) replaces the old single pet_friendly
// boolean. pet_friendly is kept as the DERIVED master (= cats OR dogs) the RPCs
// and S240 pre-screening read; derivePetFriendly is the one place that rule lives.

export const DOG_SIZE_OPTIONS = ["small", "medium", "large", "any"] as const;
export type DogSize = (typeof DOG_SIZE_OPTIONS)[number];

export function isDogSize(value: unknown): value is DogSize {
  return (
    typeof value === "string" &&
    (DOG_SIZE_OPTIONS as readonly string[]).includes(value)
  );
}

/** Normalize a raw form value to a valid dog-size option or null (= unspecified). */
export function normalizeDogSize(raw: unknown): DogSize | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return isDogSize(v) ? v : null;
}

const DOG_SIZE_LABELS: Record<DogSize, string> = {
  small: "small",
  medium: "medium",
  large: "large",
  any: "any size",
};

export function dogSizeLabel(value: unknown): string | null {
  return isDogSize(value) ? DOG_SIZE_LABELS[value] : null;
}

// --- Standard-policy fields (migration 0048) -------------------------------
// Building-constant policy attributes that live on the org-level profile and
// are inherited by every unit unless the unit overrides them. The VALUE vocab +
// labels live here (the base module); the profile merge lives in
// lib/policy-profile (resolveEffectiveFeatures). All renter-facing.

export const AC_TYPE_OPTIONS = [
  "none",
  "window",
  "portable",
  "sleeve",
  "central",
] as const;
export type AcType = (typeof AC_TYPE_OPTIONS)[number];

export function isAcType(value: unknown): value is AcType {
  return (
    typeof value === "string" &&
    (AC_TYPE_OPTIONS as readonly string[]).includes(value)
  );
}

export function normalizeAcType(raw: unknown): AcType | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return isAcType(v) ? v : null;
}

// Renter-facing A/C-type label (operator settings use these too). "none" → null
// (no A/C to advertise). The descriptor is parenthetical so buildAmenityChips
// can render "Air conditioning (wall/sleeve)".
const AC_TYPE_LABELS: Record<AcType, string | null> = {
  none: null,
  window: "window",
  portable: "portable",
  sleeve: "wall/sleeve",
  central: "central air",
};

export function acTypeLabel(value: unknown): string | null {
  return isAcType(value) ? AC_TYPE_LABELS[value] : null;
}

export const SMOKING_OPTIONS = ["non_smoking", "smoking_permitted"] as const;
export type Smoking = (typeof SMOKING_OPTIONS)[number];

export function isSmoking(value: unknown): value is Smoking {
  return (
    typeof value === "string" &&
    (SMOKING_OPTIONS as readonly string[]).includes(value)
  );
}

export function normalizeSmoking(raw: unknown): Smoking | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return isSmoking(v) ? v : null;
}

const SMOKING_LABELS: Record<Smoking, string> = {
  non_smoking: "Non-smoking",
  smoking_permitted: "Smoking permitted",
};

export function smokingLabel(value: unknown): string | null {
  return isSmoking(value) ? SMOKING_LABELS[value] : null;
}

export const LEASE_TERM_OPTIONS = [
  "month_to_month",
  "6_month",
  "1_year",
  "2_year",
] as const;
export type LeaseTerm = (typeof LEASE_TERM_OPTIONS)[number];

export function isLeaseTerm(value: unknown): value is LeaseTerm {
  return (
    typeof value === "string" &&
    (LEASE_TERM_OPTIONS as readonly string[]).includes(value)
  );
}

export function normalizeLeaseTerm(raw: unknown): LeaseTerm | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return isLeaseTerm(v) ? v : null;
}

const LEASE_TERM_LABELS: Record<LeaseTerm, string> = {
  month_to_month: "Month-to-month",
  "6_month": "6-month lease",
  "1_year": "1-year lease",
  "2_year": "2-year lease",
};

export function leaseTermLabel(value: unknown): string | null {
  return isLeaseTerm(value) ? LEASE_TERM_LABELS[value] : null;
}

// --- Unit type + "for rent by" (Kijiji autopilot field map, S550) -----------
// unit_type feeds the Kijiji unittype_s radio directly (the values ARE Kijiji's
// vocab, hyphens and all) so the done-for-you worker posts a condo as a condo,
// not the old apartment default. Nullable: an unset unit falls back to apartment
// downstream. for_rent_by feeds Kijiji's forrentbyhousing_s (owner -> ownr,
// professional -> reprofessional); the column is NOT NULL default 'owner'.

export const UNIT_TYPE_OPTIONS = [
  "apartment",
  "condo",
  "basement-apartment",
  "house",
  "townhouse",
  "duplex-triplex",
] as const;
export type UnitType = (typeof UNIT_TYPE_OPTIONS)[number];

export function isUnitType(value: unknown): value is UnitType {
  return (
    typeof value === "string" &&
    (UNIT_TYPE_OPTIONS as readonly string[]).includes(value)
  );
}

/** Normalize a raw form value to a valid unit type or null (= unspecified). */
export function normalizeUnitType(raw: unknown): UnitType | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return isUnitType(v) ? v : null;
}

const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  apartment: "Apartment",
  condo: "Condo",
  "basement-apartment": "Basement apartment",
  house: "House",
  townhouse: "Townhouse",
  "duplex-triplex": "Duplex / triplex",
};

export function unitTypeLabel(value: unknown): string | null {
  return isUnitType(value) ? UNIT_TYPE_LABELS[value] : null;
}

export const FOR_RENT_BY_OPTIONS = ["owner", "professional"] as const;
export type ForRentBy = (typeof FOR_RENT_BY_OPTIONS)[number];

export function isForRentBy(value: unknown): value is ForRentBy {
  return (
    typeof value === "string" &&
    (FOR_RENT_BY_OPTIONS as readonly string[]).includes(value)
  );
}

/**
 * Normalize a raw form value to a valid "for rent by" option. The DB column is
 * NOT NULL DEFAULT 'owner', so this NEVER returns null: a missing/invalid value
 * falls back to 'owner' (the safe default a self-listing landlord expects).
 */
export function normalizeForRentBy(raw: unknown): ForRentBy {
  if (typeof raw !== "string") return "owner";
  const v = raw.trim();
  return isForRentBy(v) ? v : "owner";
}

const FOR_RENT_BY_LABELS: Record<ForRentBy, string> = {
  owner: "Owner",
  professional: "Real estate professional",
};

export function forRentByLabel(value: unknown): string | null {
  return isForRentBy(value) ? FOR_RENT_BY_LABELS[value] : null;
}

/**
 * The renter-facing unit fields. All optional/nullable so a partially-filled
 * property still renders cleanly.
 */
export type UnitFeatures = {
  available_date?: string | null; // ISO date "YYYY-MM-DD"
  sqft?: number | null;
  floor?: string | null;
  parking?: string | null;
  // Kijiji autopilot field map (S550): structural type + who is listing.
  unit_type?: UnitType | string | null;
  for_rent_by?: ForRentBy | string | null;
  laundry?: Laundry | string | null;
  air_conditioning?: boolean | null;
  balcony?: boolean | null;
  furnished?: boolean | null;
  /** Derived master (= pets_cats OR pets_dogs). Read by the RPCs + screening. */
  pet_friendly?: boolean | null;
  pets_cats?: boolean | null;
  pets_dogs?: boolean | null;
  pets_dog_size?: DogSize | string | null;
  pets_notes?: string | null;
  heat_included?: boolean | null;
  hydro_included?: boolean | null;
  water_included?: boolean | null;
  // Standard-policy fields (0048). On a UnitFeatures these are the RESOLVED
  // EFFECTIVE values (unit override ?? org profile default), produced by
  // lib/policy-profile resolveEffectiveFeatures. The bare air_conditioning
  // boolean above stays the back-compat A/C fallback when ac_type is null.
  ac_type?: AcType | string | null;
  smoking?: Smoking | string | null;
  lease_term?: LeaseTerm | string | null;
  on_site_management?: boolean | null;
};

// --- Availability -----------------------------------------------------------

/** Parse a "YYYY-MM-DD" date string to UTC y/m/d parts, or null if malformed. */
function parseDateParts(
  iso: string,
): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * Human availability label. Null/blank or a past date → "Available now";
 * otherwise "Available Jul 1" (with year only when it's not the current year).
 * `now` is injectable for deterministic tests.
 */
export function formatAvailability(
  availableDate: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!availableDate) return "Available now";
  const parts = parseDateParts(availableDate);
  if (!parts) return "Available now";

  const target = Date.UTC(parts.y, parts.m - 1, parts.d);
  const todayUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (target <= todayUTC) return "Available now";

  const dt = new Date(target);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  };
  if (parts.y !== now.getUTCFullYear()) opts.year = "numeric";
  return `Available ${new Intl.DateTimeFormat("en-US", opts).format(dt)}`;
}

export function isAvailableNow(
  availableDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return formatAvailability(availableDate, now) === "Available now";
}

// --- Specs + amenities ------------------------------------------------------

export function formatSqft(sqft: number | null | undefined): string | null {
  if (sqft == null || !Number.isFinite(sqft) || sqft <= 0) return null;
  return `${Math.round(sqft).toLocaleString()} sq ft`;
}

/**
 * The compact "spec" line: beds · baths · sqft · floor · parking.
 * (beds/baths passed in since they live on the base property.)
 */
export function buildSpecLine(
  f: UnitFeatures & { beds?: number | null; baths?: number | null },
): string[] {
  const out: string[] = [];
  if (f.beds != null) out.push(`${f.beds} bed${f.beds === 1 ? "" : "s"}`);
  if (f.baths != null) out.push(`${f.baths} bath${f.baths === 1 ? "" : "s"}`);
  const sq = formatSqft(f.sqft);
  if (sq) out.push(sq);
  if (f.floor && f.floor.trim()) {
    const floor = f.floor.trim();
    // The field holds a level like "2nd" or "Main" and we render "<level> floor".
    // But operators often type "Main floor"/"2nd floor" already, so don't double
    // the word (the "Main floor floor" bug from the S225 QA audit).
    // ...or a leading word like a condo "Level 15"/"Penthouse level" (the
    // "Level 15 floor" bug, S450 QA audit) — append " floor" only when the
    // value does not already name a floor/level.
    out.push(/\b(?:floor|level)\b/i.test(floor) ? floor : `${floor} floor`);
  }
  if (f.parking && f.parking.trim()) out.push(`Parking: ${f.parking.trim()}`);
  return out;
}

/**
 * The pet_friendly MASTER, derived from the structured policy. This is the one
 * place the (cats OR dogs) rule lives; the server action writes it on save and
 * the SQL columns are kept in sync, so the RPCs + S240 screening read a value
 * that can never contradict the structured fields.
 */
export function derivePetFriendly(f: UnitFeatures): boolean {
  return !!(f.pets_cats || f.pets_dogs);
}

/**
 * Renter-facing pet-policy label, e.g. "Cats & dogs welcome",
 * "Dogs welcome (small)", or null when no pets are welcome. Falls back to the
 * legacy pet_friendly boolean for any row not yet carrying structured data.
 */
export function petPolicyLabel(f: UnitFeatures): string | null {
  const cats = !!f.pets_cats;
  const dogs = !!f.pets_dogs;
  if (!cats && !dogs) {
    // Pre-0045 rows: structured fields unset but the legacy master is true.
    return f.pet_friendly ? "Pets welcome" : null;
  }
  const size = isDogSize(f.pets_dog_size) ? f.pets_dog_size : null;
  // A size note only makes sense when dogs are welcome and a real limit is set.
  const sizeNote = dogs && size && size !== "any" ? ` (${size} dogs)` : "";
  if (cats && dogs) return `Cats & dogs welcome${sizeNote}`;
  if (cats) return "Cats welcome";
  return `Dogs welcome${sizeNote}`;
}

/**
 * The A/C amenity chip, A/C-type-aware. When an effective ac_type is set it
 * wins ("Air conditioning (wall/sleeve)"); ac_type "none" means no A/C even if
 * the legacy boolean is on; otherwise the bare air_conditioning boolean is the
 * back-compat fallback. Null = no A/C to advertise. This is the one place the
 * "ac_type beats the boolean" rule lives (the Unit 20 fix, S273).
 */
export function acAmenityLabel(f: UnitFeatures): string | null {
  if (isAcType(f.ac_type)) {
    if (f.ac_type === "none") return null;
    const desc = acTypeLabel(f.ac_type);
    return desc ? `Air conditioning (${desc})` : "Air conditioning";
  }
  return f.air_conditioning ? "Air conditioning" : null;
}

/**
 * Boolean amenities + laundry as a chip list (only the present ones).
 * Order is stable for predictable rendering + tests.
 */
export function buildAmenityChips(f: UnitFeatures): string[] {
  const chips: string[] = [];
  const ac = acAmenityLabel(f);
  if (ac) chips.push(ac);
  if (f.balcony) chips.push("Balcony");
  const laundry = laundryLabel(f.laundry);
  if (laundry && f.laundry !== "none") chips.push(laundry);
  if (f.furnished) chips.push("Furnished");
  // Non-smoking is a genuine selling point; "smoking permitted" is not surfaced
  // as an amenity (absence is the norm, advertising it adds no value).
  if (f.smoking === "non_smoking") chips.push("Non-smoking");
  if (f.on_site_management) chips.push("On-site management");
  const pets = petPolicyLabel(f);
  if (pets) chips.push(pets);
  return chips;
}

/** The utilities the landlord includes in rent, as labels. */
export function buildUtilitiesIncluded(f: UnitFeatures): string[] {
  const out: string[] = [];
  if (f.heat_included) out.push("Heat");
  if (f.hydro_included) out.push("Hydro");
  if (f.water_included) out.push("Water");
  return out;
}

/**
 * One-line utilities summary for the public page, or null when nothing is
 * included. e.g. "Heat included", "Heat & water included",
 * "Heat, hydro & water included".
 */
export function utilitiesSummary(f: UnitFeatures): string | null {
  const items = buildUtilitiesIncluded(f).map((s) => s.toLowerCase());
  if (items.length === 0) return null;
  let joined: string;
  if (items.length === 1) joined = items[0];
  else if (items.length === 2) joined = `${items[0]} & ${items[1]}`;
  else joined = `${items.slice(0, -1).join(", ")} & ${items[items.length - 1]}`;
  // Sentence case: capitalize the first letter only.
  const sentence = `${joined} included`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** True when the property carries any renter-facing detail worth a section. */
export function hasAnyFeature(f: UnitFeatures): boolean {
  return (
    buildAmenityChips(f).length > 0 ||
    buildUtilitiesIncluded(f).length > 0 ||
    formatSqft(f.sqft) != null ||
    !!(f.floor && f.floor.trim())
  );
}
