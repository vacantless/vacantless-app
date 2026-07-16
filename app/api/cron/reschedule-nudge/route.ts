import { NextResponse, type NextRequest } from "next/server";
import { formatSlotLong } from "@/lib/booking";
import { sendRescheduleProposal } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

// One-shot reschedule-proposal re-nudge. This deliberately reuses the direct
// renter proposal email instead of the notification substrate: the org opt-in is
// organizations.reschedule_nudge_enabled and each proposal self-gates with
// showing_reschedule_proposals.reminded_at.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const RESCHEDULE_NUDGE_AFTER_HOURS = 24;
const RESCHEDULE_NUDGE_AFTER_MS = RESCHEDULE_NUDGE_AFTER_HOURS * 3_600_000;

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

type RescheduleNudgeCandidateInput = {
  status: string | null;
  responded_at: string | null;
  reminded_at: string | null;
  created_at: string | null;
  org_enabled: boolean;
  showing_outcome: string | null;
  showing_scheduled_at: string | null;
};

type RescheduleNudgeSkipReason =
  | "eligible"
  | "not_pending"
  | "responded"
  | "already_reminded"
  | "disabled"
  | "too_new"
  | "showing_not_scheduled"
  | "showing_past"
  | "missing_created_at"
  | "missing_showing_time";

function evaluateRescheduleNudgeCandidate(
  row: RescheduleNudgeCandidateInput,
  nowMs: number = Date.now(),
): { eligible: boolean; reason: RescheduleNudgeSkipReason } {
  if (row.status !== "pending") return { eligible: false, reason: "not_pending" };
  if (row.responded_at) return { eligible: false, reason: "responded" };
  if (row.reminded_at) return { eligible: false, reason: "already_reminded" };
  if (!row.org_enabled) return { eligible: false, reason: "disabled" };

  if (!row.created_at) return { eligible: false, reason: "missing_created_at" };
  const createdMs = new Date(row.created_at).getTime();
  if (Number.isNaN(createdMs)) return { eligible: false, reason: "missing_created_at" };
  if (createdMs > nowMs - RESCHEDULE_NUDGE_AFTER_MS) {
    return { eligible: false, reason: "too_new" };
  }

  if (row.showing_outcome !== "scheduled") {
    return { eligible: false, reason: "showing_not_scheduled" };
  }
  if (!row.showing_scheduled_at) {
    return { eligible: false, reason: "missing_showing_time" };
  }
  const showingMs = new Date(row.showing_scheduled_at).getTime();
  if (Number.isNaN(showingMs)) {
    return { eligible: false, reason: "missing_showing_time" };
  }
  if (showingMs <= nowMs) return { eligible: false, reason: "showing_past" };

  return { eligible: true, reason: "eligible" };
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

function slotList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((slot): slot is string => typeof slot === "string");
}

function safeSendFailureReason(reason?: string): string {
  if (!reason) return "send_failed";
  if (reason.startsWith("brevo_")) return reason.split(":")[0] || "brevo_error";
  if (reason.startsWith("fetch_error:")) return "fetch_error";
  return reason;
}

type LeadRow = {
  id: string | null;
  name: string | null;
  email: string | null;
};

type PropertyRow = {
  id: string | null;
  address: string | null;
};

type ShowingRow = {
  id: string;
  scheduled_at: string | null;
  outcome: string | null;
  lead_id: string | null;
  property_id: string | null;
  lead: LeadRow | LeadRow[] | null;
  property: PropertyRow | PropertyRow[] | null;
};

type OrganizationRow = {
  id: string;
  name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  booking_timezone: string | null;
  reschedule_nudge_enabled: boolean | null;
};

type ProposalRow = {
  id: string;
  token: string;
  status: string | null;
  responded_at: string | null;
  reminded_at: string | null;
  created_at: string | null;
  organization_id: string;
  showing_id: string;
  proposed_slots: unknown;
  showing: ShowingRow | ShowingRow[] | null;
};

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, sent: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const params = req.nextUrl.searchParams;
  const force = params.get("force") === "1";
  const dry = params.get("dry") === "1";
  const onlyOrg = params.get("org");

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(nowMs - RESCHEDULE_NUDGE_AFTER_MS).toISOString();

  let proposalQuery = admin
    .from("showing_reschedule_proposals")
    .select(
      "id, token, status, responded_at, reminded_at, created_at, organization_id, showing_id, proposed_slots, " +
        "showing:showings!inner(id, scheduled_at, outcome, lead_id, property_id, " +
        "lead:leads(id, name, email), property:properties(id, address))",
    )
    .eq("status", "pending")
    .is("responded_at", null)
    .is("reminded_at", null);
  if (!force) proposalQuery = proposalQuery.lte("created_at", cutoffIso);
  if (onlyOrg) proposalQuery = proposalQuery.eq("organization_id", onlyOrg);

  const { data: rows, error: proposalErr } = await proposalQuery;
  if (proposalErr) {
    return NextResponse.json(
      { ok: false, reason: `proposal_query_error:${proposalErr.message}`, scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const proposals = (rows ?? []) as unknown as ProposalRow[];
  const orgIds = Array.from(new Set(proposals.map((row) => row.organization_id).filter(Boolean)));
  const orgsById = new Map<string, OrganizationRow>();
  if (orgIds.length > 0) {
    const { data: orgRows, error: orgErr } = await admin
      .from("organizations")
      .select("id, name, brand_color, logo_url, reply_to_email, booking_timezone, reschedule_nudge_enabled")
      .in("id", orgIds);
    if (orgErr) {
      return NextResponse.json(
        { ok: false, reason: `org_query_error:${orgErr.message}`, scanned: proposals.length, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
        { status: 200 },
      );
    }
    for (const org of (orgRows ?? []) as OrganizationRow[]) {
      orgsById.set(org.id, org);
    }
  }

  const summary: Summary = {
    ok: true,
    scanned: proposals.length,
    sent: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const row of proposals) {
    try {
      const showing = one<ShowingRow>(row.showing);
      const org = orgsById.get(row.organization_id) ?? null;
      const due = evaluateRescheduleNudgeCandidate({
        status: row.status,
        responded_at: row.responded_at,
        reminded_at: row.reminded_at,
        created_at: force ? cutoffIso : row.created_at,
        org_enabled: org?.reschedule_nudge_enabled === true,
        showing_outcome: showing?.outcome ?? null,
        showing_scheduled_at: showing?.scheduled_at ?? null,
      }, nowMs);

      if (!due.eligible) {
        summary.skipped++;
        summary.details.push({
          org: row.organization_id,
          proposal_id: row.id,
          showing_id: row.showing_id,
          skipped: due.reason,
        });
        continue;
      }

      if (dry) {
        summary.sent++;
        summary.details.push({
          org: row.organization_id,
          proposal_id: row.id,
          showing_id: row.showing_id,
          dry: true,
          would_send: true,
        });
        continue;
      }

      const { data: claimedRows, error: claimErr } = await admin
        .from("showing_reschedule_proposals")
        .update({ reminded_at: nowIso })
        .eq("id", row.id)
        .is("reminded_at", null)
        .select("id");
      if (claimErr) {
        summary.errors++;
        summary.details.push({
          org: row.organization_id,
          proposal_id: row.id,
          showing_id: row.showing_id,
          error: `claim_error:${claimErr.message}`,
        });
        continue;
      }
      if (!claimedRows || claimedRows.length === 0) {
        summary.skipped++;
        summary.details.push({
          org: row.organization_id,
          proposal_id: row.id,
          showing_id: row.showing_id,
          skipped: "already_claimed",
        });
        continue;
      }

      if (!showing || !org) {
        summary.errors++;
        summary.details.push({
          org: row.organization_id,
          proposal_id: row.id,
          showing_id: row.showing_id,
          error: showing ? "missing_org" : "missing_showing",
        });
        continue;
      }

      const lead = one<LeadRow>(showing.lead);
      const property = one<PropertyRow>(showing.property);
      const tz = org.booking_timezone || "America/Toronto";
      const proposedWhenLabels = slotList(row.proposed_slots).map((slot) =>
        formatSlotLong(slot, tz),
      );

      const result = await sendRescheduleProposal({
        lead_id: showing.lead_id ?? "",
        renter_name: lead?.name ?? null,
        renter_email: lead?.email ?? null,
        org_name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
        property_address: property?.address ?? null,
        current_when_label: showing.scheduled_at
          ? formatSlotLong(showing.scheduled_at, tz)
          : null,
        proposed_when_labels: proposedWhenLabels,
        proposal_url: `${APP_URL}/showing/reschedule/${row.token}`,
        renter_url: `${APP_URL}/r/${showing.property_id ?? property?.id ?? ""}`,
      });

      if (!result.sent) {
        summary.errors++;
        summary.details.push({
          org: row.organization_id,
          proposal_id: row.id,
          showing_id: row.showing_id,
          error: safeSendFailureReason(result.reason),
        });
        continue;
      }

      if (showing.lead_id) {
        const { error: messageErr } = await admin.from("messages").insert({
          organization_id: row.organization_id,
          lead_id: showing.lead_id,
          channel: "note",
          direction: "outbound",
          body: "Re-sent suggested viewing times (auto follow-up).",
        });
        if (messageErr) {
          summary.errors++;
          summary.details.push({
            org: row.organization_id,
            proposal_id: row.id,
            showing_id: row.showing_id,
            warning: `message_error:${messageErr.message}`,
          });
        }
      }

      summary.sent++;
      summary.details.push({
        org: row.organization_id,
        proposal_id: row.id,
        showing_id: row.showing_id,
        sent: true,
      });
    } catch (err) {
      summary.errors++;
      summary.details.push({
        org: row.organization_id,
        proposal_id: row.id,
        showing_id: row.showing_id,
        error: `proposal_threw:${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
