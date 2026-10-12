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
};

export function timezoneLabel(tz: string | null | undefined): string {
  const key = String(tz ?? "").trim();
  if (!key) return "";
  const known = ZONE_LABELS[key];
  if (known) return known;
  const city = key.split("/").pop() ?? key;
  return `${city.replace(/_/g, " ")} time`;
}
