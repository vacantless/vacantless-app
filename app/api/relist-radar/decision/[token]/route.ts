import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  relistRadarDecisionForAction,
  relistRadarDecisionTokenSecret,
  verifyRelistRadarDecisionToken,
  type RelistRadarDecisionAction,
} from "@/lib/relist-radar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DecisionTokenRow = {
  id: string;
  organization_id: string;
  event_id: string;
  run_item_id: string;
  cycle_date: string;
  channel: string;
  action: string;
  expires_at: string;
  used_at: string | null;
};

type RadarEventRow = {
  id: string;
  organization_id: string;
  run_item_id: string;
  cycle_date: string;
  channel: string;
  decision: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlResponse({
  title,
  body,
  status = 200,
}: {
  title: string;
  body: string;
  status?: number;
}): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
      title,
    )}</title></head><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;"><main style="max-width:520px;margin:48px auto;background:white;border:1px solid #e4e4e7;border-radius:12px;padding:28px;"><h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;">${escapeHtml(
      title,
    )}</h1><p style="margin:0;font-size:16px;line-height:1.5;color:#3f3f46;">${escapeHtml(
      body,
    )}</p></main></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

function sameDate(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

function tokenMatchesPayload(
  row: DecisionTokenRow,
  payload: {
    run_item_id: string;
    portal: string;
    action: RelistRadarDecisionAction;
    cycle_date: string;
  },
): boolean {
  return (
    row.run_item_id === payload.run_item_id &&
    row.channel === payload.portal &&
    row.action === payload.action &&
    sameDate(row.cycle_date, payload.cycle_date)
  );
}

function eventMatchesPayload(
  row: RadarEventRow,
  payload: {
    run_item_id: string;
    portal: string;
    cycle_date: string;
  },
): boolean {
  return (
    row.run_item_id === payload.run_item_id &&
    row.channel === payload.portal &&
    sameDate(row.cycle_date, payload.cycle_date)
  );
}

function actionAllowed(
  action: RelistRadarDecisionAction,
  currentDecision: string | null,
): boolean {
  if (action === "consent") {
    return currentDecision == null || currentDecision === "no_response";
  }
  if (action === "keep_live" || action === "let_expire") {
    return currentDecision == null || currentDecision === "skipped";
  }
  return currentDecision == null;
}

function decisionCopy(action: RelistRadarDecisionAction): string {
  switch (action) {
    case "skip":
      return "Skipped this refresh.";
    case "consent":
      return "Paid refresh consent recorded. No charge or repost was made from this link.";
    case "keep_live":
      return "Keep-live intent recorded. No repost was made from this link.";
    case "let_expire":
      return "Let-expire intent recorded. No portal action was made from this link.";
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const secret = relistRadarDecisionTokenSecret();
  const verified = verifyRelistRadarDecisionToken(params.token, secret);
  if (!verified.ok) {
    return htmlResponse({
      title: "Link rejected",
      body: "This Keep live link is invalid or expired.",
      status: 400,
    });
  }

  const admin = createAdminClient();
  if (!admin) {
    return htmlResponse({
      title: "Link unavailable",
      body: "The secure decision recorder is not configured right now.",
      status: 503,
    });
  }

  const { data: tokenRow, error: tokenErr } = await admin
    .from("relist_radar_decision_tokens")
    .select(
      "id, organization_id, event_id, run_item_id, cycle_date, channel, action, expires_at, used_at",
    )
    .eq("token_hash", verified.tokenHash)
    .maybeSingle();
  if (tokenErr) {
    return htmlResponse({
      title: "Link unavailable",
      body: "We could not check this Keep live link. Please open Distribute instead.",
      status: 503,
    });
  }
  const token = (tokenRow as DecisionTokenRow | null) ?? null;
  if (!token || !tokenMatchesPayload(token, verified.payload)) {
    return htmlResponse({
      title: "Link rejected",
      body: "This Keep live link is not recognized.",
      status: 400,
    });
  }
  if (token.used_at) {
    return htmlResponse({
      title: "Already used",
      body: "This Keep live link was already used.",
      status: 409,
    });
  }
  if (Date.parse(token.expires_at) < Date.now()) {
    return htmlResponse({
      title: "Link expired",
      body: "This Keep live link has expired.",
      status: 410,
    });
  }

  const { data: eventRow, error: eventErr } = await admin
    .from("relist_radar_events")
    .select("id, organization_id, run_item_id, cycle_date, channel, decision")
    .eq("id", token.event_id)
    .maybeSingle();
  if (eventErr) {
    return htmlResponse({
      title: "Link unavailable",
      body: "We could not load this Keep live cycle. Please open Distribute instead.",
      status: 503,
    });
  }
  const event = (eventRow as RadarEventRow | null) ?? null;
  if (!event || !eventMatchesPayload(event, verified.payload)) {
    return htmlResponse({
      title: "Link rejected",
      body: "This Keep live link does not match an active cycle.",
      status: 400,
    });
  }
  if (!actionAllowed(verified.payload.action, event.decision)) {
    return htmlResponse({
      title: "Already recorded",
      body: "A decision is already recorded for this Keep live cycle.",
      status: 409,
    });
  }

  const nowISO = new Date().toISOString();
  const { data: burned, error: burnErr } = await admin
    .from("relist_radar_decision_tokens")
    .update({ used_at: nowISO })
    .eq("id", token.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (burnErr || !burned) {
    return htmlResponse({
      title: "Already used",
      body: "This Keep live link was already used.",
      status: 409,
    });
  }

  const decision = relistRadarDecisionForAction(verified.payload.action);
  let updateQuery = admin
    .from("relist_radar_events")
    .update({
      decision,
      decided_at: nowISO,
      decided_via: "relist_radar_email",
    })
    .eq("id", event.id);
  updateQuery =
    verified.payload.action === "keep_live" ||
    verified.payload.action === "let_expire"
      ? updateQuery.or("decision.is.null,decision.eq.skipped")
      : verified.payload.action === "consent"
        ? updateQuery.or("decision.is.null,decision.eq.no_response")
        : updateQuery.is("decision", null);
  const { data: updated, error: updateErr } = await updateQuery
    .select("id")
    .maybeSingle();
  if (updateErr || !updated) {
    return htmlResponse({
      title: "Already recorded",
      body: "A decision is already recorded for this Keep live cycle.",
      status: 409,
    });
  }

  return htmlResponse({
    title: "Decision recorded",
    body: decisionCopy(verified.payload.action),
  });
}
