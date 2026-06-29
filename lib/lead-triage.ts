// lead-triage.ts — Inquiries triage queue (Codex design audit #4, S377).
//
// The Inquiries page was a flat chronological table: every lead read with the
// same weight, so the operator had to scan to find what needed action. Codex's
// audit asked for a triage QUEUE. This pure helper classifies a lead into one
// of three buckets and gives it an urgency rank, so the page can group + order
// the list "most-actionable first" without any new data.
//
// Pure (status + follow-up + flag in, classification out) so it's unit-testable
// and the queue order can't drift from the chips/counts on the same page.

import type { LeadStatus } from "./pipeline";
import type { FollowUpStatus } from "./lead-detail";

export type TriageBucket = "needs_you" | "in_progress" | "closed";

export type LeadTriage = {
  bucket: TriageBucket;
  /** Lower = more urgent. Sort the whole list by this, then by recency. */
  rank: number;
  /** Short why-it's-here label for "needs you now" rows; null otherwise. */
  reason: string | null;
};

export type TriageInput = {
  status: LeadStatus;
  followUp: FollowUpStatus;
  qualifiedOut: boolean;
};

// Bucket bases keep the three groups contiguous when sorting the flat list.
const BASE: Record<TriageBucket, number> = {
  needs_you: 0,
  in_progress: 100,
  closed: 200,
};

// "Working" sub-order: the further down the funnel, the hotter — surface
// applied/showed above a bare reply.
const IN_PROGRESS_SUBRANK: Partial<Record<LeadStatus, number>> = {
  applied: 0,
  showed: 1,
  booked: 2,
  contacted: 3,
  replied: 4,
};

export function triageLead(input: TriageInput): LeadTriage {
  const { status, followUp } = input;

  // Terminal stages are closed regardless of any stale follow-up date.
  if (status === "leased" || status === "lost") {
    return {
      bucket: "closed",
      rank: BASE.closed + (status === "leased" ? 0 : 1),
      reason: null,
    };
  }

  // Needs-you-now, most urgent first: a brand-new inquiry owed a first reply,
  // then a follow-up you promised that's overdue, then one due today.
  if (status === "new") {
    return { bucket: "needs_you", rank: BASE.needs_you + 0, reason: "Needs a reply" };
  }
  if (followUp === "overdue") {
    return { bucket: "needs_you", rank: BASE.needs_you + 1, reason: "Follow-up overdue" };
  }
  if (followUp === "today") {
    return { bucket: "needs_you", rank: BASE.needs_you + 2, reason: "Follow-up due today" };
  }

  // Everything else open is "working" — no action pressing right now.
  return {
    bucket: "in_progress",
    rank: BASE.in_progress + (IN_PROGRESS_SUBRANK[status] ?? 9),
    reason: null,
  };
}

export const TRIAGE_BUCKET_LABEL: Record<TriageBucket, string> = {
  needs_you: "Needs you now",
  in_progress: "Working",
  closed: "Closed",
};

// Stable display order of the buckets.
export const TRIAGE_BUCKET_ORDER: TriageBucket[] = [
  "needs_you",
  "in_progress",
  "closed",
];
