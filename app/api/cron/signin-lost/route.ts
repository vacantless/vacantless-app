import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canSetUpRobotSites, canUseRenterSms } from "@/lib/billing";
import { sendNotificationEmail } from "@/lib/email";
import { sendSms, smsLive, isWithinQuietHours } from "@/lib/sms";
import { getUserByIdCached } from "@/lib/auth-email-cache";
import {
  SITE_SIGNIN_LABEL,
  SITE_SIGNIN_ORDER,
  isSiteSigninChannel,
  signinOpensAtHome,
  siteSigninOpenHref,
  siteSigninLinksOn,
  withQuery,
  type SiteSigninChannel,
} from "@/lib/site-signin";
import {
  SIGNIN_LOST_CODES,
  joinAnd,
  signinLostAction,
  signinLostGroupEmail,
  signinLostText,
  signinLostTextAction,
} from "@/lib/signin-lost";
import { dueSoonLine, recheckDecision, signinDueSoon, siteWorkPhrase } from "@/lib/site-work-waiting";
import { loadSiteWork } from "@/lib/site-work-waiting-server";
import { requestSessionCheck } from "@/lib/distribution-session-status";
import { triggerSessionCheck } from "@/lib/site-signin-dispatch";
import { triggerRentalsTakedown } from "@/lib/post-now";
import { claimNull } from "@/lib/claim-stamp";
import { loadExtraRecipients, withExtras } from "@/lib/message-recipients-server";

// S736: email the landlord once when Kijiji, Zumper or Rentals.ca signs them
// out (lib/signin-lost). Runs in the 15-minute sweep. Only accounts with the
// Posting add-on (the robot posts for them) and not closed. ?dry=1 reports.
// S762: the link opens the sign-in window at once (?open=1), and a Growth
// landlord with texting on who saved their own mobile also gets a text
// (once per sign-out, never in quiet hours: it waits for the morning).
// S841d (REVIEW-S841-SIGNIN-GROUPING): three changes, all per account.
//  1. Ask only when work is waiting on the signed-out site (an ad to post,
//     change, take down or renew; lib/site-work-waiting). Until then no email,
//     no text and no stamp, so the ask goes out the moment work appears.
//  2. One check, one ask: when a site is found signed out, the other sites are
//     checked again first (they are looked at by different machines at
//     different hours), then ONE email and ONE text name every site.
//  3. A site that still works but is late in a sign-in that usually ends soon
//     is named as worth doing in the same sitting.

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
    "organization_id, channel, alive, last_check_code, lost_notified_at, lost_texted_at, last_checked_at, check_requested_at, last_validated_at, organization:organizations(name, plan, posting_addon_active, closed_at, brand_color, logo_url, sms_enabled, alert_mobile_e164, booking_timezone)",
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
  const nowISO = now.toISOString();
  const report: { org: string; channel: string; action: string }[] = [];
  type Row = {
    organization_id: string;
    channel: SiteSigninChannel;
    alive: boolean | null;
    last_check_code: string | null;
    lost_notified_at: string | null;
    lost_texted_at: string | null;
    last_checked_at?: string | null;
    check_requested_at?: string | null;
    last_validated_at?: string | null;
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
  };
  const byOrg = new Map<string, Row[]>();
  for (const r of (rows ?? []) as unknown as Row[]) {
    if (!isSiteSigninChannel(r.channel)) continue;
    byOrg.set(r.organization_id, [...(byOrg.get(r.organization_id) ?? []), r]);
  }
  const isLost = (r: Row) => r.alive === false && (SIGNIN_LOST_CODES as readonly string[]).includes(r.last_check_code ?? "");
  const inOrder = (a: Row, b: Row) => SITE_SIGNIN_ORDER.indexOf(a.channel) - SITE_SIGNIN_ORDER.indexOf(b.channel);
  const stampWhere = (r: Row) => ({ organization_id: r.organization_id, channel: r.channel });

  for (const [orgId, orgRows] of byOrg) {
    const org = orgRows[0].organization;
    const orgLabel = org?.name ?? orgId;
    const textsOn = !!org && org.sms_enabled === true && canUseRenterSms(org.plan) && smsLive();
    const quiet = isWithinQuietHours(now, org?.booking_timezone || "America/Toronto");
    const textActionFor = (r: Row) =>
      signinLostTextAction({
        alive: r.alive,
        lastCheckCode: r.last_check_code,
        lostTextedAt: r.lost_texted_at,
        alertMobile: org?.alert_mobile_e164 ?? null,
        textsOn,
        quiet,
      });

    // A site that works again clears its stamps, so the next sign-out asks again.
    for (const r of orgRows) {
      if (textActionFor(r) === "clear" && !dry) {
        await admin.from("distribution_channel_sessions").update({ lost_texted_at: null }).eq("organization_id", orgId).eq("channel", r.channel);
      }
      const action = signinLostAction({ alive: r.alive, lastCheckCode: r.last_check_code, lostNotifiedAt: r.lost_notified_at });
      if (action === "clear") {
        if (!dry) {
          await admin.from("distribution_channel_sessions").update({ lost_notified_at: null }).eq("organization_id", orgId).eq("channel", r.channel);
        }
        report.push({ org: orgLabel, channel: r.channel, action });
      }
    }

    const lost = orgRows.filter(isLost).sort(inOrder);
    if (lost.length === 0) continue;
    // Only landlords the robot posts for, on an open account.
    if (!org || org.closed_at || !canSetUpRobotSites(org)) continue;

    // 1. Ask only when something is waiting there.
    const work = await loadSiteWork(admin, orgId, org.booking_timezone || "America/Toronto", now);
    const withWork = lost.filter((r) => work[r.channel].waiting);
    const canWait = lost.filter((r) => !work[r.channel].waiting);
    for (const r of canWait) {
      if (!r.lost_notified_at) report.push({ org: orgLabel, channel: r.channel, action: "held_nothing_waiting" });
    }
    const emailRows = withWork.filter((r) => !r.lost_notified_at);
    const textRows = withWork.filter((r) => textActionFor(r) === "text");
    for (const r of withWork) {
      if (textActionFor(r) === "wait") report.push({ org: orgLabel, channel: r.channel, action: "text_waits_for_morning" });
    }
    if (emailRows.length === 0 && textRows.length === 0) continue;

    // 2. One check, one ask: look at the other sites before the one message.
    const asking = [...emailRows, ...textRows];
    const lostCheckedAt = asking.map((r) => r.last_checked_at ?? null).filter((t): t is string => !!t).sort().pop() ?? null;
    const others = orgRows.filter((r) => !isLost(r));
    const recheck = recheckDecision({
      lostCheckedAt,
      others: others.map((r) => ({
        channel: r.channel,
        alive: r.alive,
        lastCheckedAt: r.last_checked_at ?? null,
        checkRequestedAt: r.check_requested_at ?? null,
      })),
      nowISO,
    });
    if (recheck.request.length > 0 && !dry) {
      await requestSessionCheck({ orgId, channels: recheck.request, userId: null, admin, now }).catch(() => null);
      const cloud = recheck.request.filter((c) => isSiteSigninChannel(c) && !signinOpensAtHome(c));
      if (cloud.length > 0) await triggerSessionCheck(orgId, cloud);
      if (recheck.request.some((c) => isSiteSigninChannel(c) && signinOpensAtHome(c))) await triggerRentalsTakedown();
    }
    if (recheck.hold) {
      report.push({
        org: orgLabel,
        channel: asking[0].channel,
        action: recheck.request.length > 0 ? `checking_other_sites_first:${recheck.request.join("+")}` : "waiting_for_other_sites",
      });
      continue;
    }

    // 3. Sites that still work but are due to sign out soon.
    const dueSoon = others
      .map((r) => ({ r, d: signinDueSoon({ channel: r.channel, alive: r.alive, signedInAt: r.last_validated_at ?? null, nowISO }) }))
      .filter(({ d }) => d.soon && d.ageDays != null && d.usualDays != null)
      .sort((a, b) => inOrder(a.r, b.r));
    const several = withWork.length + dueSoon.length > 1;
    const first = withWork[0].channel;
    const path = siteSigninLinksOn()
      ? several
        ? withQuery(siteSigninOpenHref(first), "chain", "1")
        : siteSigninOpenHref(first)
      : "/dashboard/sites";
    const url = `${APP_URL}${path}`;

    // The text: one for every site that has not had one (S762 rules per site).
    if (textRows.length > 0) {
      for (const r of textRows) report.push({ org: orgLabel, channel: r.channel, action: "text" });
      if (!dry) {
        const claimed: Row[] = [];
        for (const r of textRows) {
          const claim = await claimNull(admin, "distribution_channel_sessions", stampWhere(r), "lost_texted_at");
          if (claim.outcome === "claimed") claimed.push(r);
        }
        if (claimed.length > 0) {
          const res = await sendSms({
            to: org.alert_mobile_e164,
            body: signinLostText({ siteLabel: joinAnd(claimed.map((r) => SITE_SIGNIN_LABEL[r.channel])), url }),
            organizationId: orgId,
          }).catch(() => ({ sent: false }));
          if (res.sent) texted++;
        }
      }
    }

    if (emailRows.length === 0) continue;
    for (const r of emailRows) report.push({ org: orgLabel, channel: r.channel, action: "notify" });
    if (dry) continue;

    // S742c: claim the stamps first (kept even when no owner had an email).
    let claimedAny = false;
    for (const r of emailRows) {
      const claim = await claimNull(
        admin,
        "distribution_channel_sessions",
        stampWhere(r),
        "lost_notified_at",
      );
      if (claim.outcome === "claimed") claimedAny = true;
      else report.push({ org: orgId, channel: r.channel, action: claim.outcome === "taken" ? "already_claimed" : `claim_failed:${claim.error}` });
    }
    if (!claimedAny) continue;

    const mail = signinLostGroupEmail({
      orgName: org.name,
      sites: withWork.map((r) => ({ label: SITE_SIGNIN_LABEL[r.channel], waiting: siteWorkPhrase(work[r.channel]) })),
      canWait: canWait.map((r) => SITE_SIGNIN_LABEL[r.channel]),
      dueSoon: dueSoon.map(({ r, d }) => dueSoonLine(SITE_SIGNIN_LABEL[r.channel], d.ageDays as number, d.usualDays as number)),
    });
    const { data: members } = await admin
      .from("memberships")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("role", "owner_admin");
    const ownerEmails: string[] = [];
    for (const m of (members ?? []) as { user_id: string }[]) {
      const { data } = await getUserByIdCached(admin, m.user_id);
      const e = data.user?.email?.trim().toLowerCase();
      if (e) ownerEmails.push(e);
    }
    // S824j: plus the addresses added under "Also send to".
    const recipients = withExtras(ownerEmails, await loadExtraRecipients(admin, orgId, "you-signin-lost"));
    for (const to of recipients) {
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
