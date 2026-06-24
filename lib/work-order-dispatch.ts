// Pure domain model for in-app TRADE dispatch (Option B incident-dispatch,
// Slice 5 — the guardrail amendment). NO DB, env, or I/O here so it unit-tests
// cleanly via `npx tsx scripts/test-work-order-dispatch.ts`. The impure pieces
// (token RPCs, the operator actions, the trade /job surface) live elsewhere and
// re-validate against THIS module — the dispatch_status set + quote rules are
// mirrored verbatim in migration 0065 so both sides agree
// (feedback_anon_rpc_revalidate_server_side).
//
// What a dispatch IS: the operator offers one work order to one of their own
// trades; the trade accepts/declines, then quotes (a recorded NUMBER, never a
// charge) and may propose a date; the operator approves the quote BY confirming
// a date (quoted -> scheduled in one step), then marks it complete. The owner
// pays the trade DIRECTLY, off-platform — Vacantless never moves money.

import { randomBytes } from "crypto";
import { formatMoneyCents } from "./payments";
import { formatExpectedDate } from "./work-orders";

// --- Status set -------------------------------------------------------------
// Mirrors the CHECK in 0065. CHECK (not a pg enum) so a new state is a one-line
// change on both sides.
export const DISPATCH_STATUSES = [
  "offered",
  "accepted",
  "quoted",
  "scheduled",
  "completed",
  "declined",
  "cancelled",
] as const;

export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export function isDispatchStatus(value: unknown): value is DispatchStatus {
  return (
    typeof value === "string" &&
    (DISPATCH_STATUSES as readonly string[]).includes(value)
  );
}

// The states where a dispatch is still "live" — exactly the predicate of the
// partial-unique index in 0065 (at most one active dispatch per work order).
export const ACTIVE_DISPATCH_STATUSES: readonly DispatchStatus[] = [
  "offered",
  "accepted",
  "quoted",
  "scheduled",
];

export function isActiveDispatchStatus(status: string): boolean {
  return (ACTIVE_DISPATCH_STATUSES as readonly string[]).includes(status);
}

export function isTerminalDispatchStatus(status: string): boolean {
  return status === "completed" || status === "declined" || status === "cancelled";
}

const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  offered: "Offered",
  accepted: "Accepted",
  quoted: "Quote submitted",
  scheduled: "Scheduled",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
};

export function dispatchStatusLabel(status: string): string {
  return DISPATCH_STATUS_LABELS[status as DispatchStatus] ?? status;
}

export type DispatchTone = "gray" | "blue" | "amber" | "green" | "red";

export function dispatchStatusTone(status: string): DispatchTone {
  switch (status) {
    case "offered":
      return "blue";
    case "accepted":
      return "blue";
    case "quoted":
      return "amber";
    case "scheduled":
      return "blue";
    case "completed":
      return "green";
    case "declined":
    case "cancelled":
      return "red";
    default:
      return "gray";
  }
}

// --- Transition predicates --------------------------------------------------
// The single source of truth for "what's allowed from here". The token RPCs
// (trade side) and the guarded operator UPDATEs both gate on these.

// Trade side (via /job/[token]):
export function canAccept(status: string): boolean {
  return status === "offered";
}
export function canDecline(status: string): boolean {
  return status === "offered";
}
// quote may be submitted after accepting, and REVISED while still quoted.
export function canQuote(status: string): boolean {
  return status === "accepted" || status === "quoted";
}

// Operator side (authenticated, RLS-scoped guarded UPDATEs):
// approve a quote AND lock a date in one step (minimal-clicks).
export function canApproveSchedule(status: string): boolean {
  return status === "quoted";
}
export function canComplete(status: string): boolean {
  return status === "scheduled";
}
// the operator can pull a dispatch back any time before it's terminal.
export function canCancel(status: string): boolean {
  return isActiveDispatchStatus(status);
}

// What the TRADE can do right now, given the status — drives the /job page UI.
export type TradeAction = "accept" | "decline" | "quote" | "revise_quote";

export function tradeActionsFor(status: string): TradeAction[] {
  if (status === "offered") return ["accept", "decline"];
  if (status === "accepted") return ["quote"];
  if (status === "quoted") return ["revise_quote"];
  return [];
}

// --- Token ------------------------------------------------------------------
// Single-job magic-link credential — same shape as the lease-signing /
// report-link tokens (192 bits, url-safe). One per dispatch row.
export function generateDispatchToken(): string {
  return randomBytes(24).toString("base64url");
}

// A dispatch link is single-job and should not live forever. 60 days is generous
// for a trade to act while bounding a leaked link's exposure window.
export const DISPATCH_TOKEN_TTL_DAYS = 60;

export function dispatchTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + DISPATCH_TOKEN_TTL_DAYS * 86_400_000);
}

export function isDispatchTokenExpired(
  expiresAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true;
  const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (isNaN(d.getTime())) return true;
  return d.getTime() <= now.getTime();
}

// --- Validation -------------------------------------------------------------

// A quote, in cents. Required, non-negative, under a fat-finger ceiling. The
// note is optional + bounded. A proposed date, if given, must be a valid date.
// Mirrors the checks in submit_dispatch_quote (0065).
export const MAX_QUOTE_CENTS = 1_000_000_000; // $10,000,000 ceiling
export const MAX_QUOTE_NOTE_LEN = 2000;

export type DispatchQuoteInput = {
  quoteCents: number | null;
  note?: string | null;
  proposedDate?: string | null; // "YYYY-MM-DD" or ""
};

export type DispatchQuoteValidation =
  | {
      ok: true;
      value: { quoteCents: number; note: string | null; proposedDate: string | null };
    }
  | { ok: false; code: string };

export function validateDispatchQuote(
  input: DispatchQuoteInput,
): DispatchQuoteValidation {
  const cents = input.quoteCents;
  if (cents == null || !Number.isFinite(cents) || cents < 0 || cents > MAX_QUOTE_CENTS) {
    return { ok: false, code: "bad_quote" };
  }
  const quoteCents = Math.round(cents);

  const note = (input.note ?? "").trim();
  if (note.length > MAX_QUOTE_NOTE_LEN) return { ok: false, code: "note_too_long" };

  const rawDate = (input.proposedDate ?? "").trim();
  let proposedDate: string | null = null;
  if (rawDate !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || isNaN(new Date(rawDate).getTime())) {
      return { ok: false, code: "bad_date" };
    }
    proposedDate = rawDate;
  }

  return {
    ok: true,
    value: { quoteCents, note: note === "" ? null : note, proposedDate },
  };
}

// The operator approves a quote BY confirming the agreed date. Date required +
// valid. Used by the approveDispatchSchedule action.
export type ScheduleConfirmInput = { scheduledFor: string | null };

export type ScheduleConfirmValidation =
  | { ok: true; value: { scheduledFor: string } }
  | { ok: false; code: string };

export function validateScheduleConfirmation(
  input: ScheduleConfirmInput,
): ScheduleConfirmValidation {
  const raw = (input.scheduledFor ?? "").trim();
  if (raw === "") return { ok: false, code: "schedule_required" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || isNaN(new Date(raw).getTime())) {
    return { ok: false, code: "bad_date" };
  }
  return { ok: true, value: { scheduledFor: raw } };
}

// Bound the operator's dispatch note at creation.
export const MAX_OPERATOR_NOTE_LEN = 2000;

export function normalizeOperatorNote(note: string | null | undefined): string | null {
  const v = (note ?? "").trim();
  if (v === "") return null;
  return v.length > MAX_OPERATOR_NOTE_LEN ? v.slice(0, MAX_OPERATOR_NOTE_LEN) : v;
}

// --- Formatting / view helpers ----------------------------------------------

// Quote display — reuses the ledger money formatter ("$1,250.00"); "—" for null.
export function formatDispatchQuote(cents: number | null | undefined): string {
  return formatMoneyCents(cents);
}

// Date display — reuses the tz-safe work-order date formatter so a dispatch date
// reads the same as a work-order date everywhere.
export function formatDispatchDate(d: string | null | undefined): string {
  return formatExpectedDate(d);
}

// A short, human status line for the trade's job page given the current state.
export function tradeStatusHeadline(status: string): string {
  switch (status) {
    case "offered":
      return "You've been offered this job.";
    case "accepted":
      return "You accepted — send your quote.";
    case "quoted":
      return "Quote sent. Waiting on the owner to confirm.";
    case "scheduled":
      return "You're booked. See the scheduled date below.";
    case "completed":
      return "This job is marked complete.";
    case "declined":
      return "You declined this job.";
    case "cancelled":
      return "This job was cancelled.";
    default:
      return "";
  }
}

// --- Trade-link path builders (pure strings) --------------------------------
export function tradeJobPath(token: string): string {
  return `/job/${encodeURIComponent(token)}`;
}

export function tradeJobUrl(baseUrl: string, token: string): string {
  const base = (baseUrl ?? "").replace(/\/+$/, "");
  return `${base}${tradeJobPath(token)}`;
}

// --- Operator-facing error messages -----------------------------------------
// Maps an action redirect code to a sentence for the maintenance page banner.
export function dispatchErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case undefined:
    case "":
      return null;
    case "forbidden":
      return "You don't have permission to dispatch work.";
    case "locked":
      return "In-app trade dispatch is a Premium feature.";
    case "terms_required":
      return "Enable trade dispatch (review and accept the one-time terms) before sending a job.";
    case "notfound":
      return "That work order or trade could not be found.";
    case "no_email":
      return "That trade has no email on file — add one to dispatch the job to them.";
    case "active_exists":
      return "This work order already has an active dispatch.";
    case "bad_quote":
      return "Enter a valid quote amount.";
    case "schedule_required":
      return "Pick a date to confirm the schedule.";
    case "bad_date":
      return "That date isn't valid.";
    case "wrong_state":
      return "That action no longer applies to this dispatch.";
    case "dispatched":
      return "Job dispatched to the trade.";
    case "approved":
      return "Quote approved and scheduled.";
    case "cancelled":
      return "Dispatch cancelled.";
    case "completed":
      return "Dispatch marked complete.";
    default:
      return null;
  }
}

// The trade-side equivalent — maps an action result reason to a sentence for the
// /job page.
export function tradeDispatchErrorMessage(reason: string | undefined): string {
  switch (reason) {
    case "not_found":
      return "This job link is no longer valid.";
    case "expired":
      return "This job link has expired. Please contact the owner.";
    case "wrong_state":
      return "This job has already moved on — refresh to see its current status.";
    case "terms_required":
      return "Please agree to the Vacantless Trade Terms to accept this job.";
    case "bad_quote":
      return "Enter a valid quote amount.";
    case "note_too_long":
      return "That note is too long.";
    case "bad_date":
      return "That date isn't valid.";
    default:
      return "Something went wrong. Please try again.";
  }
}
