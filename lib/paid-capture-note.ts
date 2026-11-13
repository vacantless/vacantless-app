// S786: "I paid" on a paid Kijiji ad, and what the row says after.
//
// The robot builds a paid Kijiji ad and stops at Kijiji's checkout
// (needs_payment). The landlord pays on Kijiji. "I paid" writes
// paid_pressed_at:<iso> into the item's notes and wakes the worker's
// paid-capture job, which saves the new ad's link (usually in minutes, not at
// its 2-hourly run). If paid-capture cannot save it, it writes why on the
// item's error_message starting with CAPTURE_NOTE_PREFIX (vacantless-worker
// src/paid-capture-logic.ts; keep the two in step).

export const CAPTURE_NOTE_PREFIX = "Saving your Kijiji link:";

export function paidPressedNote(iso: string): string {
  return `paid_pressed_at:${iso}`;
}

export function paidPressedAt(notes: string | null | undefined): Date | null {
  const all = [...(notes ?? "").matchAll(/paid_pressed_at:(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/g)];
  if (all.length === 0) return null;
  const d = new Date(all[all.length - 1][1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The worker's note on why the link is not saved yet, without its prefix; null when there is none. */
export function captureNote(errorMessage: string | null | undefined): string | null {
  const m = (errorMessage ?? "").trim();
  if (!m.startsWith(CAPTURE_NOTE_PREFIX)) return null;
  const rest = m.slice(CAPTURE_NOTE_PREFIX.length).trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : null;
}

/** "I paid" is offered on sites paid-capture reads. */
export function offersIPaid(channel: string): boolean {
  return channel === "kijiji";
}
