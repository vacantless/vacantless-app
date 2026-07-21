// Pure listing-health alert decisions for stale/expired listing_posts.
// The cron owns DB reads, notification sends, and timestamp writes. This file
// deliberately reuses computeChannelStatus so Distribute, freshness, snapshots,
// and proactive alerts share one stale/expired rule.

import {
  DEFAULT_REFRESH_DAYS,
  computeChannelStatus,
  type ChannelPost,
} from "./distribution-channels";
import {
  isListingPostStatus,
  isPortalKey,
  portalLabel,
} from "./listing-distribution";

export const LISTING_HEALTH_EVENT_KEY = "leasing.listing_health";
export const LISTING_HEALTH_COOLDOWN_DAYS = 7;

export type ListingHealthPost = {
  id: string;
  propertyId: string;
  address: string | null;
  portal: string;
  label?: string | null;
  status: string;
  url: string | null;
  postedOn: string | null;
  lastHealthAlertedAt?: string | null;
};

export type ListingHealthReason = "stale" | "expired_or_removed";

export type ListingHealthChannel = {
  propertyId: string;
  address: string;
  channel: string;
  channelLabel: string;
  reason: ListingHealthReason;
  postIds: string[];
  alertablePostIds: string[];
  liveUrl: string | null;
  lastPostedOn: string | null;
};

export type ListingHealthDigest = {
  adCount: number;
  unitCount: number;
  firstDistributeUrl: string | null;
  summaryText: string;
  detailsText: string;
};

export type ListingHealthSnapshotSummary = {
  adCount: number;
  unitCount: number;
  firstDistributeUrl: string | null;
};

type ListingHealthInput = {
  posts: ListingHealthPost[];
  today: string;
  nowISO: string;
  refreshDays?: number;
  cooldownDays?: number;
};

function fallbackAddress(address: string | null): string {
  const value = (address ?? "").trim();
  return value || "(unit address missing)";
}

function channelLabelFor(post: ListingHealthPost): string {
  if (isPortalKey(post.portal)) {
    if (post.portal === "other" && post.label?.trim()) return post.label.trim();
    return portalLabel(post.portal);
  }
  return post.label?.trim() || post.portal || "Listing channel";
}

function daysSince(iso: string | null | undefined, nowISO: string): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  const now = Date.parse(nowISO);
  if (Number.isNaN(then) || Number.isNaN(now)) return null;
  return Math.floor((now - then) / 86_400_000);
}

function alertable(post: ListingHealthPost, nowISO: string, cooldownDays: number): boolean {
  const age = daysSince(post.lastHealthAlertedAt, nowISO);
  return age == null || age >= cooldownDays;
}

function groupKey(post: ListingHealthPost): string {
  return `${post.propertyId}::${post.portal}`;
}

function toChannelPost(post: ListingHealthPost): ChannelPost | null {
  if (!isListingPostStatus(post.status)) return null;
  return {
    status: post.status,
    url: post.url,
    posted_on: post.postedOn,
    inquiryCount: 0,
  };
}

function reasonFor(posts: ListingHealthPost[]): ListingHealthReason {
  return posts.some((p) => p.status === "live") ? "stale" : "expired_or_removed";
}

export function listingHealthChannels(input: ListingHealthInput): ListingHealthChannel[] {
  const cooldownDays = input.cooldownDays ?? LISTING_HEALTH_COOLDOWN_DAYS;
  const refreshDays = input.refreshDays ?? DEFAULT_REFRESH_DAYS;
  const groups = new Map<string, ListingHealthPost[]>();
  for (const post of input.posts) {
    if (!post.id || !post.propertyId) continue;
    if (!isPortalKey(post.portal)) continue;
    if (!isListingPostStatus(post.status)) continue;
    const list = groups.get(groupKey(post)) ?? [];
    list.push(post);
    groups.set(groupKey(post), list);
  }

  const channels: ListingHealthChannel[] = [];
  for (const posts of groups.values()) {
    const channelPosts = posts
      .map(toChannelPost)
      .filter((p): p is ChannelPost => p !== null);
    const status = computeChannelStatus({
      linkIsLive: true,
      blockers: [],
      posts: channelPosts,
      today: input.today,
      refreshDays,
    });
    if (status.value !== "needs_refresh") continue;

    const actionablePosts = posts.filter(
      (p) =>
        p.status === "expired" ||
        p.status === "removed" ||
        (p.status === "live" && status.liveUrl !== null),
    );
    const alertablePostIds = actionablePosts
      .filter((p) => alertable(p, input.nowISO, cooldownDays))
      .map((p) => p.id);
    const first = posts[0];
    channels.push({
      propertyId: first.propertyId,
      address: fallbackAddress(first.address),
      channel: first.portal,
      channelLabel: channelLabelFor(first),
      reason: reasonFor(actionablePosts),
      postIds: actionablePosts.map((p) => p.id),
      alertablePostIds,
      liveUrl: status.liveUrl,
      lastPostedOn: status.lastPostedOn,
    });
  }

  return channels.sort((a, b) => {
    const byAddress = a.address.localeCompare(b.address);
    if (byAddress !== 0) return byAddress;
    return a.channelLabel.localeCompare(b.channelLabel);
  });
}

export function alertableListingHealthChannels(
  channels: ListingHealthChannel[],
): ListingHealthChannel[] {
  return channels.filter((channel) => channel.alertablePostIds.length > 0);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function distributeUrl(appUrl: string, propertyId: string): string {
  return `${appUrl.replace(/\/+$/, "")}/dashboard/properties/${encodeURIComponent(
    propertyId,
  )}?tab=distribute`;
}

function reasonLabel(reason: ListingHealthReason): string {
  return reason === "stale" ? "stale" : "expired or removed";
}

export function buildListingHealthDigest(
  channels: ListingHealthChannel[],
  appUrl: string,
): ListingHealthDigest {
  const uniqueUnits = new Set(channels.map((channel) => channel.propertyId));
  const adCount = channels.length;
  const unitCount = uniqueUnits.size;
  const firstDistributeUrl = channels[0]
    ? distributeUrl(appUrl, channels[0].propertyId)
    : null;
  const summaryText =
    `${adCount} ${plural(adCount, "ad needs", "ads need")} a refresh ` +
    `across ${unitCount} ${plural(unitCount, "unit", "units")}.`;
  const detailsText = channels
    .map((channel) => {
      const url = distributeUrl(appUrl, channel.propertyId);
      return [
        `- ${channel.address}: ${channel.channelLabel} (${reasonLabel(channel.reason)})`,
        `  ${url}`,
      ].join("\n");
    })
    .join("\n");
  return { adCount, unitCount, firstDistributeUrl, summaryText, detailsText };
}

export function listingHealthSnapshotSummary(
  channels: ListingHealthChannel[],
  appUrl: string,
): ListingHealthSnapshotSummary | null {
  if (channels.length === 0) return null;
  const digest = buildListingHealthDigest(channels, appUrl);
  return {
    adCount: digest.adCount,
    unitCount: digest.unitCount,
    firstDistributeUrl: digest.firstDistributeUrl,
  };
}

export function buildListingHealthSnapshotLine(
  summary: ListingHealthSnapshotSummary | null | undefined,
): string | null {
  if (!summary || summary.adCount <= 0) return null;
  const line =
    `LISTING HEALTH: ${summary.adCount} ` +
    `${plural(summary.adCount, "ad needs", "ads need")} a refresh across ` +
    `${summary.unitCount} ${plural(summary.unitCount, "unit", "units")}.`;
  return summary.firstDistributeUrl
    ? `${line} Review in Distribute: ${summary.firstDistributeUrl}`
    : line;
}
