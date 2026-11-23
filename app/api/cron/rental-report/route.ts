import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendRentalReportEmail } from "@/lib/email";
import { getUserByIdCached } from "@/lib/auth-email-cache";
import { torontoDateHour } from "@/lib/health-digest";
import { reportMonthFor } from "@/lib/rental-report";
import { loadRentalReport, type ReportProperty } from "@/lib/rental-report-server";
import { loadExtraRecipients, withExtras } from "@/lib/message-recipients-server";

// S831: the monthly report for each advertised rental, on the 1st of the month
// from 9 am Toronto time, covering the month before. Runs in the 15-minute
// sweep; the month stamp on the rental makes it once per month.
// ?dry=1 reports without sending or stamping; ?force=1 ignores the date (dry only).

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type Row = ReportProperty & {
  status: string | null;
  rental_report_sent_month: string | null;
  organization: { name: string | null; logo_url: string | null; closed_at: string | null; rental_report_enabled: boolean | null; viewings_by_request: boolean | null } | null;
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
    .from("properties")
    .select(
      "id, organization_id, address, rent_cents, available_since, report_next_steps, status, rental_report_sent_month, organization:organizations!properties_organization_id_fkey(name, logo_url, closed_at, rental_report_enabled, viewings_by_request)",
    )
    .eq("status", "available");
  if (error) return NextResponse.json({ ok: false, reason: `read:${error.code ?? "failed"}` }, { status: 500 });

  let sent = 0;
  const report: { property: string; action: string; facts?: unknown }[] = [];
  const started = Date.now();
  for (const p of (data ?? []) as unknown as Row[]) {
    if (Date.now() - started > 45_000) {
      report.push({ property: "-", action: "time_up_next_sweep" });
      break;
    }
    const org = p.organization;
    if (!org || org.closed_at || org.rental_report_enabled === false) continue;
    if (p.rental_report_sent_month === range.key) continue;
    const r = await loadRentalReport(admin, p, range, today, org.name, org.viewings_by_request === true);
    if (r.empty) {
      report.push({ property: p.address ?? p.id, action: "empty" });
      continue;
    }
    report.push({ property: p.address ?? p.id, action: dry ? "would_send" : "send", facts: r.facts });
    if (dry) continue;

    // Claim the month first so a second runner skips.
    const { data: claimed } = await admin
      .from("properties")
      .update({ rental_report_sent_month: range.key })
      .eq("id", p.id)
      .or(`rental_report_sent_month.is.null,rental_report_sent_month.neq.${range.key}`)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const { data: members } = await admin
      .from("memberships")
      .select("user_id")
      .eq("organization_id", p.organization_id)
      .eq("role", "owner_admin");
    const owners: string[] = [];
    for (const m of (members ?? []) as { user_id: string }[]) {
      const { data: u } = await getUserByIdCached(admin, m.user_id);
      const e = u.user?.email?.trim().toLowerCase();
      if (e) owners.push(e);
    }
    const to = withExtras(owners, await loadExtraRecipients(admin, p.organization_id, "you-rental-report"));
    for (const email of to) {
      const res = await sendRentalReportEmail({ to_email: email, subject: r.subject, html: r.html, org_name: org.name, logo_url: org.logo_url }).catch(
        () => ({ sent: false }),
      );
      if (res.sent) sent++;
    }
  }
  return NextResponse.json({ ok: true, sent, dry, month: range.key, report });
}
