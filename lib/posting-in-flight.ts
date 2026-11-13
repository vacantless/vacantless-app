// S786: is any site on this rental's Get online tab still moving? While one
// is, the tab refreshes itself (live-refresh.tsx) so the landlord never has to
// reload to see a post, a payment or a Rentals.ca switch land. Pure.

export type InFlightItem = {
  mode: string;
  publishStatus: string;
  approved?: boolean;
  waitingForSlot?: boolean;
  slotStuck?: boolean;
  paidPressed?: boolean;
  captureNote?: string | null;
};

const MOVING = new Set(["queued", "submitting", "submitted"]);

export function itemInFlight(it: InFlightItem): boolean {
  if (it.mode !== "concierge") return false;
  if (it.publishStatus === "live" || it.publishStatus === "rejected" || it.publishStatus === "skipped") return false;
  if (MOVING.has(it.publishStatus)) return true;
  if (it.waitingForSlot) return !it.slotStuck;
  if (it.publishStatus === "needs_payment" && it.paidPressed) return !it.captureNote;
  if (it.approved && (it.publishStatus === "needs_operator" || it.publishStatus === "needs_payment")) return true;
  return false;
}

export function postingInFlight(items: readonly InFlightItem[]): boolean {
  return items.some(itemInFlight);
}

/** Seconds until the next refresh: every 20 s for 10 minutes, then every minute. */
export function refreshDelayMs(elapsedMs: number): number {
  return elapsedMs < 10 * 60000 ? 20000 : 60000;
}
