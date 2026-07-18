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
