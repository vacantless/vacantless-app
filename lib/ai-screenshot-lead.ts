// ai-screenshot-lead.ts (S702). A landlord chatting with a renter on Facebook
// Marketplace, Kijiji, WhatsApp or by text uploads a screenshot of the chat.
// The AI reads who the renter is, how to reach them, what they asked and which
// rental it is about. The landlord checks the answers, then adds the renter.
// Pure parts here; the network call is in lib/ai-enquiry-server.ts.
import type { EnquiryRental } from "./ai-enquiry";

export const SCREENSHOT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

export type ScreenshotCheck = { ok: true } | { ok: false; reason: "missing" | "type" | "size" };

export function checkScreenshot(file: { type: string; size: number } | null | undefined): ScreenshotCheck {
  if (!file || file.size === 0) return { ok: false, reason: "missing" };
  if (!(SCREENSHOT_IMAGE_TYPES as readonly string[]).includes(file.type)) return { ok: false, reason: "type" };
  if (file.size > SCREENSHOT_MAX_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}

export const SCREENSHOT_SYSTEM_PROMPT = [
  "You read a screenshot of a chat between a landlord and a renter about a rental.",
  "The renter is the other person, never the landlord. Return only a JSON object.",
  "Never invent a name, email, phone or rental. Use null for anything not shown.",
].join(" ");

export function buildScreenshotPrompt(rentals: EnquiryRental[]): string {
  const list = rentals
    .map(
      (r) =>
        `- id ${r.id}: ${r.address}${r.rentDollars ? `, $${r.rentDollars.toLocaleString("en-CA")}/month` : ""}${
          r.beds != null ? `, ${r.beds} bed` : ""
        }`,
    )
    .join("\n");
  return [
    "The landlord's open rentals:",
    list || "(none listed)",
    "",
    "Return JSON with these keys:",
    '{"is_enquiry": true|false, "confidence": 0 to 1, "name": string|null, "email": string|null,',
    ' "phone": string|null, "question": string|null, "rental_id": one id from the list or null,',
    ' "site": the app or website the chat is on (for example Facebook Marketplace, Kijiji, WhatsApp, Text message), or null}',
    "name is the renter's name as shown in the chat. question is what the renter asked, in one short sentence.",
    "Pick rental_id only when the chat clearly points to that rental by address, price, beds or ad title.",
  ].join("\n");
}

/** Where the renter came from, for the lead's source column. */
export function screenshotSource(site: string | null | undefined): string {
  const s = (site ?? "").trim().slice(0, 40);
  return s ? `${s} (screenshot)` : "Screenshot";
}
