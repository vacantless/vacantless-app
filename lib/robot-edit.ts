// ============================================================================
// robot-edit (S762, REVIEW-S761 item 2: edits follow, Kijiji in place).
//
// Queue the robot to edit a live Kijiji ad on Kijiji's own edit page after
// the rental's details change (vacantless-worker src/edit-sites.ts). The item
// borrows the Kijiji row of the rental's active run (transport "edit"); the
// worker gives it back as live whatever happens, so the ad's state never
// changes because of an edit. Behind the staff switch kijiji_edits.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { EDIT_TRANSPORT } from "@/lib/distribution-worker";

export async function queueRobotEdits(args: {
  supabase: SupabaseClient;
  organizationId: string;
  propertyId: string;
  portals: readonly string[];
  notes: string;
  audit: (portal: string) => string;
}): Promise<string[]> {
  const queued: string[] = [];
  if (args.portals.length === 0) return queued;
  try {
    const { data: posts } = await args.supabase
      .from("listing_posts")
      .select("id, portal, status, url")
      .eq("organization_id", args.organizationId)
      .eq("property_id", args.propertyId)
      .eq("status", "live")
      .in("portal", [...args.portals]);
    const { data: run } = await args.supabase
      .from("distribution_runs")
      .select("id")
      .eq("organization_id", args.organizationId)
      .eq("property_id", args.propertyId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    let runId = (run?.id as string | undefined) ?? null;
    // S762: a rental posted long ago can have no active run (Pillette 3);
    // make one, as a takedown does (lib/robot-takedown).
    if (!runId && (posts ?? []).length > 0) {
      const { data: inserted } = await args.supabase
        .from("distribution_runs")
        .insert({ organization_id: args.organizationId, property_id: args.propertyId, status: "active" })
        .select("id")
        .maybeSingle();
      runId = (inserted?.id as string | undefined) ?? null;
    }
    if (!runId) return queued;
    const now = new Date().toISOString();
    for (const post of (posts ?? []) as { id: string; portal: string; url: string | null }[]) {
      if (!post.url || queued.includes(post.portal)) continue;
      // Never take over a row the robot is working on (a takedown or a post).
      const { data: current } = await args.supabase
        .from("distribution_run_items")
        .select("id, publish_status, transport")
        .eq("run_id", runId)
        .eq("channel", post.portal)
        .maybeSingle();
      const cur = current as { publish_status?: string | null; transport?: string | null } | null;
      if (cur && cur.transport !== EDIT_TRANSPORT && cur.publish_status !== "live") continue;
      const { error } = await args.supabase.from("distribution_run_items").upsert(
        {
          organization_id: args.organizationId,
          run_id: runId,
          channel: post.portal,
          status: "pending",
          publish_status: "queued",
          mode: "concierge",
          transport: EDIT_TRANSPORT,
          blockers: [],
          external_url: post.url,
          listing_post_id: post.id,
          operator_action_url: post.url,
          audit_message: args.audit(post.portal),
          notes: args.notes,
          error_code: null,
          error_message: null,
          concierge_claimed_by: null,
          concierge_claimed_at: null,
          last_attempted_at: now,
          updated_at: now,
        },
        { onConflict: "run_id,channel" },
      );
      if (!error) queued.push(post.portal);
    }
  } catch {
    // best-effort: the saved notice then names the site as one to edit by hand
  }
  return queued;
}
