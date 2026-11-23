import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendRentalReportEmail } from "@/lib/email";
import { getUserByIdCached } from "@/lib/auth-email-cache";
import { torontoDateHour } from "@/lib/health-digest";
import { reportMonthFor, reportSendOutcome } from "@/lib/rental-report";
import { loadAccountReport } from "@/lib/account-report-server";
import { loadExtraRecipients, withExtras } from "@/lib/message-recipients-server";

// S836b: one summary per account on the 1st of the month from 9 am Toronto,
// covering the month before (vacancy rate, rented and on the market, each
// unit's inquiries and showings, income and expenses, spend by site). Runs in
// the 15-minute sweep. Same switch and "Also send to" list as the per-rental
// reports. The month is claimed before sending; if nobody got it the claim is
// handed back so the next sweep retries, and the sweep answers ok:false.
// ?dry=1 reports without sending or stamping; ?force=1 ignores the date (dry only).

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type OrgRow = {
  id: string;
  name: string | null;
  plan: string | null;
  logo_url: string | null;
  closed_at: string | null;
  rental_report_enabled: boolean | null;
  account_report_sent_month: string | null;
};

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ ok: false, reason: "service_role_not_configured" }, { status: 500 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const force = dry && req.nextUrl.searchParams.get("force") === "1";
  const { date: today, hour } = torontoDateHour(new Date());
  if (!force && (today.slice(8, 10) !== "01" || hour < 9)) {
    return NextResponse.json({ ok: true, sent: 0, dry, skipped: "not_the_1st" });
  }
  const range = reportMonthFor(today);

  const { data, error } = await admin
    .from("organizations")
    .select("id, name, plan, logo_url, closed_at, rental_report_enabled, account_report_sent_month");
  if (error) return NextResponse.json({ ok: false, reason: `read:${error.code ?? "failed"}` }, { status: 500 });

  let sent = 0;
  const failed: string[] = [];
  const report: { org: string; action: string; facts?: unknown }[] = [];
  const started = Date.now();
  for (const org of (data ?? []) as OrgRow[]) {
    if (Date.now() - started > 45_000) {
      report.push({ org: "-", action: "time_up_next_sweep" });
      break;
    }
    if (org.closed_at || org.rental_report_enabled === false) continue;
    if (org.account_report_sent_month === range.key) continue;
    const r = await loadAccountReport(admin, { id: org.id, name: org.name, plan: org.plan }, range, today);
    if (r.empty) continue;
    const { units, sites, ...headline } = r.facts;
    report.push({ org: org.name ?? org.id, action: dry ? "would_send" : "send", facts: { ...headline, units: units.length, sites: sites.length } });
    if (dry) continue;

    // Claim the month first so a second runner skips.
    const { data: claimed } = await admin
      .from("organizations")
      .update({ account_report_sent_month: range.key })
      .eq("id", org.id)
      .or(`account_report_sent_month.is.null,account_report_sent_month.neq.${range.key}`)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const { data: members } = await admin.from("memberships").select("user_id").eq("organization_id", org.id).eq("role", "owner_admin");
    const owners: string[] = [];
    for (const m of (members ?? []) as { user_id: string }[]) {
      const { data: u } = await getUserByIdCached(admin, m.user_id);
      const e = u.user?.email?.trim().toLowerCase();
      if (e) owners.push(e);
    }
    const to = withExtras(owners, await loadExtraRecipients(admin, org.id, "you-rental-report"));
    let delivered = 0;
    let why: string | undefined;
    for (const email of to) {
      const res: { sent: boolean; reason?: string } = await sendRentalReportEmail({
        to_email: email,
        subject: r.subject,
        html: r.html,
        org_name: org.name,
        logo_url: org.logo_url,
      }).catch((e: unknown) => ({ sent: false, reason: `threw:${(e as Error)?.message ?? "error"}` }));
      if (res.sent) {
        sent++;
        delivered++;
      } else if (!why) why = res.reason;
    }
    const outcome = reportSendOutcome(to.length, delivered);
    if (outcome === "failed") {
      await admin
        .from("organizations")
        .update({ account_report_sent_month: org.account_report_sent_month })
        .eq("id", org.id)
        .eq("account_report_sent_month", range.key);
    }
    if (outcome !== "sent") {
      failed.push(`${org.name ?? org.id}:${outcome}${why ? `:${why.slice(0, 80)}` : ""}`);
    }
  }
  if (failed.length) {
    return NextResponse.json({ ok: false, reason: `account_report_${failed.length}_not_sent`, sent, dry, month: range.key, failed, report });
  }
  return NextResponse.json({ ok: true, sent, dry, month: range.key, report });
}
