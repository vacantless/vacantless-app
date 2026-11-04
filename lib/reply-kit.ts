// S750: "Quick replies" - the phone version of the helper's "Fill booking
// reply". Noam answers Marketplace and Kijiji chats on his iPhone, where no
// browser extension runs, and kept losing track of which booking link goes
// with which unit. One page: a card per rental (price first, since that is
// what the chat shows), a button per site the ad is live on (each site's own
// tracked link, so the booking says where it came from), the next open
// viewing times, and Copy / Share. Same words as the desktop helper.
//
// Pure: no I/O. The page loads the rows and the times.

import { helperReplyTemplate, fillHelperReply, shortRentalName } from "./marketplace-helper";
import { buildTrackedLink, portalLabel } from "./listing-distribution";
import { formatRent } from "./listing-copy";
import type { DaySlots } from "./booking";

export type ReplyKitProperty = {
  id: string;
  address: string | null;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  status: string | null;
  archived_at: string | null;
};

export type ReplyKitPost = { id: string; property_id: string | null; portal: string; status: string };

export type ReplyKitSite = { key: string; label: string; postId: string | null; bookingUrl: string };

export type ReplyKitCard = {
  propertyId: string;
  rental: string;
  rentLabel: string | null;
  bedsLabel: string;
  available: boolean;
  sites: ReplyKitSite[];
  nextTimes: string | null;
  hasViewingTimes: boolean;
};

/** Sites in the order a landlord answers them most. */
const SITE_ORDER = ["facebook", "kijiji", "zumper", "rentals_ca", "facebook_feed", "instagram", "viewit", "rentfaster"];

/** Short button names; the long ones wrap badly on a phone. */
const SHORT_LABEL: Record<string, string> = {
  facebook: "Marketplace",
  facebook_feed: "Facebook Page",
  zumper: "Zumper",
  rentals_ca: "Rentals.ca",
  rentfaster: "RentFaster",
  viewit: "Viewit",
};
function siteLabel(key: string): string {
  return SHORT_LABEL[key] ?? portalLabel(key);
}

function bedsLabel(beds: number | null, baths: number | null): string {
  const b = beds == null ? null : beds === 0 ? "Studio" : `${beds} bed`;
  const ba = baths == null ? null : `${baths} bath`;
  return [b, ba].filter(Boolean).join(" · ");
}

/**
 * "Thursday, November 5 at 7:30, 7:45 or 8:00 PM". The first open day only,
 * up to 4 start times. Null when there are none.
 */
export function nextTimesLabel(days: DaySlots[], weekdayLong: (dayKey: string) => string): string | null {
  const day = days.find((d) => d.slots.length > 0);
  if (!day) return null;
  const labels = day.slots.slice(0, 4).map((s) => s.label);
  const sameHalf = labels.every((l) => l.endsWith(" PM")) || labels.every((l) => l.endsWith(" AM"));
  const suffix = sameHalf ? labels[0].slice(-2) : "";
  const parts = sameHalf ? labels.map((l) => l.slice(0, -3)) : labels;
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
  return `${weekdayLong(day.dayKey)} at ${list}${suffix ? ` ${suffix}` : ""}`;
}

/** The cards for the page: rentals that are available, or rented with a live ad still up. */
export function buildReplyKitCards(input: {
  appUrl: string;
  properties: ReplyKitProperty[];
  posts: ReplyKitPost[];
  timesByProperty: Map<string, { hasViewingTimes: boolean; nextTimes: string | null }>;
}): ReplyKitCard[] {
  const liveByProp = new Map<string, ReplyKitPost[]>();
  for (const p of input.posts) {
    if (p.status !== "live" || !p.property_id) continue;
    const list = liveByProp.get(p.property_id) ?? [];
    list.push(p);
    liveByProp.set(p.property_id, list);
  }
  const cards: ReplyKitCard[] = [];
  for (const prop of input.properties) {
    if (prop.archived_at) continue;
    const available = prop.status === "available";
    const live = liveByProp.get(prop.id) ?? [];
    if (!available && live.length === 0) continue;
    const publicUrl = `${input.appUrl}/r/${prop.id}`;
    const seen = new Set<string>();
    const sites: ReplyKitSite[] = [];
    for (const key of SITE_ORDER) {
      const post = live.find((p) => p.portal === key);
      if (!post || seen.has(key)) continue;
      seen.add(key);
      sites.push({ key, label: siteLabel(key), postId: post.id, bookingUrl: buildTrackedLink(publicUrl, post.id) });
    }
    for (const post of live) {
      if (seen.has(post.portal)) continue;
      seen.add(post.portal);
      sites.push({ key: post.portal, label: siteLabel(post.portal), postId: post.id, bookingUrl: buildTrackedLink(publicUrl, post.id) });
    }
    // Always offer the plain link for texts, email and anywhere else.
    sites.push({ key: "direct", label: "Text or other", postId: null, bookingUrl: publicUrl });
    const t = input.timesByProperty.get(prop.id) ?? { hasViewingTimes: true, nextTimes: null };
    cards.push({
      propertyId: prop.id,
      rental: shortRentalName(prop.address),
      rentLabel: formatRent(prop.rent_cents),
      bedsLabel: bedsLabel(prop.beds, prop.baths),
      available,
      sites,
      nextTimes: t.nextTimes,
      hasViewingTimes: t.hasViewingTimes,
    });
  }
  // Available first, then by rent.
  return cards.sort(
    (a, b) => Number(b.available) - Number(a.available) || (rentNum(a.rentLabel) - rentNum(b.rentLabel)),
  );
}

function rentNum(label: string | null): number {
  return label ? Number(label.replace(/[^0-9.]/g, "")) || 0 : 0;
}

/** The reply for one card and site, with the renter's first name when given. */
export function replyKitText(input: {
  card: ReplyKitCard;
  site: ReplyKitSite;
  phone: string | null;
  renterName?: string | null;
}): string {
  const base = helperReplyTemplate({
    available: input.card.available,
    bookingUrl: input.site.bookingUrl,
    phone: input.phone,
    hasViewingTimes: input.card.hasViewingTimes,
  });
  let text = fillHelperReply(base, input.renterName ?? null);
  if (input.card.available && input.card.hasViewingTimes && input.card.nextTimes) {
    const marker = input.site.bookingUrl;
    text = text.replace(marker, `${marker} The next open times are ${input.card.nextTimes}.`);
  }
  return text;
}

/** "Thursday, November 5" for a YYYY-MM-DD day key (a calendar day, no time zone shift). */
export function longDayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}
