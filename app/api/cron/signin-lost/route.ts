import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canSetUpRobotSites, canUseRenterSms } from "@/lib/billing";
import { sendNotificationEmail } from "@/lib/email";
import { sendSms, smsLive, isWithinQuietHours } from "@/lib/sms";
import { getUserByIdCached } from "@/lib/auth-email-cache";
import {
  SITE_SIGNIN_LABEL,
  isSiteSigninChannel,
  siteSigninOpenHref,
  siteSigninLinksOn,
} from "@/lib/site-signin";
import { signinLostAction, signinLostEmail, signinLostText, signinLostTextAction } from "@/lib/signin-lost";
import { claimNull } from "@/lib/claim-stamp";

// S736: email the landlord once when Kijiji, Zumper or Rentals.ca signs them
// out (lib/signin-lost). Runs in the 15-minute sweep. Only accounts with the
// Posting add-on (the robot posts for them) and not closed. ?dry=1 reports.
// S762: the link opens the sign-in window at once (?open=1), and a Growth
// landlord with texting on who saved their own mobile also gets a text
// (once per sign-out, never in quiet hours: it waits for the morning).

// S748: every sweep gets the full 60 s; sweep-all waits up to 50 s for each.
export const maxDuration = 60;

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

  const read = (cols: string) =>
    admin.from("distribution_channel_sessions").select(cols).in("channel", ["kijiji", "zumper", "rentals_ca"]);
  let { data: rows, error } = await read(
    "organization_id, channel, alive, last_check_code, lost_notified_at, lost_texted_at, organization:organizations(name, plan, posting_addon_active, closed_at, brand_color, logo_url, sms_enabled, alert_mobile_e164, booking_timezone)",
  );
  // S762: before migration 0274 the text columns do not exist; the email still goes.
  if (error && /column|does not exist|42703|PGRST204/i.test(`${error.code} ${error.message}`)) {
    ({ data: rows, error } = await read(
      "organization_id, channel, alive, last_check_code, lost_notified_at, organization:organizations(name, plan, posting_addon_active, closed_at, brand_color, logo_url)",
    ));
  }
  if (error) return NextResponse.json({ ok: false, reason: `read:${error.code ?? "failed"}` }, { status: 500 });

  let sent = 0;
  let texted = 0;
  const now = new Date();
  const report: { org: string; channel: string; action: string }[] = [];
  for (const r of (rows ?? []) as unknown as {
    organization_id: string;
    channel: string;
    alive: boolean | null;
    last_check_code: string | null;
    lost_notified_at: string | null;
    lost_texted_at: string | null;
    organization: {
      name: string | null;
      plan: string | null;
      posting_addon_active: boolean | null;
      closed_at: string | null;
      brand_color: string | null;
      logo_url: string | null;
      sms_enabled: boolean | null;
      alert_mobile_e164: string | null;
      booking_timezone: string | null;
    } | null;
  }[]) {
    if (!isSiteSigninChannel(r.channel)) continue;
    const org = r.organization;
    const url = `${APP_URL}${siteSigninLinksOn() ? siteSigninOpenHref(r.channel) : "/dashboard/link-portals"}`;

    // S762: the text, decided on its own stamp so a quiet-hours wait or a
    // later-saved mobile still gets one text per sign-out.
    const textAction = signinLostTextAction({
      alive: r.alive,
      lastCheckCode: r.last_check_code,
      lostTextedAt: r.lost_texted_at,
      alertMobile: org?.alert_mobile_e164 ?? null,
      textsOn: !!org && org.sms_enabled === true && canUseRenterSms(org.plan) && smsLive(),
      quiet: isWithinQuietHours(now, org?.booking_timezone || "America/Toronto"),
    });
    if (textAction === "clear" && !dry) {
      await admin
        .from("distribution_channel_sessions")
        .update({ lost_texted_at: null })
        .eq("organization_id", r.organization_id)
        .eq("channel", r.channel);
    }
    if (textAction === "text" && org && !org.closed_at && canSetUpRobotSites(org)) {
      report.push({ org: org.name ?? r.organization_id, channel: r.channel, action: "text" });
      if (!dry) {
        const claim = await claimNull(
          admin,
          "distribution_channel_sessions",
          { organization_id: r.organization_id, channel: r.channel },
          "lost_texted_at",
        );
        if (claim.outcome === "claimed") {
          const res = await sendSms({
            to: org.alert_mobile_e164,
            body: signinLostText({ siteLabel: SITE_SIGNIN_LABEL[r.channel], url }),
            organizationId: r.organization_id,
          }).catch(() => ({ sent: false }));
          if (res.sent) texted++;
        }
      }
    } else if (textAction === "wait") {
      report.push({ org: org?.name ?? r.organization_id, channel: r.channel, action: "text_waits_for_morning" });
    }

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
    if (!org || org.closed_at || !canSetUpRobotSites(org)) continue;
    report.push({ org: org.name ?? r.organization_id, channel: r.channel, action });
    if (dry) continue;

    const label = SITE_SIGNIN_LABEL[r.channel];
    const mail = signinLostEmail({ siteLabel: label, orgName: org.name });
    const { data: members } = await admin
      .from("memberships")
      .select("user_id")
      .eq("organization_id", r.organization_id)
      .eq("role", "owner_admin");
    // S742c: claim the stamp first (kept even when no owner had an email).
    const claim = await claimNull(
      admin,
      "distribution_channel_sessions",
      { organization_id: r.organization_id, channel: r.channel },
      "lost_notified_at",
    );
    if (claim.outcome !== "claimed") {
      report.push({ org: r.organization_id, channel: r.channel, action: claim.outcome === "taken" ? "already_claimed" : `claim_failed:${claim.error}` });
      continue;
    }
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
  }
  return NextResponse.json({ ok: true, sent, texted, dry, report });
}
