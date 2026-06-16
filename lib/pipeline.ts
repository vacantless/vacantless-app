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

export function isLeadStatus(value: string): value is LeadStatus {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

export const SHOWING_OUTCOMES = [
  "scheduled",
  "attended",
  "no_show",
  "cancelled",
] as const;

export type ShowingOutcome = (typeof SHOWING_OUTCOMES)[number];

const OUTCOME_LABELS: Record<ShowingOutcome, string> = {
  scheduled: "Scheduled",
  attended: "Attended",
  no_show: "No-show",
  cancelled: "Cancelled",
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
