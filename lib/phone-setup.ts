// S824d: "Set up my phone" (pure half). The computer shows a QR code that opens
// /phone/<token>; one tap there signs the phone in and, on iPhone, makes the
// Send to Vacantless key and copies it before the Shortcut opens. The server
// half is lib/phone-setup-server.ts; the table is migration 0314.

export const PHONE_SETUP_MINUTES = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPhoneSetupToken(token: string | null | undefined): boolean {
  return UUID_RE.test(String(token ?? "").trim().toLowerCase());
}

export function phoneSetupUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/phone/${token}`;
}

export type PhoneKind = "iphone" | "android" | "other";

/** Which phone opened the page, from its user agent. iPad counts as iPhone. */
export function phoneKind(userAgent: string | null | undefined): PhoneKind {
  const ua = String(userAgent ?? "");
  if (/iPhone|iPad|iPod/i.test(ua)) return "iphone";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

export type PhoneSetupState = "ready" | "used" | "expired" | "missing";

export function phoneSetupState(
  row: { expires_at: string; used_at: string | null } | null,
  nowMs: number,
): PhoneSetupState {
  if (!row) return "missing";
  if (row.used_at) return "used";
  if (Date.parse(row.expires_at) <= nowMs) return "expired";
  return "ready";
}

export const PHONE_SETUP_STATE_LINE: Record<Exclude<PhoneSetupState, "ready">, string> = {
  used: "This code was already used. On your computer, open Quick replies and show a new code.",
  expired: "This code has run out. On your computer, open Quick replies and show a new code.",
  missing: "This code does not work. On your computer, open Quick replies and show a new code.",
};
