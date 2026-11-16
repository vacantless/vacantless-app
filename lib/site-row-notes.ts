// ============================================================================
// site-row-notes (S805, REVIEW-S805 items 1 and 3). What a site row on a
// rental's Get online tab says when it is not live, beyond the one word. Pure.
//
// Two notes:
//   - choice: one more ad here costs money ("fee") or the account's free ads
//     are all in use ("full"). The word reads "Your choice", not "Needs you",
//     and the button states the price.
//   - drop: the daily live check found the ad gone from the site while the
//     rental is still available. Before this the row only said "Needs you.
//     Post here" (1551 Assumption Unit 9 on Zumper, 2026-11-15) and no page
//     said the ad had been up and came down.
// ============================================================================

import { isRobotPostedChannel } from "./posting-lanes";
import { siteName } from "./ads-still-up";
import { EXPIRY_REPOST_MARK } from "./expiry-repost";
import type { OptionalSiteReason } from "./posting-coverage";

export type SiteRowNote = {
  choice?: OptionalSiteReason | null;
  /** The sentence under the row for a choice. */
  choiceLine?: string | null;
  /** The button's words for a choice ("Post here, $33.84"); null keeps the usual button. */
  choiceButton?: string | null;
  /** The sentence under the row when the site took the ad down. */
  dropLine?: string | null;
};

/** A drop older than this is history, not news. */
export const DROP_NOTE_DAYS = 30;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-15" -> "Nov 15". */
export function shortDay(day: string): string {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return day;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`;
}

/**
 * The day a live check found the ad gone, read from the row's notes. Unlike
 * lib/expiry-repost removalDateFromNotes this looks past the re-post line the
 * daily run adds after it; any other later line means a person has been here.
 */
export function liveCheckRemovalDay(notes: string | null | undefined): string | null {
  const lines = String(notes ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.toLowerCase().includes(EXPIRY_REPOST_MARK));
  const last = lines[lines.length - 1] ?? "";
  let m = last.match(/^live-check (\d{4}-\d{2}-\d{2}) \d{2}:\d{2}Z: REMOVED\b/);
  if (m) return m[1];
  m = last.match(/^(\d{4}-\d{2}-\d{2}) home live check: .* no longer shows this ad\b/);
  if (m) return m[1];
  return null;
}

export function choiceLine(portal: string, reason: OptionalSiteReason, price: string | null): string {
  const name = siteName(portal);
  return reason === "fee"
    ? `Your choice. ${name} charges ${price ?? "its own fee"} for this ad, and you pay it on ${name}.`
    : `Your choice. Your free ads on ${name} are all in use. To post this one, switch another off.`;
}

export function dropLine(portal: string, day: string): string {
  return `${siteName(portal)} took this ad down on ${shortDay(day)}. Post it again to put it back up.`;
}

export type SiteRowNotePost = {
  portal: string | null;
  status: string | null;
  notes: string | null;
  created_at: string | null;
};

export function buildSiteRowNotes(input: {
  posts: readonly SiteRowNotePost[];
  /** Sites where one more ad is the landlord's choice (lib/posting-coverage). */
  optional: readonly { channel: string; reason: OptionalSiteReason }[];
  /** "$33.84" for a paid site; missing means the line says "its own fee". */
  priceByChannel?: Readonly<Record<string, string>>;
  rentalAvailable: boolean;
  nowISO: string;
}): Record<string, SiteRowNote> {
  const out: Record<string, SiteRowNote> = {};
  if (!input.rentalAvailable) return out;
  for (const o of input.optional) {
    const price = input.priceByChannel?.[o.channel] ?? null;
    out[o.channel] = {
      choice: o.reason,
      choiceLine: choiceLine(o.channel, o.reason, price),
      choiceButton: o.reason === "fee" && price ? `Post here, ${price}` : null,
    };
  }
  const now = Date.parse(input.nowISO);
  const live = new Set(input.posts.filter((p) => p.status === "live").map((p) => String(p.portal)));
  const latestRemoved = new Map<string, SiteRowNotePost>();
  for (const p of input.posts) {
    const portal = String(p.portal ?? "");
    if (p.status !== "removed" || !isRobotPostedChannel(portal) || live.has(portal)) continue;
    const have = latestRemoved.get(portal);
    if (!have || String(p.created_at ?? "") > String(have.created_at ?? "")) latestRemoved.set(portal, p);
  }
  for (const [portal, post] of latestRemoved) {
    const day = liveCheckRemovalDay(post.notes);
    if (!day) continue;
    const at = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(at) || !Number.isFinite(now) || now - at > DROP_NOTE_DAYS * 86_400_000) continue;
    out[portal] = { ...(out[portal] ?? {}), dropLine: dropLine(portal, day) };
  }
  return out;
}

/** A drop older than this no longer earns a card on Today (the rental's row still says it). */
export const DROP_CARD_DAYS = 7;

export type DroppedAdNotice = {
  key: string;
  /** "Zumper took an ad down." */
  title: string;
  /** "1551 Assumption St, Unit 9, on Nov 15. Post it again to put it back up." */
  line: string;
  action: { label: string; href: string };
};

/**
 * Today's cards for ads a site took down while the rental is still available.
 * Only sites that are a real gap on the rental (lib/posting-coverage `missing`):
 * a paid site whose ad ended is the landlord's choice and earns no card.
 */
export function droppedAdNotices(input: {
  rows: readonly { propertyId: string; address: string | null; missing: readonly string[] }[];
  posts: readonly (SiteRowNotePost & { property_id: string | null })[];
  shortAddress: (address: string | null) => string;
  nowISO: string;
}): DroppedAdNotice[] {
  const now = Date.parse(input.nowISO);
  const out: DroppedAdNotice[] = [];
  for (const row of input.rows) {
    for (const portal of row.missing) {
      if (!isRobotPostedChannel(portal)) continue;
      let latest: SiteRowNotePost | null = null;
      for (const p of input.posts) {
        if (p.property_id !== row.propertyId || String(p.portal) !== portal || p.status !== "removed") continue;
        if (!latest || String(p.created_at ?? "") > String(latest.created_at ?? "")) latest = p;
      }
      const day = latest ? liveCheckRemovalDay(latest.notes) : null;
      if (!day) continue;
      const at = Date.parse(`${day}T00:00:00Z`);
      if (!Number.isFinite(at) || !Number.isFinite(now) || now - at > DROP_CARD_DAYS * 86_400_000) continue;
      out.push({
        key: `drop-${row.propertyId}-${portal}`,
        title: `${siteName(portal)} took an ad down.`,
        line: `${input.shortAddress(row.address)}, on ${shortDay(day)}. Post it again to put it back up.`,
        action: {
          label: "Open the rental",
          href: `/dashboard/properties/${row.propertyId}?tab=distribute#for-you-${portal}`,
        },
      });
    }
  }
  return out;
}
