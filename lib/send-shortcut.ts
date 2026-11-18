// S816l: "Send to Vacantless" from the iPhone share menu. A landlord takes a
// screenshot of a renter chat (Messenger, Kijiji, texts), taps Share, then the
// Apple Shortcut. The Shortcut posts the picture with the landlord's key and
// shows the line we send back. Pure parts here; the route is
// app/api/shortcut/renter and the saving is lib/send-shortcut-server.ts.
import { createHash, randomBytes } from "crypto";
import { screenshotSource } from "./ai-screenshot-lead";

export const SEND_KEY_PREFIX = "vl_";
/** Screenshots read per key per hour. Each one is an AI read. */
export const SEND_HOURLY_LIMIT = 60;

/** A new key: "vl_" and 32 url-safe characters. Shown once, never stored. */
export function makeSendKey(): string {
  return SEND_KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function hashSendKey(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

/** The last 4 characters, so the landlord can tell keys apart. */
export function sendKeyHint(raw: string): string {
  return raw.trim().slice(-4);
}

/** The key from "Authorization: Bearer vl_..." or a "key" form field. */
export function readSendKey(authHeader: string | null | undefined, formKey: unknown): string | null {
  const fromHeader = String(authHeader ?? "").match(/^\s*Bearer\s+(\S+)\s*$/i)?.[1] ?? "";
  const raw = (fromHeader || String(formKey ?? "")).trim();
  return raw.startsWith(SEND_KEY_PREFIX) && raw.length >= 20 && raw.length <= 80 ? raw : null;
}

/** Start a new hour when the last one is over; otherwise count this use. */
export function nextWindow(
  windowStart: string | null,
  uses: number,
  now: Date,
): { allowed: boolean; windowStart: string; uses: number } {
  const start = windowStart ? new Date(windowStart) : null;
  if (!start || Number.isNaN(start.getTime()) || now.getTime() - start.getTime() >= 60 * 60_000) {
    return { allowed: true, windowStart: now.toISOString(), uses: 1 };
  }
  if (uses >= SEND_HOURLY_LIMIT) return { allowed: false, windowStart: start.toISOString(), uses };
  return { allowed: true, windowStart: start.toISOString(), uses: uses + 1 };
}

/** "Facebook Marketplace" when the chat is on Facebook or Messenger, else the screenshot source. */
export function sendSource(site: string | null | undefined): string {
  const s = String(site ?? "").trim();
  if (/marketplace|facebook|messenger/i.test(s)) return "Facebook Marketplace";
  if (/kijiji/i.test(s)) return "Kijiji";
  return screenshotSource(s);
}

export type SendRead = {
  name: string | null;
  email: string | null;
  phone: string | null;
  rentalId: string | null;
};

/** What to do with what the AI read. */
export type SendPlan =
  | { kind: "no_renter" }
  | { kind: "contact"; propertyId: string | null }
  | { kind: "chat_name"; propertyId: string }
  | { kind: "name_no_rental" };

export function planSend(read: SendRead): SendPlan {
  const hasContact = Boolean(read.email || read.phone);
  if (hasContact) return { kind: "contact", propertyId: read.rentalId };
  if (!read.name) return { kind: "no_renter" };
  return read.rentalId ? { kind: "chat_name", propertyId: read.rentalId } : { kind: "name_no_rental" };
}

/** The line the Shortcut shows. Plain words, one or two sentences, no dashes. */
export function sendResultLine(input: {
  outcome: "saved" | "exists" | "no_renter" | "unreadable" | "not_available" | "failed";
  name?: string | null;
  rental?: string | null;
}): string {
  const who = input.name?.trim() || "This renter";
  const where = input.rental?.trim() ? ` for ${input.rental.trim()}` : "";
  switch (input.outcome) {
    case "saved":
      return input.rental
        ? `Saved ${who}${where} in Renters.`
        : `Saved ${who} in Renters. We could not tell which rental, so pick it on their page.`;
    case "exists":
      return `${who} is already in Renters${where}.`;
    case "not_available":
      return `${input.rental || "That rental"} is not available, so no renter was added.`;
    case "no_renter":
      return "We could not find a renter's name, email or phone in that picture. Send a screenshot that shows their name.";
    case "unreadable":
      return "We could not read that picture. Try a fresh screenshot of the chat.";
    default:
      return "Something went wrong and the renter was not saved. Try again in a minute.";
  }
}

export const SEND_ERRORS = {
  key: "This Vacantless key is not working. Make a new one on Quick replies in Vacantless.",
  role: "Your sign-in can't add renters in this account.",
  limit: "That is a lot of screenshots this hour. Try again later.",
  missing: "No picture came through. Share a screenshot, not a link.",
  type: "Use a screenshot. PNG or JPG pictures work.",
  size: "That picture is too big. Use one under 5 MB.",
  off: "Screenshot reading is not available right now.",
} as const;
