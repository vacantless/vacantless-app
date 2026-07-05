// ============================================================================
// Pure helpers for guided launch RUNS (S412 Slice 2). No DOM / env / IO —
// unit-tested (scripts/test-distribution-run.ts).
//
// A run is a saved, resumable posting session: the operator picks channels and
// works each one as a checklist. This file owns the STATIC per-channel step
// list (derived from the channel matrix) + the pure progress/labels the run UI
// renders. The durable progress (per-channel status + the live URL) lives in
// distribution_run_items (migration 0105); the steps themselves are code, not
// data, so they always match the current guardrails/fill sheet.
// ============================================================================

import {
  channelByKey,
  type DistributionChannel,
} from "./distribution-channels";

// --- run-item status -------------------------------------------------------
export const RUN_ITEM_STATUSES = [
  "pending",
  "in_progress",
  "done",
  "skipped",
] as const;
export type RunItemStatus = (typeof RUN_ITEM_STATUSES)[number];

const RUN_ITEM_STATUS_LABELS: Record<RunItemStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  done: "Done",
  skipped: "Skipped",
};

export function runItemStatusLabel(value: unknown): string {
  return typeof value === "string" &&
    (RUN_ITEM_STATUSES as readonly string[]).includes(value)
    ? RUN_ITEM_STATUS_LABELS[value as RunItemStatus]
    : "Not started";
}

export function isRunItemStatus(value: unknown): value is RunItemStatus {
  return (
    typeof value === "string" &&
    (RUN_ITEM_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizeRunItemStatus(raw: unknown): RunItemStatus {
  return isRunItemStatus(raw) ? raw : "pending";
}

// An item is "resolved" (no longer needs the operator) when done or skipped.
export function isResolvedRunStatus(s: RunItemStatus): boolean {
  return s === "done" || s === "skipped";
}

// --- steps -----------------------------------------------------------------
// One checklist step. `detail` is optional guidance shown under the label.
export type RunStep = {
  key: string;
  label: string;
  detail?: string;
};

// The ordered step list for a channel. Derived from the matrix so a broker
// channel (Realtor.ca — no self-serve copy) and the assisted-manual channels
// read differently, and Facebook carries its unique-photo reminder inline.
export function buildRunSteps(
  channelKey: string,
  opts?: { guardrailCount?: number },
): RunStep[] {
  const channel = channelByKey(channelKey);
  const guardrailCount = opts?.guardrailCount ?? 0;

  // Realtor.ca / broker route: no self-serve copy — hand the field sheet off.
  if (channel && channel.mode === "broker") {
    return [
      {
        key: "brief_agent",
        label: `Send the field sheet to your agent`,
        detail:
          "Realtor.ca is populated through a brokerage/DDF feed, so your agent lists it. The field sheet in Photos & marketing has everything they need.",
      },
      {
        key: "confirm_live",
        label: "Confirm it went live and paste the Realtor.ca link",
        detail: "Once your agent posts it, paste the live listing URL below.",
      },
    ];
  }

  const label = channel?.label ?? "the portal";
  const steps: RunStep[] = [
    { key: "open", label: `Open ${label}` },
    {
      key: "title",
      label: "Copy the title",
      detail: "Use the channel wording - it's already length-fit for this site.",
    },
    { key: "body", label: "Copy the description" },
    {
      key: "fields",
      label: "Fill the listing fields",
      detail: "The field sheet in Photos & marketing lists each field in order.",
    },
    {
      key: "photos",
      label: "Upload the photos in order",
      detail:
        channelKey === "facebook"
          ? "Facebook flags duplicate photos across posts - use this listing's own set, and add the QR image as an extra photo."
          : "Cover photo first, then the rest.",
    },
  ];
  if (guardrailCount > 0) {
    steps.push({
      key: "gotchas",
      label: `Confirm the ${guardrailCount} ${
        guardrailCount === 1 ? "gotcha" : "gotchas"
      } for this channel`,
      detail: "The 'Before you post' list flags the traps that cost money or hide the ad.",
    });
  }
  steps.push({
    key: "paste_url",
    label: "Paste the live ad URL below and mark this channel done",
    detail: "That turns on the tracked inquiry link so leads are attributed here.",
  });
  return steps;
}

// --- progress --------------------------------------------------------------
export type RunProgress = {
  total: number;
  done: number;
  skipped: number;
  resolved: number; // done + skipped
  remaining: number; // total - resolved
  pct: number; // 0..100 by resolved/total
  allResolved: boolean;
};

export function runProgress(
  items: ReadonlyArray<{ status: RunItemStatus }>,
): RunProgress {
  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const resolved = done + skipped;
  const remaining = total - resolved;
  const pct = total === 0 ? 0 : Math.round((resolved / total) * 100);
  return {
    total,
    done,
    skipped,
    resolved,
    remaining,
    pct,
    allResolved: total > 0 && resolved === total,
  };
}

// The channels an operator can add to a run = the matrix (facebook, kijiji, …)
// plus "other". Excludes channels already in the run.
export function selectableRunChannels(
  allChannels: readonly DistributionChannel[],
  alreadyInRun: ReadonlySet<string>,
): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  for (const c of allChannels) {
    if (!alreadyInRun.has(c.key)) out.push({ key: c.key, label: c.label });
  }
  if (!alreadyInRun.has("other")) out.push({ key: "other", label: "Other" });
  return out;
}
