// ============================================================================
// sqft-estimate (S712). A sensible size when the landlord leaves it blank.
//
// Kijiji and Zumper need square footage, and a missing size held a new
// landlord's rental off every robot-posted site. Order of evidence:
//   1. other rentals in the SAME BUILDING with the same bedrooms,
//   2. the org's own rentals with the same bedrooms,
//   3. a general default by bedrooms (Noam's ranges: 1 bed 600-699, 2 bed 700+).
// Only real sizes count as evidence (never another estimate). The result is
// rounded to the nearest 10 and is always marked as an estimate.
// ============================================================================

export const SQFT_DEFAULT_BY_BEDS: Readonly<Record<number, number>> = {
  0: 500,
  1: 650,
  2: 800,
  3: 1100,
};
export const SQFT_DEFAULT_FOUR_PLUS = 1400;

function median(values: readonly number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const round10 = (n: number) => Math.round(n / 10) * 10;

export type SqftEstimateSource = "building" | "org" | "default";

export function estimateSqft(input: {
  beds: number | null | undefined;
  sameBuilding: readonly number[];
  sameOrg: readonly number[];
}): { sqft: number; source: SqftEstimateSource } | null {
  const beds = input.beds;
  if (beds == null || !Number.isFinite(beds) || beds < 0) return null;
  const b = median(input.sameBuilding);
  if (b != null) return { sqft: round10(b), source: "building" };
  const o = median(input.sameOrg);
  if (o != null) return { sqft: round10(o), source: "org" };
  const d = beds >= 4 ? SQFT_DEFAULT_FOUR_PLUS : SQFT_DEFAULT_BY_BEDS[Math.floor(beds)];
  return { sqft: d, source: "default" };
}
