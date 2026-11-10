// S776e: shared, rated local trades (PLAN-S775 Phase 4, migration 0284).
// One place for the rating rules and words. Pure: no Supabase or Next imports.
// The database enforces that only a finished job by that trade can be rated
// (trade_ratings insert policy) and shares only averages across accounts
// (directory_trade_scores).

export const STAR_VALUES = [1, 2, 3, 4, 5] as const;

/** Form value to stars, or null when it is not 1 to 5. */
export function parseStars(v: unknown): number | null {
  const n = Math.round(Number(String(v ?? "").trim()));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

/** "yes" / "no" / anything else = not answered. */
export function parseHireAgain(v: unknown): boolean | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "yes") return true;
  if (s === "no") return false;
  return null;
}

/** A job can be rated once it is done and a trade did it. */
export function canRateWorkOrder(o: { status: string; trade_contact_id: string | null }): boolean {
  return o.status === "completed" && !!o.trade_contact_id;
}

/** The network card line, e.g. "4.6 out of 5 from 7 jobs, 3 landlords". */
export function ratingLine(
  score: { rating_avg: number | string | null; rating_count: number; landlord_count: number } | null | undefined,
): string | null {
  if (!score || !score.rating_count) return null;
  const avg = Number(score.rating_avg);
  if (!Number.isFinite(avg)) return null;
  const jobs = score.rating_count === 1 ? "1 job" : `${score.rating_count} jobs`;
  const people = score.landlord_count === 1 ? "1 landlord" : `${score.landlord_count} landlords`;
  return `${avg.toFixed(1)} out of 5 from ${jobs}, ${people}`;
}

/** What the landlord sees on a job they rated. */
export function yourRatingLine(stars: number, hireAgain: boolean | null): string {
  const again = hireAgain === true ? ", would hire again" : hireAgain === false ? ", would not hire again" : "";
  return `You rated this job ${stars} out of 5${again}.`;
}
