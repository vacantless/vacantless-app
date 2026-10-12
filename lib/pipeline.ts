export const PIPELINE_STAGES = [
  "new",
  "replied",
  "contacted",
  "booked",
  "showed",
  "applied",
  "leased",
  "lost",
] as const;

export type LeadStatus = (typeof PIPELINE_STAGES)[number];

const LABELS: Record<LeadStatus, string> = {
  new: "New",
  replied: "Replied",
  contacted: "Contacted",
  booked: "Booked",
  showed: "Showed",
  applied: "Applied",
  leased: "Leased",
  lost: "Lost",
};

export function statusLabel(status: string): string {
  return (LABELS as Record<string, string>)[status] ?? status;
}

// One-line meaning for each stage. The "Replied" vs "Contacted" pair looked
// interchangeable in the QA review, so the wording here draws the line: Replied
// = a first/auto response went out, Contacted = you've actually connected.
const DESCRIPTIONS: Record<LeadStatus, string> = {
  new: "Just inquired. No response yet.",
  replied: "A first or automatic response has gone out.",
  contacted: "You've actually connected (call, text, or back-and-forth email).",
  booked: "Has a viewing booked.",
  showed: "Attended their viewing.",
  applied: "Submitted a rental application.",
  leased: "Signed a lease.",
  lost: "Not moving forward.",
};

export function statusDescription(status: string): string {
  return (DESCRIPTIONS as Record<string, string>)[status] ?? "";
}

export function isLeadStatus(value: string): value is LeadStatus {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

/**
 * A lead "needs a reply" when it's brand new — it has inquired but nobody has
 * responded yet. Once any response goes out (Replied) or further, it no longer
 * needs the operator's first touch. Drives the dashboard "Needs reply" cue.
 */
export function needsReply(status: string): boolean {
  return status === "new";
}

/**
 * S708: the Today card counts only RECENT leads that still need a reply. A
 * `new` lead from months ago is not someone waiting to hear back today (Agile
 * showed "105 inquiries need a reply" when only 5 were from the last 14 days).
 * Older `new` leads stay in the Renters list under Needs reply; no status changes.
 */
export const TODAY_REPLY_WINDOW_DAYS = 14;

export function needsReplyToday(
  status: string,
  createdAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (!needsReply(status) || !createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t <= TODAY_REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Task segments (ESL Slice 6): the 8 granular pipeline stages grouped into a
 * few plain "what do I do next" buckets for the primary Renters filter. The raw
 * per-stage chips stay available behind an "All stages" toggle. Every stage is
 * covered by exactly one segment, so segment counts sum to the stage counts.
 */
export const PIPELINE_SEGMENTS = [
  { key: "needs_reply", label: "Needs reply", stages: ["new"] },
  { key: "in_conversation", label: "In conversation", stages: ["replied", "contacted"] },
  { key: "viewing", label: "Viewing", stages: ["booked", "showed"] },
  { key: "deciding", label: "Deciding", stages: ["applied"] },
  { key: "closed", label: "Closed", stages: ["leased", "lost"] },
] as const satisfies readonly {
  key: string;
  label: string;
  stages: readonly LeadStatus[];
}[];

export type PipelineSegmentKey = (typeof PIPELINE_SEGMENTS)[number]["key"];

export function isPipelineSegment(value: string): value is PipelineSegmentKey {
  return PIPELINE_SEGMENTS.some((seg) => seg.key === value);
}

export function stagesForSegment(key: string): readonly LeadStatus[] {
  return PIPELINE_SEGMENTS.find((seg) => seg.key === key)?.stages ?? [];
}

export const SHOWING_OUTCOMES = [
  "scheduled",
  "attended",
  "no_show",
  "cancelled",
  // S546: terminal state written by the auto-close default when a showing
  // passed and no operator/renter ever recorded a real outcome. Distinct from
  // attended/no_show — it never claims the renter did or did not show, so it
  // stays out of the attendance-rate math.
  "auto_closed",
] as const;

export type ShowingOutcome = (typeof SHOWING_OUTCOMES)[number];

const OUTCOME_LABELS: Record<ShowingOutcome, string> = {
  scheduled: "Scheduled",
  attended: "Attended",
  no_show: "No-show",
  cancelled: "Cancelled",
  auto_closed: "Auto-closed (no outcome recorded)",
};

export function showingOutcomeLabel(outcome: string): string {
  return (OUTCOME_LABELS as Record<string, string>)[outcome] ?? outcome;
}

export function isShowingOutcome(value: string): value is ShowingOutcome {
  return (SHOWING_OUTCOMES as readonly string[]).includes(value);
}

// Property/listing status now lives in lib/listing-state.ts (the richer
// Draft/Live/Paused/Leased model added in block 2). Re-exported here so the
// long-standing `@/lib/pipeline` import sites keep working unchanged.
export {
  PROPERTY_STATUSES,
  type PropertyStatus,
  propertyStatusLabel,
} from "./listing-state";
