// ============================================================================
// Pure distribution analytics (S412 Slice 4). No DOM / env / IO — unit-tested
// (scripts/test-distribution-analytics.ts).
//
// Closes the attribution loop: which channel actually produces renters, not
// just clicks. Aggregates the leads already stamped with a listing_post_id
// (source attribution, migration 0014) up to the PORTAL, cross-referenced with
// the live posts, into a per-channel row: leads, how many advanced past the
// inquiry, how long the ad has been live, and a plain next-action suggestion.
// Reads only data the app already has — no new table, no ad-spend assumptions.
// ============================================================================

import { daysBetween } from "./distribution-channels";
import { portalLabel } from "./listing-distribution";

// Lead pipeline stages that count as "advanced past a raw inquiry".
const ADVANCED_STATUSES = new Set([
  "booked",
  "showed",
  "applied",
  "leased",
]);

export type LeadLite = {
  listing_post_id: string | null;
  status: string;
};

export type PostLite = {
  id: string;
  portal: string;
  status: string; // draft | live | expired | removed
  posted_on: string | null;
};

export type ChannelAnalyticsRow = {
  channel: string; // portal key, or "untracked"
  label: string;
  leads: number;
  advanced: number; // leads at booked/showed/applied/leased
  hasLivePost: boolean;
  daysLive: number | null; // days since the most-recent live post went up
  suggestion: string;
};

/** Days the most-recent LIVE post for a portal has been up (null if none/undated). */
function daysLiveForPortal(
  posts: PostLite[],
  portal: string,
  today: string,
): number | null {
  const live = posts.filter((p) => p.portal === portal && p.status === "live");
  let best: string | null = null;
  for (const p of live) {
    if (p.posted_on && (best === null || p.posted_on > best)) best = p.posted_on;
  }
  return best ? daysBetween(best, today) : null;
}

/** The plain next-action nudge for a channel, from its numbers. Pure. */
export function channelSuggestion(row: {
  leads: number;
  advanced: number;
  hasLivePost: boolean;
  daysLive: number | null;
}): string {
  if (!row.hasLivePost) {
    return row.leads > 0
      ? "Past leads came from here - repost to keep it producing."
      : "Not live here right now. Post it to start getting leads.";
  }
  if (row.leads === 0) {
    if (row.daysLive != null && row.daysLive >= 14) {
      return `Live ${row.daysLive} days with no leads - refresh the ad, add photos, or check the price.`;
    }
    return "Live but no leads yet - give it a few days, then refresh if it stays quiet.";
  }
  if (row.advanced === 0) {
    return "Leads are coming in but none have booked - reply faster or tighten the screening.";
  }
  return "Working - leads and bookings are coming through. Keep it live.";
}

export function computeChannelAnalytics(opts: {
  leads: LeadLite[];
  posts: PostLite[];
  today: string;
}): ChannelAnalyticsRow[] {
  const { leads, posts, today } = opts;

  // Map a listing_post_id -> its portal, so a lead resolves to a channel.
  const postPortal = new Map<string, string>();
  for (const p of posts) postPortal.set(p.id, p.portal);

  // Tally leads + advanced per channel key ("untracked" for no/unknown post).
  type Acc = { leads: number; advanced: number };
  const byChannel = new Map<string, Acc>();
  const bump = (key: string, advanced: boolean) => {
    const a = byChannel.get(key) ?? { leads: 0, advanced: 0 };
    a.leads += 1;
    if (advanced) a.advanced += 1;
    byChannel.set(key, a);
  };
  for (const l of leads) {
    const portal =
      l.listing_post_id != null ? postPortal.get(l.listing_post_id) : undefined;
    const key = portal ?? "untracked";
    bump(key, ADVANCED_STATUSES.has(l.status));
  }

  // Union of channels that have leads OR a post, so an active-but-quiet channel
  // still shows (with 0 leads + its suggestion).
  const keys = new Set<string>(byChannel.keys());
  for (const p of posts) keys.add(p.portal);

  const rows: ChannelAnalyticsRow[] = [];
  for (const key of keys) {
    const acc = byChannel.get(key) ?? { leads: 0, advanced: 0 };
    const hasLivePost =
      key !== "untracked" &&
      posts.some((p) => p.portal === key && p.status === "live");
    const daysLive =
      key === "untracked" ? null : daysLiveForPortal(posts, key, today);
    rows.push({
      channel: key,
      label: key === "untracked" ? "Direct / untracked" : portalLabel(key),
      leads: acc.leads,
      advanced: acc.advanced,
      hasLivePost,
      daysLive,
      suggestion:
        key === "untracked"
          ? "Inquiries with no tracked source - share each channel's tracked link so you can tell what works."
          : channelSuggestion({
              leads: acc.leads,
              advanced: acc.advanced,
              hasLivePost,
              daysLive,
            }),
    });
  }

  // Sort: most leads first, then channels with a live post, then label.
  rows.sort(
    (a, b) =>
      b.leads - a.leads ||
      Number(b.hasLivePost) - Number(a.hasLivePost) ||
      a.label.localeCompare(b.label),
  );
  return rows;
}

/** Portfolio totals for the panel header. */
export function analyticsTotals(rows: ChannelAnalyticsRow[]): {
  leads: number;
  advanced: number;
  channelsWithLeads: number;
} {
  return {
    leads: rows.reduce((n, r) => n + r.leads, 0),
    advanced: rows.reduce((n, r) => n + r.advanced, 0),
    channelsWithLeads: rows.filter((r) => r.leads > 0).length,
  };
}
