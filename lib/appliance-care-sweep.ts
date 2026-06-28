// Pure selection + idempotency logic for the appliance-care reminders (S362) —
// the date-anchored-per-record half of the free compliance wedge, the sibling of
// lib/detector-eol-sweep.ts and lib/equipment-eol-sweep.ts. NO DB / env / I/O here
// so it unit-tests cleanly via `npx tsx scripts/test-appliance-care.ts`. The
// impure pieces (per-org queries, the stamps, the send) live in
// app/api/cron/appliance-care/route.ts; the care math is lib/appliance-care.ts and
// copy/recipients/branding ride the notification substrate (lib/notifications*).
//
// One generic decision function serves BOTH reminders (warranty + recurring
// consumable). They differ only in the target date and the stamp column, both
// supplied by the caller:
//   * WARRANTY (one-shot): targetDate = the STABLE warranty-expiry date; stamping
//     it gates the email to once per appliance lifecycle (re-arms only if the
//     purchase date / warranty length changes).
//   * CONSUMABLE (recurring): targetDate = the next-due date (anchor + interval);
//     stamping it gates the email to once per pending cycle. A one-tap "mark
//     replaced" rolls the anchor to today => a new next-due => the stamp no longer
//     matches => the next cycle re-arms. THIS is the recurrence the once-per-
//     lifecycle detector/equipment sweep doesn't cover.

import { isActionableApplianceStatus, type ApplianceStatus } from "./appliance-care";

export type ApplianceNudgeDecision = {
  /** Send a reminder for this target on this tick? */
  nudge: boolean;
  /** Why (for the sweep summary / tests). */
  reason: string;
  /**
   * The value to persist to the relevant *_nudged_for column when we send — the
   * STABLE target date (the warranty expiry, or the consumable next-due), NOT a
   * slipping "days overdue" figure — so the reminder fires exactly once while the
   * target holds, and re-arms when the target moves. Null when nothing to stamp.
   */
  stampFor: string | null;
};

/**
 * Decide whether to nudge ONE appliance reminder (warranty OR consumable) this
 * tick. Pure.
 *   - no target date (not configured / unknown anchor) -> no
 *   - not actionable (ok status) -> no
 *   - already nudged for THIS target date (stamp == targetDate) -> no
 *   - otherwise -> yes, and stamp the targetDate
 *
 * Because the stamp keys on the target date, the reminder fires exactly once
 * while that date holds; when the date moves (a replacement logged / marked) the
 * stamp no longer matches and the next cycle re-arms automatically.
 */
export function decideApplianceNudge(args: {
  targetDate: string | null;
  status: ApplianceStatus;
  lastNudgedFor: string | null; // the relevant *_nudged_for column
  force?: boolean; // test affordance: bypass the already-nudged gate
}): ApplianceNudgeDecision {
  if (args.targetDate == null) {
    return { nudge: false, reason: "no_target_date", stampFor: null };
  }
  if (!isActionableApplianceStatus(args.status)) {
    return { nudge: false, reason: `not_actionable:${args.status}`, stampFor: null };
  }
  const stampFor = args.targetDate;
  if (!args.force && args.lastNudgedFor && args.lastNudgedFor === stampFor) {
    return { nudge: false, reason: "already_nudged", stampFor };
  }
  return { nudge: true, reason: "due", stampFor };
}
