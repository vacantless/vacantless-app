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
  pet_friendly?: boolean | null;
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
  if (f.floor && f.floor.trim()) out.push(`${f.floor.trim()} floor`);
  if (f.parking && f.parking.trim()) out.push(`Parking: ${f.parking.trim()}`);
  return out;
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
  if (f.pet_friendly) chips.push("Pet friendly");
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
