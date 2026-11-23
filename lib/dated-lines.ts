// S830g: dated lines in a rental's description that have gone stale.
// Noam, 2026-11-22: "it would be good if time based details had expiries".
// 251 Manitoba's ads still said "No showings before October 26, 2026" a month
// after that date. A sentence with a calendar date that has passed is flagged;
// the landlord fixes it with one tap (never cut on our own: "Available
// December 15" should become "Available now", not vanish). Pure, no I/O.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export type DatedLine = {
  /** The sentence exactly as it appears in the description. */
  sentence: string;
  /** The date in it, YYYY-MM-DD. */
  dateKey: string;
  /** What the fix puts in its place; "" removes it. */
  replacement: string;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * The latest calendar date written in a sentence, or null. "October 26, 2026",
 * "Oct 26th", "26 October 2026" and "2026-10-26" are read. A date with no year
 * takes today's year, or last year when that would put it more than six
 * months ahead ("Dec 15" read in January is last December).
 */
export function dateInSentence(sentence: string, todayKey: string): string | null {
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const todayMs = Date.UTC(ty, tm - 1, td);
  const found: string[] = [];
  const push = (y: number | null, m: number, d: number) => {
    let year = y ?? ty;
    if (y == null && Date.UTC(year, m - 1, d) - todayMs > 183 * 86_400_000) year -= 1;
    if (validDay(year, m, d)) found.push(`${year}-${pad(m)}-${pad(d)}`);
  };
  const s = sentence.toLowerCase();
  const monthNames = Object.keys(MONTHS).join("|");
  for (const m of s.matchAll(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "g"))) {
    push(m[3] ? Number(m[3]) : null, MONTHS[m[1]], Number(m[2]));
  }
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\.?(?:,?\\s+(\\d{4}))?\\b`, "g"))) {
    push(m[3] ? Number(m[3]) : null, MONTHS[m[2]], Number(m[1]));
  }
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(Number(m[1]), Number(m[2]), Number(m[3]));
  return found.length ? found.sort().at(-1)! : null;
}

/** Sentences of a description, kept exactly as written. */
function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((para) => para.split(/(?<=[.!?])\s+/))
    .map((x) => x.trim())
    .filter(Boolean);
}

/** The fix for a stale sentence: an "Available ..." line becomes "Available now."; anything else goes. */
export function fixFor(sentence: string): string {
  return /^available\b/i.test(sentence.trim()) ? "Available now." : "";
}

/** Every sentence whose date is before today (YYYY-MM-DD, the landlord's time zone). */
export function expiredDatedLines(description: string | null | undefined, todayKey: string): DatedLine[] {
  const out: DatedLine[] = [];
  for (const sentence of sentences(String(description ?? ""))) {
    const dateKey = dateInSentence(sentence, todayKey);
    if (dateKey && dateKey < todayKey) out.push({ sentence, dateKey, replacement: fixFor(sentence) });
  }
  return out;
}

/** The description with that one sentence fixed. Null when the sentence is not there. */
export function applyDatedLineFix(description: string, sentence: string): string | null {
  const i = description.indexOf(sentence);
  if (i < 0 || !sentence.trim()) return null;
  const replacement = fixFor(sentence);
  let before = description.slice(0, i);
  let after = description.slice(i + sentence.length);
  if (!replacement) {
    // Drop the space after it, or an empty paragraph left behind.
    after = after.replace(/^[ \t]+/, "");
    if (/(^|\n)\s*$/.test(before) && /^\s*(\n|$)/.test(after)) {
      before = before.replace(/[ \t]*\n?[ \t]*$/, before.endsWith("\n\n") ? "\n" : "");
      after = after.replace(/^\s*\n/, "\n");
    }
  }
  return (before + replacement + after).replace(/\n{3,}/g, "\n\n").trim();
}

/** The line on Today and on the rental page. */
export function datedLineNotice(addressShort: string, line: DatedLine): string {
  const what = line.replacement ? `Change it to "${line.replacement}"` : "Remove it";
  return `${addressShort}'s ad still says "${line.sentence}" That date has passed. ${what}?`;
}
