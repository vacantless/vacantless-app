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
//    it still needs posting assist. (Rentals.ca, Zumper.)
//  - api_automatic: a sanctioned API post still gated by operator approval.
//  - broker: a realtor/DDF route (Realtor.ca) — not a self-serve landlord post.
export const CHANNEL_MODES = [
  "assisted_manual",
  "feed_or_assisted",
  "api_automatic",
  "broker",
] as const;
export type ChannelMode = (typeof CHANNEL_MODES)[number];

const CHANNEL_MODE_LABELS: Record<ChannelMode, string> = {
  assisted_manual: "Posting assist",
  feed_or_assisted: "Feed candidate / assist",
  api_automatic: "API posting",
  broker: "Broker / MLS",
};

export function channelModeLabel(mode: unknown): string {
  return typeof mode === "string" && (CHANNEL_MODES as readonly string[]).includes(mode)
    ? CHANNEL_MODE_LABELS[mode as ChannelMode]
    : "Posting assist";
}

// --- canonical channel registry fields ------------------------------------
// Extra metadata for the presentation-layer "Link Your Portals" screen. These
// fields say whether a customer can connect/post through Vacantless today; they
// do not change any existing publish or tracking behavior.
export const CHANNEL_CATEGORIES = [
  "portal",
  "classifieds",
  "social",
  "chat",
] as const;
export type ChannelCategory = (typeof CHANNEL_CATEGORIES)[number];

export const CHANNEL_INTEGRATION_STATUSES = [
  "live",
  "planned",
  "mls_gated",
] as const;
export type ChannelIntegrationStatus =
  (typeof CHANNEL_INTEGRATION_STATUSES)[number];

export const CHANNEL_CONNECT_KINDS = [
  "oauth",
  "account_login",
  "none",
] as const;
export type ChannelConnectKind = (typeof CHANNEL_CONNECT_KINDS)[number];

// --- the channel matrix ----------------------------------------------------
// One row per real destination channel. "other" is NOT in the matrix — it is a
// free-form manual catch-all handled separately by the UI (custom tracked post).
export type DistributionChannel = {
  // Reuses the listing-distribution portal keys so listing_posts, tracked links,
  // and lead source attribution all line up with an existing row.
  key: Exclude<PortalKey, "other">;
  label: string;
  category: ChannelCategory;
  // "live" is reserved for channels with a real account connection and post path
  // today. "planned" must not render a working connect CTA.
  integrationStatus: ChannelIntegrationStatus;
  connectKind: ChannelConnectKind;
  notes?: string;
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
  // Relist Radar clock metadata. Unknown TTLs stay null so the dark detector
  // skips them until a portal-specific expiry rule is proven.
  ttlDays: number | null;
  paid: boolean;
  // Where "Open portal" points (the posting / manager entry page).
  portalUrl: string;
};

export const GET_ONLINE_ASSIST_KINDS = [
  "posting_assist",
  "paid_posting_assist",
] as const;
export type GetOnlineAssistKind = (typeof GET_ONLINE_ASSIST_KINDS)[number];

const GET_ONLINE_ASSIST_BY_CHANNEL: Partial<
  Record<DistributionChannel["key"], GetOnlineAssistKind>
> = {
  facebook: "posting_assist",
  rentfaster: "paid_posting_assist",
};

// Order = ranked display order for Distribute/Get online. Publish execution
// stays decoupled in lib/distribution-publish.
export const DISTRIBUTION_CHANNELS: readonly DistributionChannel[] = [
  {
    key: "kijiji",
    label: "Kijiji",
    category: "classifieds",
    integrationStatus: "live",
    connectKind: "account_login",
    mode: "assisted_manual",
    blurb:
      "Vacantless gives you the title, description, field sheet, and Kijiji reminders. You post on Kijiji, then paste the live ad link back here.",
    copyKey: "kijiji",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: 60,
    paid: false,
    portalUrl: "https://www.kijiji.ca/p-post-ad.html",
  },
  {
    key: "facebook",
    label: "Facebook Marketplace",
    category: "classifieds",
    integrationStatus: "planned",
    connectKind: "none",
    notes:
      "Marketplace is not a connected Vacantless channel yet. Use posting assist until a real account connection exists.",
    mode: "assisted_manual",
    blurb:
      "Vacantless prepares Facebook-safe wording, photo order, and renter replies. You review the Facebook post, then paste the live ad link back here.",
    copyKey: "facebook",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: null,
    paid: false,
    portalUrl: "https://www.facebook.com/marketplace/create/rental",
  },
  {
    key: "rentals_ca",
    label: "Rentals.ca",
    category: "portal",
    integrationStatus: "live",
    connectKind: "account_login",
    mode: "feed_or_assisted",
    blurb:
      "Rentals.ca is a feed candidate, not a live Vacantless integration. Until a partner route is accepted, use the prepared copy, field sheet, and proof tracking.",
    copyKey: "rentals_ca",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: true,
    ttlDays: null,
    paid: false,
    portalUrl: "https://rentals.ca/",
  },
  {
    key: "rentfaster",
    label: "RentFaster.ca",
    category: "portal",
    integrationStatus: "planned",
    connectKind: "none",
    notes:
      "RentFaster.ca remains proof-gated in Vacantless; do not show it as connected until a real account-backed posting route exists.",
    mode: "feed_or_assisted",
    blurb:
      "RentFaster is a feed candidate and paid self-serve listing lane. Start logged in, choose Single Unit, review package/add-ons, then paste the live ad link.",
    copyKey: "rentfaster",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: true,
    ttlDays: null,
    paid: true,
    portalUrl: "https://www.rentfaster.ca/admin/add-listing/",
  },
  {
    key: "zumper",
    label: "Zumper + PadMapper",
    category: "portal",
    integrationStatus: "live",
    connectKind: "account_login",
    mode: "feed_or_assisted",
    blurb:
      "Zumper is the managed posting path and can also reach PadMapper. Use posting assist until a partner route is accepted; submitted is not counted as live until proof comes back.",
    copyKey: "zumper",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: true,
    ttlDays: null,
    paid: false,
    portalUrl: "https://www.zumper.com/manage",
  },
  {
    key: "viewit",
    label: "Viewit.ca",
    category: "portal",
    integrationStatus: "planned",
    connectKind: "none",
    notes:
      "Viewit.ca is a target portal, but Vacantless does not have a connected posting path for it yet.",
    mode: "assisted_manual",
    blurb:
      "Viewit is a paid listing site. Vacantless prepares the copy and fields; you review any payment and paste the live ad link back here.",
    copyKey: "viewit",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: null,
    paid: true,
    portalUrl: "https://www.viewit.ca/",
  },
  {
    key: "realtor_ca",
    label: "Realtor.ca",
    category: "portal",
    integrationStatus: "mls_gated",
    connectKind: "none",
    notes:
      "Realtor.ca listings must go through an MLS or broker route; this is not a self-serve landlord portal.",
    mode: "broker",
    blurb:
      "Realtor.ca is an agent or MLS route, not a self-serve landlord post. Vacantless prepares the field sheet for your agent.",
    copyKey: null,
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: null,
    paid: false,
    portalUrl: "https://www.realtor.ca/",
  },
  {
    key: "facebook_feed",
    label: "Facebook Page feed",
    category: "social",
    integrationStatus: "live",
    connectKind: "oauth",
    mode: "api_automatic",
    blurb:
      "Vacantless can post a tracked listing link to a connected Facebook Business Page after you approve that item. Organic Page posts reach Page followers; Marketplace and ads are separate channels.",
    copyKey: "facebook_feed",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: null,
    paid: false,
    portalUrl: "https://www.facebook.com/",
  },
  {
    key: "instagram",
    label: "Instagram",
    category: "social",
    integrationStatus: "live",
    connectKind: "oauth",
    mode: "api_automatic",
    blurb:
      "Vacantless can publish a single-image post to a linked Instagram Business account after you approve that item. Captions include the tracked inquiry link; Stories, Reels, and carousels stay separate.",
    copyKey: "instagram",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: null,
    paid: false,
    portalUrl: "https://www.instagram.com/",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    category: "chat",
    integrationStatus: "planned",
    connectKind: "none",
    notes:
      "WhatsApp Business is in the target channel list, but there is no connected Vacantless posting or send path for this tile yet.",
    mode: "assisted_manual",
    blurb:
      "Vacantless prepares a compact share message with the tracked inquiry link. Send it through WhatsApp or a broadcast list, then save a proof link or note.",
    copyKey: "whatsapp",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: null,
    paid: false,
    portalUrl: "https://web.whatsapp.com/",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    category: "social",
    integrationStatus: "planned",
    connectKind: "none",
    notes:
      "LinkedIn is listed for the roadmap, but Vacantless does not have a real connected posting path for it yet.",
    mode: "assisted_manual",
    blurb:
      "Vacantless prepares a polished social caption and tracked inquiry link. Post from the connected LinkedIn account, then save the post URL as proof.",
    copyKey: "linkedin",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: null,
    paid: false,
    portalUrl: "https://www.linkedin.com/feed/",
  },
  {
    key: "snapchat",
    label: "Snapchat",
    category: "social",
    integrationStatus: "planned",
    connectKind: "none",
    notes:
      "Snapchat is in the target channel list, but Vacantless does not have a real connected posting path for it yet.",
    mode: "assisted_manual",
    blurb:
      "Vacantless prepares short social copy and the tracked inquiry link. Post from the connected Snapchat account, then save the post or story proof.",
    copyKey: "snapchat",
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: null,
    paid: false,
    portalUrl: "https://www.snapchat.com/",
  },
];

export const DISTRIBUTION_CHANNEL_DISPLAY_GROUPS = [
  {
    id: "listing_sites",
    title: "Listing sites",
    categories: ["portal", "classifieds"],
  },
  {
    id: "share_social",
    title: "Share & social",
    categories: ["social", "chat"],
  },
] as const;
export type DistributionChannelDisplayGroup =
  (typeof DISTRIBUTION_CHANNEL_DISPLAY_GROUPS)[number];
export type DistributionChannelDisplayGroupId =
  DistributionChannelDisplayGroup["id"];

const DISTRIBUTION_CHANNEL_DISPLAY_GROUP_BY_CATEGORY: Record<
  ChannelCategory,
  DistributionChannelDisplayGroupId
> = {
  portal: "listing_sites",
  classifieds: "listing_sites",
  social: "share_social",
  chat: "share_social",
};

export function distributionChannelDisplayGroupFor(
  category: ChannelCategory,
): DistributionChannelDisplayGroup {
  const groupId = DISTRIBUTION_CHANNEL_DISPLAY_GROUP_BY_CATEGORY[category];
  return DISTRIBUTION_CHANNEL_DISPLAY_GROUPS.find((group) => group.id === groupId)!;
}

export function groupByDistributionChannelDisplayGroup<T>(
  items: readonly T[],
  categoryFor: (item: T) => ChannelCategory | null | undefined,
): Array<{ group: DistributionChannelDisplayGroup; items: T[] }> {
  const grouped = new Map<DistributionChannelDisplayGroupId, T[]>(
    DISTRIBUTION_CHANNEL_DISPLAY_GROUPS.map((group) => [group.id, []]),
  );

  for (const item of items) {
    const category = categoryFor(item);
    if (!category) continue;
    const group = distributionChannelDisplayGroupFor(category);
    grouped.get(group.id)?.push(item);
  }

  return DISTRIBUTION_CHANNEL_DISPLAY_GROUPS.map((group) => ({
    group,
    items: grouped.get(group.id) ?? [],
  })).filter(({ items }) => items.length > 0);
}

export function groupDistributionChannelsForDisplay(
  channels: readonly DistributionChannel[] = DISTRIBUTION_CHANNELS,
): Array<{ group: DistributionChannelDisplayGroup; channels: DistributionChannel[] }> {
  return groupByDistributionChannelDisplayGroup(
    channels,
    (channel) => channel.category,
  ).map(({ group, items }) => ({ group, channels: items }));
}

export function channelByKey(
  key: unknown,
): DistributionChannel | null {
  return (
    DISTRIBUTION_CHANNELS.find((c) => c.key === key) ?? null
  );
}

export function getOnlineAssistKindForChannel(
  channel: DistributionChannel,
): GetOnlineAssistKind | null {
  if (channel.integrationStatus !== "planned") return null;
  return GET_ONLINE_ASSIST_BY_CHANNEL[channel.key] ?? null;
}

export const CANONICAL_CHANNEL_REGISTRY = DISTRIBUTION_CHANNELS;

export const CHANNEL_TILE_STATES = [
  "linked",
  "not_linked",
  "not_available_yet",
  "mls_only",
] as const;
export type ChannelTileState = (typeof CHANNEL_TILE_STATES)[number];

export type ChannelTileAccount = {
  account_status?: string | null;
  automation_authorized?: boolean | null;
};

export type ChannelTileStatus = {
  state: ChannelTileState;
  headline: string;
  canConnect: boolean;
};

/**
 * Presentation verdict for the future "Link Your Portals" tile. Pure: callers
 * pass the optional distribution_channel_accounts row; this function never reads
 * env, DB, or network state.
 */
export function channelTileStatus(
  channelKey: unknown,
  account?: ChannelTileAccount | null,
): ChannelTileStatus {
  const channel = channelByKey(channelKey);
  if (!channel) {
    return {
      state: "not_available_yet",
      headline: "This channel is not configured yet.",
      canConnect: false,
    };
  }

  if (channel.integrationStatus === "mls_gated") {
    return {
      state: "mls_only",
      headline: `${channel.label} requires an MLS or broker route.`,
      canConnect: false,
    };
  }

  if (channel.integrationStatus === "planned") {
    return {
      state: "not_available_yet",
      headline: channel.notes ?? `${channel.label} is not available yet.`,
      canConnect: false,
    };
  }

  const linked =
    account?.account_status === "connected" &&
    account?.automation_authorized === true;

  if (linked) {
    return {
      state: "linked",
      headline: `${channel.label} is linked and authorized.`,
      canConnect: false,
    };
  }

  return {
    state: "not_linked",
    headline: `Link ${channel.label} to publish here.`,
    canConnect: true,
  };
}

export type ConnectChipTone = "positive" | "warning" | "danger" | "neutral" | "accent";
export type ConnectChipState =
  | "connected"
  | "connect"
  | "needs_login"
  | "needs_payment"
  | "submitted"
  | "rejected"
  | "paused"
  | "coming_soon"
  | "mls_route"
  | "manual"
  | "always_on";
export type ConnectChip = {
  state: ConnectChipState;
  label: string;
  tone: ConnectChipTone;
  canConnect: boolean;
};

export const CHANNEL_CONNECTION_STATES = [
  "connected_ready",
  "connected_needs_authorization",
  "needs_sign_in",
  "needs_payment_or_setup",
  "planned_or_unavailable",
  "broker_route",
  "always_on",
] as const;
export type ChannelConnectionState =
  (typeof CHANNEL_CONNECTION_STATES)[number];

export type ChannelConnectionStage = {
  state: ChannelConnectionState;
  label: string;
  nextActionLabel: string;
  helper: string;
  tone: ConnectChipTone;
  canConnect: boolean;
  countsAsReady: boolean;
};

export function channelConnectionStage(input: {
  integrationStatus: ChannelIntegrationStatus | null;
  transport: string;
  requiresLogin: boolean;
  requiresPayment: boolean;
  accountStatus: string | null;
  hasFeedRoute: boolean;
  automationAuthorized: boolean;
  requiresAutomationAuthorization: boolean;
}): ChannelConnectionStage {
  if (input.integrationStatus === "mls_gated" || input.transport === "broker") {
    return {
      state: "broker_route",
      label: "Broker route",
      nextActionLabel: "Create broker handoff",
      helper: "This channel needs an agent, MLS, or broker handoff; it is not a self-serve account connection.",
      tone: "neutral",
      canConnect: false,
      countsAsReady: false,
    };
  }

  if (input.integrationStatus === "planned") {
    const helper = input.requiresPayment
      ? "No connected Vacantless account exists here yet. Treat this as paid posting assist: review any fee, approve before paying, and save the live ad URL as proof."
      : input.requiresLogin
        ? "No connected Vacantless account exists here yet. Posting assist can prepare the listing, but a signed-in operator must review the post and save the live ad URL as proof."
        : "This channel is listed for the roadmap, but there is no connected Vacantless posting path yet.";
    return {
      state: "planned_or_unavailable",
      label: "Planned",
      nextActionLabel: input.requiresPayment ? "Use paid posting assist" : "Use posting assist",
      helper,
      tone: "neutral",
      canConnect: false,
      countsAsReady: false,
    };
  }

  if (input.integrationStatus === null && input.transport === "automatic") {
    return {
      state: "always_on",
      label: "On",
      nextActionLabel: "No account action",
      helper: "This Vacantless-owned route does not need an external account connection.",
      tone: "positive",
      canConnect: false,
      countsAsReady: true,
    };
  }

  if (input.accountStatus === "needs_login") {
    return {
      state: "needs_sign_in",
      label: "Needs sign-in",
      nextActionLabel: "Refresh sign-in",
      helper: "Sign in or refresh the saved session before Vacantless can continue this channel.",
      tone: "warning",
      canConnect: true,
      countsAsReady: false,
    };
  }

  if (input.accountStatus === "needs_payment") {
    return {
      state: "needs_payment_or_setup",
      label: "Needs payment/setup",
      nextActionLabel: "Finish setup/payment",
      helper: "Finish the paid placement or setup step before this channel can move forward.",
      tone: "warning",
      canConnect: true,
      countsAsReady: false,
    };
  }

  if (input.accountStatus === "rejected") {
    return {
      state: "needs_payment_or_setup",
      label: "Review setup",
      nextActionLabel: "Review rejection",
      helper: "The channel rejected or blocked this route. Review the setup before trying again.",
      tone: "danger",
      canConnect: true,
      countsAsReady: false,
    };
  }

  if (input.accountStatus === "paused") {
    return {
      state: "needs_payment_or_setup",
      label: "Paused",
      nextActionLabel: "Resume channel",
      helper: "Resume this channel before it can receive a listing.",
      tone: "neutral",
      canConnect: true,
      countsAsReady: false,
    };
  }

  if (input.accountStatus === "submitted") {
    return {
      state: "needs_payment_or_setup",
      label: "Submitted",
      nextActionLabel: "Check acceptance",
      helper: "Setup was submitted and is waiting on the channel to accept the route.",
      tone: "neutral",
      canConnect: false,
      countsAsReady: false,
    };
  }

  const connected =
    input.accountStatus === "connected" ||
    input.accountStatus === "accepted" ||
    input.hasFeedRoute === true;

  if (connected && input.requiresAutomationAuthorization && !input.automationAuthorized) {
    return {
      state: "connected_needs_authorization",
      label: "Connected - authorize posting",
      nextActionLabel: "Authorize auto-post",
      helper: "The account is connected. Authorize Vacantless before it can auto-post to this channel.",
      tone: "warning",
      canConnect: false,
      countsAsReady: false,
    };
  }

  if (connected) {
    return {
      state: "connected_ready",
      label: input.requiresAutomationAuthorization ? "Connected + authorized" : "Connected",
      nextActionLabel: "Use from Get online",
      helper: input.requiresAutomationAuthorization
        ? "This account is connected and authorized for approved posts."
        : "This account or feed route is ready for the next publishing step.",
      tone: "positive",
      canConnect: false,
      countsAsReady: true,
    };
  }

  return {
    state: "needs_payment_or_setup",
    label: input.requiresPayment ? "Needs payment/setup" : "Needs setup",
    nextActionLabel: input.requiresPayment ? "Set up payment rules" : "Set up account",
    helper: input.requiresPayment
      ? "Finish account setup and confirm any paid-placement rules before using this channel."
      : "Connect or record this channel once before using it from Get online.",
    tone: "accent",
    canConnect: true,
    countsAsReady: false,
  };
}

export const CHANNEL_CONNECTION_CHECKLIST_GROUPS = [
  {
    id: "authorization",
    label: "Authorize",
    helper: "Connected accounts waiting on explicit posting consent.",
  },
  {
    id: "sign_in",
    label: "Sign in",
    helper: "Portal sessions that need a fresh operator sign-in.",
  },
  {
    id: "setup",
    label: "Setup/payment",
    helper: "Accounts, feed routes, or paid-placement rules to finish.",
  },
  {
    id: "ready",
    label: "Ready",
    helper: "Routes ready for the next Get online step.",
  },
  {
    id: "planned",
    label: "Planned/broker",
    helper: "Roadmap or broker routes that must stay fail-closed.",
  },
] as const;
export type ChannelConnectionChecklistGroupId =
  (typeof CHANNEL_CONNECTION_CHECKLIST_GROUPS)[number]["id"];

export type ChannelConnectionChecklistInput = {
  channel: string;
  label: string;
  stage: ChannelConnectionStage;
  href?: string | null;
};

export type ChannelConnectionChecklistGroup<T extends ChannelConnectionChecklistInput> = {
  id: ChannelConnectionChecklistGroupId;
  label: string;
  helper: string;
  items: T[];
};

export function channelConnectionChecklistGroupFor(
  stage: ChannelConnectionStage,
): ChannelConnectionChecklistGroupId {
  if (stage.state === "connected_needs_authorization") return "authorization";
  if (stage.state === "needs_sign_in") return "sign_in";
  if (stage.state === "needs_payment_or_setup") return "setup";
  if (stage.state === "connected_ready" || stage.state === "always_on") return "ready";
  return "planned";
}

export function groupChannelConnectionChecklist<T extends ChannelConnectionChecklistInput>(
  items: readonly T[],
): Array<ChannelConnectionChecklistGroup<T>> {
  const grouped = new Map<ChannelConnectionChecklistGroupId, T[]>(
    CHANNEL_CONNECTION_CHECKLIST_GROUPS.map((group) => [group.id, []]),
  );

  for (const item of items) {
    grouped.get(channelConnectionChecklistGroupFor(item.stage))?.push(item);
  }

  return CHANNEL_CONNECTION_CHECKLIST_GROUPS.map((group) => ({
    ...group,
    items: grouped.get(group.id) ?? [],
  })).filter((group) => group.items.length > 0);
}

export function channelConnectChip(input: {
  integrationStatus: ChannelIntegrationStatus | null;
  transport: string;
  needsOrgAccount: boolean;
  accountStatus: string | null;
  hasFeedRoute: boolean;
}): ConnectChip {
  if (input.integrationStatus === "mls_gated" || input.transport === "broker") {
    return { state: "mls_route", label: "MLS / broker route", tone: "neutral", canConnect: false };
  }
  if (input.integrationStatus === "planned") {
    return { state: "coming_soon", label: "Coming soon", tone: "neutral", canConnect: false };
  }
  if (input.accountStatus === "connected" || input.accountStatus === "accepted") {
    return { state: "connected", label: "Connected", tone: "positive", canConnect: false };
  }
  if (input.hasFeedRoute === true) {
    return { state: "connected", label: "Connected", tone: "positive", canConnect: false };
  }
  if (input.accountStatus === "needs_login") {
    return { state: "needs_login", label: "Needs login", tone: "warning", canConnect: true };
  }
  if (input.accountStatus === "needs_payment") {
    return { state: "needs_payment", label: "Needs payment", tone: "warning", canConnect: true };
  }
  if (input.accountStatus === "rejected") {
    return { state: "rejected", label: "Rejected", tone: "danger", canConnect: true };
  }
  if (input.accountStatus === "paused") {
    return { state: "paused", label: "Paused", tone: "neutral", canConnect: true };
  }
  if (input.accountStatus === "submitted") {
    return { state: "submitted", label: "Submitted", tone: "neutral", canConnect: false };
  }
  if (input.integrationStatus === null && input.transport === "automatic") {
    return { state: "always_on", label: "On", tone: "positive", canConnect: false };
  }
  if (input.transport === "custom") {
    return { state: "manual", label: "Manual", tone: "neutral", canConnect: false };
  }
  return { state: "connect", label: "Connect", tone: "accent", canConnect: true };
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
