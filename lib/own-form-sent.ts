// S826a: one wording for "we sent this renter the account's own application
// form" (Buildium and the like), so the renter page, the "Sent" line on the
// button and the rented notice all read the same timeline note. Pure.
//
// Why it matters (Noam, 2026-11-21, "fix the bug now"): sending the Buildium
// link does not move the renter's stage, and Vacantless never hears when they
// apply there. Without this, marking the unit Rented emailed "it has been
// rented" to the very renter who applied in Buildium and closed them as Lost.

export const OWN_FORM_SENT_PHRASE = "application link sent to";

export function ownFormSentNote(args: {
  formName: string | null;
  to: string;
  by: string;
  emailed: boolean;
}): string {
  return (
    `${args.formName ?? "Your own"} ${OWN_FORM_SENT_PHRASE} ${args.to} by ${args.by}` +
    (args.emailed ? " (emailed)." : " (not emailed: no email on file, so copy the link to them).")
  );
}

export function isOwnFormSentNote(body: string | null | undefined, channel?: string | null): boolean {
  if (channel != null && channel !== "note") return false;
  return (body ?? "").toLowerCase().includes(OWN_FORM_SENT_PHRASE);
}

/** The newest own-form send on this renter, from their timeline. Pure. */
export function lastOwnFormSentAt(
  messages: { channel: string | null; body: string | null; created_at: string }[],
): string | null {
  let best: string | null = null;
  for (const m of messages) {
    if (!isOwnFormSentNote(m.body, m.channel)) continue;
    if (!best || Date.parse(m.created_at) > Date.parse(best)) best = m.created_at;
  }
  return best;
}
