"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAmountToCents } from "@/lib/payments";
import { validateDispatchQuote } from "@/lib/work-order-dispatch";
import { canUseIncidentDispatch } from "@/lib/billing";
import { resolveIncidentNotifyEmails, type NotifyMember } from "@/lib/incident-reports";
import { sendOrgNotification } from "@/lib/notifications-server";
import { firstWord, tradeUpdateStatusLabel, tradeUpdateDetail } from "@/lib/notifications";
import { validateDispatchMessage, messageExcerpt } from "@/lib/dispatch-messages";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_OPERATOR_NOTIFY = 10;

// Shared: re-derive the org + work order + operator fallback list FROM THE TOKEN
// (which the RPC just validated), for any operator-facing dispatch notification
// fired from the account-less trade side. Runs under the SERVICE-ROLE admin client
// (the trade is anon). Returns null when anything's missing or the org isn't
// entitled — the caller then simply skips the notify (best-effort).
type DispatchOperatorContext = {
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  org: { id: string; name: string | null; brand_color: string | null; logo_url: string | null; reply_to_email: string | null };
  tradeName: string | null;
  jobTitle: string;
  propertyAddress: string;
  operatorFallback: string[];
};

async function loadDispatchOperatorContext(
  token: string,
): Promise<DispatchOperatorContext | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data: disp } = await admin
    .from("work_order_dispatches")
    .select("organization_id, work_order_id, trade_name_snapshot")
    .eq("trade_access_token", token)
    .maybeSingle();
  const d = disp as {
    organization_id: string;
    work_order_id: string;
    trade_name_snapshot: string | null;
  } | null;
  if (!d) return null;

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email, plan")
    .eq("id", d.organization_id)
    .maybeSingle();
  if (!org) return null;
  // Defensive: only an entitled org could have an active dispatch, but re-check.
  if (!canUseIncidentDispatch(org.plan)) return null;

  const { data: wo } = await admin
    .from("work_orders")
    .select("title, property:properties(address)")
    .eq("id", d.work_order_id)
    .maybeSingle();
  const w = wo as unknown as { title: string; property: { address: string } | null } | null;

  // Operator fallback = members with manage_work_orders, else org contacts.
  const { data: memberRows } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", d.organization_id);
  const members: NotifyMember[] = [];
  for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    members.push({ role: m.role, email: u?.user?.email ?? null });
  }
  const operatorFallback = resolveIncidentNotifyEmails(members, [
    org.reply_to_email,
    org.public_contact_email,
  ]).slice(0, MAX_OPERATOR_NOTIFY);

  return {
    admin,
    org: {
      id: org.id,
      name: org.name,
      brand_color: org.brand_color,
      logo_url: org.logo_url,
      reply_to_email: org.reply_to_email,
    },
    tradeName: d.trade_name_snapshot,
    jobTitle: w?.title ?? "a job",
    propertyAddress: w?.property?.address ?? "the property",
    operatorFallback,
  };
}

// Slice 6: tell the OPERATOR that the trade just acted (accepted / declined /
// quoted). Recipients + copy are operator-customizable (dispatch.trade_update in
// notification_settings); with no configured list it falls back to org members
// who can manage work orders. Best-effort: a mail failure never affects the action.
async function notifyOperatorsOfTradeUpdate(
  token: string,
  kind: "accepted" | "declined" | "quoted",
  detailOpts: { quoteCents?: number | null; note?: string | null; declineReason?: string | null },
): Promise<void> {
  try {
    const ctx = await loadDispatchOperatorContext(token);
    if (!ctx) return;
    await sendOrgNotification({
      client: ctx.admin,
      org: ctx.org,
      eventKey: "dispatch.trade_update",
      operatorFallback: ctx.operatorFallback,
      vars: {
        org_name: ctx.org.name ?? "Your team",
        property_address: ctx.propertyAddress,
        trade_name: ctx.tradeName ?? "The trade",
        job_title: ctx.jobTitle,
        status_label: tradeUpdateStatusLabel(kind),
        detail: tradeUpdateDetail(kind, detailOpts),
        dashboard_url: `${APP_URL}/dashboard/maintenance`,
      },
      action: { label: "Open in dashboard", url: `${APP_URL}/dashboard/maintenance` },
    });
  } catch {
    // best-effort
  }
}

// S329: tell the OPERATOR the trade asked a question (often before accepting).
// Same token-derived, service-role, operator-customizable path as the trade
// update; the question text rides as the {{question}} token. Best-effort.
async function notifyOperatorsOfQuestion(token: string, questionBody: string): Promise<void> {
  try {
    const ctx = await loadDispatchOperatorContext(token);
    if (!ctx) return;
    await sendOrgNotification({
      client: ctx.admin,
      org: ctx.org,
      eventKey: "dispatch.question.operator",
      operatorFallback: ctx.operatorFallback,
      vars: {
        org_name: ctx.org.name ?? "Your team",
        property_address: ctx.propertyAddress,
        trade_name: ctx.tradeName ?? "The trade",
        job_title: ctx.jobTitle,
        question: messageExcerpt(questionBody, 500),
        dashboard_url: `${APP_URL}/dashboard/maintenance`,
      },
      action: { label: "Reply in dashboard", url: `${APP_URL}/dashboard/maintenance` },
    });
  } catch {
    // best-effort
  }
}

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
  await notifyOperatorsOfTradeUpdate(token, "accepted", {});
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
  await notifyOperatorsOfTradeUpdate(token, "declined", { declineReason: input.reason ?? null });
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
  await notifyOperatorsOfTradeUpdate(token, "quoted", {
    quoteCents: check.value.quoteCents,
    note: check.value.note,
  });
  return { ok: true };
}

// S329: the trade posts a question/message on the job (the "ask before accepting"
// back-channel). Text only, no state change, no money. The RPC re-derives the
// dispatch from the token and re-checks not-expired + a live (non-terminal)
// dispatch + the body bound server-side (feedback_anon_rpc_revalidate_server_side);
// we validate in TS too for fast feedback. On success the operator is notified.
export async function postDispatchQuestion(input: {
  token: string;
  body: string;
}): Promise<DispatchActionResult> {
  const token = (input.token ?? "").trim();
  if (!token) return { ok: false, reason: "not_found" };

  const check = validateDispatchMessage(input.body);
  if (!check.ok) return { ok: false, reason: check.code };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("post_dispatch_question", {
    p_token: token,
    p_body: check.value,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) return { ok: false, reason: result?.reason ?? "failed" };
  await notifyOperatorsOfQuestion(token, check.value);
  return { ok: true };
}
