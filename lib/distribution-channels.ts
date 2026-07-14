// ============================================================================
// Pure channel matrix + per-channel status for the Distribute command center
// (S412, Slice 1). No DOM / env / IO — fully unit-testable
// (see scripts/test-distribution-channels.ts).
//
// This is the CONSOLIDATION layer the "best-in-class syndication" plan asks for:
// the app already has per-portal copy (lib/listing-copy), fill sheets
// (lib/listing-fill-sheet), guardrails (lib/listing-guardrails), an org XML feed
// (lib/listing-feed), and where-posted tracking (lib/listing-distribution +
// listing_posts). None of those knew about each other. The matrix here ties one
// CHANNEL to all of its assets and computes a single operator-facing STATUS +
// blocker list from the data that already exists. NO new integrations, NO new
// tables — static config + a pure reducer over listing_posts + share-readiness.
//
// Honesty rules carried from the plan: we never claim automated posting for
// Facebook/Kijiji (assisted-manual only), and "feed_or_assisted" means the org
// XML feed is a CANDIDATE route, not a proven partner acceptance (that is a
// later slice). Keep wording precise; do not overpromise.
// ============================================================================

import type { PortalKey } from "./listing-distribution";
import type { CopyPortalKey } from "./listing-copy";
import type { ListingPostStatus } from "./listing-distribution";

// --- channel mode ----------------------------------------------------------
// How Vacantless can help on this channel today. Precise, non-overpromising:
//  - assisted_manual: no supported feed/API for long-term rentals; Vacantless
//    generates copy + a fill sheet + guardrails and tracks the live URL. A human
//    posts. (Facebook, Kijiji, Viewit.)
//  - feed_or_assisted: the channel accepts structured listings and is a feed
//    CANDIDATE (Vacantless has an XML feed), but until a partner route is proven
//    it is still guided manual. (Rentals.ca, Zumper.)
//  - broker: a realtor/DDF route (Realtor.ca) — not a self-serve landlord post.
export const CHANNEL_MODES = [
  "assisted_manual",
  "feed_or_assisted",
  "broker",
] as const;
export type ChannelMode = (typeof CHANNEL_MODES)[number];

const CHANNEL_MODE_LABELS: Record<ChannelMode, string> = {
  assisted_manual: "Guided posting",
  feed_or_assisted: "Feed or guided",
  broker: "Broker / MLS",
};

export function channelModeLabel(mode: unknown): string {
  return typeof mode === "string" && (CHANNEL_MODES as readonly string[]).includes(mode)
    ? CHANNEL_MODE_LABELS[mode as ChannelMode]
    : "Guided posting";
}

// --- the channel matrix ----------------------------------------------------
// One row per real destination channel. "other" is NOT in the matrix — it is a
// free-form manual catch-all handled separately by the UI (custom tracked post).
export type DistributionChannel = {
  // Reuses the listing-distribution portal keys so listing_posts, tracked links,
  // and lead source attribution all line up with an existing row.
  key: Exclude<PortalKey, "other">;
  label: string;
  mode: ChannelMode;
  // One-line "what Vacantless does here", operator-facing.
  blurb: string;
  // Which lib/listing-copy channel to surface on the card, or null when the
  // channel has no self-serve copy (Realtor.ca is a broker/DDF route).
  copyKey: CopyPortalKey | null;
  hasFillSheet: boolean;
  hasGuardrails: boolean;
  // Whether this channel is a candidate for the org XML feed (informational in
  // Slice 1; partner onboarding is a later slice).
  feedEligible: boolean;
  // Where "Open portal" points (the posting / manager entry page).
  portalUrl: string;
};

// Order = highest real demand first (Facebook, Kijiji), then structured feed
// candidates, then the paid/manual and broker routes.
export const DISTRIBUTION_CHANNELS: readonly DistributionChannel[] = [
  {
    key: "facebook",
    label: "Facebook Marketplace",
    mode: "assisted_manual",
    blurb:
      "Vacantless prepares Facebook-safe wording, photo order, and renter replies. You review the Facebook post, then paste the live ad link back here.",
    copyKey: "facebook",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    portalUrl: "https://www.facebook.com/marketplace/create/rental",
  },
  {
    key: "kijiji",
    label: "Kijiji",
    mode: "assisted_manual",
    blurb:
      "Vacantless gives you the title, description, field sheet, and Kijiji reminders. You post on Kijiji, then paste the live ad link back here.",
    copyKey: "kijiji",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    portalUrl: "https://www.kijiji.ca/p-post-ad.html",
  },
  {
    key: "rentals_ca",
    label: "Rentals.ca",
    mode: "feed_or_assisted",
    blurb:
      "If your Rentals.ca feed route is connected, Vacantless can submit the listing. Until then, use the guided copy and field sheet.",
    copyKey: "rentals_ca",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: true,
    portalUrl: "https://rentals.ca/",
  },
  {
    key: "zumper",
    label: "Zumper",
    mode: "feed_or_assisted",
    blurb:
      "If your Zumper feed route is connected, Vacantless can submit the listing. Until then, use the guided copy and field sheet.",
    copyKey: "zumper",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: true,
    portalUrl: "https://www.zumper.com/manage",
  },
  {
    key: "viewit",
    label: "Viewit.ca",
    mode: "assisted_manual",
    blurb:
      "Viewit is a paid listing site. Vacantless prepares the copy and fields; you review any payment and paste the live ad link back here.",
    copyKey: "viewit",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    portalUrl: "https://www.viewit.ca/",
  },
  {
    key: "realtor_ca",
    label: "Realtor.ca",
    mode: "broker",
    blurb:
      "Realtor.ca is an agent or MLS route, not a self-serve landlord post. Vacantless prepares the field sheet for your agent.",
    copyKey: null,
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    portalUrl: "https://www.realtor.ca/",
  },
];

export function channelByKey(
  key: unknown,
): DistributionChannel | null {
  return (
    DISTRIBUTION_CHANNELS.find((c) => c.key === key) ?? null
  );
}

// --- per-channel status ----------------------------------------------------
// The single operator-facing state of a channel, derived from listing_posts +
// share-readiness. Mirrors the vocabulary Noam asked for.
export const CHANNEL_STATUS_VALUES = [
  "not_started", // nothing posted, and the listing isn't ready to post yet
  "ready", // ready to post (or a plan drafted), nothing live yet
  "posted", // a live ad exists here
  "needs_refresh", // live but stale (repost/refresh), or expired/removed
  "problem", // a live ad is missing its link (can't be tracked/reopened)
] as const;
export type ChannelStatusValue = (typeof CHANNEL_STATUS_VALUES)[number];

const CHANNEL_STATUS_LABELS: Record<ChannelStatusValue, string> = {
  not_started: "Not started",
  ready: "Ready to post",
  posted: "Posted",
  needs_refresh: "Needs refresh",
  problem: "Problem",
};

export function channelStatusLabel(value: unknown): string {
  return typeof value === "string" &&
    (CHANNEL_STATUS_VALUES as readonly string[]).includes(value)
    ? CHANNEL_STATUS_LABELS[value as ChannelStatusValue]
    : "Not started";
}

// A visual tone hint for the status chip (green/amber/red/gray). Kept here so
// the UI never re-derives it and the two never disagree.
export type StatusTone = "positive" | "warning" | "danger" | "neutral";
const CHANNEL_STATUS_TONES: Record<ChannelStatusValue, StatusTone> = {
  not_started: "neutral",
  ready: "positive",
  posted: "positive",
  needs_refresh: "warning",
  problem: "danger",
};
export function channelStatusTone(value: unknown): StatusTone {
  return typeof value === "string" &&
    (CHANNEL_STATUS_VALUES as readonly string[]).includes(value)
    ? CHANNEL_STATUS_TONES[value as ChannelStatusValue]
    : "neutral";
}

// Default repost/refresh reminder window. A rental ad that has been live this
// many days is stale enough to bump/repost (Kijiji ads sink, Facebook posts
// fall down the feed). Configurable per call.
export const DEFAULT_REFRESH_DAYS = 14;

// One tracked post that belongs to a channel (the subset of listing_posts the
// status reducer needs). inquiryCount is the leads-through-this-post tally.
export type ChannelPost = {
  status: ListingPostStatus;
  url: string | null;
  posted_on: string | null; // "YYYY-MM-DD" or null
  inquiryCount: number;
};

export type ChannelStatusInput = {
  // Whether the public /r page is live and accepting inquiries.
  linkIsLive: boolean;
  // Required, still-unmet share-readiness items, already resolved to operator
  // labels by the caller (listing-level, channel-agnostic in Slice 1).
  blockers: string[];
  // listing_posts rows for THIS channel only.
  posts: ChannelPost[];
  // Org-local "today" as "YYYY-MM-DD" (caller passes it; keeps this pure).
  today: string;
  refreshDays?: number;
};

export type ChannelStatus = {
  value: ChannelStatusValue;
  // Missing requirements to surface on the card (share-readiness + "set Live").
  blockers: string[];
  // The representative live post's link + date, for "open live ad" / "posted X".
  liveUrl: string | null;
  lastPostedOn: string | null;
  // Total leads attributed to this channel's posts.
  inquiryCount: number;
};

/** Whole days between two "YYYY-MM-DD" strings (b - a). null if either invalid. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!isYmd(a) || !isYmd(b)) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86_400_000);
}

function isYmd(v: string | null | undefined): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Reduce a channel's tracked posts + the listing's share-readiness into one
 * status. Precedence (a live ad wins over unmet blockers — the operator may have
 * posted anyway, but we still surface the blockers as warnings):
 *   1. a LIVE post  -> posted, or needs_refresh when it's older than refreshDays
 *      (problem if a live post somehow has no url — can't be tracked/reopened)
 *   2. an expired/removed post (nothing live) -> needs_refresh (repost)
 *   3. a draft post (nothing live) -> ready (a plan noted)
 *   4. no posts -> not_started when there are blockers, else ready
 */
export function computeChannelStatus(input: ChannelStatusInput): ChannelStatus {
  const refreshDays = input.refreshDays ?? DEFAULT_REFRESH_DAYS;
  const blockers = [...input.blockers];
  if (!input.linkIsLive) {
    // The single most important blocker: the public page must be Live before any
    // channel can carry a working inquiry link. Lead with it, de-duplicated.
    const liveMsg = "Set this rental Live so its inquiry link works";
    if (!blockers.includes(liveMsg)) blockers.unshift(liveMsg);
  }

  const inquiryCount = input.posts.reduce(
    (n, p) => n + (Number.isFinite(p.inquiryCount) ? p.inquiryCount : 0),
    0,
  );

  // Pick the representative LIVE post: the most recently posted one.
  const livePosts = input.posts.filter((p) => p.status === "live");
  const live = pickMostRecent(livePosts);

  if (live) {
    if (!live.url) {
      return {
        value: "problem",
        blockers,
        liveUrl: null,
        lastPostedOn: live.posted_on,
        inquiryCount,
      };
    }
    const age = daysBetween(live.posted_on, input.today);
    const stale = age != null && age >= refreshDays;
    return {
      value: stale ? "needs_refresh" : "posted",
      blockers,
      liveUrl: live.url,
      lastPostedOn: live.posted_on,
      inquiryCount,
    };
  }

  // Nothing live. Expired/removed => needs a repost; a draft => a plan noted.
  const hasStale = input.posts.some(
    (p) => p.status === "expired" || p.status === "removed",
  );
  if (hasStale) {
    const recent = pickMostRecent(input.posts);
    return {
      value: "needs_refresh",
      blockers,
      liveUrl: null,
      lastPostedOn: recent?.posted_on ?? null,
      inquiryCount,
    };
  }

  const hasDraft = input.posts.some((p) => p.status === "draft");
  if (hasDraft) {
    return {
      value: "ready",
      blockers,
      liveUrl: null,
      lastPostedOn: null,
      inquiryCount,
    };
  }

  // No posts at all.
  return {
    value: blockers.length > 0 ? "not_started" : "ready",
    blockers,
    liveUrl: null,
    lastPostedOn: null,
    inquiryCount,
  };
}

/** The post with the latest posted_on (nulls sort last). null when empty. */
function pickMostRecent(posts: ChannelPost[]): ChannelPost | null {
  let best: ChannelPost | null = null;
  for (const p of posts) {
    if (!best) {
      best = p;
      continue;
    }
    const a = best.posted_on ?? "";
    const b = p.posted_on ?? "";
    if (b > a) best = p;
  }
  return best;
}
