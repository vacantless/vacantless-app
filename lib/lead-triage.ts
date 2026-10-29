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

import { needsReplyToday, type LeadStatus } from "./pipeline";
import type { FollowUpStatus } from "./lead-detail";

export type TriageBucket = "needs_you" | "in_progress" | "gone_quiet" | "closed";

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
  /** S710: when set with nowMs, a "new" lead older than the Today reply
   *  window goes to Gone quiet instead of Needs you now. */
  createdAt?: string | null;
  nowMs?: number;
  /** S740: an auto-reply or any outbound email or text already went out. */
  answered?: boolean;
};

// Bucket bases keep the three groups contiguous when sorting the flat list.
const BASE: Record<TriageBucket, number> = {
  needs_you: 0,
  in_progress: 100,
  gone_quiet: 150,
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
    // S710 audit: Agile's list said 107 needed you while Today said 5. A
    // renter who wrote more than TODAY_REPLY_WINDOW_DAYS ago and never got a
    // reply is not waiting on you today; group them apart, same window as
    // the Today card (lib/pipeline needsReplyToday).
    if (
      input.createdAt != null &&
      input.nowMs != null &&
      !needsReplyToday(status, input.createdAt, input.nowMs)
    ) {
      return { bucket: "gone_quiet", rank: BASE.gone_quiet, reason: null };
    }
    // S740: answered automatically (auto-reply or nurture email sent), so the
    // renter is not waiting on the landlord; they have the booking link.
    if (input.answered) {
      return { bucket: "in_progress", rank: BASE.in_progress + 5, reason: null };
    }
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
  gone_quiet: "Gone quiet: asked over two weeks ago, never booked",
  closed: "Closed",
};

// Stable display order of the buckets.
export const TRIAGE_BUCKET_ORDER: TriageBucket[] = [
  "needs_you",
  "in_progress",
  "gone_quiet",
  "closed",
];
