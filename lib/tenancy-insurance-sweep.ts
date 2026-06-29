// Pure selection + idempotency logic for the per-tenancy renter's-insurance
// lapse reminder sweep (S382) — the date-anchored-per-record half of the free
// compliance wedge, the tenancy-scoped sibling of lib/equipment-eol-sweep.ts.
// NO DB / env / I/O here so it unit-tests cleanly via
// `npx tsx scripts/test-tenancy-insurance.ts`. The impure pieces (per-org
// queries, the once-per-term stamp, the send) live in
// app/api/cron/tenancy-insurance/route.ts; the status math is
// lib/tenancy-insurance.ts and copy/recipients/branding ride the notification
// substrate (lib/notifications*).
//
// Structurally identical to lib/equipment-eol-sweep.ts, anchored to each
// policy's expiry date.

import { isActionableInsuranceStatus, type InsuranceStatus } from "./tenancy-insurance";

export type InsuranceNudgeDecision = {
  /** Send a reminder for this policy on this tick? */
  nudge: boolean;
  /** Why (for the sweep summary / tests). */
  reason: string;
  /**
   * The value to persist to tenancy_insurance.lapse_nudged_for when we send —
   * the STABLE expiry date (NOT a slipping "days overdue" figure), so the
   * reminder fires exactly once per policy term even as the status walks
   * expiring_soon -> lapsed and sits there. Null when there's nothing to stamp.
   */
  stampFor: string | null;
};

/**
 * Decide whether to nudge ONE insurance policy this tick. Pure.
 *   - not actionable (unknown/ok status, or no expiry date) -> no
 *   - already nudged for THIS expiry date (stamp == expiryDate) -> no
 *   - otherwise -> yes, and stamp the expiryDate
 *
 * Because the stamp keys on the expiry date (stable for a given policy term
 * until it's renewed), the reminder fires exactly once per term even while it
 * sits in the lapsed band. Logging a renewal (new expiry date) makes the stamp
 * no longer match, so the next term re-arms automatically.
 */
export function decideInsuranceNudge(args: {
  expiryDate: string | null;
  status: InsuranceStatus;
  lastNudgedFor: string | null; // tenancy_insurance.lapse_nudged_for
  force?: boolean; // test affordance: bypass the already-nudged gate
}): InsuranceNudgeDecision {
  if (args.expiryDate == null) {
    return { nudge: false, reason: "no_expiry_date", stampFor: null };
  }
  if (!isActionableInsuranceStatus(args.status)) {
    return { nudge: false, reason: `not_actionable:${args.status}`, stampFor: null };
  }
  const stampFor = args.expiryDate;
  if (!args.force && args.lastNudgedFor && args.lastNudgedFor === stampFor) {
    return { nudge: false, reason: "already_nudged", stampFor };
  }
  return { nudge: true, reason: "due", stampFor };
}
