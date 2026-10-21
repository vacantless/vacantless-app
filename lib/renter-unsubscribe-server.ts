// S728: env half of the renter unsubscribe link (pure half: lib/renter-unsubscribe.ts).
import { signRenterUnsubscribeToken, type UnsubscribeSubject } from "@/lib/renter-unsubscribe";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

export function renterUnsubscribeSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET || "";
}

/** The unsubscribe page for a renter, or "" when the server has no key. */
export function renterUnsubscribeUrl(id: string | null | undefined, subject: UnsubscribeSubject = "lead"): string {
  const s = renterUnsubscribeSecret();
  if (!id || !s) return "";
  return `${APP_URL}/unsubscribe/${signRenterUnsubscribeToken(id, s, subject)}`;
}
