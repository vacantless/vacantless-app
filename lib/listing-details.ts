// ============================================================================
// listing-details (S808). The listing facts Agile's vacancy schedule carried
// that a rental did not: when it was renovated, what is nearby, which way it
// faces, what parking costs, which appliances come with it, the flooring, and
// how many people may live there. Noam, 2026-11-16: "do we take in enough info
// for marketing? ... whatever was on our vacancy schedule? parking? they can be
// defaulted to org. Let's fix the gaps."
// PURE (no IO). Tests: scripts/test-listing-details.ts. Migration 0303.
// ============================================================================

export const EXPOSURE_OPTIONS = ["north", "south", "east", "west"] as const;
export type Exposure = (typeof EXPOSURE_OPTIONS)[number];
export const EXPOSURE_LABELS: Record<Exposure, string> = { north: "North", south: "South", east: "East", west: "West" };

export const APPLIANCE_KEYS = ["fridge", "stove", "microwave", "washer", "dryer"] as const;
export type ApplianceKey = (typeof APPLIANCE_KEYS)[number];
export const APPLIANCE_LABELS: Record<ApplianceKey, string> = {
  fridge: "Fridge",
  stove: "Stove",
  microwave: "Microwave",
  washer: "Washer",
  dryer: "Dryer",
};

export const FLOORING_OPTIONS = ["hardwood", "laminate", "vinyl", "carpet", "tile", "concrete"] as const;
export type Flooring = (typeof FLOORING_OPTIONS)[number];
export const FLOORING_LABELS: Record<Flooring, string> = {
  hardwood: "Hardwood floors",
  laminate: "Laminate floors",
  vinyl: "Vinyl plank floors",
  carpet: "Carpet",
  tile: "Tile floors",
  concrete: "Polished concrete floors",
};

export const NEARBY_MAX = 120;
export const EXPOSURE_VIEW_MAX = 80;
export const MAX_OCCUPANTS_LIMIT = 20;

function pickList<T extends string>(raw: unknown, allowed: readonly T[]): T[] {
  const values = typeof raw === "string" ? raw.split(/[,;\n|]+/) : Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  for (const v of values) if (typeof v === "string") seen.add(v.trim().toLowerCase());
  return allowed.filter((k) => seen.has(k));
}

/** Directions the unit faces, in N/S/E/W order; empty when none. */
export function normalizeExposure(raw: unknown): Exposure[] {
  return pickList(raw, EXPOSURE_OPTIONS);
}
export function normalizeAppliances(raw: unknown): ApplianceKey[] {
  return pickList(raw, APPLIANCE_KEYS);
}
export function normalizeFlooring(raw: unknown): Flooring | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (FLOORING_OPTIONS as readonly string[]).includes(v) ? (v as Flooring) : null;
}

/** A renovation year between 1900 and this year; anything else is null. */
export function parseRenovatedYear(raw: unknown, now: Date = new Date()): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(n) || n < 1900 || n > now.getFullYear()) return null;
  return n;
}

/** 1 to 20 people; anything else is null. */
export function parseMaxOccupants(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(n) || n < 1 || n > MAX_OCCUPANTS_LIMIT) return null;
  return n;
}

/** Dollars typed by a person ("50", "$50.00") to cents; blank or junk is null. */
export function parseDollarsToCents(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
  return Math.round(n * 100);
}

export function cleanText(raw: unknown, max: number): string | null {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "South facing", "South and west facing, park view"; null when nothing is set. */
export function exposureLabel(exposure: unknown, view?: string | null): string | null {
  const dirs = normalizeExposure(exposure).map((d) => EXPOSURE_LABELS[d]);
  const v = cleanText(view, EXPOSURE_VIEW_MAX);
  if (!dirs.length && !v) return null;
  const facing = dirs.length ? `${joinAnd(dirs.map((d, i) => (i === 0 ? d : d.toLowerCase())))} facing` : null;
  return [facing, v].filter(Boolean).join(", ");
}

/** "Renovated in 2024"; null when not set. */
export function renovatedLabel(year: unknown): string | null {
  return typeof year === "number" && Number.isInteger(year) && year >= 1900 ? `Renovated in ${year}` : null;
}

/** "Fridge, stove, washer and dryer"; null when none. */
export function appliancesLabel(raw: unknown): string | null {
  const list = normalizeAppliances(raw).map((k, i) => (i === 0 ? APPLIANCE_LABELS[k] : APPLIANCE_LABELS[k].toLowerCase()));
  return list.length ? joinAnd(list) : null;
}

export function flooringLabel(raw: unknown): string | null {
  const f = normalizeFlooring(raw);
  return f ? FLOORING_LABELS[f] : null;
}

/** "Up to 3 people"; null when not set. */
export function maxOccupantsLabel(n: unknown): string | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 ? `Up to ${n} ${n === 1 ? "person" : "people"}` : null;
}

/** "$50 a month"; null when not set. A zero fee reads "Included". */
export function parkingFeeLabel(cents: unknown): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents < 0) return null;
  if (cents === 0) return "Included";
  const whole = Math.round(cents) % 100 === 0;
  return `$${(Math.round(cents) / 100).toLocaleString("en-CA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })} a month`;
}
