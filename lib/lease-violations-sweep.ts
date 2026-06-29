// Pure selection + idempotency logic for the per-tenancy lease-violation
// follow-up reminder sweep (S383) — the date-anchored-per-record half of the
// free compliance wedge, the tenancy-scoped sibling of
// lib/tenancy-insurance-sweep.ts. NO DB / env / I/O here so it unit-tests
// cleanly via `npx tsx scripts/test-lease-violations.ts`. The impure pieces
// (per-org queries, the once-per-deadline stamp, the send) live in
// app/api/cron/violation-followup/route.ts; the status math is
// lib/lease-violations.ts and copy/recipients/branding ride the notification
// substrate (lib/notifications*).
//
// Structurally identical to lib/tenancy-insurance-sweep.ts, anchored to each
// open violation's remedy_due_on deadline.

import { isActionableFollowupStatus, type FollowupStatus } from "./lease-violations";

export type ViolationNudgeDecision = {
  /** Send a reminder for this violation on this tick? */
  nudge: boolean;
  /** Why (for the sweep summary / tests). */
  reason: string;
  /**
   * The value to persist to tenancy_violations.followup_nudged_for when we send
   * — the STABLE remedy_due_on date (NOT a slipping "days overdue" figure), so
   * the reminder fires exactly once per deadline even as the status walks
   * approaching -> overdue and sits there. Null when there's nothing to stamp.
   */
  stampFor: string | null;
};

/**
 * Decide whether to nudge ONE violation this tick. Pure.
 *   - not actionable (none/ok status, not open, or no remedy deadline) -> no
 *   - already nudged for THIS deadline (stamp == remedyDueOn) -> no
 *   - otherwise -> yes, and stamp the remedyDueOn
 *
 * Because the stamp keys on the remedy deadline (stable until it's edited or the
 * record is reopened), the reminder fires exactly once per deadline even while
 * it sits overdue. Editing the deadline (or reopening a closed record and
 * setting a new deadline) makes the stamp no longer match, so it re-arms.
 */
export function decideViolationNudge(args: {
  remedyDueOn: string | null;
  status: FollowupStatus;
  lastNudgedFor: string | null; // tenancy_violations.followup_nudged_for
  force?: boolean; // test affordance: bypass the already-nudged gate
}): ViolationNudgeDecision {
  if (args.remedyDueOn == null) {
    return { nudge: false, reason: "no_remedy_deadline", stampFor: null };
  }
  if (!isActionableFollowupStatus(args.status)) {
    return { nudge: false, reason: `not_actionable:${args.status}`, stampFor: null };
  }
  const stampFor = args.remedyDueOn;
  if (!args.force && args.lastNudgedFor && args.lastNudgedFor === stampFor) {
    return { nudge: false, reason: "already_nudged", stampFor };
  }
  return { nudge: true, reason: "due", stampFor };
}
