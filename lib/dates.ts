// S748: one home for the display time zone of server-rendered dates.
//
// Pages run on Vercel in UTC. A date formatted there without a time zone
// shows UTC: an upload at 9 PM in Toronto read as the next day. Anything
// tied to a booking (reminders, viewing times, send hours) already uses the
// account's own zone (organizations.booking_timezone, set from the first
// rental by migration 0268). Plain labels ("uploaded", "last checked") use
// this default; pass an account's zone where the page has it.

export const DEFAULT_TIME_ZONE = "America/Toronto";

/** The zone to show times in: the account's, else the default. Pure. */
export function displayTimeZone(tz?: string | null): string {
  if (!tz) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
