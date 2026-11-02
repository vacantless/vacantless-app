// S742e: the pure rules for "this one rented, here are the others".
// A renter still waiting on a rental (New, Replied, Contacted) is told when it
// rents, shown up to three other open homes, and moved to Lost on that rental.
import { NURTURABLE_STATUSES } from "./nurture";

/** A renter who asked more than this long ago is not written to. */
export const RENTED_NOTICE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
/** At most this many renters per rental in one lease-up. */
export const RENTED_NOTICE_MAX_PER_PROPERTY = 25;
export const RENTED_NOTICE_OTHER_UNITS = 3;

export type WaitingLead = {
  id: string;
  name: string | null;
  email: string | null;
  status: string | null;
  created_at: string | null;
};

/** Which leads get the email: open stage, recent, with an email, one per address. Pure. */
export function leadsToNotify(leads: WaitingLead[], nowMs: number): WaitingLead[] {
  const seen = new Set<string>();
  const out: WaitingLead[] = [];
  for (const l of leads) {
    if (!(NURTURABLE_STATUSES as readonly string[]).includes(l.status ?? "")) continue;
    const email = (l.email ?? "").trim().toLowerCase();
    if (!email) continue;
    const created = l.created_at ? Date.parse(l.created_at) : NaN;
    if (!Number.isFinite(created) || nowMs - created > RENTED_NOTICE_MAX_AGE_MS) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(l);
    if (out.length >= RENTED_NOTICE_MAX_PER_PROPERTY) break;
  }
  return out;
}

/** The open leads on the rental that cannot be emailed still close as Lost. Pure. */
export function leadsToCloseQuietly(leads: WaitingLead[], notified: WaitingLead[]): WaitingLead[] {
  const sent = new Set(notified.map((l) => l.id));
  return leads.filter(
    (l) => (NURTURABLE_STATUSES as readonly string[]).includes(l.status ?? "") && !sent.has(l.id),
  );
}
