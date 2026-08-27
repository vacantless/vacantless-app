// Pure launch coverage map for the headless-first distribution push.
//
// This is deliberately separate from channel connection state. A channel can be
// operator-covered by Launch even when it is not safe to call it silent
// automation: Facebook Marketplace is co-pilot-ready, RentFaster/Viewit can
// advance to a paid stop, Realtor.ca is a broker handoff, and commercial portals
// are source-packet assists until their account/payment behavior is proven.

import {
  DISTRIBUTION_CHANNELS,
  type DistributionChannel,
} from "./distribution-channels";

export const LAUNCH_COVERAGE_MECHANISMS = [
  "api_post",
  "headless_worker",
  "paid_worker_stop",
  "browser_copilot",
  "commercial_assist",
  "broker_handoff",
  "share_task",
] as const;
export type LaunchCoverageMechanism =
  (typeof LAUNCH_COVERAGE_MECHANISMS)[number];

export const LAUNCH_COVERAGE_LEVELS = [
  "machine_backed",
  "operator_ready",
  "handoff_ready",
] as const;
export type LaunchCoverageLevel = (typeof LAUNCH_COVERAGE_LEVELS)[number];

export type LaunchCoverageRow = {
  key: DistributionChannel["key"];
  label: string;
  mechanism: LaunchCoverageMechanism;
  level: LaunchCoverageLevel;
  operatorCovered: boolean;
  machineBacked: boolean;
  unattendedLiveCandidate: boolean;
  requiresHumanReview: boolean;
  requiresPaymentGate: boolean;
  requiresBroker: boolean;
  workerScript: string | null;
  promise: string;
};

export type LaunchCoverageSummary = {
  total: number;
  operatorCovered: number;
  operatorCoveragePercent: number;
  machineBacked: number;
  unattendedLiveCandidates: number;
  paymentGated: number;
  humanReviewRequired: number;
  brokerHandoffs: number;
};

export const WORKER_SCRIPT_BY_CHANNEL = {
  kijiji: "submit:b:live:free",
  rentals_ca: "submit:r:live:free",
  zumper: "submit:z:live",
  rentfaster: "submit:rf:live",
  viewit: "submit:v:live",
  facebook_feed: "submit:fb:live",
  instagram: "submit:ig:live",
} as const satisfies Partial<Record<DistributionChannel["key"], string>>;
type WorkerBackedChannel = keyof typeof WORKER_SCRIPT_BY_CHANNEL;

const COPILOT_READY_CHANNELS = new Set<DistributionChannel["key"]>([
  "facebook",
]);

const COMMERCIAL_ASSIST_CHANNELS = new Set<DistributionChannel["key"]>([
  "spacelist",
  "costar_loopnet",
]);

const SHARE_TASK_CHANNELS = new Set<DistributionChannel["key"]>([
  "whatsapp",
  "linkedin",
  "snapchat",
]);

const PAID_STOP_CHANNELS = new Set<DistributionChannel["key"]>([
  "rentfaster",
  "viewit",
]);

export function launchCoverageForChannel(
  channel: DistributionChannel,
): LaunchCoverageRow {
  const workerScript = workerScriptForChannel(channel.key);

  if (channel.mode === "api_automatic") {
    return row(channel, {
      mechanism: "api_post",
      level: "machine_backed",
      machineBacked: true,
      unattendedLiveCandidate: true,
      workerScript,
      promise:
        "Launch can use the sanctioned API path after the account is connected and automation is authorized.",
    });
  }

  if (PAID_STOP_CHANNELS.has(channel.key)) {
    return row(channel, {
      mechanism: "paid_worker_stop",
      level: "machine_backed",
      machineBacked: true,
      unattendedLiveCandidate: false,
      requiresHumanReview: true,
      requiresPaymentGate: true,
      workerScript,
      promise:
        "Launch can prepare the portal flow and stop at the paid decision; charging remains explicitly gated.",
    });
  }

  if (workerScript) {
    return row(channel, {
      mechanism: "headless_worker",
      level: "machine_backed",
      machineBacked: true,
      unattendedLiveCandidate: true,
      workerScript,
      promise:
        "Launch can use the worker runner after account/session and operator approval gates are satisfied.",
    });
  }

  if (COPILOT_READY_CHANNELS.has(channel.key)) {
    return row(channel, {
      mechanism: "browser_copilot",
      level: "operator_ready",
      requiresHumanReview: true,
      promise:
        "Launch can open the prepared co-pilot flow; the operator reviews, posts, and saves the real proof URL.",
    });
  }

  if (COMMERCIAL_ASSIST_CHANNELS.has(channel.key)) {
    return row(channel, {
      mechanism: "commercial_assist",
      level: "operator_ready",
      requiresHumanReview: true,
      requiresPaymentGate: channel.paid,
      promise:
        "Launch can prepare the commercial source packet while login, verification, payment, posting, and proof stay gated.",
    });
  }

  if (channel.mode === "broker") {
    return row(channel, {
      mechanism: "broker_handoff",
      level: "handoff_ready",
      requiresHumanReview: true,
      requiresBroker: true,
      promise:
        "Launch can create the broker handoff and track the real listing proof; Vacantless does not self-post this channel.",
    });
  }

  if (SHARE_TASK_CHANNELS.has(channel.key)) {
    return row(channel, {
      mechanism: "share_task",
      level: "handoff_ready",
      requiresHumanReview: true,
      promise:
        "Launch can prepare the share message and tracked link, then keep proof capture in the same run.",
    });
  }

  return row(channel, {
    mechanism: "browser_copilot",
    level: "operator_ready",
    requiresHumanReview: true,
    promise:
      "Launch can prepare posting assist and proof tracking while final review remains gated.",
  });
}

export function launchCoverageRows(
  channels: readonly DistributionChannel[] = DISTRIBUTION_CHANNELS,
): LaunchCoverageRow[] {
  return channels.map(launchCoverageForChannel);
}

export function summarizeLaunchCoverage(
  rows: readonly LaunchCoverageRow[] = launchCoverageRows(),
): LaunchCoverageSummary {
  const total = rows.length;
  const operatorCovered = rows.filter((row) => row.operatorCovered).length;
  return {
    total,
    operatorCovered,
    operatorCoveragePercent:
      total === 0 ? 0 : Math.round((operatorCovered / total) * 100),
    machineBacked: rows.filter((row) => row.machineBacked).length,
    unattendedLiveCandidates: rows.filter((row) => row.unattendedLiveCandidate)
      .length,
    paymentGated: rows.filter((row) => row.requiresPaymentGate).length,
    humanReviewRequired: rows.filter((row) => row.requiresHumanReview).length,
    brokerHandoffs: rows.filter((row) => row.requiresBroker).length,
  };
}

export function workerScriptForChannel(
  channel: DistributionChannel["key"],
): string | null {
  return Object.prototype.hasOwnProperty.call(WORKER_SCRIPT_BY_CHANNEL, channel)
    ? WORKER_SCRIPT_BY_CHANNEL[channel as WorkerBackedChannel]
    : null;
}

function row(
  channel: DistributionChannel,
  overrides: Omit<
    Partial<LaunchCoverageRow>,
    "key" | "label" | "operatorCovered" | "promise"
  > & {
    mechanism: LaunchCoverageMechanism;
    level: LaunchCoverageLevel;
    promise: string;
  },
): LaunchCoverageRow {
  return {
    key: channel.key,
    label: channel.label,
    mechanism: overrides.mechanism,
    level: overrides.level,
    operatorCovered: true,
    machineBacked: overrides.machineBacked ?? false,
    unattendedLiveCandidate: overrides.unattendedLiveCandidate ?? false,
    requiresHumanReview: overrides.requiresHumanReview ?? false,
    requiresPaymentGate: overrides.requiresPaymentGate ?? false,
    requiresBroker: overrides.requiresBroker ?? false,
    workerScript: overrides.workerScript ?? null,
    promise: overrides.promise,
  };
}
