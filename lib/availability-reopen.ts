import { buildingOpenWeekdays, type BuildingDayRow } from "@/lib/booking";
import {
  NURTURE_MAX_AGE_MS,
  NURTURABLE_STATUSES,
} from "@/lib/nurture";

export const REOPEN_NOTIFY_MAX_PER_ORG = 25;

export function isReopenLeadEligible(args: {
  noSuitableTime: boolean;
  status: string;
  propertyStatus: string | null;
  createdAtMs: number | null;
  nowMs: number;
  reopenNotifiedAtMs: number | null;
  reopenedAtMs: number | null;
}): boolean {
  if (!args.noSuitableTime) return false;
  if (!(NURTURABLE_STATUSES as readonly string[]).includes(args.status)) {
    return false;
  }
  if (args.propertyStatus !== "available") return false;
  if (args.createdAtMs == null) return false;

  const ageMs = args.nowMs - args.createdAtMs;
  if (ageMs < 0 || ageMs > NURTURE_MAX_AGE_MS) return false;

  if (args.reopenedAtMs == null) return false;
  return (
    args.reopenNotifiedAtMs == null ||
    args.reopenNotifiedAtMs < args.reopenedAtMs
  );
}

export function reopenLeadsToNotify<T>(open: number, eligible: T[]): T[] {
  if (open < 1) return [];
  return eligible.slice(0, REOPEN_NOTIFY_MAX_PER_ORG);
}

/**
 * S709: keep only leads whose building has an open viewing time on its own
 * building days. `openFor(days)` counts open slots for a weekday limit (null =
 * every viewing day); it is called once per distinct limit. Pure.
 */
export function reopenLeadsWithOpenBuilding<T>(
  eligible: T[],
  buildingKeyOf: (lead: T) => string | null,
  rows: BuildingDayRow[],
  openFor: (weekdays: number[] | null) => number,
): T[] {
  const cache = new Map<string, number>();
  return eligible.filter((lead) => {
    const days = buildingOpenWeekdays(buildingKeyOf(lead), rows);
    const key = days === null ? "all" : days.join(",");
    let open = cache.get(key);
    if (open === undefined) {
      open = openFor(days);
      cache.set(key, open);
    }
    return open > 0;
  });
}
