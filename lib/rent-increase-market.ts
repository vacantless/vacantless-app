// ============================================================================
// lib/rent-increase-market.ts — join the S544 market-rent range into the annual
// rent-increase / N1 decision (S545).
//
// At renewal the operator already sees the legal guideline cap (deriveRentIncrease:
// current -> capped new rent at the year's guideline %). What they do NOT see is
// what the unit would fetch on the open market. This pure helper compares the
// capped new rent against the market midpoint (from suggestRentRange) so the
// operator can answer the real question: "does this guideline increase keep me
// near market, or am I capped well below market (a gap only recoverable on
// turnover or an approved AGI)?".
//
// PURE: same inputs -> same output, no DB/DOM/clock. Display-only: this never
// writes rent and never changes what N1 amount is served — the served amount is
// still the guideline-capped figure. Honest-null: when there is no market
// suggestion for the unit (e.g. a bedroom/geography with no benchmark), it
// returns null and the surface shows nothing rather than a guess.
// ============================================================================

import type { RentIncrease } from "./rent-increase";
import type { MarketRentSuggestion } from "./market-rent";

export type MarketPosition = "below" | "at" | "above";

export type RentIncreaseMarketContext = {
  marketLowCents: number;
  marketMidCents: number;
  marketHighCents: number;
  confidence: MarketRentSuggestion["confidence"];
  /**
   * The rent compared against market: the guideline-capped NEW rent when an
   * amount is computable, else the current rent (exempt units, or a guideline
   * year not yet published — nothing to cap to, so we compare today's rent).
   */
  comparedRentCents: number;
  /** True when comparedRentCents is the capped new rent (guideline applied). */
  comparedIsNewRent: boolean;
  /** market mid − comparedRent (positive = the unit sits under market). */
  gapToMidCents: number;
  /** gapToMidCents as a percent of the market mid, rounded to 0.1. */
  gapToMidPercent: number;
  position: MarketPosition;
  exempt: boolean;
  /** Plain-language read of the comparison (no em dashes). */
  note: string;
};

// A unit within this band of the market midpoint reads as "at market" — small
// gaps are noise given the benchmark is an area average, not this exact unit.
export const AT_MARKET_BAND = 0.03; // ±3%

function dollars(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("en-CA");
}

/**
 * Derive the market context for a tenancy's rent-increase decision as of the
 * already-derived rentIncrease + market suggestion. Returns null (show nothing)
 * whenever either input is missing or the market mid is not a positive amount.
 */
export function deriveRentIncreaseMarketContext(args: {
  rentIncrease: RentIncrease | null;
  suggestion: MarketRentSuggestion | null;
}): RentIncreaseMarketContext | null {
  const ri = args.rentIncrease;
  const s = args.suggestion;
  if (!ri || !s) return null;
  if (!(s.midCents > 0)) return null;

  const comparedIsNewRent = ri.newRentCents != null && ri.newRentCents > 0;
  const comparedRentCents = comparedIsNewRent
    ? (ri.newRentCents as number)
    : ri.currentRentCents;
  if (!(comparedRentCents > 0)) return null;

  const gapToMidCents = s.midCents - comparedRentCents;
  const gapToMidPercent = Math.round((gapToMidCents / s.midCents) * 1000) / 10;

  let position: MarketPosition;
  if (Math.abs(gapToMidCents) <= s.midCents * AT_MARKET_BAND) {
    position = "at";
  } else {
    position = gapToMidCents > 0 ? "below" : "above";
  }

  const note = buildNote({
    position,
    exempt: ri.exempt,
    comparedIsNewRent,
    gapToMidCents,
    gapToMidPercent,
    guidelinePercent: ri.guidelinePercent,
    confidence: s.confidence,
  });

  return {
    marketLowCents: s.lowCents,
    marketMidCents: s.midCents,
    marketHighCents: s.highCents,
    confidence: s.confidence,
    comparedRentCents,
    comparedIsNewRent,
    gapToMidCents,
    gapToMidPercent,
    position,
    exempt: ri.exempt,
    note,
  };
}

function buildNote(d: {
  position: MarketPosition;
  exempt: boolean;
  comparedIsNewRent: boolean;
  gapToMidCents: number;
  gapToMidPercent: number;
  guidelinePercent: number | null;
  confidence: MarketRentSuggestion["confidence"];
}): string {
  const gapAbs = Math.abs(gapRound(d.gapToMidCents));
  const pctAbs = Math.abs(d.gapToMidPercent);
  const rentLabel = d.comparedIsNewRent
    ? "capped renewal rent"
    : "current rent";
  const caveat =
    d.confidence === "low"
      ? " This benchmark is a broad average, so treat it as a rough floor."
      : "";

  if (d.position === "at") {
    return `Your ${rentLabel} is about at market for this unit. The guideline increase keeps a good tenant close to market.${caveat}`;
  }

  if (d.position === "above") {
    return `Your ${rentLabel} is already above the market midpoint for this unit (about ${pctAbs}%, ${dollars(gapAbs)}/mo over). The guideline increase keeps you there.${caveat}`;
  }

  // below
  if (d.exempt) {
    return `This unit is exempt from the guideline cap, so market is your reference. Your ${rentLabel} is about ${pctAbs}% (${dollars(gapAbs)}/mo) below the market midpoint, so you can set the renewal rent toward it.${caveat}`;
  }
  return `At the guideline, your ${rentLabel} is about ${pctAbs}% (${dollars(gapAbs)}/mo) below market for this unit. The guideline limits this tenant's increase, so that gap is only recoverable on turnover or an approved AGI, not this renewal.${caveat}`;
}

function gapRound(cents: number): number {
  return Math.round(cents);
}
