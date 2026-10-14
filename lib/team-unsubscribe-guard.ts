// S717: keep one stray "Unsubscribe" click from silently ending a team
// member's alerts (KI1289).
//
// Brevo adds a one-click List-Unsubscribe header to every send, transactional
// included, and only its Enterprise plan can swap it for List-Help. A team
// member who clicks Gmail's "Unsubscribe" on a lead alert lands on Brevo's
// transactional blocklist and every later alert to that address is dropped
// with no error on our side. The real off switch for team alerts is the
// Alerts page in Vacantless, so this sweep takes TEAM addresses (members,
// configured alert recipients, lane recipients, showing agents, the org's
// reply-to and public contact) back off the blocklist when the reason was an
// unsubscribe click. Renters and tenants are never touched: their
// unsubscribe stands. Bounces, spam reports and admin blocks are left alone.

export const BREVO_BLOCKED_ENDPOINT = "https://api.brevo.com/v3/smtp/blockedContacts";

/** Brevo reason codes that mean "the person clicked unsubscribe". */
export const UNSUBSCRIBE_REASON_CODES = new Set([
  "unsubscribedViaEmail",
  "unsubscribedViaApi",
  "unsubscribedViaMA",
]);

export type BrevoBlockedContact = {
  email: string;
  reason?: { code?: string; message?: string } | null;
  blockedAt?: string;
};

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/** Every team address from the raw lists. Pure. */
export function buildTeamAddressSet(lists: Array<Array<string | null | undefined>>): Set<string> {
  const out = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      const e = normalizeEmail(raw);
      if (e) out.add(e);
    }
  }
  return out;
}

/** Blocked team addresses whose block was an unsubscribe click. Pure. */
export function teamAddressesToUnblock(
  blocked: BrevoBlockedContact[],
  team: Set<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const b of blocked) {
    const e = normalizeEmail(b.email);
    if (!e || seen.has(e) || !team.has(e)) continue;
    if (!UNSUBSCRIBE_REASON_CODES.has(b.reason?.code ?? "")) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}
