// Pure selection + idempotency logic for the per-tenancy renter's-insurance
// lapse reminder sweep (S382) — the date-anchored-per-record half of the free
// compliance wedge, the tenancy-scoped sibling of lib/equipment-eol-sweep.ts.
// NO DB / env / I/O here so it unit-tests cleanly via
// `npx tsx scripts/test-tenancy-insurance.ts`. The impure pieces (per-org
// queries, the per-phase stamp, the send) live in
// app/api/cron/tenancy-insurance/route.ts; the status math is
// lib/tenancy-insurance.ts and copy/recipients/branding ride the notification
// substrate (lib/notifications*).
//
// Structurally identical to lib/equipment-eol-sweep.ts, anchored to each
// policy's expiry date — BUT the renter's-insurance contract promises TWO
// reminders per term: one ~30 days out (expiring_soon) and one once the policy
// lapses. Keying idempotency on the expiry date ALONE would let the first email
// suppress the second (S384 / Codex finding). So idempotency is PHASE-AWARE:
// the pre-expiry and lapsed phases each carry their own stamp column
// (tenancy_insurance.expiring_nudged_for and .lapse_nudged_for), and each fires
// exactly once per term. A renewal (new expiry date) makes both stamps mismatch
// and re-arms the next term.

import { isActionableInsuranceStatus, type InsuranceStatus } from "./tenancy-insurance";

/** The DB column a given phase stamps for idempotency. */
export type InsuranceStampColumn = "expiring_nudged_for" | "lapse_nudged_for";

export type InsuranceNudgeDecision = {
  /** Send a reminder for this policy on this tick? */
  nudge: boolean;
  /** Why (for the sweep summary / tests). */
  reason: string;
  /**
   * Which stamp column the firing PHASE owns (expiring_soon -> expiring_nudged_for,
   * lapsed -> lapse_nudged_for). Non-null whenever the policy is actionable, so the
   * cron knows where to read/write even on an already-nudged tick; null only when
   * the policy isn't actionable at all.
   */
  stampColumn: InsuranceStampColumn | null;
  /**
   * The value to persist to the phase's stamp column when we send — the STABLE
   * expiry date (NOT a slipping "days overdue" figure), so each phase fires
   * exactly once per policy term. Null when there's nothing to stamp.
   */
  stampFor: string | null;
};

/**
 * Decide whether to nudge ONE insurance policy this tick. Pure.
 *   - not actionable (unknown/ok status, or no expiry date) -> no
 *   - actionable: pick the phase's stamp column (expiring_soon -> expiring_nudged_for,
 *     lapsed -> lapse_nudged_for); if THAT column already == the expiry date -> no
 *   - otherwise -> yes, and stamp the expiry date in the phase's column
 *
 * Because each phase keys its own stamp on the expiry date (stable for a given
 * term until renewed), a policy gets the expiring-soon email AND, later, the
 * lapsed email for the same expiry — each exactly once. Logging a renewal (new
 * expiry date) makes both stamps mismatch, so the next term re-arms.
 */
export function decideInsuranceNudge(args: {
  expiryDate: string | null;
  status: InsuranceStatus;
  expiringNudgedFor: string | null; // tenancy_insurance.expiring_nudged_for
  lapseNudgedFor: string | null; // tenancy_insurance.lapse_nudged_for
  force?: boolean; // test affordance: bypass the already-nudged gate
}): InsuranceNudgeDecision {
  if (args.expiryDate == null) {
    return { nudge: false, reason: "no_expiry_date", stampColumn: null, stampFor: null };
  }
  if (!isActionableInsuranceStatus(args.status)) {
    return { nudge: false, reason: `not_actionable:${args.status}`, stampColumn: null, stampFor: null };
  }
  // Phase-aware idempotency: the lapsed phase tracks its own stamp so the
  // earlier expiring-soon email can never suppress it (and vice versa).
  const stampColumn: InsuranceStampColumn =
    args.status === "lapsed" ? "lapse_nudged_for" : "expiring_nudged_for";
  const lastStamp =
    stampColumn === "lapse_nudged_for" ? args.lapseNudgedFor : args.expiringNudgedFor;
  const stampFor = args.expiryDate;
  if (!args.force && lastStamp && lastStamp === stampFor) {
    return { nudge: false, reason: "already_nudged", stampColumn, stampFor };
  }
  return { nudge: true, reason: "due", stampColumn, stampFor };
}
