// S828c: renters on a rental with no open viewing times say when they can
// come, in a few taps, so whoever books the viewing calls with the times in
// hand. Pure; tested in scripts/test-s828c-viewing-request.ts.

export const AVAILABILITY_PILLS = [
  "Weekday daytime",
  "Weekday evening",
  "Saturday",
  "Sunday",
  "Any time",
] as const;

export const AVAILABILITY_NOTE_MAX = 120;

/** "Weekday evening, Saturday. After 6 on Tuesday" or null when nothing was given. */
export function availabilityLine(pills: readonly unknown[], note: unknown): string | null {
  const allowed = new Set<string>(AVAILABILITY_PILLS);
  const picked = Array.from(
    new Set(pills.map((p) => String(p ?? "").trim()).filter((p) => allowed.has(p))),
  ).sort((a, b) => AVAILABILITY_PILLS.indexOf(a as never) - AVAILABILITY_PILLS.indexOf(b as never));
  const text = String(note ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, AVAILABILITY_NOTE_MAX);
  if (picked.length === 0 && !text) return null;
  const head = picked.join(", ");
  if (head && text) return `${head}. ${text}`;
  return head || text;
}

/** The line in the landlord's new-request email. */
export function requestNoteLine(input: {
  noTimesOpen: boolean;
  noSuitableTime: boolean;
  byRequest: boolean;
  availability: string | null;
}): string {
  const when = input.availability ? ` They can come: ${input.availability}.` : "";
  if (input.noTimesOpen) {
    if (input.byRequest) {
      return input.availability
        ? `They can come: ${input.availability}.`
        : "They did not say when they can come.";
    }
    return `No viewing times were open, so this renter could not book one. Open your times and they can pick.${when}`;
  }
  if (input.noSuitableTime) {
    return `This renter could not find a workable viewing time. Offer other times.${when}`;
  }
  return "";
}

/** What the renter's notes field stores: their message, then when they can come. */
export function notesWithAvailability(notes: string, availability: string | null): string | null {
  const parts = [notes.trim(), availability ? `When I can come: ${availability}` : ""].filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}
