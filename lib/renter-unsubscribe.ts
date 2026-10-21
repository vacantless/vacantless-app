// S728: the unsubscribe link at the foot of every marketing email to a renter
// (follow-ups, new viewing times, waitlist, price drop). Pure half: sign and
// verify the token. Server half: lib/renter-unsubscribe-server.ts.
//
// The token is the lead id plus a short HMAC, same shape as the Add to
// calendar token. Opening the link only RENDERS; the button POSTs, so an email
// scanner that prefetches the link can never unsubscribe a renter.

import { createHmac, timingSafeEqual } from "crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIG_LEN = 32;

export type UnsubscribeSubject = "lead" | "waitlist";

/** Token: "l-<id>.<sig>" for a lead, "w-<id>.<sig>" for a waiting-list entry. */
export function signRenterUnsubscribeToken(id: string, secret: string, subject: UnsubscribeSubject = "lead"): string {
  const prefix = subject === "waitlist" ? "w" : "l";
  const sig = createHmac("sha256", `renter-unsubscribe:${secret}`)
    .update(`${prefix}:${id.toLowerCase()}`)
    .digest("hex")
    .slice(0, SIG_LEN);
  return `${prefix}-${id.toLowerCase()}.${sig}`;
}

/** The subject and id when the token is genuine, else null. */
export function verifyRenterUnsubscribeToken(
  token: string | null | undefined,
  secret: string,
): { subject: UnsubscribeSubject; id: string } | null {
  const t = (token ?? "").trim().toLowerCase();
  const m = /^([lw])-([0-9a-f-]{36})\.([0-9a-f]+)$/.exec(t);
  if (!m || !secret) return null;
  const subject: UnsubscribeSubject = m[1] === "w" ? "waitlist" : "lead";
  const id = m[2];
  if (!UUID_RE.test(id)) return null;
  const want = Buffer.from(signRenterUnsubscribeToken(id, secret, subject));
  const got = Buffer.from(t);
  if (want.length !== got.length) return null;
  return timingSafeEqual(want, got) ? { subject, id } : null;
}
