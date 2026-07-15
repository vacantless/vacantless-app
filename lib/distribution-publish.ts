// ============================================================================
// Pure publish-run adapter model (S467 One-Click Publish Run).
//
// The Distribute tab already has channel cards, feed readiness, partner-account
// tracking, and guided launch runs. This file adds the honest "click Publish
// once" state model over those primitives: automatic where the app can really
// act, feed/partner where configured, browser co-pilot or concierge where a
// human must confirm login/payment/CAPTCHA, and broker/DDF for Realtor.ca.
//
// No DB, env, or DOM here. Server actions gather the current listing/feed/partner
// facts and call these helpers before writing distribution_run_items.
// ============================================================================

import {
  channelByKey,
  type DistributionChannel,
} from "./distribution-channels";
import {
  isPartnerActive,
  type PartnerStatus,
} from "./distribution-partner";

export const PUBLISH_CHANNEL_KEYS = [
  "vacantless",
  "org_feed",
  "network_feed",
  "facebook",
  "kijiji",
  "rentals_ca",
  "rentfaster",
  "zumper",
  "viewit",
  "realtor_ca",
  "other",
] as const;
export type PublishChannelKey = (typeof PUBLISH_CHANNEL_KEYS)[number];

export const PUBLISH_MODES = [
  "automatic",
  "feed_partner",
  "browser_copilot",
  "concierge",
  "broker",
  "custom",
] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

export const PUBLISH_STATUSES = [
  "blocked",
  "queued",
  "submitting",
  "submitted",
  "needs_operator",
  "needs_login",
  "needs_payment",
  "live",
  "rejected",
  "skipped",
] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  blocked: "Blocked",
  queued: "Queued",
  submitting: "Submitting",
  submitted: "Submitted",
  needs_operator: "Needs operator",
  needs_login: "Needs login",
  needs_payment: "Needs payment",
  live: "Live",
  rejected: "Rejected",
  skipped: "Skipped",
};

export type PublishTone = "positive" | "warning" | "danger" | "neutral";

const PUBLISH_STATUS_TONES: Record<PublishStatus, PublishTone> = {
  blocked: "danger",
  queued: "neutral",
  submitting: "warning",
  submitted: "warning",
  needs_operator: "warning",
  needs_login: "warning",
  needs_payment: "warning",
  live: "positive",
  rejected: "danger",
  skipped: "neutral",
};

const PUBLISH_MODE_LABELS: Record<PublishMode, string> = {
  automatic: "Automatic",
  feed_partner: "Feed candidate",
  browser_copilot: "Guided posting",
  concierge: "Vacantless desk",
  broker: "Broker / MLS",
  custom: "Custom tracked post",
};

export type PublishChannelMeta = {
  key: PublishChannelKey;
  label: string;
  mode: PublishMode;
  description: string;
  actionLabel: string | null;
  actionUrl: string | null;
  defaultSelected: boolean;
};

export type PublishChannelPlan = PublishChannelMeta & {
  status: PublishStatus;
  blockers: string[];
  operatorActionLabel: string | null;
  operatorActionUrl: string | null;
  externalUrl: string | null;
  listingPostId: string | null;
  auditMessage: string;
};

export type PublishPartnerState = {
  status: PartnerStatus;
  feedUrl: string | null;
};

export type PublishChannelContext = {
  linkIsLive: boolean;
  canPublishPublicPage: boolean;
  publicPageBlockers: string[];
  shareBlockers: string[];
  feedInFeed: boolean;
  feedHint: string | null;
  publicUrl: string | null;
  orgFeedUrl: string | null;
  networkFeedEnabled: boolean;
  partner: PublishPartnerState | null;
  existingLiveUrl: string | null;
  existingListingPostId: string | null;
};

export function isPublishChannelKey(value: unknown): value is PublishChannelKey {
  return (
    typeof value === "string" &&
    (PUBLISH_CHANNEL_KEYS as readonly string[]).includes(value)
  );
}

export function normalizePublishChannel(raw: unknown): PublishChannelKey | null {
  const value = String(raw ?? "").trim();
  return isPublishChannelKey(value) ? value : null;
}

export function isPublishStatus(value: unknown): value is PublishStatus {
  return (
    typeof value === "string" &&
    (PUBLISH_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizePublishStatus(raw: unknown): PublishStatus {
  return isPublishStatus(raw) ? raw : "queued";
}

export function publishStatusLabel(value: unknown): string {
  return isPublishStatus(value) ? PUBLISH_STATUS_LABELS[value] : "Queued";
}

export function publishStatusTone(value: unknown): PublishTone {
  return isPublishStatus(value) ? PUBLISH_STATUS_TONES[value] : "neutral";
}

export function isPublishMode(value: unknown): value is PublishMode {
  return (
    typeof value === "string" &&
    (PUBLISH_MODES as readonly string[]).includes(value)
  );
}

export function normalizePublishMode(raw: unknown): PublishMode {
  return isPublishMode(raw) ? raw : "browser_copilot";
}

export function publishModeLabel(value: unknown): string {
  return isPublishMode(value)
    ? PUBLISH_MODE_LABELS[value]
    : "Guided posting";
}

export function isResolvedPublishStatus(status: PublishStatus): boolean {
  return status === "live" || status === "skipped";
}

// ----------------------------------------------------------------------------
// Concierge "Publish for me" (S474b). A channel that still needs a human to post
// (browser co-pilot / feed-partner / broker / custom sitting in a needs_* state)
// can be handed to the Vacantless publishing desk: the operator clicks once, the
// run item flips to concierge mode + queued, and a staff member posts it and
// marks it live. Only human-action states are eligible — never an automatic
// channel (the app already does it), an already-concierge item, or a
// blocked/queued/submitted/live/rejected/skipped one.
// ----------------------------------------------------------------------------

/** Statuses where a human still has to act, so the desk can take it over. */
export const CONCIERGE_ELIGIBLE_STATUSES: readonly PublishStatus[] = [
  "needs_operator",
  "needs_login",
  "needs_payment",
];

/** Open concierge-queue statuses a staff member still has to work. */
export const CONCIERGE_OPEN_STATUSES: readonly PublishStatus[] = [
  "queued",
  "submitting",
  "needs_operator",
  "needs_login",
  "needs_payment",
];

/** Can this run item be handed to the concierge desk? Pure. */
export function canRequestConcierge(
  status: PublishStatus,
  mode: PublishMode,
): boolean {
  if (mode === "automatic" || mode === "concierge") return false;
  return CONCIERGE_ELIGIBLE_STATUSES.includes(status);
}

export const CONCIERGE_REQUEST_AUDIT =
  "Requested Vacantless to post this for you. Our publishing desk will post it and mark it live.";
export const CONCIERGE_CLAIMED_AUDIT =
  "Vacantless publishing desk is posting this for you.";
export const CONCIERGE_LIVE_AUDIT =
  "Vacantless posted this for you; it is live and the tracked inquiry link is active.";
export const CONCIERGE_REJECTED_AUDIT =
  "Vacantless could not post this to this channel. See the reason and try another channel.";

// Realtor.ca is NOT a post-it-ourselves channel (Distribution Lane B). A rental
// reaches Realtor.ca only through a RECO-licensed agent's brokerage, so a
// "dispatch a network agent" request is a referral to a licensed agent (the
// agent is the principal; Vacantless does not post anything and is not a party to
// any referral fee). It carries RECO-honest wording distinct from the generic
// "our desk posts it" concierge copy.
export const REALTOR_REFERRAL_REQUEST_AUDIT =
  "Realtor.ca referral: match a licensed network agent. The agent is the principal and lists this rental on Realtor.ca through their own brokerage; Vacantless does not post anything and is not a party to any referral fee. Never mark live without the real realtor.ca listing URL.";
export const REALTOR_REFERRAL_CLAIMED_AUDIT =
  "Realtor.ca referral: matching a licensed network agent. The agent is the principal and lists through their own brokerage; Vacantless does not post anything and is not a party to any referral fee. Never mark live without the real realtor.ca listing URL.";
export const REALTOR_REFERRAL_LIVE_AUDIT =
  "Realtor.ca referral live: a licensed network agent, acting as principal, listed through their own brokerage. Vacantless tracks the real realtor.ca listing URL and is not a party to any referral fee.";
export const REALTOR_REFERRAL_REJECTED_AUDIT =
  "Realtor.ca referral could not be completed by a licensed network agent. The agent would be the principal and list through their own brokerage; Vacantless does not post anything or collect a referral fee. Never mark live without the real realtor.ca listing URL.";

/**
 * The concierge-request audit line for a channel. Realtor.ca carries the
 * RECO-honest network-agent referral wording; every other channel keeps the
 * generic "publishing desk posts it" copy. Pure.
 */
export function conciergeRequestAuditForChannel(channel: string): string {
  return channel === "realtor_ca"
    ? REALTOR_REFERRAL_REQUEST_AUDIT
    : CONCIERGE_REQUEST_AUDIT;
}

export function conciergeClaimedAuditForChannel(channel: string): string {
  return channel === "realtor_ca"
    ? REALTOR_REFERRAL_CLAIMED_AUDIT
    : CONCIERGE_CLAIMED_AUDIT;
}

export function conciergeLiveAuditForChannel(channel: string): string {
  return channel === "realtor_ca"
    ? REALTOR_REFERRAL_LIVE_AUDIT
    : CONCIERGE_LIVE_AUDIT;
}

export function conciergeRejectedAuditForChannel(channel: string): string {
  return channel === "realtor_ca"
    ? REALTOR_REFERRAL_REJECTED_AUDIT
    : CONCIERGE_REJECTED_AUDIT;
}

export function legacyRunStatusForPublishStatus(
  status: PublishStatus,
): "pending" | "in_progress" | "done" | "skipped" {
  if (status === "skipped") return "skipped";
  if (status === "live") return "done";
  if (
    status === "submitted" ||
    status === "needs_operator" ||
    status === "needs_login" ||
    status === "needs_payment" ||
    status === "submitting" ||
    status === "rejected"
  ) {
    return "in_progress";
  }
  return "pending";
}

export function publishStatusFromLegacyStatus(
  status: unknown,
): PublishStatus {
  if (status === "done") return "live";
  if (status === "skipped") return "skipped";
  if (status === "in_progress") return "needs_operator";
  return "queued";
}

export function publishChannelMeta(key: PublishChannelKey): PublishChannelMeta {
  if (key === "vacantless") {
    return {
      key,
      label: "Vacantless public page",
      mode: "automatic",
      description:
        "Turns on the renter page that every ad can send people back to.",
      actionLabel: "Open public page",
      actionUrl: null,
      defaultSelected: true,
    };
  }
  if (key === "org_feed") {
    return {
      key,
      label: "Listing feed for rental sites",
      mode: "automatic",
      description:
        "Adds this rental to your Vacantless feed when the listing is complete.",
      actionLabel: "Open feed",
      actionUrl: null,
      defaultSelected: true,
    };
  }
  if (key === "network_feed") {
    return {
      key,
      label: "Private partner feed",
      mode: "feed_partner",
      description:
        "Private feed for an approved partner. Hidden until that partner route is set up.",
      actionLabel: null,
      actionUrl: null,
      defaultSelected: false,
    };
  }
  if (key === "other") {
    return {
      key,
      label: "Other tracked post",
      mode: "custom",
      description:
        "Track a local board, niche site, community group, or other place you posted.",
      actionLabel: null,
      actionUrl: null,
      defaultSelected: false,
    };
  }

  const channel = channelByKey(key);
  if (!channel) {
    return {
      key,
      label: key,
      mode: "browser_copilot",
      description: "Guided publishing channel.",
      actionLabel: null,
      actionUrl: null,
      defaultSelected: false,
    };
  }
  return {
    key,
    label: channel.label,
    mode: publishModeForDistributionChannel(channel),
    description: channel.blurb,
    actionLabel: actionLabelForDistributionChannel(channel),
    actionUrl: channel.portalUrl,
    defaultSelected: key === "facebook" || key === "kijiji",
  };
}

export function publishChannelChoices(opts?: {
  includeNetworkFeed?: boolean;
}): PublishChannelMeta[] {
  return PUBLISH_CHANNEL_KEYS.filter(
    (key) => key !== "network_feed" || opts?.includeNetworkFeed,
  ).map(publishChannelMeta);
}

export function preparePublishChannel(
  key: PublishChannelKey,
  context: PublishChannelContext,
): PublishChannelPlan {
  const meta = publishChannelMeta(key);
  const blockers = externalBlockers(context);

  if (key === "vacantless") {
    if (context.linkIsLive) {
      return plan(meta, {
        status: "live",
        externalUrl: context.publicUrl,
        operatorActionUrl: context.publicUrl,
        auditMessage: "The Vacantless renter page is live and accepting inquiries.",
      });
    }
    if (context.canPublishPublicPage) {
      return plan(meta, {
        status: "queued",
        operatorActionUrl: context.publicUrl,
        auditMessage:
          "Vacantless can turn on the renter page after you confirm.",
      });
    }
    return plan(meta, {
      status: "blocked",
      blockers: context.publicPageBlockers,
      auditMessage: "The renter page is waiting on required listing details.",
    });
  }

  if (key === "org_feed") {
    if (blockers.length > 0) {
      return plan(meta, {
        status: "blocked",
        blockers,
        auditMessage: "The listing feed waits for the renter page to work.",
      });
    }
    if (!context.feedInFeed) {
      return plan(meta, {
        status: "blocked",
        blockers: [context.feedHint ?? "Finish feed-required listing fields."],
        auditMessage: "This rental is not ready for the listing feed yet.",
      });
    }
    return plan(meta, {
      status: "submitted",
      externalUrl: context.orgFeedUrl,
      operatorActionUrl: context.orgFeedUrl,
      auditMessage:
        "This rental is in your listing feed. A partner site still has to accept and show it before it is live there.",
    });
  }

  if (key === "network_feed") {
    if (!context.networkFeedEnabled) {
      return plan(meta, {
        status: "blocked",
        blockers: ["Network feed is not configured for a partner token."],
        auditMessage: "Network feed remains dark until a partner token exists.",
      });
    }
    if (blockers.length > 0 || !context.feedInFeed) {
      return plan(meta, {
        status: "blocked",
        blockers:
          blockers.length > 0
            ? blockers
            : [context.feedHint ?? "Finish feed-required listing fields."],
        auditMessage: "Network feed waits for public page and feed readiness.",
      });
    }
    return plan(meta, {
      status: "submitted",
      auditMessage:
        "This rental is eligible for the private partner feed. The protected feed URL is not shown here.",
    });
  }

  if (context.existingLiveUrl) {
    return plan(meta, {
      status: "live",
      blockers,
      externalUrl: context.existingLiveUrl,
      operatorActionUrl: context.existingLiveUrl,
      listingPostId: context.existingListingPostId,
      auditMessage: "A tracked live URL already exists for this channel.",
    });
  }

  if (blockers.length > 0) {
    return plan(meta, {
      status: "blocked",
      blockers,
      auditMessage: "Channel is blocked until the public listing link works.",
    });
  }

  if (key === "rentals_ca" || key === "rentfaster" || key === "zumper") {
    return feedPartnerPlan(meta, context);
  }

  if (key === "facebook" || key === "kijiji") {
    return plan(meta, {
      status: "needs_login",
      operatorActionUrl: meta.actionUrl,
      auditMessage:
        "Guided posting required. Vacantless prepares the ad, but you sign in, review, and post.",
    });
  }

  if (key === "viewit") {
    return plan(meta, {
      status: "needs_payment",
      operatorActionUrl: meta.actionUrl,
      auditMessage:
        "Guided paid-listing flow. You review any login or payment before posting.",
    });
  }

  if (key === "realtor_ca") {
    return plan(meta, {
      status: "needs_operator",
      operatorActionUrl: meta.actionUrl,
      auditMessage:
        "Broker or MLS route. Send the prepared field sheet to the listing agent and confirm the live URL later.",
    });
  }

  return plan(meta, {
    status: "needs_operator",
    operatorActionUrl: meta.actionUrl,
    auditMessage:
      "Custom tracked channel. Record the next step or paste the live URL when it exists.",
  });
}

export function verifyChannel(
  key: PublishChannelKey,
  context: PublishChannelContext,
): PublishChannelPlan {
  const prepared = preparePublishChannel(key, context);
  if (context.existingLiveUrl) {
    return {
      ...prepared,
      status: "live",
      externalUrl: context.existingLiveUrl,
      operatorActionUrl: context.existingLiveUrl,
      auditMessage: "Verified from the tracked live URL on the listing post.",
    };
  }
  return prepared;
}

export function unpublishChannel(
  key: PublishChannelKey,
): PublishChannelPlan {
  const meta = publishChannelMeta(key);
  return plan(meta, {
    status: "skipped",
    auditMessage:
      "Channel was skipped or removed from this publish run. Existing external ads must still be taken down at the source.",
  });
}

function feedPartnerPlan(
  meta: PublishChannelMeta,
  context: PublishChannelContext,
): PublishChannelPlan {
  const partner = context.partner;
  if (partner?.status === "rejected") {
    return plan(meta, {
      status: "rejected",
      blockers: ["Partner rejected or declined the feed route."],
      auditMessage:
        "The partner route was rejected. Fix the requirement and resubmit.",
    });
  }
  if (
    partner &&
    (partner.status === "submitted" || isPartnerActive(partner.status))
  ) {
    return plan(meta, {
      status: "submitted",
      externalUrl: partner.feedUrl,
      operatorActionUrl: partner.feedUrl,
      auditMessage: isPartnerActive(partner.status)
        ? "The partner route is accepted. The listing is submitted through the feed; the live ad URL still needs checking."
        : "The partner route is submitted and waiting for acceptance.",
    });
  }
  if (meta.key === "rentfaster") {
    return plan(meta, {
      status: "needs_payment",
      operatorActionUrl: meta.actionUrl,
      auditMessage:
        "No accepted RentFaster feed route is recorded. Use the guided paid-listing flow; you review and pay before posting.",
    });
  }
  return plan(meta, {
    status: "needs_operator",
    operatorActionUrl: meta.actionUrl,
    auditMessage:
      "No accepted partner feed is recorded. Use guided posting or send the feed to the partner.",
  });
}

function publishModeForDistributionChannel(
  channel: DistributionChannel,
): PublishMode {
  if (channel.mode === "feed_or_assisted") return "feed_partner";
  if (channel.mode === "broker") return "broker";
  return "browser_copilot";
}

function actionLabelForDistributionChannel(
  channel: DistributionChannel,
): string | null {
  if (channel.mode === "broker") return "Open Realtor.ca";
  if (channel.key === "viewit") return "Open Viewit";
  return `Open ${channel.label}`;
}

function externalBlockers(context: PublishChannelContext): string[] {
  const blockers = [...context.shareBlockers];
  if (!context.linkIsLive) {
    blockers.unshift(
      "Publish the Vacantless public page first so the tracked inquiry link works.",
    );
  }
  return uniqueStrings(blockers);
}

function plan(
  meta: PublishChannelMeta,
  overrides: Partial<
    Pick<
      PublishChannelPlan,
      | "status"
      | "blockers"
      | "operatorActionLabel"
      | "operatorActionUrl"
      | "externalUrl"
      | "listingPostId"
      | "auditMessage"
    >
  >,
): PublishChannelPlan {
  const status = overrides.status ?? "queued";
  return {
    ...meta,
    status,
    blockers: uniqueStrings(overrides.blockers ?? []),
    operatorActionLabel:
      overrides.operatorActionLabel ?? meta.actionLabel ?? null,
    operatorActionUrl: overrides.operatorActionUrl ?? meta.actionUrl ?? null,
    externalUrl: overrides.externalUrl ?? null,
    listingPostId: overrides.listingPostId ?? null,
    auditMessage: overrides.auditMessage ?? PUBLISH_STATUS_LABELS[status],
  };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
