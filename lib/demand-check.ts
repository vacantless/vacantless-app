// ============================================================================
// demand-check (S807). Replaces "Suggested market rent" on the rental page.
//
// Noam, 2026-11-16: suggested market rent "is probably flawed for all
// geographic areas". It was: 8 benchmark rows (GTA, Niagara, Windsor) from
// CMHC averages, which count sitting tenants and read low for a vacant unit;
// anywhere else it showed nothing. This reads the rental's own renters and
// booked viewings instead, which every account has in every city, and says in
// plain words what they suggest. PURE: page queries pass the counts in.
// Tests: scripts/test-demand-check.ts.
// ============================================================================

export type DemandInput = {
  /** Days the rental has been live (first_live_at or available_since); null = unknown. */
  daysLive: number | null;
  /** Renters for this rental in the last 14 days. */
  renters14: number;
  /** Renters in the last 7 days. */
  renters7: number;
  /** Viewings booked for this rental, created in the last 14 days. */
  booked14: number;
  /** S823b: viewing times open on the account (weekly or dated, still to come). null/undefined = not known. */
  openTimes?: number | null;
};

export type DemandTone = "early" | "quiet" | "not_booking" | "strong" | "steady";

export type DemandCheck = {
  tone: DemandTone;
  headline: string;
  advice: string;
  /** Short facts line, e.g. "9 renters this week, 14 in 2 weeks, 3 viewings booked". */
  facts: string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function demandCheck(input: DemandInput): DemandCheck {
  const days = input.daysLive == null ? null : Math.max(0, Math.floor(input.daysLive));
  const r14 = Math.max(0, input.renters14);
  const r7 = Math.max(0, input.renters7);
  const b14 = Math.max(0, input.booked14);
  const facts = `${plural(r7, "renter", "renters")} this week, ${r14} in 2 weeks, ${plural(b14, "viewing", "viewings")} booked`;

  if (days != null && days < 3 && r14 < 3) {
    return { tone: "early", headline: "Too early to tell", advice: "Check back after 3 days live.", facts };
  }
  // S823b: Agile's rental page said "Steady. Renters are coming in and
  // booking." on a day no viewing time was open and 24 renters were waiting.
  // With nothing open, nobody can book, whatever the last two weeks show.
  if (input.openTimes === 0 && r14 > 0) {
    return {
      tone: "not_booking",
      headline: "Renters cannot book",
      advice: "No viewing times are open. Add times and the renters who asked can pick one.",
      facts,
    };
  }
  if (r14 === 0) {
    return {
      tone: "quiet",
      headline: "No renters in 2 weeks",
      advice: "Check the ad is up on each site first. If it is, the price or the cover photo is the likely cause.",
      facts,
    };
  }
  if (r14 >= 5 && b14 === 0) {
    return {
      tone: "not_booking",
      headline: "Renters ask, nobody books",
      advice: "Interest is there but it stops before a viewing. Check that viewing times are open, then the price against the ad.",
      facts,
    };
  }
  if (r14 >= 8 && b14 / r14 < 0.15) {
    return {
      tone: "not_booking",
      headline: "Few renters book",
      advice: "Most renters drop off before booking. The price may be a little high for what the ad shows.",
      facts,
    };
  }
  if (r7 >= 10 && b14 >= 3) {
    return {
      tone: "strong",
      headline: "Strong demand",
      advice: "Lots of renters and viewings. If it keeps up, the rent may be on the low side for the next one.",
      facts,
    };
  }
  return { tone: "steady", headline: "Steady", advice: "Renters are coming in and booking. No change needed.", facts };
}

/** Days between an ISO date and now, or null. */
export function daysSince(iso: string | null | undefined, nowMs = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / 86_400_000);
}
