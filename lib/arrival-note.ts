// S824f: the renter's arrival note for a rental ("Buzz 20 at the front door.
// Park in the visitor spots."). Renters who book see it in the confirmation,
// the reminders and the day-of texts. It is not the agent's access
// instructions: lockbox and door codes stay on the agent's viewings page, so
// a note that reads like a code is refused. Pure; tests in
// scripts/test-s824f-arrival-note.ts.

export const ARRIVAL_NOTE_MAX = 300;
/** The part of the note a text carries, so the text stays short. */
export const ARRIVAL_NOTE_SMS_MAX = 120;

/** Trimmed, single-spaced, capped; null when empty. */
export function cleanArrivalNote(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, ARRIVAL_NOTE_MAX).trim();
  return s ? s : null;
}

/**
 * True when the note reads like a lockbox, key box or door code: a code word
 * near 3 or more digits. "Buzz 20" and "Unit 2014" pass; "lockbox code 4821"
 * and "door code is 1234" do not.
 */
export function looksLikeAccessCode(note: string | null | undefined): boolean {
  const s = String(note ?? "");
  return /\b(lock ?box|key ?box|key safe|code|combo|combination|passcode|pin|keypad)\b[^.\n]{0,24}?\d{3,}/i.test(s);
}

/** The note shortened for a text, cut at a word, with a full stop. "" when empty. */
export function arrivalNoteForSms(note: string | null | undefined): string {
  const s = cleanArrivalNote(note);
  if (!s) return "";
  let out = s;
  if (out.length > ARRIVAL_NOTE_SMS_MAX) {
    const cut = out.slice(0, ARRIVAL_NOTE_SMS_MAX);
    const sp = cut.lastIndexOf(" ");
    out = (sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "");
  }
  return /[.!?]$/.test(out) ? out : `${out}.`;
}
