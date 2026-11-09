// S767 (PLAN-S766 item A): renters who only wrote in a site's chat.
//
// 34 of Agile's last 64 leads came from Marketplace, every one through the
// tracked booking link. A renter who chats and never taps the link was
// invisible. Two ways in now:
//  - helper 1.2.5: pressing "Fill booking reply" in a Marketplace chat notes
//    the renter's name and the ad; the next Vacantless page saves it.
//  - Quick replies (phone): "Add this renter" under a rental.
// Either way the renter is a lead with a name and no email or phone, status
// "replied". When the same renter later books through the link, the booking
// takes that place instead of leaving two renters.
//
// Pure: no I/O.

/** Helper 1.2.5 and up notes the renters it filled a reply for. */
export const MARKETPLACE_HELPER_REPLIED_MIN_VERSION = "1.2.5";

/** How long a chat renter stays matchable (to skip a second save, or to merge a booking into). */
export const CHAT_LEAD_MATCH_DAYS = 14;

/** Open lead statuses (same set as lib/public-lead-dedup). */
const OPEN = new Set(["new", "replied", "contacted", "booked"]);

/** The note that marks a chat renter Vacantless added (the merge looks for it). */
export const CHAT_LEAD_NOTE_HELPER = "Replied in the Marketplace chat, saved by the helper.";
export function chatLeadNoteManual(siteLabel: string): string {
  return `Added from Quick replies, ${siteLabel} chat.`;
}
const NOTE_PREFIXES = [CHAT_LEAD_NOTE_HELPER, "Added from Quick replies, "];

/** The short line under a chat renter in Renters. */
export const CHAT_LEAD_LIST_LINE = "From the chat, no email or phone yet";

/** The line on a chat renter's own page. */
export const CHAT_LEAD_LINE = "From the chat, no email or phone yet. Reply to them there; when they book with your link, this renter fills in.";

/** The source a lead gets for a site key (same words as submit_public_lead). */
const SOURCE_BY_SITE: Record<string, string> = {
  facebook: "Facebook Marketplace",
  kijiji: "Kijiji",
  zumper: "Zumper + PadMapper",
  rentals_ca: "Rentals.ca",
  rentfaster: "RentFaster.ca",
  viewit: "Viewit.ca",
  instagram: "Instagram",
  facebook_feed: "Facebook feed",
};
export function chatLeadSource(siteKey: string | null | undefined): string {
  return (siteKey && SOURCE_BY_SITE[siteKey]) || "website";
}

export type HelperRepliedChat = { itemId: string; renterName: string; at: number };

/** Replied chats as the helper sent them, checked: a real ad id, a name, in the last 7 days. */
export function cleanRepliedChats(raw: unknown, now: number = Date.now()): HelperRepliedChat[] {
  if (!Array.isArray(raw)) return [];
  const out: HelperRepliedChat[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, 50)) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const itemId = String(rec.itemId ?? "");
    const renterName = cleanRenterName(rec.renterName);
    const at = Number(rec.at);
    if (!/^\d{6,20}$/.test(itemId) || !renterName) continue;
    if (!Number.isFinite(at) || at > now + 5 * 60_000 || now - at > 7 * 24 * 60 * 60_000) continue;
    const key = `${itemId}|${normalizeRenterName(renterName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ itemId, renterName, at });
  }
  return out;
}

/** A display name as typed or shown by the site: trimmed, one space, at most 80 characters, letters required. */
export function cleanRenterName(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return /\p{L}/u.test(s) ? s : null;
}

/** "Zoë  O'Neil" -> "zoe oneil". Accents off, lowercase, letters and spaces only. */
export function normalizeRenterName(name: string | null | undefined): string {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Same renter by name: the first names match, and when both have a last name
 * its first letter matches ("Tess Smith" = "Tess S." = "Tess"; "Tess Smith" is
 * not "Tess Brown").
 */
export function sameRenterName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeRenterName(a).split(" ").filter(Boolean);
  const y = normalizeRenterName(b).split(" ").filter(Boolean);
  if (x.length === 0 || y.length === 0) return false;
  if (x[0] !== y[0]) return false;
  if (x.length > 1 && y.length > 1) return x[x.length - 1][0] === y[y.length - 1][0];
  return true;
}

export type ChatLeadCandidate = {
  id: string;
  propertyId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  notes: string | null;
  createdAt: string | Date;
};

function recent(c: ChatLeadCandidate, nowMs: number): boolean {
  const t = new Date(c.createdAt).getTime();
  return Number.isFinite(t) && nowMs - t <= CHAT_LEAD_MATCH_DAYS * 24 * 60 * 60_000;
}

/** A chat renter Vacantless added: no email, no phone, and the chat note. */
export function isChatPlaceholder(c: { email: string | null; phone: string | null; notes: string | null }): boolean {
  if ((c.email ?? "").trim() || (c.phone ?? "").trim()) return false;
  const n = (c.notes ?? "").trim();
  return NOTE_PREFIXES.some((p) => n.startsWith(p));
}

/** An open lead on this rental, same renter, last 14 days: saving again would make a second one. */
export function findExistingChatLead(
  candidates: ChatLeadCandidate[],
  input: { propertyId: string; name: string; now?: number },
): ChatLeadCandidate | null {
  const nowMs = input.now ?? Date.now();
  return (
    candidates.find(
      (c) =>
        c.propertyId === input.propertyId &&
        OPEN.has(String(c.status)) &&
        recent(c, nowMs) &&
        sameRenterName(c.name, input.name),
    ) ?? null
  );
}

/**
 * The chat renter a new booking should take the place of: on the same rental,
 * same renter by name, still open, last 14 days, and only when exactly one
 * such chat renter exists (two "Tess" chats: leave both, never guess).
 */
export function findChatPlaceholderToMerge(
  candidates: ChatLeadCandidate[],
  input: { propertyId: string; name: string; newLeadId: string; now?: number },
): ChatLeadCandidate | null {
  const nowMs = input.now ?? Date.now();
  const hits = candidates.filter(
    (c) =>
      c.id !== input.newLeadId &&
      c.propertyId === input.propertyId &&
      OPEN.has(String(c.status)) &&
      recent(c, nowMs) &&
      isChatPlaceholder(c) &&
      sameRenterName(c.name, input.name),
  );
  return hits.length === 1 ? hits[0] : null;
}

/** The line added to the booked lead's notes when it takes a chat renter's place. */
export function mergedChatNote(placeholderNotes: string | null, day: string): string {
  return (placeholderNotes ?? "").includes("Quick replies")
    ? `First wrote in the chat on ${day}, added from Quick replies.`
    : `First wrote in the Marketplace chat on ${day}.`;
}
