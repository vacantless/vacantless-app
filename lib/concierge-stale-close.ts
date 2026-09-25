// ---------------------------------------------------------------------------
// S697g - closing a publish request that nobody needs any more.
//
// The desk only ever emptied by hand: an item left an open state through
// "Mark live" or "Reject", both of which need a person. Nothing closed a
// request when the thing it was for went away. A unit could lease, go off
// market, be archived, or get posted to that same site by another route, and
// its old "post this for me" request sat in the queue forever.
//
// On 2026-09-25 every one of the ten open items was dead that way, the oldest
// by 67 days, and the desk still reported them as work. A queue of ghosts is a
// queue nobody reads, so the one real request that does arrive gets missed.
//
// This module is the pure half: which items may close on their own, and what
// the closing note says. Reaching the database lives in the -server file.
// ---------------------------------------------------------------------------

import {
  CONCIERGE_OPEN_STATUSES,
  type PublishStatus,
} from "@/lib/distribution-publish";
import { TAKEDOWN_TRANSPORT } from "@/lib/distribution-worker";

/** Why an open request stopped being work. */
export const STALE_CLOSE_TRIGGERS = [
  "leased",
  "off_market",
  "archived",
  "already_live",
] as const;
export type StaleCloseTrigger = (typeof STALE_CLOSE_TRIGGERS)[number];

/**
 * Where a self-closed item lands. "skipped" is an existing publish status the
 * schema already allows and isResolvedPublishStatus already treats as settled,
 * so nothing has to migrate and no surface has to learn a new word.
 */
export const STALE_CLOSE_PUBLISH_STATUS: PublishStatus = "skipped";
export const STALE_CLOSE_ROW_STATUS = "skipped";

export type StaleCloseCandidate = {
  publishStatus: PublishStatus | null;
  transport: string | null;
  mode: string | null;
};

/**
 * May this item close by itself?
 *
 * Only an OPEN CONCIERGE POST request. A takedown item is deliberately exempt:
 * after a lease-up, taking the live ad down is still real work, and closing it
 * would leave the ad up with nothing left to say so.
 */
export function shouldStaleCloseItem(item: StaleCloseCandidate): boolean {
  if (item.mode !== "concierge") return false;
  if (item.transport === TAKEDOWN_TRANSPORT) return false;
  if (!item.publishStatus) return false;
  return CONCIERGE_OPEN_STATUSES.includes(item.publishStatus);
}

/**
 * The note left on a closed item, in the desk's own plain voice. It names the
 * one fact that made the request pointless, so the history reads back without
 * anyone having to reconstruct it.
 */
export function staleCloseAudit(
  trigger: StaleCloseTrigger,
  channelLabel: string,
): string {
  switch (trigger) {
    case "leased":
      return `Closed on its own: the unit is leased, so this ${channelLabel} ad is not needed.`;
    case "off_market":
      return `Closed on its own: the unit is off market, so this ${channelLabel} ad is not needed.`;
    case "archived":
      return `Closed on its own: the rental was archived, so this ${channelLabel} ad is not needed.`;
    case "already_live":
      return `Closed on its own: ${channelLabel} is already live for this rental.`;
  }
}

export function isStaleCloseTrigger(value: unknown): value is StaleCloseTrigger {
  return (
    typeof value === "string" &&
    (STALE_CLOSE_TRIGGERS as readonly string[]).includes(value)
  );
}
