// ============================================================================
// Pure S553 done-for-you distribution JOB model.
//
// A run item is still the operator-visible source of truth. A distribution job
// is the internal assembly-line work order that lets staff/workers process the
// request without pretending external portals can be silently posted.
// ============================================================================

import {
  channelCapability,
  type ChannelAccountStatus,
} from "./distribution-capabilities";
import {
  normalizePublishChannel,
  publishChannelMeta,
  type PublishChannelKey,
  type PublishMode,
  type PublishStatus,
} from "./distribution-publish";

export const DISTRIBUTION_JOB_STATUSES = [
  "queued",
  "preparing",
  "ready_for_human",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
export type DistributionJobStatus = (typeof DISTRIBUTION_JOB_STATUSES)[number];

export const DISTRIBUTION_JOB_ADAPTER_KINDS = [
  "internal_app",
  "feed_partner",
  "human_external",
  "broker_handoff",
  "custom_manual",
] as const;
export type DistributionJobAdapterKind =
  (typeof DISTRIBUTION_JOB_ADAPTER_KINDS)[number];

export const DISTRIBUTION_JOB_HUMAN_GATES = [
  "connect_account",
  "login",
  "payment",
  "captcha",
  "final_submit",
  "broker",
  "proof",
] as const;
export type DistributionJobHumanGate =
  (typeof DISTRIBUTION_JOB_HUMAN_GATES)[number];

export type DistributionJobAdapter = {
  channel: PublishChannelKey;
  channelLabel: string;
  transport: PublishMode;
  kind: DistributionJobAdapterKind;
  canUseAiPrep: boolean;
  canAutoSubmit: boolean;
  requiresConnectedAccount: boolean;
  requiresLogin: boolean;
  requiresPayment: boolean;
  requiresCaptchaGate: boolean;
  requiresHumanFinalSubmit: boolean;
  proofRequired: boolean;
  humanGates: DistributionJobHumanGate[];
};

export type MinimumDistributionJobPayload = {
  channel: string;
  channelLabel: string;
  propertyAddress: string | null;
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  publicUrl: string | null;
  listingCopy: string | null;
};

export type DistributionJobDecision = {
  status: DistributionJobStatus;
  runItemPublishStatus: PublishStatus | null;
  blockers: string[];
  nextStep: string;
};

export function isDistributionJobStatus(value: unknown): value is DistributionJobStatus {
  return (
    typeof value === "string" &&
    (DISTRIBUTION_JOB_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizeDistributionJobStatus(
  value: unknown,
): DistributionJobStatus {
  return isDistributionJobStatus(value) ? value : "queued";
}

export function distributionJobStatusLabel(value: unknown): string {
  switch (normalizeDistributionJobStatus(value)) {
    case "queued":
      return "Queued for desk";
    case "preparing":
      return "Preparing";
    case "ready_for_human":
      return "Needs human gate";
    case "blocked":
      return "Blocked";
    case "completed":
      return "Proof saved";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function distributionJobAdapterForChannel(
  rawChannel: string,
): DistributionJobAdapter {
  const channel = normalizePublishChannel(rawChannel) ?? "other";
  const cap = channelCapability(channel);
  const meta = publishChannelMeta(channel);
  const broker = cap.transport === "broker";
  const custom = cap.transport === "custom";
  const internal = cap.transport === "automatic";
  const feed = cap.transport === "feed_partner" && !cap.requiresLogin && !cap.requiresPayment;
  const humanExternal =
    cap.transport === "browser_copilot" ||
    cap.requiresLogin ||
    cap.requiresPayment ||
    cap.postingPolicy === "human_confirmed";
  const kind: DistributionJobAdapterKind = internal
    ? "internal_app"
    : broker
      ? "broker_handoff"
      : custom
        ? "custom_manual"
        : feed
          ? "feed_partner"
          : "human_external";
  const humanGates: DistributionJobHumanGate[] = [];

  if (cap.needsOrgAccount) humanGates.push("connect_account");
  if (cap.requiresLogin) humanGates.push("login");
  if (cap.requiresPayment) humanGates.push("payment");
  if (humanExternal) humanGates.push("captcha");
  if (broker) humanGates.push("broker");
  if (!internal || cap.postingPolicy !== "automatic_allowed") {
    humanGates.push("final_submit");
  }
  humanGates.push("proof");

  return {
    channel,
    channelLabel: meta.label,
    transport: cap.transport,
    kind,
    canUseAiPrep: !internal,
    canAutoSubmit: internal && cap.postingPolicy === "automatic_allowed",
    requiresConnectedAccount: cap.needsOrgAccount,
    requiresLogin: cap.requiresLogin,
    requiresPayment: cap.requiresPayment,
    requiresCaptchaGate: humanExternal,
    requiresHumanFinalSubmit:
      !internal || cap.postingPolicy !== "automatic_allowed",
    proofRequired: true,
    humanGates: uniqueGates(humanGates),
  };
}

export function minimumDistributionJobPayload(input: {
  channel: string;
  propertyAddress?: string | null;
  rentCents?: number | null;
  beds?: number | null;
  baths?: number | null;
  publicUrl?: string | null;
  listingCopy?: string | null;
}): MinimumDistributionJobPayload {
  const adapter = distributionJobAdapterForChannel(input.channel);
  return {
    channel: adapter.channel,
    channelLabel: adapter.channelLabel,
    propertyAddress: textOrNull(input.propertyAddress),
    rentCents: finiteNumberOrNull(input.rentCents),
    beds: finiteNumberOrNull(input.beds),
    baths: finiteNumberOrNull(input.baths),
    publicUrl: textOrNull(input.publicUrl),
    listingCopy: textOrNull(input.listingCopy),
  };
}

export function canCallAiForDistributionJob(input: {
  adapter: DistributionJobAdapter;
  aiConsentAt?: string | null;
  payload: MinimumDistributionJobPayload;
}): boolean {
  return (
    input.adapter.canUseAiPrep &&
    Boolean(textOrNull(input.aiConsentAt)) &&
    Object.keys(input.payload).every((key) =>
      [
        "channel",
        "channelLabel",
        "propertyAddress",
        "rentCents",
        "beds",
        "baths",
        "publicUrl",
        "listingCopy",
      ].includes(key),
    )
  );
}

export function distributionJobWorkerDecision(input: {
  adapter: DistributionJobAdapter;
  accountStatus?: ChannelAccountStatus | string | null;
}): DistributionJobDecision {
  const accountStatus = input.accountStatus ?? null;
  if (
    input.adapter.requiresConnectedAccount &&
    accountStatus !== "accepted" &&
    accountStatus !== "connected"
  ) {
    return {
      status: "blocked",
      runItemPublishStatus: "needs_operator",
      blockers: [
        `${input.adapter.channelLabel} needs a connected or accepted account route before Vacantless can execute it.`,
      ],
      nextStep: "Connect or approve the channel account.",
    };
  }

  if (input.adapter.requiresPayment) {
    return {
      status: "ready_for_human",
      runItemPublishStatus: "needs_payment",
      blockers: ["A person must review and approve any paid placement before submission."],
      nextStep: "Open the portal with staff and complete the payment gate manually.",
    };
  }

  if (input.adapter.requiresLogin) {
    return {
      status: "ready_for_human",
      runItemPublishStatus: "needs_login",
      blockers: ["A person must sign in and handle any CAPTCHA or portal challenge."],
      nextStep: "Use the prepared posting packet, then save the live proof URL.",
    };
  }

  if (input.adapter.requiresHumanFinalSubmit) {
    return {
      status: "ready_for_human",
      runItemPublishStatus: "needs_operator",
      blockers: ["A person must make the final external submit and save proof."],
      nextStep: "Review the prepared packet, submit only when safe, then save proof.",
    };
  }

  return {
    status: "preparing",
    runItemPublishStatus: "submitting",
    blockers: [],
    nextStep: "Worker can prepare the app-owned surface, then proof must be saved.",
  };
}

export function humanGateLabel(gate: DistributionJobHumanGate): string {
  switch (gate) {
    case "connect_account":
      return "Connect account";
    case "login":
      return "Login";
    case "payment":
      return "Payment";
    case "captcha":
      return "CAPTCHA";
    case "final_submit":
      return "Final submit";
    case "broker":
      return "Broker handoff";
    case "proof":
      return "Proof";
  }
}

function uniqueGates(
  gates: DistributionJobHumanGate[],
): DistributionJobHumanGate[] {
  return [...new Set(gates)];
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
