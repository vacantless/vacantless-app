import { generateSlots, type Availability } from "./booking";
import { localDateString, localHour, localWeekday } from "./leasing-snapshot";

const DAY_MS = 24 * 3_600_000;

export const VIEWING_REMINDER_LOOKAHEAD_DAYS = 7;
export const VIEWING_REMINDER_MIN_OPEN_SLOTS = 1;

export type ViewingReminderGate = {
  send: boolean;
  localDate: string;
  reason: "due" | "wrong_day" | "before_hour" | "already_sent";
};

function parseLocalDateMs(day: string | null): number | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function sentWithinCurrentReminderWeek(
  lastSentOn: string | null,
  localDate: string,
): boolean {
  const last = parseLocalDateMs(lastSentOn);
  const today = parseLocalDateMs(localDate);
  if (last == null || today == null) return false;
  const diffDays = Math.floor((today - last) / DAY_MS);
  return diffDays < 0 || diffDays <= 6;
}

/**
 * Weekly org-local gate for the viewing-times reminder. The sweep may run every
 * 15 minutes, so this stays idempotent by requiring the chosen weekday/hour and
 * a last-sent stamp outside the current seven-day reminder window.
 */
export function shouldSendViewingReminder(args: {
  nowMs: number;
  tz: string;
  weekday: number;
  hour: number;
  lastSentOn: string | null;
}): ViewingReminderGate {
  const localDate = localDateString(args.nowMs, args.tz);
  const weekday = Number.isInteger(args.weekday) ? args.weekday : 0;
  const hour = Number.isInteger(args.hour) ? args.hour : 17;

  if (localWeekday(args.nowMs, args.tz) !== weekday) {
    return { send: false, localDate, reason: "wrong_day" };
  }
  if (sentWithinCurrentReminderWeek(args.lastSentOn, localDate)) {
    return { send: false, localDate, reason: "already_sent" };
  }
  if (localHour(args.nowMs, args.tz) < hour) {
    return { send: false, localDate, reason: "before_hour" };
  }
  return { send: true, localDate, reason: "due" };
}

function reminderAvailability(av: Availability): Availability {
  const configuredHorizon =
    Number.isFinite(av.horizon_days) && av.horizon_days > 0
      ? av.horizon_days
      : VIEWING_REMINDER_LOOKAHEAD_DAYS;
  return {
    ...av,
    horizon_days: Math.min(configuredHorizon, VIEWING_REMINDER_LOOKAHEAD_DAYS),
  };
}

export function openViewingDaysNext7(
  availability: Availability,
  now: Date = new Date(),
): string[] {
  const endMs = now.getTime() + VIEWING_REMINDER_LOOKAHEAD_DAYS * DAY_MS;
  const dayKeys = new Set<string>();
  for (const day of generateSlots(reminderAvailability(availability), now)) {
    if (day.slots.some((slot) => new Date(slot.iso).getTime() < endMs)) {
      dayKeys.add(day.dayKey);
    }
  }
  return [...dayKeys].sort();
}

export function countOpenViewingSlotsNext7(
  availability: Availability,
  now: Date = new Date(),
): number {
  const endMs = now.getTime() + VIEWING_REMINDER_LOOKAHEAD_DAYS * DAY_MS;
  let count = 0;
  for (const day of generateSlots(reminderAvailability(availability), now)) {
    for (const slot of day.slots) {
      const slotMs = new Date(slot.iso).getTime();
      if (!Number.isNaN(slotMs) && slotMs < endMs) count++;
    }
  }
  return count;
}

export function isViewingWeekEmpty(
  availability: Availability,
  now: Date = new Date(),
): boolean {
  return (
    countOpenViewingSlotsNext7(availability, now) <
    VIEWING_REMINDER_MIN_OPEN_SLOTS
  );
}
