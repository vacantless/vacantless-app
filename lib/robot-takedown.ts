// S754 (review item 4): when a rental leaves the market, queue the robot to
// take its ad down on Kijiji, Rentals.ca and Zumper, the sites it posts to.
// Before this the lease-up ladder listed those ads as "delete by hand"
// (Bruce 303, S741: three ads removed by a person while the robot held live
// sessions on all three sites). The Facebook Page post is deleted by
// lib/facebook-page-takedown; Marketplace stays the landlord's.
//
// A takedown is queued only when the robot can really do it: the org has the
// Posting add-on and the site's saved sign-in is alive. The queued item uses
// the lease-up run shape (mode concierge, transport takedown, publish_status
// queued) that the worker's takedown runners claim; the publish-prep cron
// never claims transport=takedown rows. Best-effort: never throws.
import type { SupabaseClient } from "@supabase/supabase-js";
import { TAKEDOWN_TRANSPORT } from "@/lib/distribution-worker";
import { isRobotPostedChannel } from "@/lib/posting-lanes";
import { readRobotPostingAccess } from "@/lib/robot-posting-access";
import { siteName } from "@/lib/ads-still-up";

export type RobotTakedownQueued = { portal: string; listingPostId: string; runItemId: string };

/** Pure: which live posts the robot can take down for this org. */
export function robotTakedownTargets(input: {
  posts: { id: string; portal: string; status: string | null; url: string | null }[];
  aliveChannels: readonly string[];
  postingAllowed: boolean;
}): { id: string; portal: string; url: string | null }[] {
  if (!input.postingAllowed) return [];
  const alive = new Set(input.aliveChannels);
  return input.posts
    .filter((p) => p.status === "live" && !!p.url && isRobotPostedChannel(p.portal) && alive.has(p.portal))
    .map((p) => ({ id: p.id, portal: p.portal, url: p.url }));
}

export function robotTakedownAudit(portal: string): string {
  return `Taking the ${siteName(portal)} ad down for you (the rental left the market). We mark it removed once the site shows it gone.`;
}

export async function queueRobotTakedowns(args: {
  supabase: SupabaseClient;
  organizationId: string;
  propertyId: string;
  /** S761: only these sites (an edit re-posts the free sites; a lease-up takes every site down). */
  portals?: readonly string[];
  /** S761: a note line on the item (the "update re-post" mark the sweep reads). */
  notes?: string | null;
  /** S761: the audit line, when not the lease-up one. */
  audit?: (portal: string) => string;
}): Promise<RobotTakedownQueued[]> {
  const out: RobotTakedownQueued[] = [];
  try {
    const { supabase, organizationId, propertyId } = args;
    const access = await readRobotPostingAccess(supabase, organizationId, { rental: propertyId });
    if (!access.allowed) return out;
    const [{ data: posts }, { data: sessions }] = await Promise.all([
      supabase
        .from("listing_posts")
        .select("id, portal, status, url")
        .eq("organization_id", organizationId)
        .eq("property_id", propertyId),
      supabase
        .from("distribution_channel_session_status")
        .select("channel, alive")
        .eq("organization_id", organizationId)
        .eq("alive", true),
    ]);
    const targets = robotTakedownTargets({
      posts: (posts ?? []) as { id: string; portal: string; status: string | null; url: string | null }[],
      aliveChannels: ((sessions ?? []) as { channel: string }[]).map((s) => s.channel),
      postingAllowed: access.allowed,
    }).filter((t) => !args.portals || args.portals.includes(t.portal));
    if (targets.length === 0) return out;

    let runId: string | null = null;
    const { data: existing } = await supabase
      .from("distribution_runs")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("property_id", propertyId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    runId = (existing?.id as string | undefined) ?? null;
    if (!runId) {
      const { data: inserted } = await supabase
        .from("distribution_runs")
        .insert({ organization_id: organizationId, property_id: propertyId, status: "active" })
        .select("id")
        .maybeSingle();
      runId = (inserted?.id as string | undefined) ?? null;
    }
    if (!runId) return out;

    const now = new Date().toISOString();
    for (const t of targets) {
      const { data } = await supabase
        .from("distribution_run_items")
        .upsert(
          {
            organization_id: organizationId,
            run_id: runId,
            channel: t.portal,
            status: "pending",
            publish_status: "queued",
            mode: "concierge",
            transport: TAKEDOWN_TRANSPORT,
            blockers: [],
            external_url: t.url,
            listing_post_id: t.id,
            operator_action_url: t.url,
            audit_message: (args.audit ?? robotTakedownAudit)(t.portal),
            notes: args.notes ?? null,
            error_code: null,
            error_message: null,
            concierge_claimed_by: null,
            concierge_claimed_at: null,
            operator_submit_approved_at: null,
            operator_submit_approved_by: null,
            last_attempted_at: now,
            updated_at: now,
          },
          { onConflict: "run_id,channel" },
        )
        .select("id")
        .maybeSingle();
      const id = (data?.id as string | undefined) ?? null;
      if (id) out.push({ portal: t.portal, listingPostId: t.id, runItemId: id });
    }
  } catch {
    // best-effort
  }
  return out;
}

/** Portals with a robot takedown queued or running for this property (for the rental's card and the email). */
export async function robotTakedownPending(args: {
  supabase: SupabaseClient;
  organizationId: string;
  propertyId: string;
}): Promise<string[]> {
  try {
    const { data: run } = await args.supabase
      .from("distribution_runs")
      .select("id")
      .eq("organization_id", args.organizationId)
      .eq("property_id", args.propertyId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    const runId = (run?.id as string | undefined) ?? null;
    if (!runId) return [];
    const { data } = await args.supabase
      .from("distribution_run_items")
      .select("channel, publish_status")
      .eq("run_id", runId)
      .eq("transport", TAKEDOWN_TRANSPORT)
      .in("publish_status", ["queued", "submitting"]);
    return ((data ?? []) as { channel: string }[]).map((r) => r.channel).filter((c) => isRobotPostedChannel(c));
  } catch {
    return [];
  }
}
