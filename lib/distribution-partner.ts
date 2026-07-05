// ============================================================================
// Pure helpers for feed-partner onboarding (S412 Slice 3). No DOM / env / IO —
// unit-tested (scripts/test-distribution-partner.ts).
//
// An org can be at various stages of getting a channel to accept its listing
// feed. This owns the status vocabulary + labels/tone + the one-line "next step"
// the Distribute cards show. The durable record is distribution_partner_accounts
// (migration 0106).
// ============================================================================

export const PARTNER_STATUSES = [
  "not_started",
  "submitted",
  "accepted",
  "rejected",
  "paused",
] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  not_started: "Not started",
  submitted: "Submitted",
  accepted: "Accepted",
  rejected: "Rejected",
  paused: "Paused",
};

export function partnerStatusLabel(value: unknown): string {
  return isPartnerStatus(value)
    ? PARTNER_STATUS_LABELS[value]
    : "Not started";
}

export function isPartnerStatus(value: unknown): value is PartnerStatus {
  return (
    typeof value === "string" &&
    (PARTNER_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizePartnerStatus(raw: unknown): PartnerStatus {
  return isPartnerStatus(raw) ? raw : "not_started";
}

export type PartnerTone = "positive" | "warning" | "danger" | "neutral";
const PARTNER_STATUS_TONES: Record<PartnerStatus, PartnerTone> = {
  not_started: "neutral",
  submitted: "warning",
  accepted: "positive",
  rejected: "danger",
  paused: "neutral",
};
export function partnerStatusTone(value: unknown): PartnerTone {
  return isPartnerStatus(value) ? PARTNER_STATUS_TONES[value] : "neutral";
}

// True only when the feed route is live (partner accepted). Drives whether the
// channel card can honestly say the listing is being SYNDICATED vs merely
// feed-ready.
export function isPartnerActive(value: unknown): boolean {
  return isPartnerStatus(value) && value === "accepted";
}

// The one-line next step an operator should take, given the partner status +
// whether they've recorded a feed URL yet. Kept pure so the card never invents
// its own wording.
export function partnerNextStep(opts: {
  status: PartnerStatus;
  hasFeedUrl: boolean;
}): string {
  switch (opts.status) {
    case "not_started":
      return "Ask this channel whether it can ingest your listing feed, then record where it stands here.";
    case "submitted":
      return opts.hasFeedUrl
        ? "Feed submitted - waiting on the channel to accept it. Check back and update the status."
        : "Marked submitted, but no feed URL is recorded yet - add the feed URL you sent them.";
    case "accepted":
      return "Accepted - this channel is carrying your feed. Keep the feed URL and contact on file.";
    case "rejected":
      return "Rejected - note the reason in the notes, fix it, and resubmit.";
    case "paused":
      return "Paused - resume when you're ready to have this channel carry the feed again.";
    default:
      return "Record where this channel's feed route stands.";
  }
}
