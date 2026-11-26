// S816l: "Send to Vacantless" from the iPhone share menu. A landlord takes a
// screenshot of a renter chat (Messenger, Kijiji, texts), taps Share, then the
// Apple Shortcut. The Shortcut posts the picture with the landlord's key and
// shows the line we send back. Pure parts here; the route is
// app/api/shortcut/renter and the saving is lib/send-shortcut-server.ts.
import { createHash, randomBytes } from "crypto";
import { screenshotSource } from "./ai-screenshot-lead";
import { replyKitText, type ReplyKitCard } from "./reply-kit";
import { answerReplyText, REPLY_ANSWER_KEYS, type ReplyAnswerKey } from "./reply-answers";
import type { EnquiryRental } from "./ai-enquiry";
import { replyUnitPhrase, shortRentalName } from "./marketplace-helper";

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

/** The picture type from its first bytes; Shortcuts may send no type. */
export function sniffImageType(head: Uint8Array): string | null {
  if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image/gif";
  return null;
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
  /** S830b: the reader says this is an agent selling leads, a promoter or spam. */
  notRenter?: boolean;
};

/** What to do with what the AI read. */
export type SendPlan =
  | { kind: "no_renter" }
  | { kind: "not_renter" }
  | { kind: "contact"; propertyId: string | null }
  | { kind: "chat_name"; propertyId: string }
  | { kind: "name_no_rental" };

export function planSend(read: SendRead): SendPlan {
  // S830b: never save someone who is selling to the landlord (REVIEW-S830).
  if (read.notRenter) return { kind: "not_renter" };
  const hasContact = Boolean(read.email || read.phone);
  if (hasContact) return { kind: "contact", propertyId: read.rentalId };
  if (!read.name) return { kind: "no_renter" };
  return read.rentalId ? { kind: "chat_name", propertyId: read.rentalId } : { kind: "name_no_rental" };
}

/** The line the Shortcut shows. Plain words, one or two sentences, no dashes. */
export function sendResultLine(input: {
  outcome: "saved" | "exists" | "no_renter" | "not_renter" | "unreadable" | "not_available" | "rented" | "failed";
  name?: string | null;
  rental?: string | null;
  /** S824a: the renter was already saved and their new question was added. */
  questionAdded?: boolean;
  /** S830f: matched by a one-word name, so it may be a different person with the same first name. */
  firstNameOnly?: boolean;
}): string {
  const who = input.name?.trim() || "This renter";
  const where = input.rental?.trim() ? ` for ${input.rental.trim()}` : "";
  switch (input.outcome) {
    case "saved":
      return input.rental
        ? `Saved ${who}${where} in Renters.`
        : `Saved ${who} in Renters. We could not tell which rental, so pick it on their page.`;
    case "exists": {
      const base = input.questionAdded
        ? `${who} is already in Renters${where}. Their new question is on their page.`
        : `${who} is already in Renters${where}.`;
      return input.firstNameOnly ? `${base} If this is someone new, add them on Renters.` : base;
    }
    case "not_available":
      return `${input.rental || "That rental"} is not available, so no renter was added.`;
    case "rented":
      return `${input.rental || "That rental"} is rented, so no renter was added.`;
    case "not_renter":
      return "No one was added. This looks like an agent, a seller or an ad, not a renter.";
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

// S817b: the Shortcut also copies the reply, the same words Quick replies would
// give for this rental, site and question. Pure.

/** Which Quick replies answer the renter's question asks for. Null = the first "still available" reply. */
export function answerKeyForQuestion(question: string | null | undefined): ReplyAnswerKey | null {
  const q = String(question ?? "").toLowerCase();
  if (!q.trim()) return null;
  // S830a: the order matters. A form already sent, then a viewing time, then
  // a rent offer, before the record's topics: "when are you available for
  // viewing" is a viewing, not a move-in date; "$1,200 all inclusive" is an
  // offer, not a utilities question (REVIEW-S830).
  const rules: [ReplyAnswerKey, RegExp][] = [
    ["applied", /\b(submit+ed|filled (it|the form|out|in)|sent (the|my|a|in) (form|request)|completed the form|set up a viewing|already (booked|sent|applied|submit+ed)|i (did|do) it)\b/],
    ["viewing", /\b(view(ing)?|visit|tour|showing|come (see|by|look|check|to see)|see (it|the|this|inside)|look (at it|inside)|check (it|this) out|\d{1,2} ?(am|pm))\b/],
    ["rent", /(\$\s?\d|\b(negotiable|negotiate|max (to pay|budget)|would you (consider|take|accept)|best price|discount|lower (the )?(rent|price))\b)/],
    ["pets", /\b(pets?|cats?|dogs?|kitten|puppy|animals?)\b/],
    ["utilities", /\b(utilit(y|ies)|hydro|heat|heating|water|electric(ity)?|internet|wifi|bills?|inclusive|included)\b/],
    ["parking", /\b(park(ing)?|garage|driveway|car)\b/],
    ["laundry", /\b(laundry|washer|dryer|washing)\b/],
    ["ac", /\b(a\/?c|air ?condition(ing|er)?|cooling)\b/],
    ["appliances", /\b(appliances?|fridge|stove|dishwasher|microwave)\b/],
    ["move_in", /\b(move[- ]?in|when.*(available|move)|available (from|on|starting)|start date|december|january|february|march|april|june|july|august|september|october|november)\b/],
  ];
  for (const [key, re] of rules) if (re.test(q)) return key;
  return null;
}

/** S830a: the topics the screenshot reader may name. */
export const SEND_TOPICS = [
  "available", "viewing", "applied", "rent", "lease", "pets", "utilities", "parking",
  "laundry", "move_in", "appliances", "ac", "other",
] as const;

/**
 * The answer key for the reader's topic. "first" is the "still available"
 * reply, "none" means a real question with no answer kind (lease, other),
 * null means the reader named no known topic (then the word rules decide).
 */
export function answerKeyForTopic(topic: string | null | undefined): ReplyAnswerKey | "first" | "none" | null {
  const t = String(topic ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!t || !(SEND_TOPICS as readonly string[]).includes(t)) return null;
  if (t === "available") return "first";
  if (t === "lease" || t === "other") return "none";
  return t as ReplyAnswerKey;
}

/**
 * S830e: rented rentals the reader may also see, so a chat about a rented unit
 * says "rented" instead of "we could not tell which rental". A rented rental
 * that shares its rent with an open one is left out: price is often the only
 * tell, and a real renter must never be matched to the rented twin.
 */
export function rentedForReader(open: EnquiryRental[], rented: EnquiryRental[]): EnquiryRental[] {
  const openRents = new Set(open.map((r) => r.rentDollars).filter((n): n is number => typeof n === "number"));
  return rented
    .filter((r) => typeof r.rentDollars === "number" && !openRents.has(r.rentDollars))
    .map((r) => ({ ...r, address: `${r.address}, rented now` }));
}

/** S830f: up to two topics the reader named ("pets, move_in"). */
export function answerKeysForTopic(topic: string | null | undefined): ReturnType<typeof answerKeyForTopic>[] {
  return String(topic ?? "")
    .split(/[,+&/]| and /)
    .map((t) => answerKeyForTopic(t))
    .filter((k) => k != null)
    .slice(0, 2);
}

/** The card's site button for the chat's site; "direct" when that ad is not tracked. */
export function replySiteKey(site: string | null | undefined): string {
  const s = String(site ?? "").toLowerCase();
  if (/marketplace|facebook|messenger/.test(s)) return "facebook";
  if (/kijiji/.test(s)) return "kijiji";
  if (/zumper/.test(s)) return "zumper";
  if (/rentals\.?ca/.test(s)) return "rentals_ca";
  return "direct";
}

/**
 * The reply to copy, or null with why. A question with no answer on file gets
 * no reply (never a guess, the S812 rule); Quick replies says the same.
 */
export function shortcutReply(input: {
  card: ReplyKitCard | null;
  site: string | null | undefined;
  question: string | null | undefined;
  /** S830a: the topic the screenshot reader named; it wins over the word rules. */
  topic?: string | null;
  phone: string | null;
  renterName: string | null;
}): { text: string | null; why: "ok" | "no_rental" | "no_answer" } {
  const card = input.card;
  if (!card) return { text: null, why: "no_rental" };
  const want = replySiteKey(input.site);
  const site = card.sites.find((x) => x.key === want) ?? card.sites.find((x) => x.key === "direct") ?? card.sites[0];
  if (!site) return { text: null, why: "no_rental" };
  // S830f: two questions with both answers on file get one reply with both.
  const two = card.available ? answerKeysForTopic(input.topic) : [];
  const recordKeys = new Set<string>(REPLY_ANSWER_KEYS);
  if (two.length === 2 && two.every((k) => typeof k === "string" && recordKeys.has(k))) {
    const answers = two.map((k) => card.answers.find((a) => a.key === k));
    if (answers.every(Boolean)) {
      const want2 = replySiteKey(input.site);
      const site2 = card.sites.find((x) => x.key === want2) ?? card.sites.find((x) => x.key === "direct") ?? card.sites[0];
      const [a1, a2] = answers as NonNullable<(typeof answers)[number]>[];
      return {
        text: answerReplyText({
          answer: { ...a1, text: `${a1.text} ${a2.text}` },
          bookingUrl: site2.bookingUrl,
          hasViewingTimes: card.hasViewingTimes,
          renterName: input.renterName,
        }),
        why: "ok",
      };
    }
  }
  const fromTopic = card.available ? (two[0] ?? answerKeyForTopic(input.topic)) : "first";
  if (fromTopic === "none") return { text: null, why: "no_answer" };
  const key = !card.available || fromTopic === "first" ? null : fromTopic ?? answerKeyForQuestion(input.question);
  if (key && !card.answers.some((a) => a.key === key)) return { text: null, why: "no_answer" };
  return {
    text: replyKitText({ card, site, phone: input.phone, renterName: input.renterName, answerKey: key }),
    why: "ok",
  };
}

/** The second line the Shortcut shows under the saved line. */
export function shortcutReplyLine(why: "ok" | "no_rental" | "no_answer"): string {
  if (why === "ok") return "Your reply is copied. Paste it in the chat.";
  if (why === "no_answer") return "There is no answer on file for that question, so nothing was copied. Answer it on Quick replies.";
  return "Pick the rental on Quick replies to copy a reply. We could not tell which one it was.";
}

/**
 * S845c: Facebook shows "SOLD - 1 Bed 1 Bath Apartment" on a chat once the ad
 * is taken down, with no price, so the price rule cannot tell which rental it
 * was (Tammy, Unit 9, 2026-11-26). The one rented rental whose Marketplace ad
 * came down in the last 30 days is that rental. Two or more: we cannot tell.
 */
export function soldAdRental<T extends { id: string }>(adSold: boolean | undefined, recentlyDown: readonly T[]): T | null {
  if (!adSold) return null;
  const uniq = [...new Map(recentlyDown.map((r) => [r.id, r])).values()];
  return uniq.length === 1 ? uniq[0] : null;
}

/** S845c: the reply for a chat about a rented rental: it is rented, here is what is open. */
export function rentedChatReply(input: {
  rentalName: string | null;
  renterName: string | null;
  others: { address: string; rentDollars: number | null; url: string }[];
}): string {
  const first = (input.renterName ?? "").trim().split(/\s+/)[0] ?? "";
  const unit = replyUnitPhrase(shortRentalName(input.rentalName)) ?? "This one";
  const head = `${first ? `Hi ${first}` : "Hi"}, thanks for asking. ${unit} is rented now.`;
  const others = input.others.slice(0, 3);
  if (others.length === 0) return head;
  const list = others
    .map((o) => `${replyUnitPhrase(shortRentalName(o.address)) ?? o.address}${o.rentDollars ? `, $${o.rentDollars.toLocaleString("en-CA")} a month` : ""}: ${o.url}`)
    .join(" ");
  return `${head} ${others.length === 1 ? "This one is open" : "These are open"}. ${list}`;
}

/** S845c: open rentals to offer in place of a rented one: same bedrooms first. */
export function othersForRented<T extends { beds: number | null; rentDollars: number | null }>(rentedBeds: number | null, open: readonly T[]): T[] {
  const same = rentedBeds == null ? [] : open.filter((r) => r.beds === rentedBeds);
  const pool = same.length > 0 ? same : [...open];
  return [...pool].sort((a, b) => (a.rentDollars ?? 1e9) - (b.rentDollars ?? 1e9)).slice(0, 3);
}
