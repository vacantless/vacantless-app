// ============================================================================
// Distribution channel contract v2 (S279 headless-first reset).
// Pure model: no DOM, env, DB, provider, payment, or worker execution.
//
// This is the clean product contract above the older implementation terms
// (`browser_copilot`, `concierge`, `feed_partner`). User-facing surfaces can read
// this layer for ready/account/authorization/spend/refresh/takedown states while
// the lower-level state machine keeps its existing internal names.
// ============================================================================

import { channelByKey } from "./distribution-channels";
import {
  PUBLISH_CHANNEL_KEYS,
  type PublishChannelKey,
} from "./distribution-publish";

export const DISTRIBUTION_EXECUTION_KINDS = [
  "public_page",
  "feed",
  "api",
  "headless_worker",
  "broker",
  "share",
  "fallback",
] as const;
export type DistributionExecutionKind =
  (typeof DISTRIBUTION_EXECUTION_KINDS)[number];

export const DISTRIBUTION_ACCOUNT_KINDS = [
  "none",
  "oauth",
  "stored_session",
  "partner_feed",
  "broker",
  "share",
] as const;
export type DistributionAccountKind = (typeof DISTRIBUTION_ACCOUNT_KINDS)[number];

export const DISTRIBUTION_AUTHORIZATION_KINDS = [
  "none",
  "posting",
  "posting_and_refresh",
  "broker_request",
] as const;
export type DistributionAuthorizationKind =
  (typeof DISTRIBUTION_AUTHORIZATION_KINDS)[number];

export const DISTRIBUTION_SPEND_KINDS = [
  "none",
  "paid_pass_through_optional",
  "paid_pass_through_required",
] as const;
export type DistributionSpendKind = (typeof DISTRIBUTION_SPEND_KINDS)[number];

export const DISTRIBUTION_PROOF_KINDS = [
  "public_url",
  "feed_acceptance",
  "external_url",
  "graph_permalink",
  "broker_url",
  "manual_note",
] as const;
export type DistributionProofKind = (typeof DISTRIBUTION_PROOF_KINDS)[number];

export const DISTRIBUTION_REFRESH_KINDS = [
  "none",
  "ttl_auto",
  "ttl_reminder",
  "unknown",
] as const;
export type DistributionRefreshKind = (typeof DISTRIBUTION_REFRESH_KINDS)[number];

export const DISTRIBUTION_TAKEDOWN_KINDS = [
  "none",
  "internal_unpublish",
  "api_delete",
  "headless_delete",
  "operator_task",
  "broker_request",
] as const;
export type DistributionTakedownKind =
  (typeof DISTRIBUTION_TAKEDOWN_KINDS)[number];

export const DISTRIBUTION_ROLLOUT_STATES = [
  "planned",
  "dark",
  "source_built",
  "merged",
  "deployed",
  "live_proven",
  "needs_decision",
] as const;
export type DistributionRolloutState =
  (typeof DISTRIBUTION_ROLLOUT_STATES)[number];

export const DISTRIBUTION_LAUNCH_STATES = [
  "ready",
  "needs_account",
  "needs_authorization",
  "needs_spend_limit",
  "needs_broker",
  "fallback_task",
  "planned",
] as const;
export type DistributionLaunchState =
  (typeof DISTRIBUTION_LAUNCH_STATES)[number];

export type DistributionChannelContract = {
  channel: PublishChannelKey;
  label: string;
  executionKind: DistributionExecutionKind;
  accountKind: DistributionAccountKind;
  authorizationKind: DistributionAuthorizationKind;
  spendKind: DistributionSpendKind;
  proofKind: DistributionProofKind;
  refreshKind: DistributionRefreshKind;
  takedownKind: DistributionTakedownKind;
  rolloutState: DistributionRolloutState;
  ttlDays: number | null;
  note: string;
};

export type DistributionContractAccountState = {
  accountStatus?: string | null;
  automationAuthorized?: boolean | null;
  spendAuthorized?: boolean | null;
  spendMaxCents?: number | null;
  spendRevokedAt?: string | null;
  feedAccepted?: boolean | null;
};

export type DistributionLaunchReadiness = {
  channel: PublishChannelKey;
  label: string;
  state: DistributionLaunchState;
  reason: string;
};

export type DistributionLifecycleSummary = {
  refreshLabel: string;
  takedownLabel: string;
  detail: string;
};

export type DistributionContractTone =
  | "positive"
  | "warning"
  | "danger"
  | "neutral"
  | "accent";

const DISTRIBUTION_LAUNCH_STATE_LABELS: Record<
  DistributionLaunchState,
  string
> = {
  ready: "Ready",
  needs_account: "Needs account",
  needs_authorization: "Needs authorization",
  needs_spend_limit: "Needs spend limit",
  needs_broker: "Broker route",
  fallback_task: "Fallback task",
  planned: "Planned",
};

const DISTRIBUTION_LAUNCH_STATE_TONES: Record<
  DistributionLaunchState,
  DistributionContractTone
> = {
  ready: "positive",
  needs_account: "accent",
  needs_authorization: "warning",
  needs_spend_limit: "warning",
  needs_broker: "neutral",
  fallback_task: "neutral",
  planned: "neutral",
};

const DISTRIBUTION_EXECUTION_LABELS: Record<
  DistributionExecutionKind,
  string
> = {
  public_page: "Included",
  feed: "Feed",
  api: "Connected post",
  headless_worker: "Automated",
  broker: "Broker route",
  share: "Share",
  fallback: "Fallback",
};

type ContractOverride = Omit<
  DistributionChannelContract,
  "channel" | "label" | "ttlDays"
> & {
  label?: string;
  ttlDays?: number | null;
};

const CONTRACT_OVERRIDES: Record<PublishChannelKey, ContractOverride> = {
  vacantless: {
    label: "Vacantless public page",
    executionKind: "public_page",
    accountKind: "none",
    authorizationKind: "none",
    spendKind: "none",
    proofKind: "public_url",
    refreshKind: "none",
    takedownKind: "internal_unpublish",
    rolloutState: "live_proven",
    note: "Core renter page and tracked inquiry link.",
  },
  org_feed: {
    label: "Listing feed",
    executionKind: "feed",
    accountKind: "none",
    authorizationKind: "none",
    spendKind: "none",
    proofKind: "feed_acceptance",
    refreshKind: "none",
    takedownKind: "internal_unpublish",
    rolloutState: "live_proven",
    note: "In-feed is not the same as live on a partner site.",
  },
  network_feed: {
    label: "Private partner feed",
    executionKind: "feed",
    accountKind: "partner_feed",
    authorizationKind: "posting",
    spendKind: "none",
    proofKind: "feed_acceptance",
    refreshKind: "unknown",
    takedownKind: "operator_task",
    rolloutState: "source_built",
    note: "Ready only after a partner/feed route is configured and accepted.",
  },
  facebook: {
    label: "Facebook Marketplace",
    executionKind: "fallback",
    accountKind: "none",
    authorizationKind: "none",
    spendKind: "none",
    proofKind: "external_url",
    refreshKind: "unknown",
    takedownKind: "operator_task",
    rolloutState: "needs_decision",
    note: "Do not conflate Marketplace with Facebook Page feed. Keep as fallback unless a compliant route is proven.",
  },
  kijiji: {
    executionKind: "headless_worker",
    accountKind: "stored_session",
    authorizationKind: "posting_and_refresh",
    spendKind: "paid_pass_through_required",
    proofKind: "external_url",
    refreshKind: "ttl_auto",
    takedownKind: "operator_task",
    rolloutState: "source_built",
    note: "Headless worker lane exists; paid pass-through and spend-enforced claim path still need reconciliation before rollout.",
  },
  linkedin: {
    executionKind: "share",
    accountKind: "share",
    authorizationKind: "none",
    spendKind: "none",
    proofKind: "manual_note",
    refreshKind: "unknown",
    takedownKind: "none",
    rolloutState: "planned",
    note: "Share target only until a real connected posting path exists.",
  },
  instagram: {
    executionKind: "api",
    accountKind: "oauth",
    authorizationKind: "posting",
    spendKind: "none",
    proofKind: "graph_permalink",
    refreshKind: "none",
    takedownKind: "operator_task",
    rolloutState: "source_built",
    note: "Linked Instagram Business account can post single-image listing content after authorization.",
  },
  facebook_feed: {
    label: "Facebook Page feed",
    executionKind: "api",
    accountKind: "oauth",
    authorizationKind: "posting_and_refresh",
    spendKind: "none",
    proofKind: "graph_permalink",
    refreshKind: "none",
    takedownKind: "api_delete",
    rolloutState: "source_built",
    note: "Graph Page post path and lease-up delete proof are distinct from Marketplace.",
  },
  whatsapp: {
    executionKind: "share",
    accountKind: "share",
    authorizationKind: "none",
    spendKind: "none",
    proofKind: "manual_note",
    refreshKind: "unknown",
    takedownKind: "none",
    rolloutState: "planned",
    note: "Share-message target only until a real send/connect path exists.",
  },
  snapchat: {
    executionKind: "share",
    accountKind: "share",
    authorizationKind: "none",
    spendKind: "none",
    proofKind: "manual_note",
    refreshKind: "unknown",
    takedownKind: "none",
    rolloutState: "planned",
    note: "Share/social target only until a real posting path exists.",
  },
  rentals_ca: {
    executionKind: "headless_worker",
    accountKind: "stored_session",
    authorizationKind: "posting",
    spendKind: "paid_pass_through_optional",
    proofKind: "external_url",
    refreshKind: "unknown",
    takedownKind: "operator_task",
    rolloutState: "source_built",
    note: "Headless runner/mapping exists; feed acceptance remains a separate proof class.",
  },
  rentfaster: {
    executionKind: "headless_worker",
    accountKind: "stored_session",
    authorizationKind: "posting",
    spendKind: "paid_pass_through_required",
    proofKind: "external_url",
    refreshKind: "unknown",
    takedownKind: "operator_task",
    rolloutState: "source_built",
    note: "Headless paid worker path exists; spend pass-through and proof must bind before rollout.",
  },
  zumper: {
    executionKind: "headless_worker",
    accountKind: "stored_session",
    authorizationKind: "posting",
    spendKind: "paid_pass_through_optional",
    proofKind: "external_url",
    refreshKind: "unknown",
    takedownKind: "operator_task",
    rolloutState: "source_built",
    note: "Headless runner/mapping exists; partner/feed proof remains distinct.",
  },
  viewit: {
    executionKind: "headless_worker",
    accountKind: "stored_session",
    authorizationKind: "posting",
    spendKind: "paid_pass_through_required",
    proofKind: "external_url",
    refreshKind: "unknown",
    takedownKind: "operator_task",
    rolloutState: "source_built",
    note: "Headless paid worker path exists; payment and live proof stay gated.",
  },
  realtor_ca: {
    executionKind: "broker",
    accountKind: "broker",
    authorizationKind: "broker_request",
    spendKind: "none",
    proofKind: "broker_url",
    refreshKind: "unknown",
    takedownKind: "broker_request",
    rolloutState: "source_built",
    note: "Broker/MLS route only, never a self-serve landlord portal post.",
  },
  other: {
    label: "Other tracked post",
    executionKind: "fallback",
    accountKind: "none",
    authorizationKind: "none",
    spendKind: "paid_pass_through_optional",
    proofKind: "manual_note",
    refreshKind: "unknown",
    takedownKind: "operator_task",
    rolloutState: "source_built",
    note: "Custom tracked destination. Keep outside the one-click ready count until configured.",
  },
};

function contractForKey(channel: PublishChannelKey): DistributionChannelContract {
  const matrix = channelByKey(channel);
  const override = CONTRACT_OVERRIDES[channel];
  return {
    channel,
    label: override.label ?? matrix?.label ?? channel.replace(/_/g, " "),
    executionKind: override.executionKind,
    accountKind: override.accountKind,
    authorizationKind: override.authorizationKind,
    spendKind: override.spendKind,
    proofKind: override.proofKind,
    refreshKind: override.refreshKind,
    takedownKind: override.takedownKind,
    rolloutState: override.rolloutState,
    ttlDays: override.ttlDays ?? matrix?.ttlDays ?? null,
    note: override.note,
  };
}

export const DISTRIBUTION_CHANNEL_CONTRACTS: readonly DistributionChannelContract[] =
  PUBLISH_CHANNEL_KEYS.map(contractForKey);

const CONTRACT_BY_KEY = new Map(
  DISTRIBUTION_CHANNEL_CONTRACTS.map((contract) => [contract.channel, contract]),
);

export function distributionChannelContract(
  channel: PublishChannelKey,
): DistributionChannelContract {
  const contract = CONTRACT_BY_KEY.get(channel);
  if (!contract) {
    throw new Error(`Missing distribution channel contract for ${channel}`);
  }
  return contract;
}

export function allDistributionChannelContracts(): DistributionChannelContract[] {
  return [...DISTRIBUTION_CHANNEL_CONTRACTS];
}

function accountReady(
  contract: DistributionChannelContract,
  account: DistributionContractAccountState,
): boolean {
  if (contract.accountKind === "none" || contract.accountKind === "share") {
    return true;
  }
  if (contract.accountKind === "broker") return false;
  if (contract.accountKind === "partner_feed") {
    return (
      account.feedAccepted === true ||
      account.accountStatus === "accepted" ||
      account.accountStatus === "connected"
    );
  }
  return account.accountStatus === "connected";
}

function authorizationReady(
  contract: DistributionChannelContract,
  account: DistributionContractAccountState,
): boolean {
  return (
    contract.authorizationKind === "none" ||
    contract.authorizationKind === "broker_request" ||
    account.automationAuthorized === true
  );
}

function spendReady(
  contract: DistributionChannelContract,
  account: DistributionContractAccountState,
): boolean {
  if (contract.spendKind !== "paid_pass_through_required") return true;
  return (
    account.spendAuthorized === true &&
    !account.spendRevokedAt &&
    typeof account.spendMaxCents === "number" &&
    account.spendMaxCents > 0
  );
}

export function resolveDistributionLaunchReadiness(
  contract: DistributionChannelContract,
  account: DistributionContractAccountState = {},
): DistributionLaunchReadiness {
  if (contract.rolloutState === "planned") {
    return {
      channel: contract.channel,
      label: contract.label,
      state: "planned",
      reason: "No connected execution path is proven for this destination yet.",
    };
  }
  if (contract.executionKind === "fallback") {
    return {
      channel: contract.channel,
      label: contract.label,
      state: "fallback_task",
      reason: "This destination needs a fallback task until a real execution path is proven.",
    };
  }
  if (contract.executionKind === "broker") {
    return {
      channel: contract.channel,
      label: contract.label,
      state: "needs_broker",
      reason: "This destination needs a broker or agent route.",
    };
  }
  if (!accountReady(contract, account)) {
    return {
      channel: contract.channel,
      label: contract.label,
      state: "needs_account",
      reason: "Connect or accept the account route before launch.",
    };
  }
  if (!authorizationReady(contract, account)) {
    return {
      channel: contract.channel,
      label: contract.label,
      state: "needs_authorization",
      reason: "Authorize Vacantless to post or refresh before launch.",
    };
  }
  if (!spendReady(contract, account)) {
    return {
      channel: contract.channel,
      label: contract.label,
      state: "needs_spend_limit",
      reason: "Set a landlord pass-through spend limit before a paid launch.",
    };
  }
  return {
    channel: contract.channel,
    label: contract.label,
    state: "ready",
    reason: "Ready for the launch action.",
  };
}

export function distributionLaunchStateLabel(
  state: DistributionLaunchState,
): string {
  return DISTRIBUTION_LAUNCH_STATE_LABELS[state];
}

export function distributionLaunchStateTone(
  state: DistributionLaunchState,
): DistributionContractTone {
  return DISTRIBUTION_LAUNCH_STATE_TONES[state];
}

export function distributionExecutionLabel(
  executionKind: DistributionExecutionKind,
): string {
  return DISTRIBUTION_EXECUTION_LABELS[executionKind];
}

export function distributionRefreshLabel(
  contract: DistributionChannelContract,
): string {
  if (contract.refreshKind === "ttl_auto") {
    return contract.ttlDays
      ? `Auto-refresh before ${contract.ttlDays} days`
      : "Auto-refresh watch";
  }
  if (contract.refreshKind === "ttl_reminder") {
    return contract.ttlDays
      ? `Expiry reminder before ${contract.ttlDays} days`
      : "Expiry reminder";
  }
  if (contract.refreshKind === "unknown") {
    return "Expiry watch after proof";
  }
  return "No expiry reminder";
}

export function distributionTakedownLabel(
  contract: DistributionChannelContract,
): string {
  switch (contract.takedownKind) {
    case "internal_unpublish":
      return "Internal unpublish";
    case "api_delete":
      return "API takedown";
    case "headless_delete":
      return "Headless takedown";
    case "operator_task":
      return "Removal task";
    case "broker_request":
      return "Broker removal request";
    case "none":
      return "No takedown step";
  }
}

export function distributionLifecycleSummary(
  contract: DistributionChannelContract,
): DistributionLifecycleSummary {
  const refreshLabel = distributionRefreshLabel(contract);
  const takedownLabel = distributionTakedownLabel(contract);
  const hasRefresh = contract.refreshKind !== "none";
  const hasTakedown = contract.takedownKind !== "none";
  let detail = "No expiry or takedown automation is tracked for this destination yet.";

  if (hasRefresh && hasTakedown) {
    detail = `${refreshLabel}; ${takedownLabel.toLowerCase()} when the rental is leased or taken offline.`;
  } else if (hasRefresh) {
    detail = `${refreshLabel}; no takedown step is tracked here.`;
  } else if (hasTakedown) {
    detail = `${takedownLabel} when the rental is leased or taken offline.`;
  }

  return { refreshLabel, takedownLabel, detail };
}

export function hasAutomatedTakedown(
  contract: DistributionChannelContract,
): boolean {
  return (
    contract.takedownKind === "internal_unpublish" ||
    contract.takedownKind === "api_delete" ||
    contract.takedownKind === "headless_delete"
  );
}

export function participatesInKeepLive(
  contract: DistributionChannelContract,
): boolean {
  return (
    contract.refreshKind === "ttl_auto" ||
    contract.refreshKind === "ttl_reminder"
  );
}
