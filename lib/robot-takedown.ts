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
import { UNAVAILABLE_STATUSES, siteName } from "@/lib/ads-still-up";
import { triggerTakedownNow } from "@/lib/post-now";

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
  // S830i: Kijiji and Zumper takedowns run in takedown-sites.yml; wake it now.
  if (out.some((o) => o.portal === "kijiji" || o.portal === "zumper")) await triggerTakedownNow();
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

/** Pure (S845b): rentals whose ad on this site should come down now that the site is signed in. */
export function takedownsOwedAfterSignin(input: {
  posts: { propertyId: string | null; status: string | null; url: string | null }[];
  offMarketIds: readonly string[];
  /** Rentals with a takedown item on this site touched in the last 30 minutes. */
  recentlyTriedIds: readonly string[];
}): string[] {
  const off = new Set(input.offMarketIds);
  const tried = new Set(input.recentlyTriedIds);
  const out = new Set<string>();
  for (const p of input.posts) {
    if (p.status !== "live" || !p.url?.trim() || !p.propertyId) continue;
    if (off.has(p.propertyId) && !tried.has(p.propertyId)) out.add(p.propertyId);
  }
  return [...out];
}

/**
 * S845b: a site was signed out when its rental was marked rented, so no
 * takedown was queued (the robot could not reach it). The sign-in ask already
 * goes out for that ad (lib/site-work-waiting "takedown"); when the landlord
 * signs in, queue the takedown so the sign-in is used at once. A rental whose
 * takedown on this site was tried in the last 30 minutes is left alone, so a
 * failed try is not repeated by every poll. Best-effort: never throws.
 */
export async function queueTakedownsAfterSignin(args: {
  supabase: SupabaseClient;
  organizationId: string;
  channel: string;
}): Promise<number> {
  try {
    const { supabase, organizationId, channel } = args;
    if (!isRobotPostedChannel(channel)) return 0;
    const { data: posts } = await supabase
      .from("listing_posts")
      .select("property_id, status, url")
      .eq("organization_id", organizationId)
      .eq("portal", channel)
      .eq("status", "live");
    const rows = ((posts ?? []) as { property_id: string | null; status: string | null; url: string | null }[]).map((r) => ({
      propertyId: r.property_id,
      status: r.status,
      url: r.url,
    }));
    const ids = [...new Set(rows.map((r) => r.propertyId).filter((x): x is string => !!x))];
    if (ids.length === 0) return 0;
    const [{ data: props }, { data: items }] = await Promise.all([
      supabase.from("properties").select("id, status, archived_at").eq("organization_id", organizationId).in("id", ids),
      supabase
        .from("distribution_run_items")
        .select("run_id, distribution_runs!inner(property_id)")
        .eq("organization_id", organizationId)
        .eq("channel", channel)
        .eq("transport", TAKEDOWN_TRANSPORT)
        .gte("updated_at", new Date(Date.now() - 30 * 60_000).toISOString()),
    ]);
    const offMarketIds = ((props ?? []) as { id: string; status: string | null; archived_at: string | null }[])
      .filter((p) => !!p.archived_at || (UNAVAILABLE_STATUSES as readonly string[]).includes(String(p.status ?? "")))
      .map((p) => p.id);
    const recentlyTriedIds = ((items ?? []) as unknown as { distribution_runs: { property_id: string } | { property_id: string }[] }[])
      .flatMap((i) => (Array.isArray(i.distribution_runs) ? i.distribution_runs : [i.distribution_runs]))
      .map((r) => r?.property_id)
      .filter((x): x is string => !!x);
    let queued = 0;
    for (const propertyId of takedownsOwedAfterSignin({ posts: rows, offMarketIds, recentlyTriedIds })) {
      const q = await queueRobotTakedowns({ supabase, organizationId, propertyId, portals: [channel] });
      queued += q.length;
    }
    return queued;
  } catch {
    return 0;
  }
}
