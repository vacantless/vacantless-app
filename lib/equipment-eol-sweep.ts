// Pure selection + idempotency logic for the major-equipment end-of-life reminder
// sweep (S361) — the date-anchored-per-record half of the free compliance wedge,
// the sibling of lib/detector-eol-sweep.ts and the asset-tracked cousin of the
// rent-increase autopilot. NO DB / env / I/O here so it unit-tests cleanly via
// `npx tsx scripts/test-equipment-eol.ts`. The impure pieces (per-org queries,
// the once-per-lifecycle stamp, the send) live in app/api/cron/equipment-eol/
// route.ts; the EOL math is lib/equipment-eol.ts and copy/recipients/branding
// ride the notification substrate (lib/notifications*).
//
// Structurally identical to lib/detector-eol-sweep.ts, anchored to each item's
// end-of-life date.

import { isActionableEquipmentStatus, type EquipmentStatus } from "./equipment-eol";

export type EquipmentNudgeDecision = {
  /** Send a reminder for this item on this tick? */
  nudge: boolean;
  /** Why (for the sweep summary / tests). */
  reason: string;
  /**
   * The value to persist to unit_equipment.eol_nudged_for when we send — the
   * STABLE end-of-life date (NOT a slipping "days overdue" figure), so the
   * reminder fires exactly once per item lifecycle even as the status walks
   * due_soon -> overdue and sits there. Null when there's nothing to stamp.
   */
  stampFor: string | null;
};

/**
 * Decide whether to nudge ONE equipment item this tick. Pure.
 *   - not actionable (unknown/ok status, or no EOL date) -> no
 *   - already nudged for THIS end-of-life date (stamp == eolDate) -> no
 *   - otherwise -> yes, and stamp the eolDate
 *
 * Because the stamp keys on the EOL date (stable for a given item until it's
 * replaced), the reminder fires exactly once per lifecycle even while it sits in
 * the overdue band. Logging a replacement (new install date -> new EOL date)
 * makes the stamp no longer match, so the next lifecycle re-arms automatically.
 */
export function decideEquipmentNudge(args: {
  eolDate: string | null;
  status: EquipmentStatus;
  lastNudgedFor: string | null; // unit_equipment.eol_nudged_for
  force?: boolean; // test affordance: bypass the already-nudged gate
}): EquipmentNudgeDecision {
  if (args.eolDate == null) {
    return { nudge: false, reason: "no_eol_date", stampFor: null };
  }
  if (!isActionableEquipmentStatus(args.status)) {
    return { nudge: false, reason: `not_actionable:${args.status}`, stampFor: null };
  }
  const stampFor = args.eolDate;
  if (!args.force && args.lastNudgedFor && args.lastNudgedFor === stampFor) {
    return { nudge: false, reason: "already_nudged", stampFor };
  }
  return { nudge: true, reason: "due", stampFor };
}
