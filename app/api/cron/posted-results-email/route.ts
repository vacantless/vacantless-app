import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUseRobotPosting } from "@/lib/billing";
import { sendNotificationEmail } from "@/lib/email";
import { getUserByIdCached } from "@/lib/auth-email-cache";
import { postedResultsNextSteps, postedResultsSites } from "@/lib/posted-results";
import { resultsEmail, resultsEmailDecision, type ResultsEmailPost } from "@/lib/posted-results-email";

// S737 (review item 2): email the landlord the list of live ads once per
// rental turn, two hours after the first ad went live (lib/posted-results-email).
// Runs in the 15-minute sweep. ?dry=1 reports without sending or stamping.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";
// Agile's ads are posted by us for Noam; its operators do not need this email.
const SKIP_ORG_IDS = new Set(["921f7c08-98af-428f-a238-36f4a781b0de"]);

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type PropRow = {
  id: string;
  organization_id: string;
  address: string | null;
  status: string | null;
  results_emailed_at: string | null;
  organization: {
    name: string | null;
    plan: string | null;
    posting_addon_active: boolean | null;
    closed_at: string | null;
    brand_color: string | null;
    logo_url: string | null;
  } | null;
};

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ ok: false, reason: "service_role_not_configured" }, { status: 500 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const now = Date.now();

  // Only rentals with an ad created in the last 3 days can qualify.
  const since = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentErr } = await admin
    .from("listing_posts")
    .select("property_id")
    .eq("status", "live")
    .gte("created_at", since);
  if (recentErr) return NextResponse.json({ ok: false, reason: `posts:${recentErr.code ?? "failed"}` }, { status: 500 });
  const ids = Array.from(new Set(((recent ?? []) as { property_id: string | null }[]).map((r) => r.property_id).filter(Boolean))) as string[];
  if (ids.length === 0) return NextResponse.json({ ok: true, sent: 0, dry, report: [] });

  const { data: props, error } = await admin
    .from("properties")
    .select(
      "id, organization_id, address, status, results_emailed_at, organization:organizations(name, plan, posting_addon_active, closed_at, brand_color, logo_url)",
    )
    .in("id", ids);
  if (error) return NextResponse.json({ ok: false, reason: `read:${error.code ?? "failed"}` }, { status: 500 });

  let sent = 0;
  const report: { property: string; action: string }[] = [];
  for (const p of (props ?? []) as unknown as PropRow[]) {
    const org = p.organization;
    if (!org || org.closed_at || SKIP_ORG_IDS.has(p.organization_id)) continue;
    const { data: postRows } = await admin
      .from("listing_posts")
      .select("portal, status, url, created_at")
      .eq("property_id", p.id);
    const posts: ResultsEmailPost[] = ((postRows ?? []) as { portal: string | null; status: string | null; url: string | null; created_at: string | null }[]).map(
      (r) => ({ portal: r.portal, status: r.status, url: r.url, createdAt: r.created_at }),
    );
    const action = resultsEmailDecision({ propertyStatus: p.status, posts, lastSentAt: p.results_emailed_at, now });
    if (action !== "send") continue;
    report.push({ property: p.address ?? p.id, action });
    if (dry) continue;

    const liveKeys = postedResultsSites(posts).map((s) => s.key);
    const { data: fbPage } = await admin
      .from("distribution_channel_accounts")
      .select("account_status")
      .eq("organization_id", p.organization_id)
      .eq("channel", "facebook_feed")
      .maybeSingle();
    const next = postedResultsNextSteps({
      propertyId: p.id,
      liveKeys,
      facebookPageConnected: (fbPage as { account_status?: string } | null)?.account_status === "connected",
      robotPostingAllowed: canUseRobotPosting(org),
      marketplaceKitAvailable: true,
    })[0] ?? null;
    const mail = resultsEmail({
      address: p.address,
      posts,
      bookingUrl: `${APP_URL}/r/${p.id}`,
      appUrl: APP_URL,
      nextStep: next,
    });
    const { data: members } = await admin
      .from("memberships")
      .select("user_id")
      .eq("organization_id", p.organization_id)
      .eq("role", "owner_admin");
    const seen = new Set<string>();
    for (const m of (members ?? []) as { user_id: string }[]) {
      const { data } = await getUserByIdCached(admin, m.user_id);
      const to = data.user?.email?.trim().toLowerCase();
      if (!to || seen.has(to)) continue;
      seen.add(to);
      const res = await sendNotificationEmail({
        to_email: to,
        subject: mail.subject,
        body: mail.body,
        action_label: mail.actionLabel,
        action_url: `${APP_URL}/dashboard/properties/${p.id}?tab=distribute`,
        org_name: org.name ?? "Vacantless",
        brand_color: org.brand_color ?? null,
        logo_url: org.logo_url ?? null,
        reply_to_email: null,
      }).catch(() => ({ sent: false }));
      if (res.sent) sent++;
    }
    // Stamp even with no owner email, so the sweep does not retry every 15 minutes.
    await admin.from("properties").update({ results_emailed_at: new Date().toISOString() }).eq("id", p.id);
  }
  return NextResponse.json({ ok: true, sent, dry, report });
}
