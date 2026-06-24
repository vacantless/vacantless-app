"use server";

import { createClient } from "@/lib/supabase/server";
import { parseAmountToCents } from "@/lib/payments";
import { validateDispatchQuote } from "@/lib/work-order-dispatch";

// Public, UNAUTHENTICATED trade dispatch actions (Option B Slice 5 — the
// guardrail amendment). The trade has no account; the dispatch's
// `trade_access_token` is their only handle. Every action calls a SECURITY
// DEFINER RPC that RE-DERIVES the dispatch / org / work order from the token and
// re-checks the state machine + not-expired server-side
// (feedback_anon_rpc_revalidate_server_side). We validate in TS too (fast
// feedback) but the RPC is the source of truth. No money ever moves — a quote is
// a recorded number; the owner pays the trade directly, off-platform.

export type DispatchActionResult = { ok: true } | { ok: false; reason: string };

export async function acceptDispatch(input: {
  token: string;
  termsAccepted: boolean;
}): Promise<DispatchActionResult> {
  const token = (input.token ?? "").trim();
  if (!token) return { ok: false, reason: "not_found" };
  // Slice 0 Block A: the trade must agree to the Vacantless Trade Terms. The UI
  // gates the button on the checkbox; the RPC re-checks (terms_required).
  if (!input.termsAccepted) return { ok: false, reason: "terms_required" };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("accept_dispatch", {
    p_token: token,
    p_terms_accepted: true,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) return { ok: false, reason: result?.reason ?? "failed" };
  return { ok: true };
}

export async function declineDispatch(input: {
  token: string;
  reason?: string | null;
}): Promise<DispatchActionResult> {
  const token = (input.token ?? "").trim();
  if (!token) return { ok: false, reason: "not_found" };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("decline_dispatch", {
    p_token: token,
    p_reason: input.reason ?? null,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) return { ok: false, reason: result?.reason ?? "failed" };
  return { ok: true };
}

export async function submitDispatchQuote(input: {
  token: string;
  quote: string; // raw amount, e.g. "250" or "250.00"
  note?: string | null;
  proposedDate?: string | null;
}): Promise<DispatchActionResult> {
  const token = (input.token ?? "").trim();
  if (!token) return { ok: false, reason: "not_found" };

  // Fast local validation (the RPC re-checks). parseAmountToCents accepts "$",
  // commas, decimals.
  const check = validateDispatchQuote({
    quoteCents: parseAmountToCents(input.quote),
    note: input.note ?? null,
    proposedDate: input.proposedDate ?? null,
  });
  if (!check.ok) return { ok: false, reason: check.code };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("submit_dispatch_quote", {
    p_token: token,
    p_quote_cents: check.value.quoteCents,
    p_note: check.value.note,
    p_proposed_date: check.value.proposedDate,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) return { ok: false, reason: result?.reason ?? "failed" };
  return { ok: true };
}
