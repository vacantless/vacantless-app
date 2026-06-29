// Pure selection + idempotency logic for the per-tenancy property-inspection
// reminder sweep (S385) — the date-anchored-per-record half of the free
// compliance wedge, the tenancy-scoped sibling of lib/lease-violations-sweep.ts.
// NO DB / env / I/O here so it unit-tests cleanly via
// `npx tsx scripts/test-property-inspections.ts`. The impure pieces (per-org
// queries, the once-per-date stamp, the send) live in
// app/api/cron/inspection-reminder/route.ts; the status math is
// lib/property-inspections.ts and copy/recipients/branding ride the notification
// substrate (lib/notifications*).
//
// Structurally identical to lib/lease-violations-sweep.ts, anchored to each
// scheduled inspection's scheduled_for date.

import { isActionableInspectionDueStatus, type InspectionDueStatus } from "./property-inspections";

export type InspectionNudgeDecision = {
  /** Send a reminder for this inspection on this tick? */
  nudge: boolean;
  /** Why (for the sweep summary / tests). */
  reason: string;
  /**
   * The value to persist to tenancy_inspections.reminder_nudged_for when we send
   * — the STABLE scheduled_for date (NOT a slipping "days overdue" figure), so
   * the reminder fires exactly once per planned date even as the status walks
   * approaching -> overdue and sits there. Null when there's nothing to stamp.
   */
  stampFor: string | null;
};

/**
 * Decide whether to nudge ONE inspection this tick. Pure.
 *   - not actionable (none/ok status, not scheduled, or no planned date) -> no
 *   - already nudged for THIS date (stamp == scheduledFor) -> no
 *   - otherwise -> yes, and stamp the scheduledFor
 *
 * Because the stamp keys on the planned date (stable until it's edited or the
 * record is rescheduled), the reminder fires exactly once per date even while it
 * sits overdue. Editing the date (or reopening a closed record and setting a new
 * date) makes the stamp no longer match, so it re-arms.
 */
export function decideInspectionNudge(args: {
  scheduledFor: string | null;
  status: InspectionDueStatus;
  lastNudgedFor: string | null; // tenancy_inspections.reminder_nudged_for
  force?: boolean; // test affordance: bypass the already-nudged gate
}): InspectionNudgeDecision {
  if (args.scheduledFor == null) {
    return { nudge: false, reason: "no_planned_date", stampFor: null };
  }
  if (!isActionableInspectionDueStatus(args.status)) {
    return { nudge: false, reason: `not_actionable:${args.status}`, stampFor: null };
  }
  const stampFor = args.scheduledFor;
  if (!args.force && args.lastNudgedFor && args.lastNudgedFor === stampFor) {
    return { nudge: false, reason: "already_nudged", stampFor };
  }
  return { nudge: true, reason: "due", stampFor };
}
