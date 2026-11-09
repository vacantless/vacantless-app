import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { answeredLeadIds } from "@/lib/lead-answered";
import { QUIET_MAX_AGE_MS, QUIET_MOVE_NOTE, QUIET_MS, shouldMoveToContacted } from "@/lib/quiet-new-leads";

// S771: moves a "New" renter to "Contacted" once our reply went out and they
// stayed quiet for 3 days (lib/quiet-new-leads). Every org. Idempotent: the
// update only matches rows still at "new", so a double run moves nothing twice.

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, reason: "service_role_not_configured", moved: 0 }, { status: 200 });
  }
  const nowMs = Date.now();
  const { data, error } = await admin
    .from("leads")
    .select("id, organization_id, status, created_at")
    .eq("status", "new")
    .lte("created_at", new Date(nowMs - QUIET_MS).toISOString())
    .gt("created_at", new Date(nowMs - QUIET_MAX_AGE_MS).toISOString())
    .limit(500);
  if (error) {
    return NextResponse.json({ ok: false, error: `query_error:${error.message}`, moved: 0 }, { status: 200 });
  }
  const rows = (data ?? []) as { id: string; organization_id: string; status: string; created_at: string }[];

  const byOrg = new Map<string, string[]>();
  for (const r of rows) byOrg.set(r.organization_id, [...(byOrg.get(r.organization_id) ?? []), r.id]);
  const answered = new Set<string>();
  for (const [orgId, ids] of byOrg) {
    for (const id of await answeredLeadIds(admin, orgId, ids)) answered.add(id);
  }

  let moved = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      if (
        !shouldMoveToContacted({
          status: r.status,
          createdAtMs: Date.parse(r.created_at),
          nowMs,
          hasOutboundReply: answered.has(r.id),
        })
      ) {
        continue;
      }
      const { data: upd, error: uerr } = await admin
        .from("leads")
        .update({ status: "contacted" })
        .eq("id", r.id)
        .eq("status", "new")
        .select("id");
      if (uerr) {
        errors++;
        continue;
      }
      if ((upd?.length ?? 0) === 0) continue;
      moved++;
      await admin.from("messages").insert({
        organization_id: r.organization_id,
        lead_id: r.id,
        channel: "note",
        direction: "outbound",
        body: QUIET_MOVE_NOTE,
      });
    } catch {
      errors++;
    }
  }
  console.log(`[quiet-new-leads] scanned=${rows.length} moved=${moved} errors=${errors}`);
  return NextResponse.json({ ok: errors === 0, scanned: rows.length, moved, errors, sent: 0 }, { status: 200 });
}
