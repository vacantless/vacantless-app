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

// S681 CAVEAT, read before trusting "live" on an account_login channel.
// "live" here means the channel has a real POST PATH today. It does NOT mean a
// landlord can connect it themselves. Facebook/Instagram (oauth) are the only
// self-serve connections in the product. kijiji, rentals_ca, zumper, rentfaster
// and viewit are account_login, and the "Log in" route lands on a Settings form
// whose only control is a SELF-DECLARED account_status dropdown. There is no
// session-ingestion route anywhere in the app (lib/distribution-session-crypto
// exists; nothing feeds it), so those channels are concierge-onboarded in
// practice. The Stage 1 copy now says so, guarded by
// scripts/test-stage1-connect-copy-truth.ts. Do not widen that claim without
// shipping a real connect route first.
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
  spacelist: "posting_assist",
  costar_loopnet: "paid_posting_assist",
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
    key: "spacelist",
    label: "SpaceList.ca",
    category: "portal",
    integrationStatus: "planned",
    connectKind: "none",
    notes:
      "SpaceList is the first commercial-only target channel. Vacantless does not have a connected posting path for it yet.",
    mode: "assisted_manual",
    blurb:
      "SpaceList is a commercial-only listing lane. Vacantless prepares the commercial field sheet; a signed-in operator reviews the property use, lease facts, and proof URL.",
    copyKey: null,
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: null,
    paid: false,
    portalUrl: "https://www.spacelist.ca/",
  },
  {
    key: "costar_loopnet",
    label: "CoStar / LoopNet",
    category: "portal",
    integrationStatus: "planned",
    connectKind: "none",
    notes:
      "CoStar and LoopNet stay one paid/operator-assisted CRE and 5+ multifamily candidate until account, price, and proof behavior are verified.",
    mode: "assisted_manual",
    blurb:
      "CoStar / LoopNet is for commercial or 5+ multifamily investment inventory. Vacantless prepares the source packet, but login, verification, payment, and posting stay human-gated.",
    copyKey: null,
    hasFillSheet: true,
    hasGuardrails: true,
    feedEligible: false,
    ttlDays: null,
    paid: true,
    portalUrl: "https://www.loopnet.com/solutions/",
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

// ============================================================================
// Connect-tile verdict (Post Everywhere Slice 1, SPEC-S688 section 3).
//
// Pure. The tile reads two rows: the org's distribution_channel_accounts row
// (who connected, is automation authorized, spend limit, kijiji tier) and the
// worker-owned distribution_channel_session_status view row (is the saved
// session alive, signed in as whom, how much of the free cap is used, when the
// worker last looked). Neither read touches a secret column.
//
// `session` has three shapes on purpose:
//   undefined -> the session model is not in play for this caller (flag off, or
//                the 0225 view is not readable yet). Resolve from the account
//                row alone: no "checking", no cap, exactly the pre-Slice-1 tile.
//   null      -> the session model is on and this channel has no session row
//                (nothing to probe: the tile reads Reconnect, code no_session).
//   object    -> the view row.
// With the flag off (Agile today) the page never writes (acceptance 3) and
// Stage 3 "send live" keeps every channel it could send to before this slice;
// the only visible change is that a connected-but-unauthorized account now
// reads "Authorize" instead of "Connect", and a needs_login account reads
// "Reconnect", both per spec steps 5 and 8.
// ============================================================================

export const CHANNEL_TILE_STATES = [
  "linked",
  "connected_needs_authorization",
  "checking",
  "dead_session",
  "cap_reached",
  "not_linked",
  "not_available_yet",
  "mls_only",
] as const;
export type ChannelTileState = (typeof CHANNEL_TILE_STATES)[number];

export type ChannelTileAccount = {
  account_status?: string | null;
  automation_authorized?: boolean | null;
  external_account_label?: string | null;
  spend_authorized?: boolean | null;
  spend_max_cents?: number | null;
  spend_revoked_at?: string | null;
  capabilities?: Record<string, unknown> | null;
};

export type ChannelTileSession = {
  account_label?: string | null;
  alive?: boolean | null;
  cap_used?: number | null;
  cap_total?: number | null;
  last_checked_at?: string | null;
  last_check_code?: string | null;
  last_check_error?: string | null;
  check_pending?: boolean | null;
  stale?: boolean | null;
  // When the session blob was last (re)written by a warm or a reconnect. A
  // dead verdict older than this write is stale and must be re-probed.
  last_validated_at?: string | null;
};

export type ChannelTileStatus = {
  state: ChannelTileState;
  headline: string;
  canConnect: boolean;
  canReconnect: boolean;
  needsCheck: boolean;
  accountLabel: string | null;
  alive: boolean | null;
  lastCheckedAt: string | null;
  lastCheckCode: string | null;
  capLine: string | null;
  costLine: string | null;
  // Structured form of capLine/costLine for locale rendering (page).
  costCap: ChannelCostCap;
  kijijiTier: KijijiTier | null;
};

// One source of truth for what a portal costs. The worker never writes a price.
export const CHANNEL_COST_CENTS: Partial<Record<DistributionChannel["key"], number>> = {
  kijiji: 3384, // $33.84 per Owner ad, tax in, Toronto rental category (S667)
  rentals_ca: 0, // Limited plan
  zumper: 0,
  facebook_feed: 0,
  instagram: 0,
};

// Free cap per account. Kijiji depends on the account tier (personal = 1 free
// ad, business = every ad paid) and is resolved from capabilities.kijiji_tier.
export const CHANNEL_FREE_CAP: Partial<Record<DistributionChannel["key"], number>> = {
  rentals_ca: 3,
  zumper: 5,
};

export const KIJIJI_TIERS = ["personal", "business"] as const;
export type KijijiTier = (typeof KIJIJI_TIERS)[number];

export function kijijiTierOf(
  account: ChannelTileAccount | null | undefined,
): KijijiTier | null {
  const raw = account?.capabilities?.kijiji_tier;
  return raw === "personal" || raw === "business" ? raw : null;
}

// Mirrors spendReady() in lib/distribution-channel-contracts.ts (the
// launch-readiness predicate) on the tile's snake_case account row. Keep the
// two in step; test-session-status-readmodel pins this one.
export function spendReadyForAccount(
  account: ChannelTileAccount | null | undefined,
): boolean {
  return (
    account?.spend_authorized === true &&
    !account?.spend_revoked_at &&
    typeof account?.spend_max_cents === "number" &&
    account.spend_max_cents > 0
  );
}

export function formatChannelMoney(cents: number, locale: "en" | "fr" = "en"): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

export const SPEND_SUFFIX_COPY = " Set a spend limit before a paid post.";

function effectiveCapTotal(
  channelKey: DistributionChannel["key"],
  account: ChannelTileAccount | null | undefined,
  session: ChannelTileSession | null | undefined,
): number | null {
  if (typeof session?.cap_total === "number") return session.cap_total;
  const constant = CHANNEL_FREE_CAP[channelKey];
  if (typeof constant === "number") return constant;
  if (channelKey === "kijiji" && kijijiTierOf(account) === "personal") return 1;
  return null;
}

export type ChannelCapKey =
  | "kijijiFreeAvailable"
  | "kijijiFreeUsed"
  | "rentalsUsed"
  | "rentalsReached"
  | "rentalsUnknown"
  | "zumperUsed"
  | "zumperReached"
  | "zumperUnknown";
export type ChannelCostKey =
  | "free"
  | "kijijiTierUnknown"
  | "kijijiNext"
  | "kijijiPerAd"
  | "kijijiPerExtraAd";

// Structured form of the cap/cost verdict: the page renders it through
// next-intl (stage1.cap.*, stage1.cost.*), the pure English line below is the
// same data rendered with the default strings.
export type ChannelCostCap = {
  cap: { key: ChannelCapKey; used: number | null } | null;
  cost: { key: ChannelCostKey; priceCents: number | null } | null;
  spendSuffix: boolean;
  capReached: boolean;
};

export const EMPTY_COST_CAP: ChannelCostCap = {
  cap: null,
  cost: null,
  spendSuffix: false,
  capReached: false,
};

export function channelCostCap(
  channelKey: unknown,
  account: ChannelTileAccount | null | undefined,
  session: ChannelTileSession | null | undefined,
): ChannelCostCap {
  const none = EMPTY_COST_CAP;
  const channel = channelByKey(channelKey);
  if (!channel) return none;

  const capUsed = typeof session?.cap_used === "number" ? session.cap_used : null;
  const capTotal = effectiveCapTotal(channel.key, account, session);
  const capReached = capUsed != null && capTotal != null && capUsed >= capTotal;
  const free = { key: "free" as const, priceCents: 0 };

  switch (channel.key) {
    case "kijiji": {
      const priceCents = CHANNEL_COST_CENTS.kijiji ?? 0;
      const spendSuffix = !spendReadyForAccount(account);
      const tier = kijijiTierOf(account);
      if (!tier) {
        return {
          cap: null,
          cost: { key: "kijijiTierUnknown", priceCents: null },
          spendSuffix: false,
          capReached: false,
        };
      }
      if (tier === "business") {
        return {
          cap: null,
          cost: { key: "kijijiPerAd", priceCents },
          spendSuffix,
          capReached: false,
        };
      }
      if (capReached) {
        return {
          cap: { key: "kijijiFreeUsed", used: capUsed },
          cost: { key: "kijijiPerExtraAd", priceCents },
          spendSuffix,
          capReached: true,
        };
      }
      return {
        cap: { key: "kijijiFreeAvailable", used: capUsed },
        cost: { key: "kijijiNext", priceCents },
        spendSuffix: false,
        capReached: false,
      };
    }
    case "rentals_ca": {
      if (capUsed == null) {
        return { cap: { key: "rentalsUnknown", used: null }, cost: free, spendSuffix: false, capReached: false };
      }
      if (capReached) {
        return { cap: { key: "rentalsReached", used: capUsed }, cost: free, spendSuffix: false, capReached: true };
      }
      return { cap: { key: "rentalsUsed", used: capUsed }, cost: free, spendSuffix: false, capReached: false };
    }
    case "zumper": {
      if (capUsed == null) {
        return { cap: { key: "zumperUnknown", used: null }, cost: free, spendSuffix: false, capReached: false };
      }
      if (capReached) {
        return { cap: { key: "zumperReached", used: capUsed }, cost: free, spendSuffix: false, capReached: true };
      }
      return { cap: { key: "zumperUsed", used: capUsed }, cost: free, spendSuffix: false, capReached: false };
    }
    case "facebook_feed":
    case "instagram":
      return { cap: null, cost: free, spendSuffix: false, capReached: false };
    default:
      return none;
  }
}

// English defaults, one per key. messages/en.json stage1.cap.* and
// stage1.cost.* carry the same strings with ICU params.
export const CHANNEL_CAP_COPY_EN: Record<ChannelCapKey, (used: number | null) => string> = {
  kijijiFreeAvailable: () => "Your 1 free ad is available.",
  kijijiFreeUsed: () => "Free slot used (1 of 1).",
  rentalsUsed: (used) => `Free (Limited): ${used ?? 0} of 3 active listings used.`,
  rentalsReached: () => "Free cap reached: 3 of 3 active. Disable one or pay for a plan.",
  rentalsUnknown: () => "Free (Limited): up to 3 active listings per account.",
  zumperUsed: (used) => `Free: ${used ?? 0} of 5 listings used.`,
  zumperReached: () => "Free cap reached: 5 of 5 listings. Remove one first.",
  zumperUnknown: () => "Free: up to 5 listings per account.",
};
export const CHANNEL_COST_COPY_EN: Record<ChannelCostKey, (price: string) => string> = {
  free: () => "Free.",
  kijijiTierUnknown: () => "Tell us if this is a personal or business Kijiji account.",
  kijijiNext: (price) => `Free. The next ad after it is ${price}.`,
  kijijiPerAd: (price) => `${price} per ad, paid at the last step.`,
  kijijiPerExtraAd: (price) => `${price} per extra ad, paid at the last step.`,
};

/**
 * The cap line and the cost line under a connect tile, English. Pure.
 */
export function channelCostCapLine(
  channelKey: unknown,
  account: ChannelTileAccount | null | undefined,
  session: ChannelTileSession | null | undefined,
): { capLine: string | null; costLine: string | null; capReached: boolean } {
  const v = channelCostCap(channelKey, account, session);
  const capLine = v.cap ? CHANNEL_CAP_COPY_EN[v.cap.key](v.cap.used) : null;
  const costLine = v.cost
    ? CHANNEL_COST_COPY_EN[v.cost.key](formatChannelMoney(v.cost.priceCents ?? 0)) +
      (v.spendSuffix ? SPEND_SUFFIX_COPY : "")
    : null;
  return { capLine, costLine, capReached: v.capReached };
}

export const SESSION_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

// Same rule as the 0225 view's `stale` column, for callers that pass a row
// without it (or tests that pin `now`).
export function isSessionStale(
  lastCheckedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastCheckedAt) return true;
  const at = Date.parse(lastCheckedAt);
  if (Number.isNaN(at)) return true;
  return at < now - SESSION_STALE_AFTER_MS;
}

// One-line reason for a dead session, keyed by last_check_code (rule 157).
export function sessionCheckReason(code: string | null | undefined): string {
  switch (code) {
    case "needs_login":
      return "signed out";
    case "cloudflare":
    case "captcha":
      return "the site asked for a human check";
    case "no_session":
      return "no saved session";
    case "timeout":
      return "the site did not respond";
    case "error":
      return "an error";
    default:
      return "signed out";
  }
}

/**
 * Presentation verdict for the "Link your portals" tile. Pure: callers pass the
 * optional distribution_channel_accounts row and the optional session-status
 * view row; this function never reads env, DB, or network state. Resolution
 * order is SPEC-S688 section 3.1, first hit wins.
 */
export function channelTileStatus(
  channelKey: unknown,
  account?: ChannelTileAccount | null,
  session?: ChannelTileSession | null,
  now: number = Date.now(),
): ChannelTileStatus {
  const channel = channelByKey(channelKey);
  const base = {
    canConnect: false,
    canReconnect: false,
    needsCheck: false,
    accountLabel: null,
    alive: null,
    lastCheckedAt: null,
    lastCheckCode: null,
    capLine: null,
    costLine: null,
    costCap: EMPTY_COST_CAP,
    kijijiTier: null,
  };

  if (!channel) {
    return {
      ...base,
      state: "not_available_yet",
      headline: "This channel is not configured yet.",
    };
  }

  if (channel.integrationStatus === "mls_gated") {
    return {
      ...base,
      state: "mls_only",
      headline: `${channel.label} requires an MLS or broker route.`,
    };
  }

  if (channel.integrationStatus === "planned") {
    return {
      ...base,
      state: "not_available_yet",
      headline: channel.notes ?? `${channel.label} is not available yet.`,
    };
  }

  const accountStatus = account?.account_status ?? null;
  if (accountStatus !== "connected" && accountStatus !== "needs_login") {
    return {
      ...base,
      state: "not_linked",
      headline: `Link ${channel.label} to publish here.`,
      canConnect: true,
    };
  }

  // From here on the account exists; every verdict carries who it is and what
  // it costs (a dead session still says who it was).
  const sessionAware = session !== undefined;
  const accountLabel =
    session?.account_label ?? account?.external_account_label ?? null;
  const labelForCopy = accountLabel ?? channel.label;
  const costCap = channelCostCap(channel.key, account, session);
  const { capLine, costLine, capReached } = channelCostCapLine(
    channel.key,
    account,
    session,
  );
  const known = {
    costCap,
    kijijiTier: channel.key === "kijiji" ? kijijiTierOf(account) : null,
    accountLabel,
    alive: session?.alive ?? null,
    lastCheckedAt: session?.last_checked_at ?? null,
    lastCheckCode: session?.last_check_code ?? null,
    capLine,
    costLine,
  };

  // A verdict is current only if the worker looked AFTER the last session
  // write; a reconnect (writeChannelSession bumps last_validated_at) must
  // not stay "dead" on the strength of a probe that predates it.
  const verdictCurrent =
    !session?.last_validated_at ||
    !session?.last_checked_at ||
    Date.parse(session.last_checked_at) >= Date.parse(session.last_validated_at);
  if ((session?.alive === false && verdictCurrent) || accountStatus === "needs_login") {
    return {
      ...base,
      ...known,
      state: "dead_session",
      headline: `Reconnect ${labelForCopy}: ${sessionCheckReason(
        session?.alive === false ? session?.last_check_code : "needs_login",
      )}`,
      canReconnect: true,
    };
  }

  if (sessionAware && channel.connectKind !== "none") {
    // No session row at all: nothing to probe, nothing that can post. The
    // worker's own word for this is no_session; the tile reads Reconnect.
    if (session === null) {
      return {
        ...base,
        ...known,
        state: "dead_session",
        headline: `Reconnect ${labelForCopy}: ${sessionCheckReason("no_session")}`,
        lastCheckCode: "no_session",
        canReconnect: true,
      };
    }
    const stale =
      (typeof session.stale === "boolean"
        ? session.stale
        : isSessionStale(session.last_checked_at, now)) || !verdictCurrent;
    if (stale) {
      const pending = session?.check_pending === true;
      return {
        ...base,
        ...known,
        state: "checking",
        headline: `Checking your ${channel.label} account...`,
        needsCheck: !pending,
      };
    }
  }

  if (capReached) {
    return {
      ...base,
      ...known,
      state: "cap_reached",
      headline: capLine ?? `${channel.label} free cap reached.`,
    };
  }

  if (account?.automation_authorized !== true) {
    return {
      ...base,
      ...known,
      state: "connected_needs_authorization",
      headline: `Connected as ${labelForCopy}. Authorize Vacantless before it can post here.`,
    };
  }

  return {
    ...base,
    ...known,
    state: "linked",
    headline: `${channel.label} is linked and authorized.`,
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
    helper: "Connected accounts waiting on posting or refresh consent.",
  },
  {
    id: "sign_in",
    label: "Reconnect",
    helper: "Saved sessions that need a fresh sign-in.",
  },
  {
    id: "setup",
    label: "Account/spend",
    helper: "Accounts, feed routes, or landlord spend limits to finish.",
  },
  {
    id: "ready",
    label: "Ready",
    helper: "Destinations ready for launch.",
  },
  {
    id: "planned",
    label: "Fallback/planned",
    helper: "Broker, fallback, and future destinations.",
  },
] as const;
export type ChannelConnectionChecklistGroupId =
  (typeof CHANNEL_CONNECTION_CHECKLIST_GROUPS)[number]["id"];

export type ChannelConnectionChecklistInput = {
  channel: string;
  label: string;
  stage: ChannelConnectionStage;
  actionLabel: string;
  href?: string | null;
};

export type ChannelConnectionChecklistGroup<T extends ChannelConnectionChecklistInput> = {
  id: ChannelConnectionChecklistGroupId;
  label: string;
  helper: string;
  items: T[];
};

export type RecommendedChannelConnectionChecklistAction<T extends ChannelConnectionChecklistInput> = {
  group: ChannelConnectionChecklistGroup<T>;
  item: T;
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

export function channelConnectionChecklistActionLabel(input: {
  stage: ChannelConnectionStage;
  fallbackActionLabel?: string | null;
}): string {
  if (
    input.stage.state === "planned_or_unavailable" ||
    input.stage.state === "broker_route"
  ) {
    return input.fallbackActionLabel ?? input.stage.nextActionLabel;
  }

  return input.stage.nextActionLabel;
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

const CHANNEL_CONNECTION_RECOMMENDATION_ORDER: readonly ChannelConnectionChecklistGroupId[] = [
  "authorization",
  "sign_in",
  "setup",
  "planned",
  "ready",
];

export function recommendedChannelConnectionChecklistAction<T extends ChannelConnectionChecklistInput>(
  groups: readonly ChannelConnectionChecklistGroup<T>[],
): RecommendedChannelConnectionChecklistAction<T> | null {
  for (const groupId of CHANNEL_CONNECTION_RECOMMENDATION_ORDER) {
    const group = groups.find((candidate) => candidate.id === groupId);
    const item = group?.items[0] ?? null;
    if (group && item) {
      return { group, item };
    }
  }
  return null;
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
