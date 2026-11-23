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
    ' "price_shown": the monthly rent shown in the chat title or ad line as a number (for example 1225), or null,',
    ' "site": the app or website the chat is on (for example Facebook Marketplace, Kijiji, WhatsApp, Text message), or null,',
    ' "topic": one word for what the renter asked last, from the list below,',
    ' "not_renter": true only when the other person is not looking to rent}',
    "name is the renter's name as shown in the chat, copied exactly in whatever script it is written (Punjabi, Arabic, Chinese and so on are fine).",
    "On Facebook Marketplace and Messenger the chat title reads \"Name · ad title\" and a line says \"Name started this chat\": that Name is the renter.",
    "question is what the renter asked, in one short sentence.",
    "topic is one of: available (only asks if it is available, or no question, or just thanks), viewing (asks to see it, a time to visit, a tour),",
    "applied (says they already filled out the form, sent the request or booked), rent (offers a lower rent or asks if the price can change),",
    "lease (lease length or term), pets, utilities (what is included), parking, laundry, move_in (when they can move in), appliances, ac (air conditioning),",
    "other (any other question). A renter who says they have no pets is not asking about pets.",
    "When the renter asked two things, give both topics separated by a comma, for example \"pets, move_in\".",
    "A rental ending in \"rented now\" is no longer available. Pick it only when the chat clearly points to it.",
    "not_renter is true for an agent offering to find tenants for a fee, a promoter or marketer, or spam. An agent asking for a client who wants to rent is a renter.",
    "Pick rental_id when the chat points to one rental by address, unit, price, beds or ad title. A Marketplace listing line such as \"CA$1,250 · 1 Bed 1 Bath\" matches the rental with that monthly price.",
    "When two rentals in the list have the same price and nothing else in the chat tells them apart, use null for rental_id.",
  ].join("\n");
}

/** Where the renter came from, for the lead's source column. */
export function screenshotSource(site: string | null | undefined): string {
  const s = (site ?? "").trim().slice(0, 40);
  return s ? `${s} (screenshot)` : "Screenshot";
}
