import type { ChannelTileStatusRow } from "./distribution-channel-tile-statuses";
import { isPublishStatus, type PublishStatus } from "./distribution-publish";

// ============================================================================
// Stage 3 "Choose & send live" — pure view logic (S586).
// No DOM / IO — unit-testable (scripts/test-stage3-send-live.ts).
//
// Reads the EXISTING run-item state machine (distribution_run_items.publish_status)
// and the Stage 1 channel-tile verdicts. Adds only presentation mapping — NO new
// read-model, NO backend. LIVE! comes only from a run item's OWN status
// (publish_status === "live"), corroborated by a real verified_live proof
// (rule 16) — never a cosmetic timer.
// ============================================================================

// Keys into the next-intl `stage3.micro` catalog (must exist in en.json + fr.json).
// "formatting" and "uploading" are reserved finer-grained states we never
// fabricate from the coarse publish_status (mirrors stage4 badgeRemoving).
export type Stage3MicroKey =
  | "waiting"
  | "formatting"
  | "uploading"
  | "posting"
  | "live";

// StatusChip tones only (the ChipTone subset the per-channel row chip uses).
export type Stage3RowTone = "success" | "warn" | "neutral";

export type Stage3SendRow = {
  channel: string; // canonical channel key
  publishStatus: PublishStatus | null;
  microKey: Stage3MicroKey;
  tone: Stage3RowTone;
  isLive: boolean;
};

// The channels the blast will actually target = Stage 1 verdict "linked".
// Everything else (not linked / coming soon / mls-only) stays off, honestly.
export function stage3SendableChannels(
  rows: readonly ChannelTileStatusRow[],
): ChannelTileStatusRow[] {
  return rows.filter((row) => row.state === "linked");
}

// A channel is LIVE only when its run item's own status is "live" AND a real
// verified_live proof exists for it (rule 16). `verifiedLiveChannels === null`
// means "no verification signal supplied" — then the item's own live status is
// the sole authority (used by unit tests / pre-verification callers).
function stage3IsLive(
  publishStatus: PublishStatus | null,
  channel: string,
  verifiedLiveChannels: ReadonlySet<string> | null,
): boolean {
  if (publishStatus !== "live") return false;
  return verifiedLiveChannels === null || verifiedLiveChannels.has(channel);
}

// Map the item's own status to the honest micro-progress key. LIVE only when
// proven live; a live-but-unproven row reads as still "posting", never LIVE!.
function stage3MicroKeyFor(
  publishStatus: PublishStatus | null,
  isLive: boolean,
): Stage3MicroKey {
  if (isLive) return "live";
  if (publishStatus === "submitting" || publishStatus === "live") {
    return "posting";
  }
  return "waiting";
}

function stage3RowTone(
  publishStatus: PublishStatus | null,
  isLive: boolean,
): Stage3RowTone {
  if (isLive) return "success";
  if (publishStatus === "submitting" || publishStatus === "live") return "warn";
  return "neutral";
}

// Build the ordered send-row list from the sendable (linked) channels + the
// per-channel run-item publish_status map + the verified_live channel set. A
// linked channel with no run item yet reads honestly as "waiting to start".
export function buildStage3SendRows(
  sendable: readonly ChannelTileStatusRow[],
  publishStatusByChannel: ReadonlyMap<string, string | null>,
  verifiedLiveChannels: ReadonlySet<string> | null = null,
): Stage3SendRow[] {
  return sendable.map((row) => {
    const raw = publishStatusByChannel.get(row.channel) ?? null;
    const publishStatus: PublishStatus | null = isPublishStatus(raw)
      ? raw
      : null;
    const live = stage3IsLive(publishStatus, row.channel, verifiedLiveChannels);
    return {
      channel: row.channel,
      publishStatus,
      microKey: stage3MicroKeyFor(publishStatus, live),
      tone: stage3RowTone(publishStatus, live),
      isLive: live,
    };
  });
}

// Every linked channel is proven live -> show the "all done" banner instead of
// the send button. Needs >=1 sendable channel and all of them live.
export function stage3AllLive(rows: readonly Stage3SendRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.isLive);
}

// There is at least one linked channel not yet live -> the big send button is
// the call to action.
export function stage3HasSendableWork(rows: readonly Stage3SendRow[]): boolean {
  return rows.some((row) => !row.isLive);
}
