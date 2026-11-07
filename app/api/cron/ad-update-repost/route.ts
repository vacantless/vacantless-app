import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readRobotPostingAccess } from "@/lib/robot-posting-access";
import { TAKEDOWN_TRANSPORT } from "@/lib/distribution-worker";
import { UPDATE_REPOST_MARK, updateRepostAudit, updateRepostDecision } from "@/lib/ad-edits-follow";

// S761 (REVIEW-S761 item 2): once the robot has taken an edited rental's old
// ad down (the takedown item carries the "update re-post" mark and reads
// skipped), queue the same item as a fresh post, the write "Post it for me"
// makes. Runs in the 15-minute sweep. ?dry=1 reports without writing.

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ ok: false, reason: "service_role_not_configured" }, { status: 500 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";

  const { data: rows, error } = await admin
    .from("distribution_run_items")
    .select("id, organization_id, run_id, channel, transport, publish_status, notes, run:distribution_runs(property_id)")
    .eq("transport", TAKEDOWN_TRANSPORT)
    .ilike("notes", `%${UPDATE_REPOST_MARK}%`)
    .in("publish_status", ["queued", "submitting", "skipped"])
    .limit(50);
  if (error) return NextResponse.json({ ok: false, reason: `read:${error.code ?? "failed"}` }, { status: 500 });

  const nowISO = new Date().toISOString();
  let queued = 0;
  const report: { item: string; channel: string; decision: string }[] = [];
  const accessByOrg = new Map<string, Awaited<ReturnType<typeof readRobotPostingAccess>>>();
  for (const r of (rows ?? []) as unknown as {
    id: string;
    organization_id: string;
    run_id: string;
    channel: string;
    transport: string | null;
    publish_status: string | null;
    notes: string | null;
    run: { property_id: string | null } | null;
  }[]) {
    const propertyId = r.run?.property_id ?? null;
    let propertyStatus: string | null = null;
    let propertyArchived = true;
    if (propertyId) {
      const { data: prop } = await admin
        .from("properties")
        .select("status, archived_at")
        .eq("id", propertyId)
        .maybeSingle();
      propertyStatus = (prop as { status: string | null } | null)?.status ?? null;
      propertyArchived = Boolean((prop as { archived_at: string | null } | null)?.archived_at);
    }
    let access = accessByOrg.get(r.organization_id);
    if (!access) {
      access = await readRobotPostingAccess(admin, r.organization_id);
      accessByOrg.set(r.organization_id, access);
    }
    const { data: session } = await admin
      .from("distribution_channel_session_status")
      .select("alive")
      .eq("organization_id", r.organization_id)
      .eq("channel", r.channel)
      .maybeSingle();
    const decision = updateRepostDecision({
      transport: r.transport,
      publishStatus: r.publish_status,
      notes: r.notes,
      propertyStatus,
      propertyArchived,
      postingAllowed: access.allowed,
      autopilot: access.autopilot,
      sessionAlive: (session as { alive: boolean | null } | null)?.alive === true,
    });
    report.push({ item: r.id, channel: r.channel, decision });
    if (decision === "wait") continue;
    if (dry) continue;
    if (decision === "drop") {
      // Strip the mark so the sweep never looks at this item again.
      await admin
        .from("distribution_run_items")
        .update({ notes: `${r.notes ?? ""}\n${nowISO.slice(0, 10)} update re-post dropped (rental not live, no Posting, or site signed out)`.trim() })
        .eq("id", r.id);
      continue;
    }
    const { error: updErr } = await admin
      .from("distribution_run_items")
      .update({
        mode: "concierge",
        transport: null,
        publish_status: "queued",
        status: "in_progress",
        listing_post_id: null,
        external_url: null,
        operator_action_url: null,
        operator_submit_approved_at: null,
        operator_submit_approved_by: null,
        external_posted_at: null,
        external_expires_at: null,
        blockers: [],
        concierge_requested_at: nowISO,
        concierge_requested_by: null,
        concierge_claimed_by: null,
        concierge_claimed_at: null,
        audit_message: updateRepostAudit(r.channel),
        notes: `${r.notes ?? ""}\n${nowISO.slice(0, 10)} re-posted after the update`.trim(),
        error_code: null,
        error_message: null,
        updated_at: nowISO,
      })
      .eq("id", r.id)
      .eq("transport", TAKEDOWN_TRANSPORT)
      .eq("publish_status", "skipped");
    if (updErr) {
      report[report.length - 1].decision = `failed:${updErr.code ?? "update"}`;
      continue;
    }
    await admin.from("distribution_runs").update({ status: "active", completed_at: null }).eq("id", r.run_id).eq("status", "completed");
    queued++;
  }
  return NextResponse.json({ ok: true, dry, scanned: (rows ?? []).length, queued, report });
}
