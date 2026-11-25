// S841d: the reads behind lib/site-work-waiting (pure). One load per account,
// shared by the sign-out email sweep, Today and the sign-in pages.
import type { SupabaseClient } from "@supabase/supabase-js";
import { SITE_SIGNIN_CHANNELS, type SiteSigninChannel } from "@/lib/site-signin";
import {
  signinDueSoon,
  siteWorkWaiting,
  type SiteWork,
  type WorkItem,
  type WorkPost,
  type WorkProperty,
} from "@/lib/site-work-waiting";

export type SiteWorkByChannel = Record<SiteSigninChannel, SiteWork>;

export async function loadSiteWork(
  supabase: SupabaseClient,
  orgId: string,
  timeZone: string = "America/Toronto",
  now: Date = new Date(),
): Promise<SiteWorkByChannel> {
  const sites = [...SITE_SIGNIN_CHANNELS];
  const [{ data: posts }, { data: items }] = await Promise.all([
    supabase
      .from("listing_posts")
      .select("property_id, portal, status, posted_on, notes, created_at")
      .eq("organization_id", orgId)
      .eq("status", "live")
      .in("portal", sites)
      .limit(500),
    supabase
      .from("distribution_run_items")
      .select("channel, publish_status, status, updated_at")
      .eq("organization_id", orgId)
      .in("channel", sites)
      .in("publish_status", ["queued", "submitting", "needs_login", "needs_operator"])
      .limit(500),
  ]);
  const postRows = ((posts ?? []) as {
    property_id: string | null;
    portal: string;
    status: string | null;
    posted_on: string | null;
    notes: string | null;
    created_at: string | null;
  }[]).map<WorkPost>((p) => ({
    propertyId: p.property_id,
    portal: p.portal,
    status: p.status,
    postedOn: p.posted_on ?? p.created_at?.slice(0, 10) ?? null,
    notes: p.notes,
  }));
  const propIds = [...new Set(postRows.map((p) => p.propertyId).filter((id): id is string => !!id))];
  const { data: props } = propIds.length
    ? await supabase.from("properties").select("id, status, archived_at").in("id", propIds)
    : { data: [] };
  const properties = ((props ?? []) as { id: string; status: string | null; archived_at: string | null }[]).map<WorkProperty>(
    (p) => ({ id: p.id, status: p.status, archived: !!p.archived_at }),
  );
  const itemRows = ((items ?? []) as {
    channel: string | null;
    publish_status: string | null;
    status: string | null;
    updated_at: string | null;
  }[]).map<WorkItem>((i) => ({ channel: i.channel, publishStatus: i.publish_status, status: i.status, updatedAt: i.updated_at }));
  const today = now.toLocaleDateString("en-CA", { timeZone });
  const nowISO = now.toISOString();
  const out = {} as SiteWorkByChannel;
  for (const channel of sites) {
    out[channel] = siteWorkWaiting({ channel, properties, posts: postRows, items: itemRows, today, nowISO });
  }
  return out;
}

export type DueSoonSite = { channel: SiteSigninChannel; ageDays: number; usualDays: number };

/** Sites that still work but are late in a sign-in that usually ends soon. */
export async function loadDueSoonSites(
  supabase: SupabaseClient,
  orgId: string,
  now: Date = new Date(),
): Promise<DueSoonSite[]> {
  const { data } = await supabase
    .from("distribution_channel_session_status")
    .select("channel, alive, last_validated_at")
    .eq("organization_id", orgId)
    .in("channel", [...SITE_SIGNIN_CHANNELS]);
  const out: DueSoonSite[] = [];
  for (const r of (data ?? []) as { channel: string; alive: boolean | null; last_validated_at: string | null }[]) {
    const d = signinDueSoon({ channel: r.channel, alive: r.alive, signedInAt: r.last_validated_at, nowISO: now.toISOString() });
    if (d.soon && d.ageDays != null && d.usualDays != null) {
      out.push({ channel: r.channel as SiteSigninChannel, ageDays: d.ageDays, usualDays: d.usualDays });
    }
  }
  return out;
}
