// S728: env half of the renter unsubscribe link (pure half: lib/renter-unsubscribe.ts).
import { signRenterUnsubscribeToken, verifyRenterUnsubscribeToken, type UnsubscribeSubject } from "@/lib/renter-unsubscribe";
import { linkSigningSecret, verifyWithAnyKey } from "@/lib/link-signing";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

export function renterUnsubscribeSecret(): string {
  return linkSigningSecret();
}

/** S751: checks a link against the new key and the keys older links were signed with. */
export function verifyRenterUnsubscribeLink(token: string) {
  return verifyWithAnyKey((s) => verifyRenterUnsubscribeToken(token, s));
}

/** The unsubscribe page for a renter, or "" when the server has no key. */
export function renterUnsubscribeUrl(id: string | null | undefined, subject: UnsubscribeSubject = "lead"): string {
  const s = renterUnsubscribeSecret();
  if (!id || !s) return "";
  return `${APP_URL}/unsubscribe/${signRenterUnsubscribeToken(id, s, subject)}`;
}
