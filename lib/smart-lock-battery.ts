// Pure recurring cadence logic for the smart-lock battery reminder (S610).
// No DB / env / I/O so it unit-tests cleanly via scripts/test-smart-lock-battery.ts.

export const SMART_LOCK_BATTERY_INTERVAL_MONTHS = 6;

function parseDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const hh = date.getUTCHours();
  const mm = date.getUTCMinutes();
  const ss = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();

  const firstOfTarget = new Date(Date.UTC(y, m + months, 1, hh, mm, ss, ms));
  const lastDay = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(d, lastDay));
  return firstOfTarget;
}

/**
 * Next time a smart-lock battery reminder is due. A never-reminded flagged unit
 * is due immediately, so there is no synthetic date to return.
 */
export function nextSmartLockBatteryReminderDueAt(
  lastSentAt: string | Date | null | undefined,
  intervalMonths: number = SMART_LOCK_BATTERY_INTERVAL_MONTHS,
): Date | null {
  const last = parseDate(lastSentAt);
  if (!last) return null;
  return addMonthsUtc(last, Math.max(1, Math.floor(intervalMonths)));
}

/**
 * Recurring reminder gate. Null/invalid last-sent timestamps are treated as due,
 * which lets a unit become eligible as soon as has_smart_lock is set.
 */
export function isSmartLockBatteryReminderDue(args: {
  lastSentAt?: string | Date | null;
  now?: string | Date | null;
  intervalMonths?: number;
}): boolean {
  const now = parseDate(args.now ?? new Date());
  if (!now) return false;
  const nextDue = nextSmartLockBatteryReminderDueAt(
    args.lastSentAt ?? null,
    args.intervalMonths ?? SMART_LOCK_BATTERY_INTERVAL_MONTHS,
  );
  return nextDue == null || nextDue.getTime() <= now.getTime();
}
