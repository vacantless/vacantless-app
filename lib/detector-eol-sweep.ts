// Pure selection + idempotency logic for the detector end-of-life reminder sweep
// (S359) — the date-anchored-per-record half of the free compliance wedge, the
// asset-tracked sibling of the rent-increase autopilot. NO DB / env / I/O here so
// it unit-tests cleanly via `npx tsx scripts/test-detector-eol.ts`. The impure
// pieces (per-org detector queries, the once-per-lifecycle stamp, the send) live
// in app/api/cron/detector-eol/route.ts; the EOL math is lib/detector-eol.ts and
// copy/recipients/branding ride the notification substrate (lib/notifications*).
//
// Structurally identical to lib/rent-increase-sweep.ts, anchored to each
// detector's end-of-life date instead of a lease anniversary.

import { isActionableDetectorStatus, type DetectorStatus } from "./detector-eol";

export type DetectorNudgeDecision = {
  /** Send a reminder for this detector on this tick? */
  nudge: boolean;
  /** Why (for the sweep summary / tests). */
  reason: string;
  /**
   * The value to persist to unit_detectors.eol_nudged_for when we send — the
   * STABLE end-of-life date (NOT a slipping "days overdue" figure), so the
   * reminder fires exactly once per detector lifecycle even as the status walks
   * due_soon -> overdue and sits there. Null when there's nothing to stamp.
   */
  stampFor: string | null;
};

/**
 * Decide whether to nudge ONE detector this tick. Pure.
 *   - not actionable (unknown/ok status, or no EOL date) -> no
 *   - already nudged for THIS end-of-life date (stamp == eolDate) -> no
 *   - otherwise -> yes, and stamp the eolDate
 *
 * Because the stamp keys on the EOL date (stable for a given detector until it's
 * replaced), the reminder fires exactly once per lifecycle even while it sits in
 * the overdue band. Logging a replacement (new install date -> new EOL date)
 * makes the stamp no longer match, so the next lifecycle re-arms automatically.
 */
export function decideDetectorNudge(args: {
  eolDate: string | null;
  status: DetectorStatus;
  lastNudgedFor: string | null; // unit_detectors.eol_nudged_for
  force?: boolean; // test affordance: bypass the already-nudged gate
}): DetectorNudgeDecision {
  if (args.eolDate == null) {
    return { nudge: false, reason: "no_eol_date", stampFor: null };
  }
  if (!isActionableDetectorStatus(args.status)) {
    return { nudge: false, reason: `not_actionable:${args.status}`, stampFor: null };
  }
  const stampFor = args.eolDate;
  if (!args.force && args.lastNudgedFor && args.lastNudgedFor === stampFor) {
    return { nudge: false, reason: "already_nudged", stampFor };
  }
  return { nudge: true, reason: "due", stampFor };
}
