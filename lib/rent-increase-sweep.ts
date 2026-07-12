// Pure selection + idempotency logic for the rent-increase reminder sweep
// (the "autopilot" half of the free compliance wedge, S339). NO DB / env / I/O
// here so it unit-tests cleanly via `npx tsx scripts/test-rent-increase-sweep.ts`.
// The impure pieces (per-org tenancy queries, the once-per-cycle stamp, the send)
// live in app/api/cron/rent-increase/route.ts; copy/recipients/branding ride the
// notification substrate (lib/notifications*) exactly like every other event.
//
// The calc core (lib/rent-increase.ts deriveRentIncrease) is unchanged: this
// module only decides WHICH derived results warrant a proactive email this tick,
// and gates each tenancy to at most one nudge per increase cycle.

import type { RentIncrease, RentIncreaseStatus } from "./rent-increase";

// The statuses that warrant a proactive reminder — the same actionable band the
// Overview "Rent increases due" rollup surfaces (dashboard/page.tsx URGENCY).
// `exempt` and `scheduled` are intentionally excluded: nothing to do yet.
export const RENT_INCREASE_NUDGE_STATUSES: readonly RentIncreaseStatus[] = [
  "serve_window",
  "serve_late",
  "overdue",
] as const;

// Most-urgent first, for ordering an org's due tenancies in the sweep summary.
// Mirrors the dashboard rollup's URGENCY map.
export const RENT_INCREASE_URGENCY: Record<string, number> = {
  overdue: 0,
  serve_late: 1,
  serve_window: 2,
};

/**
 * True when a derived result is in the actionable band (worth an email). Plain
 * boolean — NOT a `result is RentIncrease` type guard: a `scheduled`/`exempt`
 * result is still a RentIncrease, it just isn't actionable, so guard-style
 * negative narrowing would be unsound.
 */
export function isActionableRentIncrease(result: RentIncrease | null): boolean {
  return (
    result != null &&
    (RENT_INCREASE_NUDGE_STATUSES as readonly string[]).includes(result.status)
  );
}

export type RentIncreaseNudgeDecision = {
  /** Send a reminder for this tenancy on this tick? */
  nudge: boolean;
  /** Why (for the sweep summary / tests). */
  reason: string;
  /**
   * The value to persist to tenancies.rent_increase_nudged_for when we send —
   * the STABLE earliest-effective (anniversary) date, NOT the realistic
   * effective date (which slips day-by-day in serve_late/overdue and would
   * otherwise re-nudge every tick). Null when there's nothing to stamp.
   */
  stampFor: string | null;
};

/**
 * Decide whether to nudge ONE tenancy this tick. Pure.
 *   - not actionable (exempt/scheduled/no result) -> no
 *   - already nudged for THIS cycle (stamp == earliestEffectiveDate) -> no
 *   - otherwise -> yes, and stamp the earliestEffectiveDate
 *
 * Because the stamp keys on earliestEffectiveDate (stable for a given 12-month
 * cycle), the reminder fires exactly once per cycle even as the status walks
 * serve_window -> serve_late -> overdue. Recording an increase
 * (last_rent_increase_date) rolls earliestEffectiveDate forward ~a year, so the
 * stamp no longer matches and the NEXT cycle re-arms automatically.
 */
export function decideRentIncreaseNudge(args: {
  result: RentIncrease | null;
  lastNudgedFor: string | null; // tenancies.rent_increase_nudged_for
  force?: boolean; // test affordance: bypass the already-nudged gate
}): RentIncreaseNudgeDecision {
  const r = args.result;
  if (r == null) {
    return { nudge: false, reason: "no_result", stampFor: null };
  }
  if (!(RENT_INCREASE_NUDGE_STATUSES as readonly string[]).includes(r.status)) {
    return { nudge: false, reason: `not_actionable:${r.status}`, stampFor: null };
  }
  // Actionable but no computable new rent = the guideline for the effective year
  // isn't published yet (non-exempt; exempt is excluded above). Do NOT send a
  // placeholder amount and do NOT stamp — leaving the cycle unstamped so that
  // publishing the guideline later re-nudges it (Codex P2).
  if (r.newRentCents == null) {
    return { nudge: false, reason: "guideline_missing", stampFor: null };
  }
  const stampFor = r.earliestEffectiveDate;
  if (!args.force && args.lastNudgedFor && args.lastNudgedFor === stampFor) {
    return { nudge: false, reason: "already_nudged", stampFor };
  }
  return { nudge: true, reason: "due", stampFor };
}
