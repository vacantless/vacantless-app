// Pure domain model for the per-dispatch trade<->operator MESSAGE thread
// (Option B incident-dispatch, S329 — the "trade asks a question" reply). NO DB,
// env, or I/O here so it unit-tests cleanly via
// `npx tsx scripts/test-dispatch-messages.ts`. The impure pieces (the anon token
// RPC post_dispatch_question, the operator reply action, the /job + dashboard
// surfaces) live elsewhere and re-validate against THIS module — the body bound +
// the allowed-state predicate are mirrored in migration 0070 so both sides agree
// (feedback_anon_rpc_revalidate_server_side).
//
// What a message IS: one line of free text on a single dispatch, from the trade
// (asked from /job/[token]) or the operator (replied from the dashboard). Text
// only in v1 — no attachments, no money, no state change. A question is the
// trade's way to clarify scope/access BEFORE accepting instead of phoning
// off-platform; the operator answers in-app.

import { isTerminalDispatchStatus } from "./work-order-dispatch";

// --- Sender -----------------------------------------------------------------
// Mirrors the CHECK in 0070.
export const DISPATCH_MESSAGE_SENDERS = ["trade", "operator"] as const;
export type DispatchMessageSender = (typeof DISPATCH_MESSAGE_SENDERS)[number];

export function isDispatchMessageSender(value: unknown): value is DispatchMessageSender {
  return (
    typeof value === "string" &&
    (DISPATCH_MESSAGE_SENDERS as readonly string[]).includes(value)
  );
}

// One message row, as both surfaces read it (get_dispatch_context for the trade,
// an RLS select for the operator).
export type DispatchMessage = {
  id: string;
  sender: DispatchMessageSender;
  body: string;
  created_at: string;
};

// --- State predicate --------------------------------------------------------
// A question/reply is allowed only while the dispatch is still LIVE (non-terminal).
// Once it's completed / declined / cancelled the thread is read-only — history is
// preserved but nobody can add to a closed job. Mirrored verbatim in the RPC
// (post_dispatch_question) and re-checked on the operator reply action.
export function canPostDispatchMessage(status: string): boolean {
  return !isTerminalDispatchStatus(status);
}

// --- Validation -------------------------------------------------------------
// A message: required, non-blank after trim, under a sane ceiling. Mirrors the
// check in post_dispatch_question.
export const MAX_DISPATCH_MESSAGE_LEN = 2000;

export type DispatchMessageValidation =
  | { ok: true; value: string }
  | { ok: false; code: string };

export function validateDispatchMessage(
  body: string | null | undefined,
): DispatchMessageValidation {
  const v = (body ?? "").trim();
  if (v === "") return { ok: false, code: "empty" };
  if (v.length > MAX_DISPATCH_MESSAGE_LEN) return { ok: false, code: "too_long" };
  return { ok: true, value: v };
}

// --- View helpers -----------------------------------------------------------
// "You" vs the org name on the TRADE's job page (the trade reads their own posts
// as "You"; the operator's posts read as the org name).
export function tradeSenderLabel(
  sender: DispatchMessageSender,
  orgName: string | null | undefined,
): string {
  return sender === "trade" ? "You" : orgName?.trim() || "Owner";
}

// "You" vs the trade name on the OPERATOR's dashboard (mirror image).
export function operatorSenderLabel(
  sender: DispatchMessageSender,
  tradeName: string | null | undefined,
): string {
  return sender === "operator" ? "You" : tradeName?.trim() || "Trade";
}

// A short, token-friendly excerpt of a message body for a notification subject /
// preview (no "—"; collapses whitespace; ellipsizes). Empty in == empty out.
export const DISPATCH_MESSAGE_EXCERPT_LEN = 140;

export function messageExcerpt(
  body: string | null | undefined,
  max: number = DISPATCH_MESSAGE_EXCERPT_LEN,
): string {
  const v = (body ?? "").replace(/\s+/g, " ").trim();
  if (v.length <= max) return v;
  return v.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

// Count an unread-ish "needs a reply" hint for the operator dashboard: the thread
// is awaiting the operator iff the LAST message is from the trade. Pure read over
// an already-ordered (oldest-first) list.
export function awaitsOperatorReply(messages: readonly DispatchMessage[]): boolean {
  if (messages.length === 0) return false;
  return messages[messages.length - 1].sender === "trade";
}
