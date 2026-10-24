import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUseRobotPosting } from "@/lib/billing";
import { sendNotificationEmail } from "@/lib/email";
import { getUserByIdCached } from "@/lib/auth-email-cache";
import {
  SITE_SIGNIN_LABEL,
  isSiteSigninChannel,
  siteSigninHref,
  siteSigninLinksOn,
} from "@/lib/site-signin";
import { signinLostAction, signinLostEmail } from "@/lib/signin-lost";

// S736: email the landlord once when Kijiji, Zumper or Rentals.ca signs them
// out (lib/signin-lost). Runs in the 15-minute sweep. Only accounts with the
// Posting add-on (the robot posts for them) and not closed. ?dry=1 reports.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

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
    .from("distribution_channel_sessions")
    .select(
      "organization_id, channel, alive, last_check_code, lost_notified_at, organization:organizations(name, plan, posting_addon_active, closed_at, brand_color, logo_url)",
    )
    .in("channel", ["kijiji", "zumper", "rentals_ca"]);
  if (error) return NextResponse.json({ ok: false, reason: `read:${error.code ?? "failed"}` }, { status: 500 });

  let sent = 0;
  const report: { org: string; channel: string; action: string }[] = [];
  for (const r of (rows ?? []) as unknown as {
    organization_id: string;
    channel: string;
    alive: boolean | null;
    last_check_code: string | null;
    lost_notified_at: string | null;
    organization: {
      name: string | null;
      plan: string | null;
      posting_addon_active: boolean | null;
      closed_at: string | null;
      brand_color: string | null;
      logo_url: string | null;
    } | null;
  }[]) {
    if (!isSiteSigninChannel(r.channel)) continue;
    const org = r.organization;
    const action = signinLostAction({ alive: r.alive, lastCheckCode: r.last_check_code, lostNotifiedAt: r.lost_notified_at });
    if (action === "none") continue;
    if (action === "clear") {
      if (!dry) {
        await admin
          .from("distribution_channel_sessions")
          .update({ lost_notified_at: null })
          .eq("organization_id", r.organization_id)
          .eq("channel", r.channel);
      }
      report.push({ org: org?.name ?? r.organization_id, channel: r.channel, action });
      continue;
    }
    // notify: only landlords the robot posts for, on an open account.
    if (!org || org.closed_at || !canUseRobotPosting(org)) continue;
    report.push({ org: org.name ?? r.organization_id, channel: r.channel, action });
    if (dry) continue;

    const label = SITE_SIGNIN_LABEL[r.channel];
    const mail = signinLostEmail({ siteLabel: label, orgName: org.name });
    const url = `${APP_URL}${siteSigninLinksOn() ? siteSigninHref(r.channel) : "/dashboard/link-portals"}`;
    const { data: members } = await admin
      .from("memberships")
      .select("user_id")
      .eq("organization_id", r.organization_id)
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
        action_url: url,
        org_name: org.name ?? "Vacantless",
        brand_color: org.brand_color ?? null,
        logo_url: org.logo_url ?? null,
        reply_to_email: null,
      }).catch(() => ({ sent: false }));
      if (res.sent) sent++;
    }
    // Stamp even when no owner had an email, so the sweep does not retry every 15 minutes.
    await admin
      .from("distribution_channel_sessions")
      .update({ lost_notified_at: new Date().toISOString() })
      .eq("organization_id", r.organization_id)
      .eq("channel", r.channel);
  }
  return NextResponse.json({ ok: true, sent, dry, report });
}
