// ============================================================================
// Publish Everywhere — pure per-org channel mode resolver (S629, Slice 1;
// S631 Slice 3 adds the co-pilot-capable signal).
// No DOM / env / IO — fully unit-testable (scripts/test-publish-everywhere.ts).
//
// The one-click "Publish everywhere" surface renders every channel by resolving
// it, per-org, to exactly ONE publish MODE, then grouping modes into the three
// user-facing BUCKETS. Adding a channel (LinkedIn/WhatsApp/future) is a config +
// account-state change — this resolver and the UI never hard-code a channel.
//
// Faithful to reality (lib/distribution-channels.ts): a channel is only
// "instant" when it is actually connected/authorized or its feed route is
// accepted; otherwise it honestly falls to "after setup". No overpromising.
// ============================================================================

import type {
  ChannelIntegrationStatus,
  ChannelConnectKind,
  ChannelMode,
} from "./distribution-channels";

// The six per-org publish modes.
export const PUBLISH_MODES = [
  "instant_auto", // fires on click, hands-off (page/email, authorized API, accepted feed)
  "copilot_fill", // one-click in-session fill; landlord signs in + posts (Kijiji/Marketplace)
  "paid_optin", // copilot_fill + a listing fee paid direct to the site (Viewit/RentFaster)
  "needs_connection", // available, org hasn't connected/authorized/accepted yet
  "brokerage_gated", // via the landlord's agent (Realtor.ca)
  "planned", // declared in the catalog, no mechanism yet (LinkedIn/WhatsApp/Snapchat)
] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

// The three user-facing buckets the surface groups by.
export const PUBLISH_BUCKETS = ["instant", "for_you", "after_setup"] as const;
export type PublishBucket = (typeof PUBLISH_BUCKETS)[number];

export function bucketForMode(mode: PublishMode): PublishBucket {
  switch (mode) {
    case "instant_auto":
      return "instant";
    case "copilot_fill":
    case "paid_optin":
      return "for_you";
    case "needs_connection":
    case "brokerage_gated":
    case "planned":
      return "after_setup";
  }
}

// The minimal, structural input the resolver needs — the caller (the property
// page) adapts each DistributeChannelCard into this. Kept dependency-light so
// the resolver stays a pure lib and never imports app/component types.
export type PublishChannelInput = {
  key: string;
  integrationStatus: ChannelIntegrationStatus; // "live" | "planned" | "mls_gated"
  connectKind: ChannelConnectKind; // "oauth" | "account_login" | "none"
  mode: ChannelMode; // "assisted_manual" | "feed_or_assisted" | "api_automatic" | "broker"
  // Paid self-serve listing site (a listing fee applies) — e.g. Viewit, RentFaster.
  hasFee?: boolean;
  // api_automatic channel that is connected AND automation-authorized (FB Page / IG).
  connectedAuthorized?: boolean;
  // feed channel whose org XML feed route is accepted / the listing is in-feed.
  feedAccepted?: boolean;
  // S631 Slice 3: this assisted_manual channel has a real co-pilot mechanism
  // (the vacantless-extension fill sheet + the pop-out sidecar) — i.e. Kijiji and
  // Facebook Marketplace. That mechanism IS how we post it for the landlord, so a
  // co-pilot-capable channel is "we post it for you" even when it has no API and
  // is catalog-"planned" (FB Marketplace). Channels WITHOUT a mechanism yet
  // (LinkedIn/WhatsApp/Snapchat) leave this false and stay honestly "coming soon".
  copilotSupported?: boolean;
};

/**
 * Resolve one channel's per-org publish mode + bucket. Precedence is deliberate:
 * broker/MLS is settled first (never a self-serve post); then a co-pilot-capable
 * channel resolves to the for-you handoff (this is why FB Marketplace, catalog-
 * "planned" but extension-fillable, is honestly "we post it for you"); then
 * not-yet-built "planned" channels; then the connected/accepted live channels.
 */
export function resolvePublishMode(input: PublishChannelInput): {
  mode: PublishMode;
  bucket: PublishBucket;
} {
  const mode = computeMode(input);
  return { mode, bucket: bucketForMode(mode) };
}

function computeMode(input: PublishChannelInput): PublishMode {
  // Broker / MLS route — never a self-serve post.
  if (input.integrationStatus === "mls_gated" || input.mode === "broker") {
    return "brokerage_gated";
  }
  // A co-pilot-capable channel (Kijiji / FB Marketplace): the extension fill +
  // sidecar IS the posting mechanism, so it is a for-you handoff even with no API
  // and even when the catalog still marks it "planned". Paid self-serve sites
  // additionally carry a listing fee (paid direct to the site).
  if (input.mode === "assisted_manual" && input.copilotSupported) {
    return input.hasFee ? "paid_optin" : "copilot_fill";
  }
  // Declared in the catalog but no live mechanism yet — honest "coming soon".
  if (input.integrationStatus === "planned") {
    return "planned";
  }
  // Sanctioned API post (Facebook Page / Instagram): instant only once the org
  // has connected AND authorized automation; otherwise it needs a one-time connect.
  if (input.mode === "api_automatic") {
    return input.connectedAuthorized ? "instant_auto" : "needs_connection";
  }
  // Feed portal (Rentals.ca / Zumper): instant only once a partner feed route is
  // accepted; until then it is pending that setup, not silently "live".
  if (input.mode === "feed_or_assisted") {
    return input.feedAccepted ? "instant_auto" : "needs_connection";
  }
  // No API — the co-pilot fills it in the landlord's own session. Paid self-serve
  // sites additionally carry a listing fee (paid direct to the site).
  if (input.mode === "assisted_manual") {
    return input.hasFee ? "paid_optin" : "copilot_fill";
  }
  return "planned";
}

// The two always-on destinations that are not catalog channels: the public
// Vacantless page and the email-alert audience. They are always instant.
export const ALWAYS_ON_INSTANT_COUNT = 2;

export type ReachSummary = {
  included: number; // instant + for_you (what this publish actually acts on now)
  instant: number;
  for_you: number;
  after_setup: number;
};

/**
 * Roll a resolved channel list into the reach summary shown on the surface.
 * `includeAlwaysOn` adds the Vacantless page + email to the instant tally (the
 * surface renders those two rows itself). "included" is instant + for_you —
 * NEVER the raw channel count (we never claim reach we can't act on now).
 */
export function summarizeReach(
  buckets: PublishBucket[],
  includeAlwaysOn = true,
): ReachSummary {
  let instant = includeAlwaysOn ? ALWAYS_ON_INSTANT_COUNT : 0;
  let for_you = 0;
  let after_setup = 0;
  for (const b of buckets) {
    if (b === "instant") instant += 1;
    else if (b === "for_you") for_you += 1;
    else after_setup += 1;
  }
  return { included: instant + for_you, instant, for_you, after_setup };
}

// S631 Slice 3: the channels that have a real co-pilot mechanism today (the
// vacantless-extension fill sheet + the no-install pop-out sidecar). Kept in
// lockstep with EXTENSION_CHANNELS (lib/extension-kit.ts) and the extension's
// config.js CHANNEL_BY_HOST. The surface only sets copilotSupported for these,
// and only when the Slice-3 handoff flag is on.
export const COPILOT_SUPPORTED_KEYS: readonly string[] = ["kijiji", "facebook"];

export function isCopilotSupportedKey(key: string): boolean {
  return COPILOT_SUPPORTED_KEYS.includes(key);
}
