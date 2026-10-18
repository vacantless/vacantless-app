// S723: send the "ads still up" email when a rental leaves the market (lib/ads-still-up.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendOrgNotification } from "@/lib/notifications-server";
import { resolveLeadNotifyEmailsPreferMemberFallback } from "@/lib/leads-notify";
import type { Org } from "@/lib/org";
import { adsStillUp, isUnavailableStatus, stillUpNoticeVars, type StillUpPost } from "@/lib/ads-still-up";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

export function stillUpDashboardUrl(propertyId: string): string {
  return `${APP_URL}/dashboard/properties/${encodeURIComponent(propertyId)}#ads-still-up`;
}

/** Best-effort. Never throws and never blocks the status change that called it. */
export async function notifyAdsStillUp(args: {
  supabase: SupabaseClient;
  org: Org;
  propertyId: string;
}): Promise<void> {
  try {
    const { data: property } = await args.supabase
      .from("properties")
      .select("id, address, status, archived_at")
      .eq("id", args.propertyId)
      .eq("organization_id", args.org.id)
      .maybeSingle();
    const p = property as { id: string; address: string | null; status: string | null; archived_at: string | null } | null;
    if (!p) return;
    const archived = !!p.archived_at;
    if (!isUnavailableStatus(p.status) && !archived) return;
    const { data: posts } = await args.supabase
      .from("listing_posts")
      .select("id, portal, url, status, label")
      .eq("organization_id", args.org.id)
      .eq("property_id", p.id);
    const still = adsStillUp((posts ?? []) as StillUpPost[]);
    if (still.length === 0) return;
    const dashboardUrl = stillUpDashboardUrl(p.id);
    await sendOrgNotification({
      client: args.supabase,
      org: {
        id: args.org.id,
        name: args.org.name,
        brand_color: args.org.brand_color,
        logo_url: args.org.logo_url,
        reply_to_email: args.org.reply_to_email,
      },
      eventKey: "leasing.ads_still_up",
      vars: stillUpNoticeVars({
        orgName: args.org.name,
        address: p.address,
        status: p.status,
        archived,
        posts: still,
        dashboardUrl,
      }),
      operatorFallback: resolveLeadNotifyEmailsPreferMemberFallback([], [
        args.org.reply_to_email,
        args.org.public_contact_email,
      ]),
      action: { label: "Open the rental", url: dashboardUrl },
    });
  } catch {
    // best-effort
  }
}
