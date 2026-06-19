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

/**
 * The renter-facing unit fields. All optional/nullable so a partially-filled
 * property still renders cleanly.
 */
export type UnitFeatures = {
  available_date?: string | null; // ISO date "YYYY-MM-DD"
  sqft?: number | null;
  floor?: string | null;
  parking?: string | null;
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
    out.push(/floor$/i.test(floor) ? floor : `${floor} floor`);
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
 * Boolean amenities + laundry as a chip list (only the present ones).
 * Order is stable for predictable rendering + tests.
 */
export function buildAmenityChips(f: UnitFeatures): string[] {
  const chips: string[] = [];
  if (f.air_conditioning) chips.push("Air conditioning");
  if (f.balcony) chips.push("Balcony");
  const laundry = laundryLabel(f.laundry);
  if (laundry && f.laundry !== "none") chips.push(laundry);
  if (f.furnished) chips.push("Furnished");
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
