// S715: emails that are not urgent wait for daytime in the account's own time
// zone. The ad-refresh email went out at 12:15 AM and a renter's "How was your
// viewing?" at 11:46 PM. Both crons run every 15 minutes, so holding until the
// morning costs at most one night.

export const DAYTIME_START_HOUR = 8; // 8:00 AM, inclusive
export const DAYTIME_END_HOUR = 21; // 9:00 PM, exclusive

/** The hour (0-23) in a time zone; falls back to Toronto on a bad zone. Pure. */
export function localHour(now: Date, timeZone: string | null | undefined): number {
  const fmt = (tz: string) =>
    Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now),
    );
  try {
    return fmt(timeZone || "America/Toronto");
  } catch {
    return fmt("America/Toronto");
  }
}

/** Is it daytime (8 AM to 9 PM) where the account is? Pure. */
export function isDaytime(
  now: Date,
  timeZone: string | null | undefined,
  startHour = DAYTIME_START_HOUR,
  endHour = DAYTIME_END_HOUR,
): boolean {
  const h = localHour(now, timeZone);
  return h >= startHour && h < endHour;
}
