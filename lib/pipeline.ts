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
