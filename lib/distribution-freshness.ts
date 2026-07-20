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
    | "not_due";
};

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

  const postedOn = input.listingPostPostedOn ?? null;
  const today = input.nowISO.slice(0, 10);
  const age = daysBetween(postedOn, today);
  if (
    status === "live" &&
    age != null &&
    age >= (input.refreshDays ?? DEFAULT_REFRESH_DAYS)
  ) {
    return { shouldFlag: true, reason: "posted_on_stale" };
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
