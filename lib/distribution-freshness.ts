// ============================================================================
// Pure distribution freshness decisions (S543).
//
// The cron route owns all IO. This file only answers:
//   - is a row due for a freshness check?
//   - should a portal tracker be flagged for operator refresh?
//   - what pointer/status should be written after a verifier result?
//
// Honesty boundary: external portals are never fetched or auto-posted by the
// freshness sweep. Portal rows can only be flagged from our own tracker/pointer
// state so a human can refresh them.
// ============================================================================

import {
  DEFAULT_REFRESH_DAYS,
  daysBetween,
} from "./distribution-channels";
import {
  scheduleNextVerification,
  type VerificationResult,
} from "./distribution-verification";
import {
  isListingPostStatus,
  isPortalKey,
  type ListingPostStatus,
} from "./listing-distribution";

export const FRESHNESS_VERIFIABLE_CHANNELS = [
  "vacantless",
  "org_feed",
] as const;
export type FreshnessVerifiableChannel =
  (typeof FRESHNESS_VERIFIABLE_CHANNELS)[number];

export type FreshnessPointerInput = {
  nextCheckAt?: string | null;
  staleAfter?: string | null;
  nextRetryAt?: string | null;
};

export type FreshnessDueDecision = {
  due: boolean;
  pointer: string | null;
  reason: "no_pointer" | "due" | "future" | "invalid_pointer";
};

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function freshnessPointer(
  input: FreshnessPointerInput,
): string | null {
  return input.nextCheckAt ?? input.staleAfter ?? input.nextRetryAt ?? null;
}

export function freshnessDue(
  input: FreshnessPointerInput & { nowISO: string },
): FreshnessDueDecision {
  const pointer = freshnessPointer(input);
  if (!pointer) return { due: true, pointer: null, reason: "no_pointer" };
  const nowMs = parseMs(input.nowISO);
  const pointerMs = parseMs(pointer);
  if (nowMs == null || pointerMs == null) {
    return { due: true, pointer, reason: "invalid_pointer" };
  }
  if (pointerMs <= nowMs) return { due: true, pointer, reason: "due" };
  return { due: false, pointer, reason: "future" };
}

export function isFreshnessVerifiableChannel(
  channel: unknown,
): channel is FreshnessVerifiableChannel {
  return (
    typeof channel === "string" &&
    (FRESHNESS_VERIFIABLE_CHANNELS as readonly string[]).includes(channel)
  );
}

export function isFreshnessPortalChannel(channel: unknown): boolean {
  return isPortalKey(channel);
}

export type PortalFreshnessInput = FreshnessPointerInput & {
  channel: string;
  listingPostStatus: string | null | undefined;
  listingPostUrl: string | null | undefined;
  listingPostPostedOn: string | null | undefined;
  /**
   * Fallback age clock. `posted_on` is nullable and a great many rows never get
   * one, which used to leave those rows literally ageless. Pass the row's
   * `created_at` so a live portal row always has SOME clock. Accepts a full
   * timestamp; only the leading YYYY-MM-DD is used.
   */
  listingPostCreatedAt?: string | null;
  nowISO: string;
  refreshDays?: number;
};

export type PortalFreshnessDecision = {
  shouldFlag: boolean;
  reason:
    | "not_portal"
    | "missing_live_url"
    | "tracker_expired"
    | "pointer_due"
    | "posted_on_stale"
    | "created_at_stale"
    | "not_due";
};

export const DISTRIBUTION_LIFECYCLE_ATTENTION_KINDS = [
  "takedown_needed",
  "refresh_due",
  "expires_soon",
  "proof_needed",
] as const;
export type DistributionLifecycleAttentionKind =
  (typeof DISTRIBUTION_LIFECYCLE_ATTENTION_KINDS)[number];

export type DistributionLifecycleAttentionTone =
  | "positive"
  | "warning"
  | "danger"
  | "neutral";

export type DistributionLifecycleAttention = {
  kind: DistributionLifecycleAttentionKind;
  label: string;
  tone: DistributionLifecycleAttentionTone;
  detail: string;
  actionLabel: string;
  dueAt: string | null;
};

export type DistributionLifecycleAttentionInput = {
  channel: string;
  channelLabel: string;
  propertyStatus: string | null | undefined;
  publishStatus: string | null | undefined;
  transport: string | null | undefined;
  verificationStatus?: string | null;
  staleAfter?: string | null;
  externalExpiresAt?: string | null;
  externalUrl?: string | null;
  proofUrl?: string | null;
  liveWithoutUrl?: boolean;
  nowISO: string;
  expiryLeadDays?: number;
};

/**
 * Narrow a date or timestamp to the bare `YYYY-MM-DD` that `daysBetween`
 * requires. `posted_on` is already a DATE; `created_at` is a timestamptz like
 * "2026-07-06 11:24:43.39666+00", which `daysBetween` would otherwise reject
 * outright and silently return null for.
 */
function ymd(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const head = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
}

function daysUntil({
  nowISO,
  targetISO,
}: {
  nowISO: string;
  targetISO: string | null | undefined;
}): number | null {
  const now = parseMs(nowISO);
  const target = parseMs(targetISO);
  if (now == null || target == null) return null;
  return Math.ceil((target - now) / 86_400_000);
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = parseMs(value);
  if (ms == null) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function propertyNeedsExternalTakedown(status: string | null | undefined): boolean {
  return status === "leased" || status === "paused" || status === "off_market";
}

function itemHasLiveExternalProof(
  input: DistributionLifecycleAttentionInput,
): boolean {
  if (input.transport === "takedown") return false;
  if (input.publishStatus !== "live") return false;
  return Boolean(input.externalUrl?.trim() || input.proofUrl?.trim());
}

export function distributionLifecycleAttention(
  input: DistributionLifecycleAttentionInput,
): DistributionLifecycleAttention | null {
  if (
    input.transport === "takedown" &&
    input.publishStatus !== "skipped" &&
    input.publishStatus !== "rejected"
  ) {
    return {
      kind: "takedown_needed",
      label: "Takedown needed",
      tone: "warning",
      detail: `Remove the ${input.channelLabel} ad, then save removal proof here.`,
      actionLabel: "Remove ad",
      dueAt: null,
    };
  }

  if (
    propertyNeedsExternalTakedown(input.propertyStatus) &&
    itemHasLiveExternalProof(input)
  ) {
    return {
      kind: "takedown_needed",
      label: "Takedown needed",
      tone: "warning",
      detail: `${input.channelLabel} is still live, but this rental is no longer accepting new renters.`,
      actionLabel: "Remove ad",
      dueAt: null,
    };
  }

  if (input.publishStatus === "live" && input.liveWithoutUrl === true) {
    return {
      kind: "proof_needed",
      label: "Proof needed",
      tone: "danger",
      detail: `${input.channelLabel} is marked Live without a real ad URL.`,
      actionLabel: "Save proof",
      dueAt: null,
    };
  }

  if (
    runItemNeedsRefresh({
      verificationStatus: input.verificationStatus,
      staleAfter: input.staleAfter,
      nowISO: input.nowISO,
    })
  ) {
    return {
      kind: "refresh_due",
      label: "Refresh due",
      tone: "warning",
      detail: `${input.channelLabel} needs fresh proof or a refresh before it keeps counting as Live.`,
      actionLabel: "Refresh ad",
      dueAt: input.staleAfter ?? null,
    };
  }

  if (input.publishStatus !== "live") return null;

  const days = daysUntil({
    nowISO: input.nowISO,
    targetISO: input.externalExpiresAt,
  });
  if (days == null) return null;

  const dueDate = dateOnly(input.externalExpiresAt);
  if (days <= 0) {
    return {
      kind: "refresh_due",
      label: "Refresh due",
      tone: "warning",
      detail: dueDate
        ? `${input.channelLabel} expired on ${dueDate}. Refresh it or remove it.`
        : `${input.channelLabel} is expired. Refresh it or remove it.`,
      actionLabel: "Refresh ad",
      dueAt: input.externalExpiresAt ?? null,
    };
  }

  if (days <= (input.expiryLeadDays ?? 3)) {
    return {
      kind: "expires_soon",
      label: "Expires soon",
      tone: "warning",
      detail: dueDate
        ? `${input.channelLabel} expires on ${dueDate}. Vacantless should remind or refresh before then.`
        : `${input.channelLabel} expires soon. Vacantless should remind or refresh before then.`,
      actionLabel: "Review expiry",
      dueAt: input.externalExpiresAt ?? null,
    };
  }

  return null;
}

export function portalFreshnessDecision(
  input: PortalFreshnessInput,
): PortalFreshnessDecision {
  if (!isPortalKey(input.channel)) {
    return { shouldFlag: false, reason: "not_portal" };
  }

  const status: ListingPostStatus | null = isListingPostStatus(
    input.listingPostStatus,
  )
    ? input.listingPostStatus
    : null;

  if (status === "expired" || status === "removed") {
    return { shouldFlag: true, reason: "tracker_expired" };
  }

  if (status === "live" && !input.listingPostUrl) {
    return { shouldFlag: false, reason: "missing_live_url" };
  }

  const due = freshnessDue(input);
  if (due.due && due.pointer) {
    return { shouldFlag: true, reason: "pointer_due" };
  }

  // S670: a live portal row could become UNREACHABLE by every branch above.
  // The pointer branch requires a non-null pointer, so an item that has never
  // been scheduled (`reason: "no_pointer"`) is skipped by it - exactly the item
  // that most needs a first look. If `posted_on` was also null the row had no
  // age either, so it stayed "not_due" forever. 50 Glenrose Unit 4 read `live`
  // on a dead Facebook ad for 46 days that way. Falling back to `created_at`
  // gives every row a clock, which closes the hole without the false-alarm
  // storm that flagging on a bare `no_pointer` would cause across live orgs.
  const postedOn = ymd(input.listingPostPostedOn);
  const createdAt = ymd(input.listingPostCreatedAt);
  const ageAnchor = postedOn ?? createdAt;
  const today = input.nowISO.slice(0, 10);
  const age = daysBetween(ageAnchor, today);
  if (
    status === "live" &&
    age != null &&
    age >= (input.refreshDays ?? DEFAULT_REFRESH_DAYS)
  ) {
    return {
      shouldFlag: true,
      reason: postedOn ? "posted_on_stale" : "created_at_stale",
    };
  }

  return { shouldFlag: false, reason: "not_due" };
}

export type FreshnessResultUpdate = {
  runItemResult: VerificationResult;
  staleAfter: string | null;
  nextRetryAt: string | null;
  fresh: boolean;
};

export function freshnessUpdateForVerification({
  channel,
  result,
  nowISO,
}: {
  channel: string;
  result: VerificationResult;
  nowISO: string;
}): FreshnessResultUpdate {
  const fresh = result === "verified_live" || result === "verified_submitted";
  if (fresh) {
    const next = scheduleNextVerification(channel, result, nowISO);
    return {
      runItemResult: result,
      staleAfter: next,
      nextRetryAt: next,
      fresh: true,
    };
  }

  const next = scheduleNextVerification(channel, "stale", nowISO);
  return {
    runItemResult: "stale",
    staleAfter: null,
    nextRetryAt: next,
    fresh: false,
  };
}

export function runItemNeedsRefresh({
  verificationStatus,
  staleAfter,
  nowISO,
}: {
  verificationStatus: string | null | undefined;
  staleAfter: string | null | undefined;
  nowISO: string;
}): boolean {
  if (verificationStatus === "stale" || verificationStatus === "not_found") {
    return true;
  }
  if (!staleAfter) return false;
  const staleMs = parseMs(staleAfter);
  const nowMs = parseMs(nowISO);
  return staleMs != null && nowMs != null && staleMs <= nowMs;
}

export function runItemHasFreshnessState({
  verificationStatus,
  staleAfter,
}: {
  verificationStatus: string | null | undefined;
  staleAfter: string | null | undefined;
}): boolean {
  return (
    verificationStatus === "verified_live" ||
    verificationStatus === "verified_submitted" ||
    verificationStatus === "stale" ||
    verificationStatus === "not_found" ||
    Boolean(staleAfter)
  );
}
