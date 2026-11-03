// S710 audit: renters and landlords saw raw IANA names ("America/Toronto").
// Show the plain zone name people use instead; unknown zones fall back to the
// city part of the IANA name.
const ZONE_LABELS: Readonly<Record<string, string>> = {
  "America/Toronto": "Eastern time",
  "America/New_York": "Eastern time",
  "America/Vancouver": "Pacific time",
  "America/Los_Angeles": "Pacific time",
  "America/Edmonton": "Mountain time",
  "America/Denver": "Mountain time",
  "America/Winnipeg": "Central time",
  "America/Chicago": "Central time",
  "America/Halifax": "Atlantic time",
  "America/St_Johns": "Newfoundland time",
  "America/Regina": "Saskatchewan time",
  "America/Whitehorse": "Yukon time",
};

/** S747: the viewing time zones a landlord can pick, Canada first. One list
 *  for the Viewing times page and the save action. */
export const BOOKING_TIMEZONES: readonly string[] = [
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Regina",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "America/Whitehorse",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

export function timezoneLabel(tz: string | null | undefined): string {
  const key = String(tz ?? "").trim();
  if (!key) return "";
  const known = ZONE_LABELS[key];
  if (known) return known;
  const city = key.split("/").pop() ?? key;
  return `${city.replace(/_/g, " ")} time`;
}
