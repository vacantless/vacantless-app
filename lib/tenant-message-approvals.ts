// Pure domain model for the APPROVAL-GATED tenant message queue (S341 — the
// second send-mode tier, "approve_to_send"). A compliance-triggered drip step
// (today: the rent-increase courtesy note from app/api/cron/rent-increase)
// DRAFTS a tenant message into pending_tenant_messages (0075); a human operator
// then reviews/edits and Approves & Sends it. NO DB / env / I/O here so it
// unit-tests cleanly via `npx tsx scripts/test-tenant-message-approvals.ts`. The
// impure pieces (insert on enqueue, send on approve) live in the cron route +
// app/dashboard/messages/actions.ts and use THIS module to decide + validate.
//
// The guarantee this enforces: a tenant message is never sent from a trigger.
// The queue row is the human-in-the-loop checkpoint — canApprove gates the send,
// validateTenantMessageEdit bounds an operator edit, and the status machine
// (pending -> sent | dismissed) is one-way so a sent/dismissed row can't re-fire.

import { isValidEmail } from "./notifications";

export type PendingMessageStatus = "pending" | "sent" | "dismissed";

// The queue row as the pure layer sees it (a subset of the 0075 columns the
// decisions need — callers pass the already-fetched pieces).
export type PendingTenantMessageRow = {
  status: PendingMessageStatus;
  tenant_email: string | null;
  subject: string;
  body: string;
};

// Bounds for an operator edit of a queued draft. Generous — these are full
// emails, not the 2000-char dispatch one-liner — but capped so a paste accident
// can't store a megabyte. Subject stays one line.
export const MAX_TENANT_MESSAGE_SUBJECT_LEN = 200;
export const MAX_TENANT_MESSAGE_BODY_LEN = 8000;

export type TenantMessageEditInput = {
  subject: string | null | undefined;
  body: string | null | undefined;
};

export type TenantMessageEditValidation =
  | { ok: true; value: { subject: string; body: string } }
  | { ok: false; code: "empty_subject" | "empty_body" | "subject_too_long" | "body_too_long" };

/**
 * Validate + normalize an operator's edit of a queued draft before it's stored.
 * Trims, rejects blank subject/body, and caps length. Pure.
 */
export function validateTenantMessageEdit(
  input: TenantMessageEditInput,
): TenantMessageEditValidation {
  const subject = (input.subject ?? "").trim();
  const body = (input.body ?? "").trim();
  if (subject === "") return { ok: false, code: "empty_subject" };
  if (body === "") return { ok: false, code: "empty_body" };
  if (subject.length > MAX_TENANT_MESSAGE_SUBJECT_LEN) {
    return { ok: false, code: "subject_too_long" };
  }
  if (body.length > MAX_TENANT_MESSAGE_BODY_LEN) {
    return { ok: false, code: "body_too_long" };
  }
  return { ok: true, value: { subject, body } };
}

/**
 * Can this queued draft be Approved & Sent? Only a PENDING row with a valid
 * tenant address and non-blank stored copy. (A sent/dismissed row is terminal;
 * a row with no/invalid tenant email has nowhere to go.)
 */
export function canApproveTenantMessage(row: PendingTenantMessageRow): boolean {
  if (row.status !== "pending") return false;
  if (!row.tenant_email || !isValidEmail(row.tenant_email)) return false;
  if (row.subject.trim() === "" || row.body.trim() === "") return false;
  return true;
}

/** Can this queued draft be Dismissed? Any pending row (no address needed). */
export function canDismissTenantMessage(row: PendingTenantMessageRow): boolean {
  return row.status === "pending";
}

/**
 * The idempotency key for a drip draft so the 15-min cron re-pinging the same
 * window drafts AT MOST ONE row per (tenancy, event, cycle). For the rent-
 * increase note the stable anchor is the earliest-effective anniversary date
 * (the SAME value leasing.rent_increase stamps as rent_increase_nudged_for), so
 * the tenant draft and the landlord nudge advance together each cycle.
 */
export function tenantNoticeDedupeKey(
  eventKey: string,
  tenancyId: string,
  cycleAnchorDate: string,
): string {
  return `${eventKey}:${tenancyId}:${cycleAnchorDate}`;
}
