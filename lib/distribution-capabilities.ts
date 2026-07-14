// ============================================================================
// Pure channel CAPABILITY + ACCOUNT-READINESS model (S480, first-class
// distribution). No DOM / env / IO — unit-tested (test-distribution-accounts.ts).
//
// distribution-publish.ts models what a channel's status/mode ARE for a given
// listing. This layer answers the operator's pre-Publish question: "for THIS
// channel, what can Vacantless really do, and is my ORG set up to use that
// route?" — the capability profile (static, honest per the design brief) + a
// readiness reducer over the durable distribution_channel_accounts row (0141).
//
// Honesty rules (brief): automatic only where real (Vacantless page + org feed);
// Facebook/Kijiji/Viewit are browser co-pilot or concierge (never silent posting);
// Rentals.ca/RentFaster/Zumper are feed-candidates when accepted, else guided;
// Realtor.ca is a broker/DDF route. "submitted"/feed-ready is never "live".
// ============================================================================

import {
  publishModeLabel,
  type PublishChannelKey,
  type PublishMode,
} from "./distribution-publish";

export const POSTING_POLICIES = [
  "automatic_allowed",
  "feed_only",
  "human_confirmed",
  "concierge_only",
  "broker_only",
  "not_supported",
] as const;
export type PostingPolicy = (typeof POSTING_POLICIES)[number];

export type ChannelCapability = {
  channel: PublishChannelKey;
  transport: PublishMode;
  supportsFeed: boolean;
  supportsCopilot: boolean;
  supportsConcierge: boolean;
  supportsLiveVerification: boolean;
  requiresLogin: boolean;
  requiresPayment: boolean;
  postingPolicy: PostingPolicy;
  // Does this channel need an org-level account/route set up before a run item
  // can honestly reach it (feed partners), vs. it can always be attempted via a
  // human transport (co-pilot / broker / custom / our own automatic surfaces)?
  needsOrgAccount: boolean;
};

const CAP = (
  channel: PublishChannelKey,
  transport: PublishMode,
  partial: Partial<ChannelCapability>,
): ChannelCapability => ({
  channel,
  transport,
  supportsFeed: false,
  supportsCopilot: false,
  supportsConcierge: false,
  supportsLiveVerification: true,
  requiresLogin: false,
  requiresPayment: false,
  postingPolicy: "human_confirmed",
  needsOrgAccount: false,
  ...partial,
});

// The static capability matrix. One entry per publish channel key.
const CHANNEL_CAPABILITIES: Record<PublishChannelKey, ChannelCapability> = {
  vacantless: CAP("vacantless", "automatic", {
    postingPolicy: "automatic_allowed",
    supportsLiveVerification: true,
  }),
  org_feed: CAP("org_feed", "automatic", {
    supportsFeed: true,
    postingPolicy: "automatic_allowed",
    supportsLiveVerification: true,
  }),
  network_feed: CAP("network_feed", "feed_partner", {
    supportsFeed: true,
    postingPolicy: "feed_only",
    needsOrgAccount: true,
    supportsLiveVerification: false,
  }),
  facebook: CAP("facebook", "browser_copilot", {
    supportsCopilot: true,
    supportsConcierge: true,
    requiresLogin: true,
    postingPolicy: "human_confirmed",
  }),
  kijiji: CAP("kijiji", "browser_copilot", {
    supportsCopilot: true,
    supportsConcierge: true,
    requiresLogin: true,
    postingPolicy: "human_confirmed",
  }),
  rentals_ca: CAP("rentals_ca", "feed_partner", {
    supportsFeed: true,
    supportsCopilot: true,
    supportsConcierge: true,
    postingPolicy: "human_confirmed",
  }),
  rentfaster: CAP("rentfaster", "feed_partner", {
    supportsFeed: true,
    supportsCopilot: true,
    supportsConcierge: true,
    requiresLogin: true,
    requiresPayment: true,
    postingPolicy: "human_confirmed",
  }),
  zumper: CAP("zumper", "feed_partner", {
    supportsFeed: true,
    supportsCopilot: true,
    supportsConcierge: true,
    requiresLogin: true,
    postingPolicy: "feed_only",
    needsOrgAccount: true,
  }),
  viewit: CAP("viewit", "browser_copilot", {
    supportsCopilot: true,
    supportsConcierge: true,
    requiresLogin: true,
    requiresPayment: true,
    postingPolicy: "human_confirmed",
  }),
  realtor_ca: CAP("realtor_ca", "broker", {
    supportsConcierge: true,
    postingPolicy: "broker_only",
  }),
  other: CAP("other", "custom", {
    supportsConcierge: true,
    postingPolicy: "human_confirmed",
  }),
};

export function channelCapability(channel: PublishChannelKey): ChannelCapability {
  return CHANNEL_CAPABILITIES[channel];
}

export function allChannelCapabilities(): ChannelCapability[] {
  return Object.values(CHANNEL_CAPABILITIES);
}

// --- account readiness ------------------------------------------------------

// The durable account states (distribution_channel_accounts.account_status).
export const CHANNEL_ACCOUNT_STATUSES = [
  "not_started",
  "needs_setup",
  "submitted",
  "accepted",
  "paused",
  "rejected",
  "connected",
  "needs_login",
  "needs_payment",
] as const;
export type ChannelAccountStatus = (typeof CHANNEL_ACCOUNT_STATUSES)[number];

export function isChannelAccountStatus(v: unknown): v is ChannelAccountStatus {
  return (
    typeof v === "string" &&
    (CHANNEL_ACCOUNT_STATUSES as readonly string[]).includes(v)
  );
}

// The operator-facing readiness a channel shows BEFORE Publish.
export const CHANNEL_READINESS_VALUES = [
  "ready", // can attempt this channel via its transport now
  "needs_setup", // an org-level route/account must be set up first (feed partners)
  "submitted", // feed submitted to a partner, awaiting acceptance
  "needs_login", // the next step is gated by the portal login
  "needs_payment", // the next step is gated by paid placement
  "rejected", // the partner rejected the route
  "paused", // the operator paused this channel
] as const;
export type ChannelReadinessValue = (typeof CHANNEL_READINESS_VALUES)[number];

export type ChannelAccountReadiness = {
  channel: PublishChannelKey;
  transport: PublishMode;
  status: ChannelReadinessValue;
  blockers: string[];
  nextActionLabel: string | null;
  // A transport-appropriate hint; the caller supplies real URLs (portal, setup).
  nextActionKind:
    | "publish_now"
    | "feed_setup"
    | "open_copilot"
    | "queue_concierge"
    | "broker_handoff"
    | "manual_custom"
    | "resume";
};

export type AccountReadinessInput = {
  capability: ChannelCapability;
  accountStatus?: ChannelAccountStatus | null;
  hasFeedRoute?: boolean; // an accepted/connected feed URL is on file
};

/**
 * Reduce a channel capability + its org account row into the pre-Publish
 * readiness the picker shows. Pure. Feed-partner channels are only "ready" once
 * the org route is accepted/connected; human-transport channels (co-pilot /
 * broker / custom / our automatic surfaces) are "ready" to attempt, surfacing a
 * recorded login/payment/pause/reject state when present.
 */
export function channelAccountReadiness(
  input: AccountReadinessInput,
): ChannelAccountReadiness {
  const cap = input.capability;
  const status = input.accountStatus ?? null;
  const base = {
    channel: cap.channel,
    transport: cap.transport,
    blockers: [] as string[],
  };

  // Explicit blocking account states apply to any channel.
  if (status === "paused") {
    return { ...base, status: "paused", nextActionLabel: "Resume this channel", nextActionKind: "resume" };
  }
  if (status === "rejected") {
    return {
      ...base,
      status: "rejected",
      blockers: ["This channel rejected the route — fix the reason and resubmit."],
      nextActionLabel: "Review rejection",
      nextActionKind: cap.needsOrgAccount ? "feed_setup" : "queue_concierge",
    };
  }
  if (status === "needs_login") {
    return { ...base, status: "needs_login", nextActionLabel: "Sign in to continue", nextActionKind: "open_copilot" };
  }
  if (status === "needs_payment") {
    return { ...base, status: "needs_payment", nextActionLabel: "Complete paid placement", nextActionKind: "open_copilot" };
  }

  // Our own automatic surfaces never need an external account.
  if (cap.transport === "automatic") {
    return { ...base, status: "ready", nextActionLabel: null, nextActionKind: "publish_now" };
  }

  // Feed-partner channels require an accepted org route before they are "ready".
  if (cap.needsOrgAccount) {
    if (status === "accepted" || status === "connected" || input.hasFeedRoute) {
      return { ...base, status: "ready", nextActionLabel: "Include in feed", nextActionKind: "feed_setup" };
    }
    if (status === "submitted") {
      return {
        ...base,
        status: "submitted",
        blockers: ["Feed submitted — waiting on the partner to accept the route."],
        nextActionLabel: "Check partner acceptance",
        nextActionKind: "feed_setup",
      };
    }
    return {
      ...base,
      status: "needs_setup",
      blockers: ["Set up this channel's feed/partner route before it can carry listings."],
      nextActionLabel: "Set up feed route",
      nextActionKind: "feed_setup",
    };
  }

  // Human-transport channels can always be attempted; the login/payment gates
  // happen live inside the co-pilot/concierge session (never bypassed).
  if (cap.transport === "broker") {
    return { ...base, status: "ready", nextActionLabel: "Create broker handoff", nextActionKind: "broker_handoff" };
  }
  if (cap.transport === "custom") {
    return { ...base, status: "ready", nextActionLabel: "Record a tracked post", nextActionKind: "manual_custom" };
  }
  if (cap.transport === "feed_partner") {
    return { ...base, status: "ready", nextActionLabel: "Use guided posting", nextActionKind: "feed_setup" };
  }
  return { ...base, status: "ready", nextActionLabel: "Open co-pilot", nextActionKind: "open_copilot" };
}

export function channelReadinessLabel(value: unknown): string {
  const map: Record<ChannelReadinessValue, string> = {
    ready: "Ready",
    needs_setup: "Needs setup",
    submitted: "Submitted",
    needs_login: "Needs login",
    needs_payment: "Needs payment",
    rejected: "Rejected",
    paused: "Paused",
  };
  return typeof value === "string" &&
    (CHANNEL_READINESS_VALUES as readonly string[]).includes(value)
    ? map[value as ChannelReadinessValue]
    : "Ready";
}

export function transportLabel(transport: unknown): string {
  return publishModeLabel(transport);
}
